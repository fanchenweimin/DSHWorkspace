'use strict';

/**
 * 回合结算：把"点一下"变成状态变化。
 *
 * 顺序（写死，别调换）：
 *   1. 查月份够不够 —— 不够就整件事不发生
 *   2. 扣钱（选项上明码标价的 cost）
 *   3. 耗月 / 标已处理 / 写"你做了什么"
 *   4. 跑 effects（数值效果）
 *   5. 满 12 月翻年：长一岁、清手牌、修饰器到期、修为取整、写年份分隔
 *
 * 效果执行在 `systems/effects.js`；这里的职责只有时间与顺序。
 */

const handSys = require('./hand');
const effects = require('./effects');
const draw = require('./draw');
const calendar = require('./calendar');
const realm = require('../rules/realm');
const arts = require('../rules/arts');
const spells = require('../rules/spells');
const grade = require('../rules/grade');
const mods = require('../rules/mods');
const config = require('../repository/config');
const time = require('../rules/time');

const MONTHS_PER_YEAR = 12;
const DIGIT = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 309 -> 三〇九 */
function cnYear(n) {
  return String(n).split('').map((d) => DIGIT[Number(d)] || d).join('');
}

function monthsText(n) {
  if (n === 0) return '顷刻';
  return n === 1 ? '一个月' : `${n} 个月`;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 年末修为取整（设计/02 §6）：只在小数位存在时掷，气运决定进位方向。
 * 不掷的话小数位年年被舍弃，等于慢性扣修为。
 */
function roundBars(state) {
  const p = 0.5 + (num(state.luck) - 50) * 0.001;
  for (const dao of ['body', 'qi', 'spirit', 'heart']) {
    const path = state.path[dao];
    if (!path) continue;
    const frac = path.bar - Math.floor(path.bar);
    if (frac <= 0.001) continue;
    path.bar = Math.floor(path.bar) + (Math.random() < p ? 1 : 0);
  }
}

/**
 * 满一年。**年初链的顺序写死**（设计/00 I7、需求/01 §6、需求/20 §10.1）：
 *
 *   ① 寿元  ② 气运漂移  ③ 心性衰减  ④ 心魔  ⑤ 城池层（未接）  ⑥ 跨年动作（暂缓）  ⑦ 掷事件
 *
 * 顺序不能换：先衰减再掷心魔，与先掷再衰减，是两个人不同的死法。
 */
function rollYear(state) {
  const rules = config.get('rules');

  state.clock.year += 1;
  state.clock.age += 1;
  state.monthsUsed = 0;
  state.handled = [];
  state.turn = state.turn || {};
  state.turn.breakthroughUsed = false;
  /* r40.1：**每道各自一年一次**，跨年清空记账 */
  state.turn.brokeThisYear = {};

  /* r39：品内小境界"一年一次"的记账，跨年清零（入门关本来就不记） */
  for (const dao of ['body', 'qi', 'spirit', 'heart']) {
    const p = state.path && state.path[dao];
    if (p) p.triedYear = {};
  }
  state.turn.mainId = null;      /* 新的一年重抽主卡（设计/20 §9） */
  state.turn.mainDone = false;   /* 新的一年才又有"一件大事" */
  state.turn.heartBlocked = false;  /* 心魔活下来的"当年不可再发起心关"解除 */
  mods.expire(state);
  roundBars(state);

  /* 坊市的货架当年有效：跨年就收摊（需求/20 §7：1 月/次） */
  if (state.flags && state.flags.market) delete state.flags.market.open;

  /* ── ① 寿元（设计/20 §9 step1_lifespan） ───────────────── */
  state.lifespan = realm.lifespanOf(state, rules);
  if (state.clock.age > state.lifespan) {
    state.dead = true;
    state.log.push(`你活到了 ${state.clock.age} 岁。这一年冬天，你没能再睁眼。`);
    state.log.push(`— 大曜历${cnYear(state.clock.year)}年 · ${state.clock.age} 岁 —`);
    return;
  }

  /* ── ② 气运漂移（需求/01 §4：每年向 50 回归 ±1） ─────────── */
  const luck = num(state.luck != null ? state.luck : 50);
  if (luck !== 50) {
    state.luck = luck + (luck > 50 ? -1 : 1);
  }

  /* ── ③ 心性衰减（需求/01 §3.2：定时任务，只到 60 为止） ─────── */
  const decay = realm.heartDecay(state, rules);
  if (decay > 0) {
    state.log.push(`日子又磨去一点。心性 −${decay}（现 ${Math.round(num(mods.get(state, 'attr.heart.eff')))}）。`);
  }

  /* ── ③.5 世界认可 · 唤醒（r44，需求/11 §1.2.2） ──────────────
     这是"事件 1"，**必出、不占主事件位**：
       · 4 品修为满 + 门槛过 → 看有没有「世界认可」
           · 有  → 直接 lv = 5（跳过事件 2）
           · 没有 → 唤醒事件 2（让「有人记住了你」能进池）
     它必须放在心魔之后、战事之前：心魔可能中断这一年，唤醒不该白做。 */
  const recog = require('./recognition');
  const wake = recog.settleWakeUp(state, rules);
  for (const w of wake) {
    if (w.action === 'granted') {
      state.log.push(`你冲第 5 品那天，才发现不必再证明什么——${w.daoName}的门槛，世界早就替你跨过了。`);
    } else {
      state.log.push(`你${w.daoName}已修到第四品圆满。可这城里，似乎还没人认得你。`);
    }
  }

  /* ── ④ 心魔（需求/01 §3.5：心性 0–39 每年掷一次） ──────────── */
  const demon = realm.rollDemon(state, rules, Math.random);
  if (demon) {
    if (demon.survived) {
      state.log.push(`这一年你心里有什么东西碎了。你熬过来了，但什么都没剩下。（心性 ${Math.round(demon.heart)} → ${Math.round(demon.after)}，修为清零）`);
    } else {
      state.log.push(`你没能从那一夜里走出来。心性 ${Math.round(demon.heart)}，心魔在你心里生了根。`);
      state.log.push(`— 大曜历${cnYear(state.clock.year)}年 · ${state.clock.age} 岁 —`);
      return;
    }
  }

  /* ── ⑤ 城池层（未接）、⑥ 跨年动作（r35 暂缓） ─────────────── */

  /* ── ⑦ 战事日历（设计/21 §2：到点必来，不看概率） ──────────── */
  calendar.sync(state);

  state.log.push(`— 大曜历${cnYear(state.clock.year)}年 · ${state.clock.age} 岁 —`);
}

/**
 * 把这一年剩下的月过完（设计/20 §9：挡住的年底就结束）。
 * 不弹窗、不确认——点一下就是"这一年就这么过去了"。
 *
 * r38 修：如果**月份已经用完**（`monthsUsed >= 12`）但年份还没翻
 * （比如调用方直接把 `monthsUsed` 设成 12，或者某条路径耗完月却没走 `commit`），
 * 这里要兜底翻年——否则玩家会卡在"这一年已经过完了"里出不来。
 */
function pass(state, note) {
  const left = budget(state);
  if (left <= 0) {
    /* 月份已经满了：兜底翻年，别让人卡死 */
    if (!state.dead) {
      rollYear(state);
      return { ok: true, months: 0, waited: true, rolled: true };
    }
    return { ok: false, reason: '这一年已经过完了。' };
  }
  state.monthsUsed = MONTHS_PER_YEAR;
  state.log.push(note || `剩下的 ${left} 个月，你没有再做什么。`);
  rollYear(state);
  return { ok: true, months: left, waited: true };
}

function gradeLabel(g) {
  return grade.short(g.jie, g.pin);
}

function budget(state) {
  return MONTHS_PER_YEAR - num(state.monthsUsed);
}

/**
 * 真正结算一步。
 * payload: { id, months, text, list, event, args, choice, keepMain }
 */
function commit(state, payload) {
  const { id, text, list, event, args, choice, keepMain, quiet, mainEvent, span } = payload;

  /* r32：跨年的事（城战 / 国战这类 `span: true`）把今年的月用完，
     剩下的月记到明年开春——以前是"今年月不够就整件事做不成"，一座城就这么白丢了。 */
  let months = payload.months != null ? payload.months : 1;
  let carry = 0;
  const left = budget(state);
  if (months > left) {
    if (!span) {
      return { ok: false, reason: `今年只剩 ${left} 个月，这件事要 ${months} 个月。` };
    }
    carry = months - left;
    months = left;
  }

  state.monthsUsed += months;
  if (id) {
    state.handled.push(id);
    draw.markFired(state, id);      /* 冷却 / 一生一次 / 每年次数都记在这 */
    /* 排定的事件已经上桌，从待办里摘掉 */
    if (Array.isArray(state.pending)) state.pending = state.pending.filter((p) => p.event !== id);
  }
  /* 0 月的事（吃药、买东西）不写"（顷刻）"，那句话只用来交代耗了多久 */
  if (text) state.log.push(months > 0 ? `${text}（${monthsText(months)}）` : text);

  const ran = effects.run(state, list || [], {
    rules: config.get('rules'),
    conditions: config.get('conditions'),
    macros: config.get('macros'),
    args: args || {},
    event: event || null,
    choice: choice || null,
    quiet: !!quiet
  });

  if (state.log.length > 400) state.log = state.log.slice(-260);

  /* 这一手用掉了，下一手重新抽（设计/20 §7 第 3 条：每处理完一条就重算批）
     0 月的动作（吃药）不换卡，否则点一次药主卡就跳一张 */
  state.turn = state.turn || {};
  if (!keepMain && months > 0) state.turn.mainId = null;
  /* r30：一年只有一件主要事件——办完就收摊，不再一张接一张 */
  if (mainEvent) state.turn.mainDone = true;

  const rolled = state.monthsUsed >= MONTHS_PER_YEAR;
  if (rolled) {
    rollYear(state);
    if (carry > 0) {
      state.monthsUsed = Math.min(MONTHS_PER_YEAR, carry);
      state.log.push(`这件事还没完，开春接着做——今年已经过去 ${state.monthsUsed} 个月。`);
    }
  }

  return {
    ok: true, months, carry, rolled,
    errors: ran.errors, notes: ran.notes, battles: ran.battles
  };
}

/* ── 修炼：一次修到满（或修到年底） ───────────────────── */

function train(state, payload) {
  const rules = config.get('rules');
  const dao = String(payload.dao || String(payload.id || '').replace(/^train\./, ''));
  if (!state.path[dao]) return { ok: false, reason: '没有这一道。' };

  const left = budget(state);
  if (left <= 0) return { ok: false, reason: '这一年已经过完了。' };
  if (dao === 'heart') return { ok: false, reason: '道心不吃月修为，只能靠心关。' };

  const cap = realm.barMax(state, dao, rules);
  if (cap == null) {
    /* 没有修为条：要么还没入品（只有门槛），要么已经站到这一道的顶 */
    const level = num(state.path[dao].level);
    return {
      ok: false,
      reason: level < 1 ? '还没入品，先把那一关过了。' : '这一道已经到顶了，没有可修的了。'
    };
  }
  if (!realm.canTrain(state, dao, rules)) {
    return { ok: false, reason: '这一道已经满了，只剩突破。' };
  }

  const need = realm.monthsToFull(state, dao, rules);
  const months = Math.max(1, Math.min(left, Number.isFinite(need) ? need : left));

  return commit(state, {
    id: null,
    months,
    text: `你连着修了${monthsText(months)}。`,
    list: [{ train: { dao, months } }],
    event: null
  });
}

/* ── 突破：常驻卡上的一次冲关 / 求学 ──────────────────── */

function breakAct(state, payload) {
  const dao = String(payload.dao || '');
  const tier = num(payload.tier);
  const rules = config.get('rules');
  const card = handSys.breakCards(state).find((b) => b.dao === dao && b.tier === tier);
  if (!card) return { ok: false, reason: '这一关还没到。' };
  if (!card.gateOk) return { ok: false, reason: card.gateHint || '还差些火候。' };

  if (payload.mode === 'study') {
    if (card.kind !== 'prob') return { ok: false, reason: '这一关求人没用。' };
    if (!card.study) return { ok: false, reason: '这一关已经求过人了。' };
    const cost = num(card.study.cost);
    if (cost > 0 && mods.moneyTotal(state) < cost) return { ok: false, reason: '钱不够。' };

    const list = [];
    if (cost > 0) list.push({ money: { copper: -cost } });
    list.push({ call: { macro: 'macro.study.session', args: { dao, tier } } });

    return commit(state, {
      id: null,
      months: card.study.months || 3,
      text: `${card.study.label}一次。`,
      list,
      event: null
    });
  }

  /* 修为得先练满（「练满才有资格破下一品」）。
     入门关（第 1 品）没有修为条，不受这条限制。 */
  if (!card.ready) {
    const left = Math.max(0, num(card.barMax) - num(card.bar));
    return { ok: false, reason: `修为还没练满，还差 ${Math.round(left)}。先修满再说。` };
  }

  /* 品内真实突破全局一年一次。但只有"会造成进品"的点击才看名额：
     · 概率瓶颈：一次点击 = 判定 + 进品，名额没够直接拒（省月份）；
     · 层级已到位（事件瓶颈办完事）：点的是"突破境界"，看名额；
     · 事件瓶颈还没办事：点的是"把那件事办掉"，只通层级不进品——
       名额用光也该能办，进品等明年（"条件满足了也可以不突破"是合法状态）。
     入门关不受名额限制。 */
  const isEntry = num((state.path[dao] || {}).level) === 0 && tier === 1;
  const willBreak = card.levelReady || card.kind === 'prob';
  /* r40.1：**每道一年一次**——锻体破过不影响炼气，但同一道今年只能破一次 */
  if (willBreak && !isEntry && realm.brokeThisYear(state, dao)) {
    return { ok: false, reason: '这一年这一道已经破过了。' };
  }

  /* r40.2：**同一个瓶颈、同一年，只准冲一次**（需求/15 §1.3）。
     这一段必须在 `commit` **之前**——否则失败也会扣 3 个月、写一条
     「你闭关冲调息」的纪事，玩家一年能连点好几次，日志里看起来就像
     "突破重复了"，而实际上境界一次都没动。
     入门关豁免（体魄/感气那种，当年可以一直试）。 */
  if (!isEntry && card.kind === 'prob') {
    const tried = (state.path[dao].triedYear || {})[tier];
    if (num(tried) === num(state.clock.year)) {
      return { ok: false, reason: '这一品今年已经冲过了，等明年再来。' };
    }
  }

  /* ── 层级已到位 → 这一步是"真实境界突破" ──────────────
     r40：事件瓶颈先由事件通 lv，再在这里由玩家手动进品。
     概率瓶颈正常不会停在这个状态：它的判定与进品已在同一次点击里完成；
     保留此分支用于事件瓶颈，以及旧存档中已经通了 lv 的概率瓶颈。 */
  if (card.levelReady) {
    const r = realm.breakthrough(state, { dao, tier }, { rules, rng: Math.random });
    if (!r.ok) {
      const why = {
        need_level: '这道门的关窍还没通。',
        heart_low: `心性不够（${Math.round(r.heart)} / 需要 ${r.need}），这一关必然失败。`,
        one_per_year: '一年只能破一次境界。今年已经破过了。',
        already: '已经在这一品了。'
      }[r.why] || '这一关过不去。';
      return { ok: false, reason: why };
    }
    state.log.push(`你破了「${card.title}」。从今天起，你站在这一品上了。`);
    return { ok: true, months: 0, broke: true, dao, tier };
  }

  /* 事件瓶颈（品 5/6、养灵、修心、法相…）：**不是掷骰，也不是按钮代办**。
     r42：它由事件自己上桌（`hand.gateDue`），玩家在事件里做选择，
     事件把 `lv` +1；等 `lv >= tier`，这张卡的 `levelReady` 变 true，
     那时才走上面"真实突破"那一支。

     所以到这一支时只有一种情况：**事件还没来**（修为没满 / 门槛没到）。
     不再替玩家选 `choices[0]`——那是替玩家做了决定。 */
  if (card.kind !== 'prob') {
    return {
      ok: false,
      reason: `这一关要等一件事：${card.title}。修为练满、条件到了，它会自己找上来。`
    };
  }

  /* r40：概率瓶颈只点这一次。macro.break.attempt 内部先判定，
     成功后立即真实进品并占用年度名额；不会再长出第二次「突破」点击。 */
  const beforeLevel = num((state.path[dao] || {}).level);
  const r = commit(state, {
    id: null,
    months: card.months || 1,
    text: `你闭关冲「${card.title}」。`,
    list: [{ call: { macro: 'macro.break.attempt', args: { dao, tier } } }],
    event: null
  });

  if (num((state.path[dao] || {}).level) >= tier && beforeLevel < tier) {
    state.log.push(`你破了「${card.title}」。从今天起，你站在这一品上了。`);
    r.broke = true;
  }
  return r;
}

/* ── 委托：每门百艺一条实战线（r39，需求/20 §7.4） ─────── */

/**
 * 接一单委托。
 *
 * payload: { mode: 'commission', art: 'alchemy', kind: 'odd'|'main' }
 *
 * 流程（需求/20 §7.4.2）：
 *   ① 手艺够不够（reqLv）
 *   ② 选杂活 / 正活
 *   ③ 出城的单：掷"路上事件"——**强制的**，遇上了必须处理
 *   ④ 结账
 */
function commissionAct(state, payload) {
  const com = require('./commission');
  const artId = String(payload.art || '');
  const pick = com.available(state).find((c) => c.art === artId);
  if (!pick) return { ok: false, reason: '没有这门手艺的委托。' };
  if (!pick.unlocked) return { ok: false, reason: pick.lockedWhy || '这门活你接不了。' };

  const isMain = payload.mode2 === 'main' || payload.kind === 'main';
  const pay = isMain ? pick.main.pay : pick.odd.pay;
  const risk = isMain ? pick.main.risk : 0;

  /* 出城 + 正活 → 掷路上事件 */
  let encounter = null;
  if (pick.outing && isMain && risk > 0 && Math.random() < risk) {
    encounter = pick.art;
  }

  const list = [];
  list.push({ money: { copper: pay } });
  list.push({ add: ['reputation.eff', isMain ? 3 : 1] });

  if (encounter) {
    /* 遇上了：钱先不给，改成一次死斗（对手按玩家品的 1.1 倍） */
    list.length = 0;
    list.push({
      judge: {
        kind: 'battle',
        scale: 1.1,
        kindName: '劫道的',
        match: 'death'
      }
    });
  }

  const months = num(pick.months) || 2;
  const text = encounter
    ? `你接了「${pick.name}」，出城走到半路——有人拦在前面。`
    : (isMain ? `你把「${pick.name}」接了，做完了。` : `你去给「${pick.name}」打了下手。`);

  const r = commit(state, {
    id: null,
    months,
    text,
    list,
    event: null
  });

  return { ...r, commission: { art: pick.art, name: pick.name, pay, encounter: !!encounter } };
}

/* ── 百艺：一次做一季（3 月） ────────────────────────── */

function artAct(state, payload) {
  const id = String(payload.id || '');
  const art = arts.byId(id);
  if (!art) return { ok: false, reason: '没有这门艺。' };

  const rules = config.get('rules');
  const openAge = num((rules.ARTS || {}).age != null ? rules.ARTS.age : 14);
  if (num(state.clock.age) < openAge) {
    return { ok: false, reason: `${openAge} 岁以后才谈得上手艺。` };
  }

  /* 每门艺自己的门槛：`req: { qi: 2 }` = 炼气要到第二品（需求/13 §2.2） */
  for (const [dao, lv] of Object.entries(art.req || {})) {
    if (num((state.path[dao] || {}).level) >= num(lv)) continue;
    const name = ({ body: '锻体', qi: '炼气', spirit: '养灵', heart: '修心' })[dao] || dao;
    const tier = (((rules.TIERS || {})[dao]) || [])[num(lv) - 1] || `第 ${lv} 品`;
    return { ok: false, reason: `这门艺要先到${name}·${tier}。` };
  }

  /* r30：没学过的手艺练不了——先花三个月（和一笔学费）去学 */
  if (!arts.learned(state, id)) return { ok: false, reason: '这门还没学，先拜个师。' };

  const left = budget(state);
  if (left <= 0) return { ok: false, reason: '这一年已经过完了。' };

  /* r34：和境界修炼一致——够升一档就只走到升档，不够就用完今年剩下的月。
     以前一季三个月，练一年要点四次。 */
  const need = arts.monthsToNext(state, id);
  const months = Math.min(left, need > 0 ? need : left);
  if (months <= 0) return { ok: false, reason: '这一年已经过完了。' };
  const before = arts.stateOf(state, id).lvl;
  const income = Math.round(arts.incomeOf(art, before) * months);
  const rep = Math.round(arts.repOf(art, before) * months);

  const res = arts.applyMonth(state, id, months);

  const list = [];
  if (income > 0) list.push({ money: { copper: income } });
  if (rep > 0) list.push({ add: ['reputation.eff', rep] });
  list.push({ log: `你把 ${monthsText(months)} 花在${art.name}上，得 ${income} 文。` });
  if (res.up) list.push({ log: `你的${art.name}到了「${arts.levelName(art, res.lvl)}」。` });

  /* r34：升档出一件实物，进囊中（能卖，价格按坊市半价回收） */
  if (res.made > 0) {
    const cid = `craft.${id}`;
    state.items = state.items || {};
    state.items[cid] = num(state.items[cid]) + res.made;
    const prod = arts.productOf(art, res.lvl);
    state.craftGrade = state.craftGrade || {};
    state.craftGrade[id] = { jie: prod.jie, pin: prod.pin };
    list.push({ log: `你做出了${res.made} 件${art.name}成品（${gradeLabel(prod)}）。` });
  }
  if (res.atCap && res.up) list.push({ log: `这已是你能到的最高阶了。` });

  return commit(state, {
    id: null,
    months,
    text: null,
    list,
    event: null,
    quiet: true
  });
}

/* ── 学一门手艺（14 岁以后）：第一门免费，后面花钱求学 ── */

/** 学费：第一门不要钱，从第二门起按 rules.ARTS.studyCost 收 */
function artStudyCost(state) {
  const A = (config.get('rules') || {}).ARTS || {};
  const base = num(A.studyCost != null ? A.studyCost : 300);
  return arts.learnedCount(state) === 0 ? 0 : base;
}

function learnArt(state, payload) {
  const id = String(payload.id || '');
  const art = arts.byId(id);
  if (!art) return { ok: false, reason: '没有这门艺。' };

  const rules = config.get('rules');
  const openAge = num((rules.ARTS || {}).age != null ? rules.ARTS.age : 14);
  if (num(state.clock.age) < openAge) return { ok: false, reason: `${openAge} 岁以后才谈得上手艺。` };
  if (arts.learned(state, id)) return { ok: false, reason: '这门已经学过了。' };

  for (const [dao, lv] of Object.entries(art.req || {})) {
    if (num((state.path[dao] || {}).level) >= num(lv)) continue;
    const name = ({ body: '锻体', qi: '炼气', spirit: '养灵', heart: '修心' })[dao] || dao;
    const tier = (((rules.TIERS || {})[dao]) || [])[num(lv) - 1] || `第 ${lv} 品`;
    return { ok: false, reason: `这门艺要先到${name}·${tier}。` };
  }

  const cost = artStudyCost(state);
  if (cost > 0 && mods.moneyTotal(state) < cost) return { ok: false, reason: '钱不够交学费。' };

  const list = [];
  if (cost > 0) list.push({ money: { copper: -cost } });
  list.push({ log: `你拜了位师父，从头学${art.name}。` });

  const r = commit(state, {
    id: null,
    months: time.learnMonths(state, 'art'),
    text: null,
    list,
    event: null,
    quiet: true
  });
  if (r.ok) arts.stateOf(state, id).learned = true;
  return r;
}

/* ── 术法：三个月一练；没学的先花钱学 ────────────────── */

function spellAct(state, payload) {
  const id = String(payload.id || '');
  const sp = spells.byId(id);
  if (!sp) return { ok: false, reason: '没有这门术法。' };
  if (!spells.know(state, id)) return { ok: false, reason: '还没学，先把它学会。' };

  const left = budget(state);
  if (left <= 0) return { ok: false, reason: '这一年已经过完了。' };
  const need = spells.monthsToNext(state, id);
  const months = Math.min(left, need > 0 ? need : left);
  if (months <= 0) return { ok: false, reason: '这一年已经过完了。' };

  const res = spells.train(state, id, months);
  const list = [{ log: `你把 ${monthsText(months)} 花在${sp.name}上。` }];
  if (res.up) list.push({ log: `你的${sp.name}到了「${spells.lvlName(res.lvl)}」。` });
  if (res.atCap && res.up) list.push({ log: '这门术法，你已经练到头了。' });

  return commit(state, {
    id: null,
    months,
    text: null,
    list,
    event: null,
    quiet: true
  });
}

function learnSpell(state, payload) {
  const id = String(payload.id || '');
  const sp = spells.byId(id);
  if (!sp) return { ok: false, reason: '没有这门术法。' };
  if (spells.know(state, id)) return { ok: false, reason: '已经学会了。' };
  if (!spells.reqOk(state, sp)) return { ok: false, reason: '境界不够，看不懂这门术法。' };

  /* r34：术法有三个来路——学堂教、坊市买、城主府用军功换 */
  const src = spells.sourceOf(state, sp);
  if (!src.ok) {
    if (src.kind === 'market') return { ok: false, reason: `钱不够（要 ${src.cost} 文）。` };
    if (src.kind === 'office') return { ok: false, reason: src.why || '军功不够。' };
    return { ok: false, reason: '这门术法你现在没有来路。' };
  }

  const left = budget(state);
  if (left <= 0) return { ok: false, reason: '这一年已经过完了。' };
  const months = Math.min(left, time.learnMonths(state, 'spell'));

  const list = [];
  if (src.cost > 0) list.push({ money: { copper: -src.cost } });
  if (src.merit > 0) list.push({ add: ['merit.war', -src.merit] });

  const where = src.kind === 'academy' ? '先生把口诀一句一句讲给你听'
    : src.kind === 'office' ? '城主府的库房里，你用军功换来一册抄本'
      : '你从坊市买了一册抄本';
  list.push({ log: `${where}——${sp.name}，总算记下了。` });

  spells.stateOf(state, id);

  return commit(state, {
    id: null,
    months,
    text: null,
    list,
    event: null,
    quiet: true
  });
}

/* ── 卖东西：半价，0 月 ──────────────────────────────── */

function sell(state, payload) {
  const id = String(payload.id || '');
  const item = (config.get('items') || []).find((x) => x.id === id);
  if (!item) return { ok: false, reason: '没有这件东西。' };
  if (num((state.items || {})[id]) <= 0) return { ok: false, reason: '囊中没有这件东西。' };
  if (!(state.flags && state.flags.market && state.flags.market.open)) {
    return { ok: false, reason: '得先进坊市。' };
  }
  if (state.zone !== 'city') return { ok: false, reason: '城外没有坊市。' };

  const price = item.price || {};
  const C = (config.get('rules') || {}).CURRENCY || { copper: 100, silver: 100 };
  const full = num(price.copper) + num(price.silver) * num(C.copper) + num(price.gold) * num(C.copper) * num(C.silver);
  const got = Math.max(1, Math.floor(full * 0.5));

  state.items[id] = num(state.items[id]) - 1;
  if (state.items[id] <= 0) delete state.items[id];

  return commit(state, {
    months: 0,
    keepMain: true,
    quiet: true,
    text: `你把${item.name}卖了，换回 ${got} 文。`,
    list: [{ money: { copper: got } }],
    event: null
  });
}

/* ── 吃药：0 月，不换主卡 ────────────────────────────── */

function useItem(state, id) {
  const items = config.get('items') || [];
  const item = items.find((x) => x.id === id);
  if (!item) return { ok: false, reason: '没有这件东西。' };
  if (item.use === false) return { ok: false, reason: '这件东西不是吃的。' };
  if (num((state.items || {})[id]) <= 0) return { ok: false, reason: '囊中没有这件东西。' };

  state.items[id] = num(state.items[id]) - 1;
  if (state.items[id] <= 0) delete state.items[id];

  const list = (item.mods || []).map((m) => ({
    mod: { ...m, source: `item.${id}`, duration: item.duration || { kind: 'permanent' } }
  }));
  list.push({ log: `你服下${item.name}。` });

  return commit(state, { months: 0, list, event: item, keepMain: true });
}

/* ── 坊市：逛一趟（1 月）→ 当年可以随时买（0 月） ──────── */

function moneyText(price) {
  const bits = [];
  if (num(price.gold)) bits.push(`${num(price.gold)} 金`);
  if (num(price.silver)) bits.push(`${num(price.silver)} 银`);
  if (num(price.copper)) bits.push(`${num(price.copper)} 铜`);
  return bits.join(' ') || '不要钱';
}

/** 逛坊市：花 1 个月，把货架打开（当年有效，跨年自动关） */
function marketVisit(state) {
  const left = budget(state);
  if (left <= 0) return { ok: false, reason: '这一年已经过完了。' };
  if (state.zone !== 'city') return { ok: false, reason: '城外没有坊市。' };
  if (state.flags && state.flags.market && state.flags.market.open) {
    return { ok: false, reason: '今年已经逛过了，直接挑东西就行。' };
  }
  return commit(state, {
    id: null,
    months: 1,
    text: '你在坊市里转了一圈。',
    list: [
      { flag: { id: 'market.open' } },
      { log: '摊子上的东西都明码标价，钱够就能拿走。' }
    ],
    event: null
  });
}

/** 买一件：0 月、不换主卡；钱不够整条不作数 */
function buy(state, payload) {
  const id = String(payload.id || '');
  const item = (config.get('items') || []).find((x) => x.id === id);
  if (!item) return { ok: false, reason: '没有这件东西。' };
  if (item.shop === false) return { ok: false, reason: '这件东西坊市里不卖。' };
  if (!(state.flags && state.flags.market && state.flags.market.open)) {
    return { ok: false, reason: '得先进坊市看看货。' };
  }
  if (state.zone !== 'city') return { ok: false, reason: '城外没有坊市。' };

  const price = item.price || {};
  const C = (config.get('rules') || {}).CURRENCY || { copper: 100, silver: 100 };
  const cost = num(price.copper) + num(price.silver) * num(C.copper) + num(price.gold) * num(C.copper) * num(C.silver);
  if (mods.moneyTotal(state) < cost) return { ok: false, reason: '钱不够。' };

  state.items = state.items || {};
  state.items[id] = num(state.items[id]) + 1;

  return commit(state, {
    months: 0,
    keepMain: true,
    quiet: true,
    text: `你付了 ${moneyText(price)}，把${item.name}收进囊中。`,
    list: [{ money: { copper: -cost } }],
    event: null
  });
}

/** 给前端看的货架（只有逛过才给） */
function marketOf(state) {
  if (!(state.flags && state.flags.market && state.flags.market.open)) return [];
  if (state.zone !== 'city') return [];
  const C = (config.get('rules') || {}).CURRENCY || { copper: 100, silver: 100 };
  const total = mods.moneyTotal(state);
  return (config.get('items') || [])
    .filter((x) => x.shop !== false)
    .map((x) => {
      const p = x.price || {};
      const cost = num(p.copper) + num(p.silver) * num(C.copper) + num(p.gold) * num(C.copper) * num(C.silver);
      return {
        id: x.id,
        no: x.no,
        name: x.name,
        kind: x.kind || '杂物',
        price: moneyText(p),
        cost,
        effect: x.effect || '',
        afford: total >= cost
      };
    });
}

/**
 * 执行一次选择。
 * payload: { kind: 'event'|'action'|'train'|'break'|'art'|'use'|'buy'|'wait', id, choice, dao, tier, mode }
 */
function act(state, payload) {
  if (state.dead) return { ok: false, reason: '此生已尽。' };

  const kind = String(payload.kind || 'event');
  if (kind === 'wait') return pass(state);

  const table = handSys.table(state);

  /* I15：有强制事件没处理，除了它本身，什么都做不了 */
  if (table.locked && kind !== 'event') {
    return { ok: false, reason: '手头有非处理不可的事，别的都做不了。' };
  }

  if (kind === 'train') return train(state, payload);
  if (kind === 'break') return breakAct(state, payload);
  if (kind === 'art') return artAct(state, payload);
  if (kind === 'learnArt') return learnArt(state, payload);
  if (kind === 'spell') return spellAct(state, payload);
  if (kind === 'learnSpell') return learnSpell(state, payload);
  if (kind === 'use') return useItem(state, payload.id);
  if (kind === 'buy') return buy(state, payload);
  if (kind === 'sell') return sell(state, payload);

  const id = String(payload.id || '');
  const choiceId = payload.choice != null ? String(payload.choice) : null;

  if (kind === 'action') {
    const a = table.actions.find((x) => x.id === id);
    if (!a) return { ok: false, reason: '这件事今年做不了。' };
    /* 坊市：不是"做事"，是把货架打开 */
    if (a.id === 'act.market') return marketVisit(state);
    /* 闲居：把这一年剩下的月份过完（用户口径：闲居就是过完当前年） */
    if (a.restMonths) return pass(state, `剩下的月份，你哪儿也没去。`);
    /* r39：接委托走专门的分支（选哪门艺、杂活还是正活、要不要出城） */
    if (a.id === 'act.commission') return commissionAct(state, payload);
    return commit(state, {
      id: null,
      months: a.months != null ? a.months : 1,
      text: a.text || `你${a.name}。`,
      list: a.do || [],
      event: a,
      args: a.args || {}
    });
  }

  const e = table.events.find((x) => x.id === id);
  if (!e) return { ok: false, reason: '这件事已经过去了。' };

  const choices = (e.choices && e.choices.length)
    ? e.choices
    : [{ id: '_', label: '知道了', months: e.months }];
  const c = choiceId == null ? choices[0] : choices.find((x) => x.id === choiceId);
  if (!c) return { ok: false, reason: '没有这一条路。' };

  /* 选项自己的门槛（比如"入太学"要破胎） */
  if (c.when) {
    const ok = require('../rules/dsl').evalWhen(c.when, {
      state,
      rules: config.get('rules'),
      conditions: config.get('conditions'),
      args: e.args || {}
    });
    if (!ok) return { ok: false, reason: '这条路现在走不通。' };
  }

  /* 耗月：写死就用写的；写了 `monthsBy` 就按属性反比算（r33） */
  let months = (c.months != null ? c.months : e.months) != null
    ? (c.months != null ? c.months : e.months)
    : 1;
  if (c.monthsBy || e.monthsBy) {
    const kind = String(c.monthsBy || e.monthsBy);
    const base = num(months) || 1;
    months = Math.min(budget(state), time.months(state, kind, base, 1));
  }

  /* 明码标价的选项：钱不够就整条不作数，连月份都不扣 */
  const list = [];
  if (c.cost != null && c.cost !== 0) {
    if (mods.moneyTotal(state) < c.cost) return { ok: false, reason: '钱不够。' };
    list.push({ money: { copper: -Math.abs(c.cost) } });
  }
  list.push(...(Array.isArray(c.do) ? c.do : (e.do || [])));

  return commit(state, {
    id: e.id,
    months,
    span: !!e.span,
    text: (e.choices && e.choices.length)
      ? `「${e.title}」—— 你选了「${c.label}」。`
      : `「${e.title}」。`,
    list,
    event: e,
    args: e.args || {},
    choice: c,
    mainEvent: true
  });
}

module.exports = {
  act, commit, pass, train, breakAct, artAct, learnArt, spellAct, learnSpell,
  useItem, buy, sell, marketVisit, marketOf,
  rollYear, cnYear, MONTHS_PER_YEAR, artStudyCost
};
