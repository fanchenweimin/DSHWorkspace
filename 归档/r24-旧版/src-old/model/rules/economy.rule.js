'use strict';

const { clamp } = require('../../util/text');

/*
 * 经济规则：物价锚点、赔偿、声望、税收、家世供给、百艺成本。
 */

/** 1 金 = 10000 铜；普通人一年生活费 ≈ 10 银 = 1000 铜 */
const LIVING_YEAR = 1000;

/** 家世年供（按年龄档位） */
const FAMILY_SUPPLY = {
  大族: { minor: 10000, adult: 5000, elder: 2000 },
  富商: { minor: 5000, adult: 3000, elder: 1000 },
  小吏: { minor: 2000, adult: 1000, elder: 300 },
  农户: { minor: 500, adult: 200, elder: 0 },
  孤儿: { minor: 0, adult: 0, elder: 0 }
};

function familySupply(family, age) {
  const tier = FAMILY_SUPPLY[family] || FAMILY_SUPPLY['孤儿'];
  if (age <= 15) return tier.minor;
  if (age <= 25) return tier.adult;
  return tier.elder;
}

/** 赔偿：对手资产 × 随机 1%~10% × 级别系数 */
function compensation(opponentAssets, ratio, levelFactor = 1) {
  return Math.round(opponentAssets * clamp(ratio, 0.01, 0.1) * levelFactor);
}

/** 偿还方式 */
function debtPlan(debt, yearlyIncome) {
  const raw = Math.ceil(debt / Math.max(1, yearlyIncome));
  const years = Math.min(5, raw);
  // covered = 上限 5 年内能还清
  return { years, covered: raw <= 5 };
}

/** 声望用途 */
function reputationEffects(reputation) {
  return {
    marketMultiplier: reputation < 0 ? 1.3 : reputation >= 80 ? 0.9 : 1,
    commissionBonus: clamp(Math.floor(reputation / 20) * 0.05, 0, 0.2),
    canDirectRecruit: reputation >= 0,
    canBeGeneral: reputation >= 60,
    canBeLord: reputation >= 80,
    canBorrowHeritage: reputation >= 70,
    canRecruitFollowers: reputation >= 30
  };
}

/** 城主税收 */
function cityTax(population, rate = 0.4) {
  return Math.round(population * 20 * clamp(rate, 0.3, 0.6));
}

/** 百艺单次成本 */
const CRAFT_COST = {
  alchemy: { money: 30, items: { herb: 2 } },
  forging: { money: 50, items: { iron: 2 } },
  talisman: { money: 20, items: { paper: 2 } },
  formation: { money: 40, items: { array_stone: 2 } }
};

const CRAFT_TIER_MULT = { 1: 1, 2: 5, 3: 25 };

function craftCost(skill, tier = 1) {
  const base = CRAFT_COST[skill];
  if (!base) return { money: 0, items: {} };
  const mult = CRAFT_TIER_MULT[tier] || 1;
  return { money: base.money * mult, items: { ...base.items } };
}

/** 城主府招募：按百艺品阶分期 */
const PATRONAGE = [
  { maxTier: 1, minLevel: 1, settle: 20000, salary: 3000 },
  { maxTier: 1, minLevel: 2, settle: 50000, salary: 6000 },
  { maxTier: 1, minLevel: 3, settle: 100000, salary: 10000 },
  { maxTier: 2, minLevel: 4, settle: 300000, salary: 30000 },
  { maxTier: 3, minLevel: 5, settle: 800000, salary: 80000 }
];

function patronage(skillLevel) {
  const row = PATRONAGE.find((r) => skillLevel <= r.minLevel + 0) || PATRONAGE[PATRONAGE.length - 1];
  return row;
}

/** 灌顶费用（按被灌顶者阶） */
const EMPOWER_COST = {
  1: [3000, 8000],
  2: [10000, 30000],
  3: [40000, 100000]
};

module.exports = {
  LIVING_YEAR,
  FAMILY_SUPPLY,
  CRAFT_COST,
  CRAFT_TIER_MULT,
  EMPOWER_COST,
  familySupply,
  compensation,
  debtPlan,
  reputationEffects,
  cityTax,
  craftCost,
  patronage
};
