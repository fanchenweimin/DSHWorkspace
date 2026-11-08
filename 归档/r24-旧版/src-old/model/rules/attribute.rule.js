'use strict';

const { clamp } = require('../../util/text');

const HIDDEN_MIN = 10;
const HIDDEN_MAX = 100;

/** 每个大境界看哪个隐藏属性 */
const ATTRIBUTE_KEYS = {
  body: ['aptitude'],
  qi: ['insight'],
  spirit: ['aptitude', 'insight'],
  heart: ['heart'],
  balanced: ['insight', 'heart']
};

function attributeKeys(cfg) {
  if (!cfg) return ['insight'];
  return ATTRIBUTE_KEYS[cfg.attribute] || ['insight'];
}

/** 该道当前的主属性值（多属性取平均） */
function realmAttribute(hidden, cfg) {
  const keys = attributeKeys(cfg);
  if (!keys.length) return 55;
  const sum = keys.reduce((acc, key) => acc + (hidden[key] ?? 55), 0);
  return Math.round(sum / keys.length);
}

/**
 * 修炼收益系数：属性越高，收益越高。
 * 锻体跨度最大（0.55~1.90），修心最平（0.45~1.60）。
 */
function attrCoef(attr, realmKey) {
  const a = Number(attr) || 50;
  switch (realmKey) {
    case 'body':
      return clamp(0.35 + a / 65, 0.55, 1.9);
    case 'qi':
      return clamp(0.35 + a / 65, 0.55, 1.9);
    case 'spirit':
      return clamp(0.3 + a / 70, 0.45, 1.85);
    case 'heart':
      return clamp(0.3 + a / 80, 0.45, 1.6);
    default:
      return clamp(0.35 + a / 70, 0.5, 1.7);
  }
}

/** 属性增减（带上下限，心性/本性各自封顶） */
function adjustHidden(hidden, key, delta) {
  if (!delta) return 0;
  if (key === 'luck') {
    const before = hidden.luck;
    hidden.luck = clamp(hidden.luck + delta, 20, 95);
    return hidden.luck - before;
  }
  if (!(key in hidden) || !(key in hidden.caps)) return 0;
  const before = hidden[key];
  hidden[key] = clamp(hidden[key] + delta, HIDDEN_MIN, hidden.caps[key]);
  return hidden[key] - before;
}

/** 提升上限 */
function raiseCap(hidden, key, amount) {
  if (!(key in hidden.caps)) return 0;
  const before = hidden.caps[key];
  hidden.caps[key] = clamp(hidden.caps[key] + amount, HIDDEN_MIN, HIDDEN_MAX);
  return hidden.caps[key] - before;
}

/** 心性衰减：开修心前每 3 年 -1，开修心后每 6 年 -1 */
function heartDecay(hidden, years, heartOpen) {
  hidden.heartDecay = (hidden.heartDecay || 0) + (years || 1);
  const period = heartOpen ? 6 : 3;
  let lost = 0;
  while (hidden.heartDecay >= period) {
    hidden.heartDecay -= period;
    hidden.heart = Math.max(HIDDEN_MIN, hidden.heart - 1);
    lost += 1;
  }
  return lost;
}

/** 心性意象 */
function heartOmen(value) {
  if (value < 30) return '心湖易澜';
  if (value < 55) return '心有定见';
  if (value < 80) return '澄如止水';
  if (value < 90) return '万劫不疑';
  return '道心天成';
}

/** 本性区间名 */
function natureLabel(value) {
  if (value <= 20) return '大恶';
  if (value <= 40) return '偏恶';
  if (value <= 60) return '中性';
  if (value <= 80) return '偏善';
  return '大善';
}

module.exports = {
  HIDDEN_MIN,
  HIDDEN_MAX,
  ATTRIBUTE_KEYS,
  attributeKeys,
  realmAttribute,
  attrCoef,
  adjustHidden,
  raiseCap,
  heartDecay,
  heartOmen,
  natureLabel
};
