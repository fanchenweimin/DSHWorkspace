'use strict';

const { clamp } = require('../../util/text');

/*
 * 战斗压制：两层制
 *   常境：D = 阶差 * 6 + 品差 + 修为微差
 *   极境：对常境基本必胜（0.0001% 翻车）；极境之间按手段广度
 */

const TIER_GAP = 6;

/** 常境压制值 */
function gap({ atkRank, atkTier, atkProf, defRank, defTier, defProf }) {
  const rankDiff = (atkRank - defRank) * TIER_GAP;
  const tierDiff = atkTier - defTier;
  const profDiff = ((atkProf || 0) - (defProf || 0)) / 100 * 0.5;
  return rankDiff + tierDiff + profDiff;
}

/** D → 档位与倍率 */
const TIERS = [
  { min: 12, key: 'chasm', name: '天堑', out: 2.6, incoming: 0.35 },
  { min: 9, key: 'crush', name: '碾压', out: 2.1, incoming: 0.45 },
  { min: 6, key: 'press', name: '强压', out: 1.6, incoming: 0.62 },
  { min: 3, key: 'edge', name: '略优', out: 1.25, incoming: 0.82 },
  { min: -2, key: 'even', name: '持平', out: 1.0, incoming: 1.0 },
  { min: -5, key: 'behind', name: '略劣', out: 0.85, incoming: 1.18 },
  { min: -8, key: 'pressed', name: '被压', out: 0.65, incoming: 1.45 },
  { min: -11, key: 'crushed', name: '被碾压', out: 0.48, incoming: 1.75 },
  { min: -Infinity, key: 'doomed', name: '必败', out: 0.32, incoming: 2.1 }
];

function tierOf(d) {
  return TIERS.find((tier) => d >= tier.min) || TIERS[TIERS.length - 1];
}

/** 极境对常境：固定档 */
const EXTREME_OUT = 3.5;
const EXTREME_IN = 0.25;
const EXTREME_FLUKE = 0.0001; // 0.0001% 翻车

/** 极境之间：基础 55 开，按手段广度修正 */
function extremeWinRate(atkBreadth, defBreadth) {
  return clamp(50 + (atkBreadth - defBreadth) * 4, 5, 95);
}

/** 手段广度（类数） */
const BREADTH = {
  body: 4,
  qi: 6,
  spirit: 8,
  heart1: 10,
  heart2: 11,
  heart3: 12,
  heart4: 13
};

function breadthOf(realmKey, stageIndex) {
  if (realmKey === 'heart') {
    const map = ['heart1', 'heart2', 'heart3', 'heart4'];
    return BREADTH[map[Math.min(stageIndex || 0, 3)]];
  }
  return BREADTH[realmKey] || 4;
}

module.exports = {
  TIER_GAP,
  TIERS,
  EXTREME_OUT,
  EXTREME_IN,
  EXTREME_FLUKE,
  BREADTH,
  gap,
  tierOf,
  extremeWinRate,
  breadthOf
};
