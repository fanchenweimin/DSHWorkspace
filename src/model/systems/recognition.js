'use strict';

/**
 * 世界认可（r44，`需求/11` §1.2.2）。
 *
 * **品 5 的事件瓶颈是一条两道链**，三道（锻体 / 炼气 / 养灵）共用：
 *
 *   事件 1「唤醒」——**必出**，不占主事件位，年初自动结算：
 *       4 品修为满 → 查 `state.recognition.recognized`
 *         · 有 → **直接 `lv = 5`**（跳过事件 2）
 *         · 没有 → 把这个道记进 `awoken`，让事件 2 能进池
 *
 *   事件 2「世界认可」——**普通事件**，有权重、进池掷骰：
 *       前置：`awoken` 里有我（没被唤醒就永不出现）
 *       成功 → `recognized = true` + `lv = 5`
 *
 * 为什么拆两段：
 *   · 第一段是"**你干过什么，世界知道吗**"——它是检测，不是运气。
 *   · 第二段是"**世界什么时候看见你**"——那是机缘，得等、得碰。
 * 一个玩家 4 品满了却没人看见，他就该卡着；卡多久取决于他做的事有没有传出去。
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const DAOS = ['body', 'qi', 'spirit'];

/** 品 5 的"门票层"：前三道共用一套 */
function isWorldTier(dao, tier) {
  return DAOS.indexOf(String(dao)) >= 0 && num(tier) === 5;
}

/** 拿到识别的记账结构（老档没有这个字段时补上） */
function box(state) {
  if (!state.recognition || typeof state.recognition !== 'object') {
    state.recognition = { recognized: false, awoken: {}, fromVoidSoul: false };
  }
  const r = state.recognition;
  if (!r.awoken || typeof r.awoken !== 'object') r.awoken = {};
  if (r.recognized == null) r.recognized = false;
  return r;
}

/** 拿到世界认可了吗 */
function recognized(state) {
  return !!box(state).recognized;
}

/** 这一道被唤醒了吗（= 事件 2 够不够格进池） */
function awoken(state, dao) {
  return !!box(state).awoken[String(dao)];
}

/** 唤醒它（事件 1 的"没有标识"分支） */
function wake(state, dao) {
  const r = box(state);
  r.awoken[String(dao)] = true;
}

/** 灌顶过的人永久失格（`需求/02` §5、`设计/91`） */
function voidSoul(state) {
  box(state).fromVoidSoul = true;
}

/**
 * **事件 1：唤醒**——年初自动结算，不占主事件位。
 *
 * 返回做了什么的清单，给 `turn.rollYear` 写纪事用。
 *
 * @returns {Array<{dao, daoName, action: 'granted'|'woken'}>}
 */
function settleWakeUp(state, rules, opts) {
  const out = [];
  const bn = require('../rules/realm');
  const names = { body: '锻体', qi: '炼气', spirit: '养灵' };

  for (const dao of DAOS) {
    const p = state.path && state.path[dao];
    if (!p) continue;

    const level = num(p.level);
    const tier = level + 1;
    if (!isWorldTier(dao, tier)) continue;        /* 只有"冲第 5 品"才走这条 */
    if (num(p.lv) >= 5) continue;                 /* 这一关已经通了 */

    /* 4 品修为满 */
    const cap = bn.barMax(state, dao, rules);
    const full = cap == null ? true : num(p.bar) >= cap - 0.001;
    if (!full) continue;

    /* 门槛（BREAK_GATE）也要过 */
    const gate = ((rules.BREAK_GATE || {})[dao] || {})['5'] || {};
    const dsl = require('../rules/dsl');
    const ctx = {
      state,
      rules,
      conditions: require('../repository/config').get('conditions'),
      args: opts || {}
    };
    if (!dsl.evalWhen(gate.when || [], ctx)) continue;

    const r = box(state);

    if (r.recognized) {
      /* 已经有认可 → 直接通层级，不进事件 2 */
      p.lv = 5;
      p.attempts = 0;
      bn.breakWall(state, dao, 5);
      out.push({ dao, daoName: names[dao], action: 'granted' });
    } else if (!r.awoken[dao]) {
      /* 没有认可 → 唤醒事件 2 */
      r.awoken[dao] = true;
      out.push({ dao, daoName: names[dao], action: 'woken' });
    }
    /* 已经唤醒过、还在等 → 什么都不做（不重复唤醒） */
  }
  return out;
}

/**
 * **事件 2 成功**：拿认可 + 通层级。
 *
 * 一次拿到之后，另外两个道再冲第 5 品时，事件 1 会直接放行——
 * 「世界认了你一次，就够了」（`需求/11` §1.2.2）。
 */
function grant(state, dao) {
  const r = box(state);
  r.recognized = true;
  r.awoken[String(dao)] = true;
  return r;
}

module.exports = {
  DAOS, isWorldTier, box, recognized, awoken, wake, voidSoul,
  settleWakeUp, grant
};
