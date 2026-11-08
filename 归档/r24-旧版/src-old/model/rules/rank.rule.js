'use strict';

/*
 * x 阶 x 品 —— 全项目唯一的境界坐标。
 * 阶 = 大境界序号（锻体1 / 炼气2 / 养灵3 / 修心4）
 * 品 = 小境界序号（1..6，修心 1..4）
 *
 * 极境（extreme）：三道的第六重 + 修心四重，共 7 个，单列一层。
 */

const EXTREME_STAGES = {
  body: 5,   // 锻体·临虚
  qi: 5,     // 炼气·化朽
  spirit: 5, // 养灵·回春
  heart: 0   // 修心·不惑 起全部极境
};

/** 大境界 key → 阶 */
const REALM_RANK = {
  body: 1,
  qi: 2,
  spirit: 3,
  heart: 4
};

function rankOfRealm(realmKey) {
  return REALM_RANK[realmKey] || 1;
}

/** 组合成 { rank, tier } */
function rank(realmKey, stageIndex) {
  return { rank: rankOfRealm(realmKey), tier: (stageIndex || 0) + 1 };
}

function labelOf(rankObj) {
  if (!rankObj) return '未知';
  return `${rankObj.rank} 阶 ${rankObj.tier} 品`;
}

/** 是否极境 */
function isExtreme(realmKey, stageIndex) {
  const threshold = EXTREME_STAGES[realmKey];
  if (threshold == null) return false;
  return (stageIndex || 0) >= threshold;
}

function countExtreme() {
  return 3 + 4; // 三道第六重 + 修心四重
}

/** 比较两个 rank，返回 -1 / 0 / 1 */
function compare(a, b) {
  if (!a || !b) return 0;
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  if (a.tier !== b.tier) return a.tier < b.tier ? -1 : 1;
  return 0;
}

module.exports = {
  REALM_RANK,
  EXTREME_STAGES,
  rankOfRealm,
  rank,
  labelOf,
  isExtreme,
  countExtreme,
  compare
};
