'use strict';

/**
 * 手牌（业务层第一块）：把"这一手能看的东西"算出来。
 *
 * 分工：
 *   draw.js  决定**哪一张主卡**（四步入池 + 权重掷骰）
 *   hand.js  决定**桌上的形状**：主事件 / 突破 / 修炼 / 百艺 / 营生
 *   turn.js  决定"点了以后发生什么"
 *
 * r27 的形状（对应界面五块）：
 *   main    这一年的主事件（一手一张）
 *   breaks  修为满了的**常驻突破卡**（不再是年初抽的事件）
 *   train   修炼一行（锻体 / 炼气 / 养灵；满了就不出现）
 *   arts    百艺一行（12 门，按境界门槛锁）
 *   actions 营生（坊市、委托、出战、闲居…）
 *
 * 这里只筛选与排序，不结算、不改数值。
 */

const config = require('../repository/config');
const draw = require('./draw');
const calendar = require('./calendar');
const realm = require('../rules/realm');
const arts = require('../rules/arts');
const spells = require('../rules/spells');
const time = require('../rules/time');
const { evalWhen, bindArgs } = require('../rules/dsl');

const MONTHS_PER_YEAR = 12;

const DAO_CN = {
  body: { name: '锻体', bar: '内力', train: '打熬筋骨' },
  qi: { name: '炼气', bar: '法力', train: '导引吐纳' },
  spirit: { name: '养灵', bar: '灵力', train: '观照众生' },
  heart: { name: '修心', bar: '道心', train: '静坐' }
};

/* 可以按月修的三道。修心不吃月修为（I4），所以不在这里 */
const TRAINABLE = ['body', 'qi', 'spirit'];

const STUDY_MONTHS = 3;

function applyArgs(node, args) {
  return bindArgs(node, args);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const round1 = (v) => Math.round(num(v) * 10) / 10;

/**
 * 模板展开：模板给骨架，事件给 args 与文案。
 * `when` 是**两边都要满足**（模板的条件 + 事件自己的额外门槛），
 * 所以是拼起来而不是覆盖——覆盖会让"心性 ≥ 90"这类额外门槛静默失效。
 */
function expand(ev, templates) {
  if (!ev.template) return ev;
  const tpl = templates[ev.template];
  if (!tpl) return ev;

  const base = applyArgs(JSON.parse(JSON.stringify(tpl)), ev.args || {});
  delete base.params;
  delete base.desc;

  const merged = { ...base, ...ev };
  merged.nature = ev.nature || tpl.nature;
  merged.when = [...(base.when || []), ...(ev.when || [])];
  merged.choices = base.choices || [];
  merged.months = ev.months != null ? ev.months : base.months;
  merged.forced = ev.forced != null ? ev.forced : base.forced;
  merged.priority = ev.priority != null ? ev.priority : base.priority;
  merged.weight = ev.weight != null ? ev.weight : base.weight;
  merged.ttl = ev.ttl != null ? ev.ttl : base.ttl;
  return merged;
}

function all() {
  const templates = config.get('templates');
  return config.get('events')
    /* `gate` 事件只在"这一关该开了"时被点名，不进池子随机抽（r30） */
    .filter((e) => !e.superseded && !e.disabled && !e.gate)
    .map((e) => expand(e, templates));
}

/** 全部事件（含 gate）：gateEvent 要用 */
function everyEvent() {
  const templates = config.get('templates');
  return config.get('events')
    .filter((e) => !e.superseded && !e.disabled)
    .map((e) => expand(e, templates));
}

function ctxOf(state) {
  return {
    state,
    rules: config.get('rules'),
    conditions: config.get('conditions'),
    args: {},
    last: null
  };
}

/**
 * 今年能上桌的那一张（设计/20 §7：一手一张）。
 * r30：**一年只出一件主要事件**——处理掉以后，这一年就不再抽新的了
 * （`turn.mainDone` 由 `turn.commit` 置位，跨年清）。
 */
function hand(state, opts) {
  if (state.turn && state.turn.mainDone) return null;

  /* ① 到点的战事优先：日历事件不掷骰、不参与权重（设计/21 §2）。
        参数以日历为准（同一年同一座城，只有守备与月数不同）。 */
  const hit = calendar.due(state);
  if (hit) {
    const ev0 = { ...hit.event };
    ev0.args = { ...(ev0.args || {}), ...(hit.entry.params || {}) };
    const ev = expand(ev0, config.get('templates') || {});
    ev.fromCalendar = true;
    return ev;
  }

  /* ② 否则照常从池子里掷一张（事件瓶颈不占主事件，走「突破」按钮） */
  const picked = draw.mainOf(state, all(), ctxOf(state), opts);
  return picked ? decorate(state, picked) : picked;
}

/**
 * 给"选百艺"那张卡做动态加工（r41）。
 *
 * 需求：**推荐一门上限最高的**，不然玩家随便选一门没天赋的，
 * 练到 1 档就封顶，白白浪费一次强制事件。
 *
 * 做法：按 `arts.talentRank` 把选项从高到低排，并在 hint 里写清
 * 「这门你能到第几档」。有天赋那门排第一，并标一个「推荐」。
 */
function decorate(state, ev) {
  if (!ev || ev.id !== 'evt.art.choose') return ev;
  const arts = require('../rules/arts');
  const CAP_CN = { 1: '1 档', 2: '2 档', 3: '3 档', 4: '4 档（宗师）' };

  const out = ev.choices.map((c) => {
    const id = String(c.id);
    if (!arts.byId(id)) return { ...c, order: 99 };
    const rank = arts.talentRank(state, id);            /* 0 无 / 1 下 / 2 上 / 3 绝 */
    const cap = arts.capOf(state, id);                  /* 数字 1..4 */
    const talentCn = arts.TALENT_CN[arts.talentOf(state, id)] || '无';
    return {
      ...c,
      order: 9 - rank,                                  /* 天赋越高越靠前 */
      hint: `${c.hint || ''}（你的天赋：${talentCn}，最高 ${CAP_CN[cap] || cap + ' 档'}）`
    };
  }).sort((a, b) => (a.order - b.order));

  /* 第一名如果真有天赋，标一下"推荐" */
  if (out.length && arts.talentRank(state, out[0].id) > 0) {
    out[0] = { ...out[0], hint: `【推荐】${out[0].hint}` };
  }
  return { ...ev, choices: out };
}

/**
 * 事件瓶颈对应的那条事件（r30 定稿：由玩家点「突破」主动去过这一关）。
 * 找不到就返回 null——那说明这一关的剧情还没写。
 */
function gateOf(state, dao, tier) {
  return everyEvent().find((e) => e.gate
    && e.gate.dao === dao && num(e.gate.tier) === num(tier)) || null;
}

/** 常驻动作：只筛条件，不做别的（它们不进事件池，没有权重） */
function resident(state) {
  const ctx = ctxOf(state);
  return config.get('actions')
    .filter((a) => !a.disabled)
    .filter((a) => evalWhen(a.when || [], ctx));
}

/* ── 突破（常驻，修为满了就有） ───────────────────────── */

function studiedFlag(state, dao, tier) {
  const s = (state.flags || {}).study || {};
  return !!(s[dao] && s[dao][String(tier)]);
}

function inSchool(state) {
  const stage = state.education && state.education.stage;
  return stage === 'meng' || stage === 'fu' || stage === 'tai';
}

/** 求指导的价格：按品递增（毕业以后没有免费的师父了） */
function tutorCost(tier) {
  return 200 * Math.max(1, num(tier));
}

/**
 * 修为满了 → 一张突破卡。
 *
 * r28 两件不同的事，分清楚：
 *   · **入门关**（level = 0，第 1 品）：没有修为条，只看门槛（`BREAK_GATE.<dao>.1`）。
 *     "没墙就直接进"这件事在开局就判完了（`systems/opening.js`）。
 *   · **品内突破**（level ≥ 1）：站在本品的修为练满（`PROF[level-1]`）才有资格冲下一品。
 *     没满也把卡摆出来，只是按钮灰着、写明还差多少——**看得见门槛**。
 */
function breakCards(state) {
  const rules = config.get('rules');
  const ctx = ctxOf(state);
  const tiers = rules.TIERS || {};
  const out = [];

  for (const dao of ['body', 'qi', 'spirit', 'heart']) {
    const p = state.path[dao];
    if (!p) continue;

    const level = num(p.level);                        /* 境界（站在第几品） */
    const lv = num(p.lv != null ? p.lv : p.level);     /* 层级（门通到第几层） */

    /* r36：下一张卡永远是"**下一个境界**"（`level + 1`）。
       它有两种状态：
         · lv < level+1 → 层级还没通 → 卡是「冲关」
         · lv ≥ level+1 → 层级通了 → 卡是「突破境界」（玩家点不点随他） */
    const tier = level + 1;
    const prof = rules.PROF[dao] || [];
    if (tier > prof.length) continue;                 /* 这一道已经到顶了 */

    const cap = realm.barMax(state, dao, rules);
    const barFull = cap == null ? true : num(p.bar) >= cap - 0.001;

    const entryCard = level === 0 && tier === 1;
    const levelReady = lv >= tier;

    /* 事件瓶颈的月数由那件事自己定（大心关三个月、武名动四方三个月…） */
    const kind = realm.bottleneckOf(dao, tier);
    const gateEv = kind === 'prob' ? null : gateOf(state, dao, tier);

    const gate = (((rules.BREAK_GATE || {})[dao] || {})[String(tier)]) || {};
    const gateOk = evalWhen(gate.when || [], ctx);
    const studied = studiedFlag(state, dao, tier);
    const school = inSchool(state);
    const cost = school ? 0 : tutorCost(tier);

    /* 求学只对**概率瓶颈**有用，而且要等修为练满、真卡在那儿了才有意义
       （需求/11 §7、需求/20 §7：求学在"有瓶颈"时出现）。品 5/6 是事件瓶颈，求学无效。 */
    const canStudy = !studied && gateOk && barFull && realm.bottleneckOf(dao, tier) === 'prob';

    out.push({
      key: `break:${dao}:${tier}`,
      dao,
      tier,
      level,                                        /* 境界：站在第几品 */
      lv,                                           /* 层级：门通到第几层 */
      /* prob = 概率瓶颈（掷骰冲关）；其余 = 事件瓶颈（把那一件事办掉） */
      kind,
      entry: level === 0 && dao !== 'heart',        /* 入门关：没有修为条 */
      title: (tiers[dao] || [])[tier - 1] || `第 ${tier} 品`,
      daoName: DAO_CN[dao] ? DAO_CN[dao].name : dao,
      /* 闭关多久：按属性反比（r33）——资质好的人破同样的关快些 */
      months: time.breakMonths(state, dao, tier),
      ready: barFull,
      /* r36：lv 到位 → 只剩"点不点突破"；没到位 → 这张卡是"冲关" */
      levelReady,
      bar: round1(p.bar),
      barMax: cap == null ? null : round1(cap),
      gateOk,
      gateHint: gateOk ? '' : (gate.hint || '还差些火候。'),
      study: canStudy
        ? { label: school ? '求学' : '求指导', months: STUDY_MONTHS, cost, free: school }
        : null,
      studied
    });
  }
  return out;
}

/* ── 修炼一行 ─────────────────────────────────────────── */

function trainRow(state) {
  const rules = config.get('rules');
  const left = MONTHS_PER_YEAR - num(state.monthsUsed);
  if (left <= 0) return [];

  const out = [];
  for (const dao of TRAINABLE) {
    const p = state.path[dao];
    if (!p) continue;
    /* 没入品（没有修为条）就先过门槛；修为满了就只剩突破——两种情况都不给修炼 */
    if (!realm.canTrain(state, dao, rules)) continue;

    const need = realm.monthsToFull(state, dao, rules);
    const months = Math.max(1, Math.min(left, Number.isFinite(need) ? need : left));
    const gain = realm.monthGain(state, dao) * months;
    const barMax = num(realm.barMax(state, dao, rules));

    out.push({
      id: `train.${dao}`,
      dao,
      name: DAO_CN[dao].train,
      sub: `${DAO_CN[dao].bar} +${round1(gain)}`,
      months,
      bar: round1(p.bar),
      barMax: round1(barMax),
      toFull: Number.isFinite(need) ? need : null
    });
  }
  return out;
}

/* ── 百艺一行 ─────────────────────────────────────────── */

/** 几岁才谈得上手艺（rules.ARTS.age，默认 14；需求/13 §2.2） */
function artAge() {
  const A = (config.get('rules') || {}).ARTS || {};
  return num(A.age != null ? A.age : 14);
}

/**
 * 十四岁以前不放出来：百艺是"手艺"，不是蒙学功课。
 * 每一门自己还有门槛（`arts.json#req`），没过的锁着并写明要先到哪一品。
 *
 * r30：**只有学过的才能练**。没学过的给一个"求学"价，第一门免费、后面收学费。
 */
function artRow(state) {
  const age = num(state.clock.age);
  if (age < artAge()) return [];

  const A = (config.get('rules') || {}).ARTS || {};
  const base = num(A.studyCost != null ? A.studyCost : 300);
  const cost = arts.learnedCount(state) === 0 ? 0 : base;

  return arts.publicList(state).map((a) => ({
    ...a,
    /* 已学：练到升档要几个月；没学：拜师要几个月（r34 一次到底） */
    months: a.learned ? (arts.monthsToNext(state, a.id) || 0) : time.learnMonths(state, 'art'),
    learnCost: cost
  }));
}

/* ── 法术一行 ─────────────────────────────────────────── */

/**
 * 法术列表（r39 重做）。
 *
 * **分成两份，别混**（需求/15 §1.2、`设计/40` §3.2.1）：
 *   practice — **我已经学了的**，这一格是"怎么练"（没买的术法不该出现在这里）
 *   learn    — **我今天真能学的**：境界够 且 有一条能走的来路（有钱 / 在学 / 有军功）
 *
 * 境界不够的（比如要法相才能学的）**一律不出现**——他没到那儿，那门对他等于不存在。
 */
function spellRow(state) {
  const practice = spells.publicList(state, { only: 'known' }).map((s) => ({
    ...s,
    months: spells.monthsToNext(state, s.id) || 0
  }));

  const learn = spells.publicList(state, { only: 'actionable' })
    .filter((s) => !s.known)
    .map((s) => ({
      ...s,
      months: time.learnMonths(state, 'spell')
    }));

  /* 兼容老调用方：合并成一个数组（练的在前） */
  return practice.concat(learn);
}

/** 只给"练"的那一份（界面用这个分栏） */
function spellPractice(state) {
  return spells.publicList(state, { only: 'known' }).map((s) => ({
    ...s,
    months: spells.monthsToNext(state, s.id) || 0
  }));
}

/** 只给"能学"的那一份 */
function spellLearn(state) {
  return spells.publicList(state, { only: 'actionable' })
    .filter((s) => !s.known)
    .map((s) => ({
      ...s,
      months: time.learnMonths(state, 'spell')
    }));
}

/* ── 兜底：还有月份，却没有一件做得成的事 ───────────── */

function choiceFits(months, left) {
  return (months == null ? 1 : months) <= left;
}

function nothingToDo(state, main, breaks, train, art, actions) {
  const left = MONTHS_PER_YEAR - num(state.monthsUsed);
  if (left <= 0) return false;

  if (main) {
    const choices = (main.choices && main.choices.length)
      ? main.choices
      : [{ months: main.months }];
    if (choices.some((c) => choiceFits(c.months != null ? c.months : main.months, left))) return false;
  }
  if (breaks.some((b) => b.gateOk && b.ready && choiceFits(b.months, left))) return false;
  if (train.some((t) => choiceFits(t.months, left))) return false;
  if (art.some((a) => !a.locked && choiceFits(a.months, left))) return false;
  if (actions.some((a) => choiceFits(a.months, left))) return false;
  return true;
}

/**
 * 桌上有什么。
 * I15：主卡是强制事件时，其余全部封住（不是灰掉，是不给）。
 */
function table(state) {
  if (state.dead) {
    return {
      main: null, events: [], breaks: [], train: [], arts: [], spells: [],
      spellPractice: [], spellLearn: [], actions: [],
      locked: false, canWait: false, monthsLeft: 0, artAge: artAge()
    };
  }

  const main = hand(state);
  const events = main ? [main] : [];
  const locked = !!(main && main.forced);

  if (locked) {
    return {
      main, events,
      breaks: [], train: [], actions: [],
      /* 左栏要显示"我学了什么、练到哪了"——封住的只是"能不能做"，不是"能不能看" */
      arts: artRow(state),
      spells: spellRow(state),
      spellPractice: spellPractice(state),
      spellLearn: spellLearn(state),
      locked: true, canWait: draw.nothingToDo(state, main), monthsLeft: MONTHS_PER_YEAR - num(state.monthsUsed),
      artAge: artAge()
    };
  }

  const breaks = breakCards(state).filter((b) => (b.entry ? b.gateOk : true));
  const train = trainRow(state);
  const art = artRow(state);
  const actions = resident(state);

  /* r39：法术分两份——"练"（已学）与"学"（今天真能学） */
  const spellPracticeList = spellPractice(state);
  const spellLearnList = spellLearn(state);

  return {
    main,
    events,
    breaks,
    train,
    arts: art,
    /* 老字段：合并版，给不区分练/学的调用方 */
    spells: spellPracticeList.concat(spellLearnList),
    /* 新字段：界面按这两个分栏画 */
    spellPractice: spellPracticeList,
    spellLearn: spellLearnList,
    actions,
    locked: false,
    canWait: nothingToDo(state, main, breaks, train, art, actions),
    monthsLeft: MONTHS_PER_YEAR - num(state.monthsUsed),
    artAge: artAge()
  };
}

module.exports = {
  hand, resident, table, all, expand, MONTHS_PER_YEAR,
  breakCards, trainRow, artRow, spellRow, spellPractice, spellLearn, decorate,
  gateOf, artAge, inSchool, tutorCost, DAO_CN
};
