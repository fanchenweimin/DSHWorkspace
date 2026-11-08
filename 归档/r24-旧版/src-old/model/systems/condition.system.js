'use strict';

const rng = require('../../util/rng');
const { clamp } = require('../../util/text');
const { PROF_MAX } = require('../rules/breakthrough.rule');
const { adjustHidden } = require('../rules/attribute.rule');

/*
 * 条件求值：show / enable / when
 * show   不满足 → 选项不出现
 * enable 不满足 → 出现但置灰，附理由
 * when   事件级触发条件
 */

function avatar(state) {
  return {
    age: state.age,
    hidden: state.hidden,
    education: state.education,
    realms: state.realms,
    identity: state.identity,
    flags: state.flags,
    items: state.items,
    skills: state.skills,
    fate: state.fate,
    talents: state.talents,
    reputation: state.reputation,
    merit: state.merit,
    money: state.items.money || 0
  };
}

/** 境界是否达到 */
function realmAtLeast(state, key, tier) {
  const realm = state.realms[key];
  return Boolean(realm?.unlocked && realm.stageIndex >= tier - 1);
}

/** 单个条件判断 */
function testOne(state, key, value) {
  switch (key) {
    case 'age': {
      if (typeof value === 'number') return state.age === value;
      const min = value.min ?? -Infinity;
      const max = value.max ?? Infinity;
      return state.age >= min && state.age <= max;
    }
    case 'heart': {
      if (typeof value === 'number') return state.hidden.heart === value;
      const min = value.min ?? -Infinity;
      const max = value.max ?? Infinity;
      return state.hidden.heart >= min && state.hidden.heart <= max;
    }
    case 'nature': {
      if (typeof value === 'number') return state.hidden.nature === value;
      const min = value.min ?? -Infinity;
      const max = value.max ?? Infinity;
      return state.hidden.nature >= min && state.hidden.nature <= max;
    }
    case 'reputation': {
      if (typeof value === 'number') return state.reputation >= value;
      const min = value.min ?? -Infinity;
      const max = value.max ?? Infinity;
      return state.reputation >= min && state.reputation <= max;
    }
    case 'fate':
      return Array.isArray(value) ? value.includes(state.fate) : value === state.fate;
    case 'talent':
      return Array.isArray(value)
        ? value.some((key2) => state.talents.includes(key2))
        : state.talents.includes(value);
    case 'identity':
      return Array.isArray(value) ? value.includes(state.identity.base) : value === state.identity.base;
    case 'education':
      return Array.isArray(value) ? value.includes(state.education.stage) : value === state.education.stage;
    case 'realm': {
      for (const [realmKey, tier] of Object.entries(value)) {
        if (!realmAtLeast(state, realmKey, typeof tier === 'number' ? tier : tier.min || 1)) return false;
      }
      return true;
    }
    case 'flags': {
      for (const [flag, expected] of Object.entries(value)) {
        if (Boolean(state.flags[flag]) !== Boolean(expected)) return false;
      }
      return true;
    }
    case 'notFlags': {
      for (const [flag, expected] of Object.entries(value)) {
        if (Boolean(state.flags[flag]) === Boolean(expected)) return false;
      }
      return true;
    }
    case 'money':
      return (state.items.money || 0) >= value;
    case 'items': {
      for (const [id, count] of Object.entries(value)) {
        if ((state.items[id] || 0) < count) return false;
      }
      return true;
    }
    case 'skill': {
      for (const [skill, level] of Object.entries(value)) {
        if ((state.skills[skill] || 0) < level) return false;
      }
      return true;
    }
    case 'tier': {
      // 百艺品阶
      for (const [skill, level] of Object.entries(value)) {
        if ((state.skillTier[skill] || 1) < level) return false;
      }
      return true;
    }
    case 'merit':
      return state.merit >= value;
    case 'cognition':
      return state.cognition >= value;
    case 'fortune': {
      for (const [realmKey, need] of Object.entries(value)) {
        if ((state.fortune[realmKey] || 0) < need) return false;
      }
      return true;
    }
    default:
      return true;
  }
}

/** 整组条件 */
function test(state, cond) {
  if (!cond) return true;
  for (const [key, value] of Object.entries(cond)) {
    if (!testOne(state, key, value)) return false;
  }
  return true;
}

/** enable 不满足的原因 */
function whyDisabled(state, enable) {
  if (!enable) return '';
  if (enable.money && (state.items.money || 0) < enable.money) return '钱不够';
  if (enable.items) {
    for (const [id, count] of Object.entries(enable.items)) {
      if ((state.items[id] || 0) < count) return `缺${count}件材料`;
    }
  }
  if (enable.realm) {
    for (const [realmKey, tier] of Object.entries(enable.realm)) {
      if (!realmAtLeast(state, realmKey, typeof tier === 'number' ? tier : tier.min || 1)) {
        return '境界不足';
      }
    }
  }
  if (enable.skill) {
    for (const [skill, level] of Object.entries(enable.skill)) {
      if ((state.skills[skill] || 0) < level) return '手艺不足';
    }
  }
  return '条件不足';
}

/** 条件宏 */
const MACROS = {
  goodOnly: { heart: { min: 70 }, nature: { min: 61 } },
  evilOnly: { nature: { max: 40 } },
  bodyOnly: { realm: { body: 1 } },
  qiOnly: { realm: { qi: 1 } },
  spiritOnly: { realm: { spirit: 1 } },
  heartOnly: { realm: { heart: 1 } }
};

function resolveMacros(cond) {
  if (!cond) return cond;
  const out = {};
  for (const [key, value] of Object.entries(cond)) {
    if (MACROS[key]) Object.assign(out, MACROS[key]);
    else out[key] = value;
  }
  return out;
}

/** 选项是否出现 */
function visible(state, choice) {
  const cond = resolveMacros(choice.show);
  if (!test(state, cond)) return false;
  // 恶人专属选项的额外门槛：需要 knows_blood_alchemy 时才真正显示
  if (choice.evil && !isEvilUnlocked(state)) return false;
  return true;
}

/** 邪恶路线解锁 */
function isEvilUnlocked(state) {
  if (state.flags.knows_blood_alchemy) return true;
  if (state.hidden.nature <= 40) return true;
  const fate = state.fate;
  const evilFates = ['sha', 'xiegu', 'bloodhand', 'xiong'];
  return evilFates.includes(fate);
}

/** 选项是否可用 */
function enabled(state, choice) {
  return test(state, choice.enable);
}

module.exports = {
  test,
  testOne,
  whyDisabled,
  visible,
  enabled,
  isEvilUnlocked,
  realmAtLeast,
  resolveMacros
};
