'use strict';

const { clamp } = require('../../util/text');

/*
 * 破境规则：三类政策 + 五档难度。
 *
 * policy:
 *   pills       锻体式：丹药/药浴/外力可用
 *   treasure    炼气式：丹药无效，靠悟性宝物 / 宝地
 *   opportunity 养灵式：不吃外力，只认认知与机缘
 *   heart       修心式：只认心性，可能跌落或身死
 */

const PROF_MAX = 100;

/** 前三重的自然突破率 */
function naturalChance({ policy, attr, luck, fortune = 0, cognition = 0, insightBuff = 0 }) {
  const base =
    policy === 'pills'
      ? 32 + (attr - 50) * 1.15 + (luck - 55) * 0.1
      : policy === 'treasure'
        ? 22 + (attr - 50) * 0.95 + insightBuff * 0.85
        : policy === 'opportunity'
          ? 6 + cognition * 4 + (attr - 50) * 0.3
          : 20 + (attr - 50) * 0.9;
  if (policy === 'treasure' || policy === 'opportunity') return clamp(base + fortune * 2, 3, 88);
  return clamp(base + fortune * 3, 5, 92);
}

/** 第四重所需机缘 */
function fortuneNeed(policy, attr) {
  if (policy === 'opportunity') return 3;
  if (attr >= 85) return 1;
  if (attr >= 65) return 2;
  if (attr >= 45) return 3;
  return 4;
}

/** 第四重成功率 */
function effortChance({ attr, luck, fortune, fortuneNeed: need, insightBuff = 0, borrowed = false }) {
  let chance = 45 + (attr - 50) * 0.6 + fortune * 5 + insightBuff;
  if (fortune < need) return 0; // 机缘不足，根本不能开
  if (borrowed) chance -= 30;
  return clamp(chance, 5, 95);
}

/** 灌顶：成功率减半，重复灌顶继续递减 */
const EMPOWER_FACTOR = [0.5, 0.35, 0.25, 0.15];

function empowerFactor(times) {
  const index = Math.min(times || 0, EMPOWER_FACTOR.length - 1);
  return EMPOWER_FACTOR[index];
}

/** 跨大境界灌顶的固定概率（0.001%），不受次数影响 */
function empowerCrossChance() {
  return 0.001;
}

/** 心性门槛 */
const HEART_GATE = 90;

module.exports = {
  PROF_MAX,
  HEART_GATE,
  naturalChance,
  fortuneNeed,
  effortChance,
  empowerFactor,
  empowerCrossChance
};
