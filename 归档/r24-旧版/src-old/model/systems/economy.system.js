'use strict';

const rng = require('../../util/rng');
const { clamp } = require('../../util/text');
const money = require('../../util/money');
const { ITEMS } = require('../../seed/items.seed');
const { familySupply, cityTax, craftCost, reputationEffects } = require('../rules/economy.rule');
const { IDENTITIES, soulMass } = require('../../seed/identities.seed');

/*
 * 经济系统：年度结算。
 * 每年自动发生：
 *   - 家世年供
 *   - 缴税（居民 / 城卫 / 附庸 / 城主）
 *   - 生存开销
 *   - 城主府俸禄
 * 付不起 → 记 debt / 触发强制劳役
 */

/** 该身份的年度税 */
function annualTax(state) {
  const base = state.identity.base;
  if (base === 'lord') return 0; // 城主是收税的一方
  if (base === 'citizen') return state.age < 16 ? 0 : 400;
  if (base === 'guard') return 300;
  if (base === 'retainer') return 800;
  if (base === 'clan_head') return 400;
  if (base === 'sect_master') return 0;
  if (base === 'general') return 0;
  if (base === 'disciple') return 0;
  return state.age < 16 ? 0 : 40; // 散修、附庸、种草者
}

/** 该身份的年度俸禄 / 抽成 */
function annualStipend(state) {
  const base = state.identity.base;
  if (base === 'guard') return 2500;
  if (base === 'retainer') return 6000;
  if (base === 'general') return 30000 + rng.int(0, 30000);
  if (base === 'sect_master') return 40000 + rng.int(0, 110000);
  if (base === 'lord') return 0; // 城主走 cityTax
  if (base === 'disciple') return 1200;
  if (state.flags.patronage) return state.flags.patronageSalary || 0;
  return 0;
}

/** 生存开销 */
function livingCost(state) {
  if (state.identity.base === 'lord') return 6000;
  if (state.identity.base === 'general') return 4000;
  if (state.identity.base === 'sect_master') return 3000;
  if (state.age > 60) return 1500;
  return 1000;
}

/**
 * 年度结算。
 * 返回 { notes, changes, laborTriggered }
 */
function settleYear(state) {
  const notes = [];
  const changes = [];
  const change = (label, value, tone) => changes.push({ label, value, tone });
  const note = (text) => notes.push(text);

  // 家世年供
  const family = state.flags.family;
  const supply = familySupply(family, state.age);
  if (supply > 0) {
    state.items.money = (state.items.money || 0) + supply;
    change('家世供给', `+${money.format(supply)}`, 'money');
  }

  // 俸禄
  const stipend = annualStipend(state);
  if (stipend > 0) {
    state.items.money = (state.items.money || 0) + stipend;
    change('俸禄', `+${money.format(stipend)}`, 'money');
  }

  // 城主抽税
  if (state.identity.base === 'lord') {
    const pop = state.identity.subjects.mortal || 0;
    const tax = cityTax(pop, state.flags.taxRate ?? 0.4);
    state.items.money = (state.items.money || 0) + tax;
    change('城税', `+${money.format(tax)}`, 'money');
  }

  // 生存开销
  const living = livingCost(state);
  state.items.money = Math.max(0, (state.items.money || 0) - living);
  change('生计', `-${money.format(living)}`, 'money');

  // 缴税
  const tax = annualTax(state);
  let labor = false;
  if (tax > 0) {
    if ((state.items.money || 0) >= tax) {
      state.items.money -= tax;
      change('赋税', `-${money.format(tax)}`, 'money');
    } else {
      const shortfall = tax - (state.items.money || 0);
      state.items.money = 0;
      state.flags.debt = (state.flags.debt || 0) + shortfall;
      state.flags.owedTax = true;
      change('欠税', `-${money.format(shortfall)}`, 'danger');
      note('你交不出今年的税。衙门记了一笔。');
      labor = true;
    }
  }

  // 城主府开销（城主必须花钱）
  if (state.identity.base === 'lord') {
    const upkeep = 6000;
    if ((state.items.money || 0) >= upkeep) {
      state.items.money -= upkeep;
      change('城池开销', `-${money.format(upkeep)}`, 'money');
      state.flags.courtFavor = clamp((state.flags.courtFavor ?? 50) + 1, 0, 100);
    } else {
      state.flags.courtFavor = clamp((state.flags.courtFavor ?? 50) - 8, 0, 100);
      note('城防与官吏的开销你付不出了。城中已有怨言。');
      if (state.flags.courtFavor <= 20) {
        state.flags.misrule = (state.flags.misrule || 0) + 1;
      }
    }
  }

  return { notes, changes, laborTriggered: labor, debt: state.flags.debt || 0 };
}

/** 百艺修炼成本校验 */
function canAffordCraft(state, skill, tier = 1) {
  const cost = craftCost(skill, tier);
  if ((state.items.money || 0) < cost.money) return { ok: false, reason: '钱不够', cost };
  for (const [id, count] of Object.entries(cost.items)) {
    if ((state.items[id] || 0) < count) return { ok: false, reason: `缺${ITEMS[id]?.name || id}`, cost };
  }
  return { ok: true, reason: '', cost };
}

/** 扣百艺成本 */
function payCraft(state, skill, tier = 1) {
  const check = canAffordCraft(state, skill, tier);
  if (!check.ok) return check;
  state.items.money -= check.cost.money;
  for (const [id, count] of Object.entries(check.cost.items)) {
    state.items[id] = Math.max(0, (state.items[id] || 0) - count);
    if (state.items[id] === 0) delete state.items[id];
  }
  return { ok: true, cost: check.cost };
}

/** 当前养灵增益 */
function spiritBonus(state) {
  const mass = soulMass(state.identity);
  return { mass, multiplier: 1 + Math.log10(mass + 1) / 2 };
}

module.exports = {
  annualTax,
  annualStipend,
  livingCost,
  settleYear,
  canAffordCraft,
  payCraft,
  spiritBonus,
  reputationEffects,
  patronage: require('../rules/economy.rule').patronage
};
