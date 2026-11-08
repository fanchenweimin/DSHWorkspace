'use strict';

const rng = require('../../util/rng');
const { clamp } = require('../../util/text');
const { realmAttribute, attrCoef, adjustHidden, raiseCap } = require('../rules/attribute.rule');
const { PROF_MAX } = require('../rules/breakthrough.rule');
const { methodById } = require('../../seed/arts.seed');
const { soulMass, gainFromSoulMass } = require('../../seed/identities.seed');

/** 功法系数：品阶 + 熟练 */
function methodFactor(state, realmKey) {
  const id = state.methods[realmKey];
  const method = methodById(id);
  if (!method) return 0.2;
  const rank = method.grade.rank;
  const tier = method.grade.tier;
  const mastery = state.mastery[id] || 0;
  const base = 0.55 + rank * 0.18 + tier * 0.05;
  const genericPenalty = method.generic ? -0.1 : 0.05;
  return clamp(base + mastery / 600 + genericPenalty, 0.24, 1.45);
}

/** 主修权重 */
function focusWeight(state, realmKey, realmCfg) {
  if (state.activeRealm === realmKey) return 1;
  const activeCfg = state.config.realms.find((r) => r.key === state.activeRealm);
  if (!activeCfg) return 0.06;
  const activeOrder = activeCfg.order || 0;
  return (realmCfg.order || 0) < activeOrder ? 0.38 : 0;
}

/** 当前生效的悟性 buff */
function insightBuffOf(state) {
  const buff = state.hidden.insightBuff;
  if (!buff || !buff.value) return 0;
  if (state.age > buff.untilAge) return 0;
  return buff.value;
}

function heartBuffOf(state) {
  const buff = state.hidden.heartBuff;
  if (!buff || !buff.value) return 0;
  if (state.age > buff.untilAge) return 0;
  return buff.value;
}

/**
 * 修炼一次：返回实际获得的修为。
 * 养灵（opportunity）不吃静修，直接返回 0。
 */
function applyTraining(state, realmKey, base, ctx) {
  const realm = state.realms[realmKey];
  const cfg = state.config.realms.find((r) => r.key === realmKey);
  if (!realm || !cfg || !realm.unlocked || realm.completed) return 0;

  if (realm.awaiting) {
    ctx?.note?.(`${cfg.name}修为已满，只等${realm.awaiting === 'world' ? '世界认可' : '悟道'}，再练也无用。`);
    return 0;
  }

  // 养灵：静修无效
  if (cfg.policy === 'opportunity') {
    ctx?.note?.('养灵之修不在静坐。你坐了一整天，什么也没有多出来。');
    return 0;
  }

  const weight = focusWeight(state, realmKey, cfg);
  if (weight <= 0) return 0;

  const attr = realmAttribute(state.hidden, cfg) + (cfg.key === 'qi' ? insightBuffOf(state) : 0);
  const coef = attrCoef(attr, realmKey);
  const factor = methodFactor(state, realmKey);
  const random = 0.9 + rng.next() * 0.2;

  // 治下生灵只对养灵有效，但养灵不走静修，所以这里不乘
  let gain = Math.round(base * weight * coef * factor * random);
  gain = Math.max(1, gain);

  if (realm.prof + gain > PROF_MAX) gain = PROF_MAX - realm.prof;
  realm.prof = clamp(realm.prof + gain, 0, PROF_MAX);

  const methodId = state.methods[realmKey];
  if (methodId && weight >= 1) {
    state.mastery[methodId] = clamp((state.mastery[methodId] || 0) + 1, 0, 100);
  }

  ctx?.change?.(`${cfg.name}感悟`, `+${gain}`, realmKey);

  // 无功法自修：风险
  if (!methodId && weight >= 1) {
    ctx?.note?.('没有对应功法，你只能自己摸索，气机几次走到危险的岔口。');
    if (rng.roll(13)) {
      adjustHidden(state.hidden, 'heart', -1);
      adjustHidden(state.hidden, 'luck', -3);
      ctx?.change?.('心性', '略受挫损', 'hidden');
      if (rng.roll(18)) state.pendingEnding = { cause: 'deviation' };
    }
  }

  return gain;
}

/** 养灵专用：认知加深 */
function applyCognition(state, amount, ctx) {
  const realm = state.realms.spirit;
  const cfg = state.config.realms.find((r) => r.key === 'spirit');
  if (!realm?.unlocked || realm.completed || cfg?.policy !== 'opportunity') return 0;

  state.cognition += 0;
  const weight = focusWeight(state, 'spirit', cfg) || 1;
  const gain = Math.max(1, Math.round(amount * weight));
  if (realm.prof + gain > PROF_MAX) realm.prof = PROF_MAX;
  else realm.prof += gain;
  ctx?.change?.('养灵感悟', `+${gain}`, 'spirit');
  return gain;
}

/** 养灵增益（供 UI / 事件使用） */
function spiritMultiplier(state) {
  return gainFromSoulMass(soulMass(state.identity));
}

module.exports = {
  methodFactor,
  focusWeight,
  insightBuffOf,
  heartBuffOf,
  applyTraining,
  applyCognition,
  spiritMultiplier
};
