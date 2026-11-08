'use strict';

/**
 * 境界规则（设计/02 §2 · 设计/11 §4–§7）。
 *
 * 这里是**公式的唯一实现**：月修为、出现率 q、成功基数 b、破境判定、commit、
 * 外溢、拆墙。配置只能调用，不能重写（I18）。
 *
 * 所有函数都收 rules 参数（= 设计里的常量表），不自己读文件，
 * 这样冒烟测试可以塞一份假常量进来验算。
 */

const mods = require('./mods');

const RANK = { body: 1, qi: 2, spirit: 3 };

/** 功法值表（设计/02 §2.1）。养灵用势力档次，数值同表。 */
const GONGFA = { meng: 38, fu: 46, tai: 54, none: 30, sect: 58, holy: 60 };

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** 某一道吃的属性（养灵是资质与悟性各半） */
function attrOf(state, dao) {
  if (dao === 'spirit') {
    return (mods.get(state, 'attr.aptitude.eff') + mods.get(state, 'attr.insight.eff')) / 2;
  }
  if (dao === 'qi') return mods.get(state, 'attr.insight.eff');
  if (dao === 'heart') return mods.get(state, 'attr.heart.eff');
  return mods.get(state, 'attr.aptitude.eff');
}

function gongfaOf(state) {
  const stage = state.education && state.education.stage;
  return GONGFA[stage] != null ? GONGFA[stage] : GONGFA.none;
}

/**
 * 这一品的修为条上限。
 *
 * r28 修口径（对齐 `归档/境界系统总纲.md` §「修为总量的定义」）：
 *   **PROF[dao][n] = 站在第 n+1 品上、练到能破下一品所需的修为。**
 *   所以"体魄 140" = 在体魄这一品练满 140，才有资格破脏腑；
 *   而 **level = 0（还没入第一品）没有修为条**——入门只看瓶颈，不看进度。
 *
 *   返回 null 的两种情况：还没入品（level 0）、以及已经站在该道最高品（没有下一品）。
 */
function barMax(state, dao, rules) {
  const p = state.path[dao];
  if (!p) return null;
  const level = num(p.level);
  const prof = (rules.PROF || {})[dao] || [];

  /* 修心是**累计制**：PROF 的四个值就是四道门槛本身（100/220/370/550），
     道心不清零，所以"站在第 n 品"看的是下一道门槛还有多远。 */
  if (dao === 'heart') {
    if (level >= prof.length) return null;
    return prof[level] != null ? prof[level] : null;
  }

  if (level < 1) return null;
  if (level >= prof.length) return null;
  return prof[level - 1] != null ? prof[level - 1] : null;
}

/** 修炼基数 = 0.70×属性 + 0.20×功法值 + 0.10×境界值（设计/02 §2） */
function baseRate(state, dao) {
  /* 境界值跟着**当前站的品**走：没入品按第一品算（凡人也是"体魄那一档"的肉身） */
  const level = Math.max(1, num(state.path[dao].level));
  return 0.70 * attrOf(state, dao) + 0.20 * gongfaOf(state) + 0.10 * (30 + 10 * level);
}

/** 灵量系数（设计/02 §4）：未接灵脉时取 1.0（中性），接了才零和 */
function spiritCoef(state) {
  /* TODO(r26-9)：灵脉（city.spiritMass）还没接，现在恒走中性分支 */
  const m = state.spiritMass;
  if (!m || !m.city) return 1;
  return clamp((2 * num(m.own)) / num(m.city), 0.2, 6);
}

/** rate.month.all 上的乘区（培元丹 1.10 这类） */
function rateMul(state, path) {
  let v = 1;
  for (const m of state.mods || []) {
    if (m.target !== path) continue;
    if (m.op === 'mul') v *= num(m.value);
  }
  return v;
}

/** 月修为（修心为 0：道心只走心关，I4） */
function monthGain(state, dao) {
  if (dao === 'heart') return 0;
  let v = baseRate(state, dao) * 0.20 * rateMul(state, 'rate.month.all');
  if (dao === 'spirit') v *= spiritCoef(state);
  return v;
}

/** 出现率 q：这一品对这个人有没有墙（设计/11 §4） */
function appearRate(state, dao, tier, rules) {
  const row = ((rules.APPEAR || {})[dao] || []).find((r) => r.tier === tier);
  if (!row) return 0;
  const attr = attrOf(state, row.attr === 'aptIns' ? 'spirit' : row.attr);
  const raw = row.base + (attr - row.from) * row.coef;
  return clamp(1 - clamp(raw, 0, 1), 0, 1);
}

/** 成功基数 b（设计/11 §5） */
function successBase(state, dao, tier, rules) {
  const S = rules.SUCCESS || {};
  const E = S.event || {};
  const apt = mods.get(state, 'attr.aptitude.eff');
  const ins = mods.get(state, 'attr.insight.eff');

  if (dao === 'qi' && tier === 4 && E.qi4) {
    return num(E.qi4.base) + Math.max(0, ins - num(E.qi4.from)) * num(E.qi4.coef);
  }
  if (dao === 'spirit' && E.spirit) {
    return num(E.spirit.base) + Math.max(0, apt + ins - num(E.spirit.from)) * num(E.spirit.coef);
  }
  if (dao === 'heart' && E.heart) {
    return num(E.heart.base) + Math.max(0, num(mods.get(state, 'attr.heart.eff')) - num(E.heart.from)) * num(E.heart.coef);
  }
  if (tier === 6 && E.tier6) {
    return num(E.tier6.base) + Math.max(0, apt + ins - num(E.tier6.from)) * num(E.tier6.coef);
  }
  /* 概率瓶颈：max(0, 属性 − 40) × 0.0030 */
  const floor = num(S.probFloor != null ? S.probFloor : 40);
  return Math.max(0, attrOf(state, dao) - floor) * num(S.probCoef != null ? S.probCoef : 0.003);
}

/** 求学累积（按品）：`path.<dao>.study.<tier>`，一个瓶颈只叠一次 */
function studyBonus(state, dao, tier, rules) {
  const cap = ((rules.SUCCESS || {}).teachCap || {})[String(tier)];
  const got = num(mods.get(state, `path.${dao}.study.${tier}`));
  return cap != null ? Math.min(num(cap), got) : got;
}

/**
 * 还要修几个月才到本品上限（设计/02 §2）。
 * 修心返回 Infinity：道心不吃月修为，只能靠心关（I4）。
 * 已满 / 没有条（未入品、到顶）返回 0 或 Infinity。
 */
function monthsToFull(state, dao, rules) {
  if (dao === 'heart') return Infinity;
  const p = state.path[dao];
  if (!p) return Infinity;
  const cap = barMax(state, dao, rules);
  if (cap == null) return Infinity;      /* 没有条：修不动（未入品 / 已到顶） */
  if (p.bar >= cap) return 0;
  const gain = monthGain(state, dao);
  if (!(gain > 0)) return Infinity;
  return Math.ceil((cap - p.bar) / gain);
}

/** 修为满了就不能再修：只剩突破；没有条（未入品 / 到顶）也不能修（r28 口径） */
function canTrain(state, dao, rules) {
  if (dao === 'heart') return false;
  const p = state.path[dao];
  if (!p) return false;
  const cap = barMax(state, dao, rules);
  if (cap == null) return false;
  return p.bar < cap;
}

/** 嗑药 + 喂招，合计上限 0.13 */
function pillBonus(state, rules) {
  const cap = num((rules.PILL || {}).cap != null ? rules.PILL.cap : 0.13);
  let v = 0;
  for (const m of state.mods || []) {
    if (m.target === 'rate.success.pill' && m.op === 'add') v += num(m.value);
  }
  return Math.min(cap, v);
}

/** 气运只做加法（I5），钳 ±0.05 */
function luckAdj(state) {
  return clamp((num(state.luck) - 50) * 0.001, -0.05, 0.05);
}

function bottleneckOf(dao, tier) {
  if (dao === 'body') return tier <= 4 ? 'prob' : (tier === 5 ? 'event_once' : 'event_judge');
  if (dao === 'qi') return tier <= 3 ? 'prob' : (tier === 5 ? 'event_once' : 'event_judge');
  if (dao === 'spirit') return tier === 5 ? 'event_once' : 'event_judge';
  return 'event_judge';
}

/* ── 破境 ─────────────────────────────────────────────── */

const DAOS = ['body', 'qi', 'spirit', 'heart'];
const BASE_LIFESPAN = 72;      /* 凡人：没进任何品就是七十上下 */

/**
 * 寿元（rules.LIFESPAN）：取四道里**最高那一档的上限**。
 * 走到哪一道的哪一品，就按那一档给寿元——不是相加，也不是取平均。
 */
function lifespanOf(state, rules) {
  let best = BASE_LIFESPAN;
  for (const dao of DAOS) {
    const lv = Number((state.path[dao] || {}).level) || 0;
    if (lv <= 0) continue;
    const row = ((rules || {}).LIFESPAN || {})[dao] || [];
    const span = row[lv - 1];
    if (Array.isArray(span) && span[1] != null) best = Math.max(best, span[1]);
  }
  return best;
}

/**
 * 破境成功后唯一的收尾口：记层级 → 清条 → 清失败 → 作废本品墙 → 拆低阶墙。
 * **`spirit.level` 的唯一写入点就是这里**（I25）。
 */
function commitTier(state, dao, tier, rules) {
  const p = state.path[dao];
  p.level = tier;
  /* 修心是**累计制**：道心不清零，下一品接着往上攒（设计/11 §8 边界表） */
  if (dao !== 'heart') p.bar = 0;
  p.attempts = 0;
  p.fail = 0;
  if (p.wall) delete p.wall[tier];
  breakWall(state, dao, tier);
  return p.level;
}

/** 外溢：修高阶时给低一阶的同品号 10%（I10；已满则丢弃） */
function spill(state, dao, gained, rules) {
  const rate = num((rules || {}).SPILL_RATE != null ? rules.SPILL_RATE : 0.10);
  const m = RANK[dao];
  if (!m || gained <= 0) return;
  for (const lo of Object.keys(RANK)) {
    if (RANK[lo] >= m) continue;
    const p = state.path[lo];
    if (num(p.level) < 1) continue;                     /* 还没入品：没有条可灌 */
    const cap = barMax(state, lo, rules);
    if (cap == null || p.bar >= cap) continue;
    p.bar = Math.min(cap, p.bar + gained * rate);
  }
}

/** 拆墙：高阶过第 N 品，低阶同品号的墙直接判"不存在" */
function breakWall(state, dao, tier) {
  if (tier < 2) return;
  const m = RANK[dao] || 0;
  for (const lo of Object.keys(RANK)) {
    if (RANK[lo] >= m) continue;
    const p = state.path[lo];
    if (p.level < tier) {
      p.wall = p.wall || {};
      p.wall[tier] = false;
    }
  }
}

/**
 * 判「破境」。参数 {dao, tier}。
 * 返回 {ok, why, q, p, roll}：`why` 既是日志也是置灰文案（设计/20 §8）。
 */
function judgeBreak(state, params, ctx) {
  const dao = String(params.dao || '');
  const tier = num(params.tier);
  const rules = ctx.rules;
  const rng = ctx.rng || Math.random;
  const path = state.path[dao];

  if (!path) return { ok: false, why: 'no_such_dao' };
  if (path.level >= tier) return { ok: false, why: 'already' };
  if (path.level < tier - 1) return { ok: false, why: 'level_gap' };

  const kind = bottleneckOf(dao, tier);
  /* r30：事件瓶颈（品 5/6、养灵、修心、法相…）**只能由事件开**。
     硬闯没用——没有那件事，你修一万年也进不去。 */
  const force = !!(params && params.force);
  if (kind !== 'prob' && !force) return { ok: false, why: 'need_event' };

  /* r32：**每年只能破一次境界，但"入门"不算**（感气入门、体魄入门这种）。
     入门问的是"能不能开始"，不是"能不能再进一步"，所以不占当年的名额。 */
  const isEntry = num(path.level) === 0 && tier === 1;

  /* r35：修心的门是**一次性**的，且心性 < 90 → **必然失败**（需求/11 §6.1–§6.2）。
     这一检查要放在 force 之前：连"事件直接把门推开"也不行——心性不够就是进不去。 */
  if (dao === 'heart') {
    const H = rules.HEART || {};
    const need = num(H.heartBreakNeed != null ? H.heartBreakNeed : 90);
    const heartV = num(mods.get(state, 'attr.heart.eff'));
    if (heartV < need) {
      return { ok: false, why: 'heart_low', p: 0, need, heart: heartV };
    }
  }

  /* r35：`force` 也吃"一年一次"。
     r34 之前 force 绕过这条，导致 15 条 evt.gate.* 可以同年连破两个瓶颈。
     需求/20 §10.2 写的是"全局一次，不分道、不分品"，没有例外。 */
  if (!isEntry && state.turn && state.turn.breakthroughUsed) {
    return { ok: false, why: 'one_per_year' };
  }
  /* r27 / r28：这里**不检查修为条**。
     ① 入门关（第 1 品）根本没有修为条，只看瓶颈；
     ② 品内突破的"修为得先修满"是**资格**问题，放在业务层 `turn.breakAct()`
        里拦（那边能给出"还差多少"的人话），不塞进纯判定。 */

  /* 事件瓶颈：事件办成了就直接进品，不再掷第二次骰（r30） */
  if (force) {
    state.turn = state.turn || {};
    if (!isEntry) state.turn.breakthroughUsed = true;
    commitTier(state, dao, tier, rules);
    return { ok: true, why: 'event', q: 0, forced: true };
  }

  const q = appearRate(state, dao, tier, rules);
  path.wall = path.wall || {};
  if (path.wall[tier] === undefined) path.wall[tier] = rng() < q;   // 一品只掷一次（§4.1）

  /* r35：**没墙（q=0 掷空）不占年度名额**（设计/11 §4 + §10）。
     r34 之前这行在掷 q 之前，运气好的人也要被罚一年。 */
  if (!path.wall[tier]) {
    commitTier(state, dao, tier, rules);
    return { ok: true, why: 'no_wall', q };
  }

  /* 到这里才算"真的开始冲关"：占掉今年的名额 */
  state.turn = state.turn || {};
  if (!isEntry) state.turn.breakthroughUsed = true;

  /**
   * 入门关（第 1 品）和品内突破不是一回事：
   * 它问的是"这个人能不能开始"，不是"能不能再进一步"。
   * 所以基数抬到 openBase，也不吃"首次必败"——否则资质 40 的人会一辈子站在门外。
   */
  const entry = tier === 1;
  const S = rules.SUCCESS || {};

  path.attempts = num(path.attempts) + 1;
  if (!entry && path.attempts === 1) {
    path.fail = num(S.firstFail != null ? S.firstFail : 0.02);
    return { ok: false, why: 'first_try', q, p: 0 };
  }

  const base = entry
    ? Math.max(successBase(state, dao, tier, rules), num(S.openBase != null ? S.openBase : 0.25))
    : successBase(state, dao, tier, rules);

  /* 灌顶（r35）：一次性，把这一次判定抬到"基本保送"（需求/11 §7.4）。 */
  const enlight = num(path.enlighten);

  const p = Math.min(
    num(S.pCap != null ? S.pCap : 0.95),
    base
      + (entry ? 0 : studyBonus(state, dao, tier, rules))
      + Math.min(num(S.failCap != null ? S.failCap : 0.1), num(path.fail))
      + pillBonus(state, rules)
      + luckAdj(state)
      + enlight
  );
  const roll = rng();
  if (roll < p) {
    path.enlighten = 0;                       /* 灌顶用掉就没了 */
    commitTier(state, dao, tier, rules);
    return { ok: true, why: 'roll', q, p, roll, enlight };
  }

  path.enlighten = 0;                          /* 灌顶失败也算用掉 */
  path.fail = Math.min(
    num(S.failCap != null ? S.failCap : 0.1),
    num(path.fail) + 0.01 + rng() * 0.02
  );
  return { ok: false, why: 'roll', q, p, roll };
}

/* ── 心性：定时衰减 / 心魔 / 心关失败（需求/01 §3，r35） ────── */

/**
 * ① 自然衰减（定时任务）。
 *
 * 规则（`需求/01` §3.2）：
 *   - **入了修心就不衰减**（不惑 = 世事再也磨不动你）
 *   - **心性 ≤ 60 就停**——定时任务永远压不到 40，单靠熬时间遇不到心魔
 *   - 在册（蒙/府/太）−1；离校 −2
 *
 * @returns {number} 实际扣掉的量（0 表示没执行）
 */
function heartDecay(state, rules) {
  const H = (rules || {}).HEART || {};
  const floor = num(H.decayFloor != null ? H.decayFloor : 60);
  const heartPath = state.path && state.path.heart;
  const heart = num(mods.get(state, 'attr.heart.eff'));

  /* 已入修心：自然衰减归零 */
  if (heartPath && num(heartPath.level) >= 1) return 0;
  /* 已到地板：定时任务停止 */
  if (heart <= floor) return 0;

  const inSchool = !!(state.education && !state.education.graduated);
  const step = num(inSchool
    ? (H.decayInSchool != null ? H.decayInSchool : 1)
    : (H.decayOutSchool != null ? H.decayOutSchool : 2));

  const next = Math.max(floor, heart - step);
  const lost = heart - next;
  if (lost > 0) mods.write(state, 'attr.heart.eff', next);
  return lost;
}

/**
 * 心魔的存活率（**与心性成正比**，r35）。
 *   p(活) = 0.1 × 心性 / 39     39 → 0.100、20 → 0.051、0 → 0
 */
function demonSurvive(heart, rules) {
  const H = (rules || {}).HEART || {};
  const at = num(H.demonSurviveAt != null ? H.demonSurviveAt : 39);
  const max = num(H.demonSurviveMax != null ? H.demonSurviveMax : 0.1);
  if (at <= 0) return 0;
  return clamp((max * num(heart)) / at, 0, 1);
}

/** 心魔只找入道者（锻体 ≥ 3 或 炼气 ≥ 2）。凡人只得"心疾"，不掷骰。 */
function canHaveDemon(state, rules) {
  const H = (rules || {}).HEART || {};
  const needBody = num(H.demonRequiresBody != null ? H.demonRequiresBody : 3);
  const needQi = num(H.demonRequiresQi != null ? H.demonRequiresQi : 2);
  const body = num(((state.path || {}).body || {}).level);
  const qi = num(((state.path || {}).qi || {}).level);
  return body >= needBody || qi >= needQi;
}

/**
 * ② 心魔判定（年初 step4）。返回 null 表示没触发。
 *
 * 触发：心性 0–39，每年掷一次。
 * 存活：心性 −5、**当前品修为条清零**、当年不能再发起心关。
 * 死亡：`state.dead = true`。
 */
function rollDemon(state, rules, rng) {
  const H = (rules || {}).HEART || {};
  const line = num(H.demonLine != null ? H.demonLine : 40);
  const heart = num(mods.get(state, 'attr.heart.eff'));

  if (heart >= line) return null;
  if (!canHaveDemon(state, rules)) return null;

  const p = demonSurvive(heart, rules);
  const roll = (rng || Math.random)();

  if (roll < p) {
    const loss = num(H.demonHpLoss != null ? H.demonHpLoss : 5);
    const after = Math.max(0, heart - loss);
    mods.write(state, 'attr.heart.eff', after);
    /* 当前品的修为条清零（所有道，因为"这一关"是他整个人的关卡） */
    for (const dao of DAOS) {
      const p2 = state.path[dao];
      if (p2 && num(p2.level) >= 1) p2.bar = 0;
    }
    state.turn = state.turn || {};
    state.turn.heartBlocked = true;      /* 当年不能再发起心关 */
    return { kind: 'demon', survived: true, heart, after, p, roll };
  }
  state.dead = true;
  return { kind: 'demon', survived: false, heart, p, roll };
}

/**
 * ③ 心关失败（需求/01 §3.4）：修为 −10×基数、30% 心性 −1。
 * 与 ① 分开记——入修心后 ① 停了，③ 不停。
 */
function heartClashFail(state, rules, rng) {
  const H = (rules || {}).HEART || {};
  const chance = num(H.heartClashFailPenalty != null ? H.heartClashFailPenalty : 0.3);
  const loss = num(H.heartClashFailLoss != null ? H.heartClashFailLoss : 1);
  const heart = num(mods.get(state, 'attr.heart.eff'));
  const roll = (rng || Math.random)();
  if (roll < chance) {
    const after = Math.max(0, heart - loss);
    mods.write(state, 'attr.heart.eff', after);
    return { ok: true, lost: loss, from: heart, to: after, roll, chance };
  }
  return { ok: true, lost: 0, roll, chance };
}

module.exports = {
  RANK, DAOS, GONGFA, attrOf, gongfaOf, barMax, baseRate, monthGain, spiritCoef,
  appearRate, successBase, studyBonus, pillBonus, luckAdj,
  bottleneckOf, commitTier, spill, breakWall, judgeBreak, lifespanOf,
  monthsToFull, canTrain,
  heartDecay, demonSurvive, canHaveDemon, rollDemon, heartClashFail
};
