'use strict';

/*
 * 手段代差（layer）
 *   physical < mana < spirit < dao
 * 攻方 layer 高于守方 → 守方「无法抵抗」。
 */

const ORDER = { physical: 0, mana: 1, spirit: 2, dao: 3 };

const LABEL = {
  physical: '肉身',
  mana: '法力',
  spirit: '灵力',
  dao: '道意'
};

/** 获得该 layer 的最低条件 */
const UNLOCK = {
  physical: { realm: 'body', tier: 1 },
  mana: { realm: 'qi', tier: 2 },     // 炼气·破胎
  spirit: { realm: 'spirit', tier: 2 }, // 养灵·启灵
  dao: null                            // 极境 / 传承级武器
};

function rank(layer) {
  return ORDER[layer] ?? 0;
}

/** 攻方能否穿透守方 */
function pierces(attackLayer, defenseLayer) {
  return rank(attackLayer) > rank(defenseLayer);
}

/** 穿透加成 */
const PIERCE_MULT = 1.8;

/** 玩家当前能达到的最高 layer */
function maxLayer(state) {
  const qi = state.realms.qi;
  const spirit = state.realms.spirit;
  if (spirit?.unlocked && spirit.stageIndex >= 1) return 'spirit';
  if (qi?.unlocked && qi.stageIndex >= 1) return 'mana';
  return 'physical';
}

/** 是否具备该 layer 的抵抗能力 */
function canResist(state, layer) {
  const need = UNLOCK[layer];
  if (!need) {
    // dao：只有极境能抗
    const body = state.realms.body;
    const qi = state.realms.qi;
    const spirit = state.realms.spirit;
    const heart = state.realms.heart;
    return Boolean(
      (body?.stageIndex >= 5) ||
      (qi?.stageIndex >= 5) ||
      (spirit?.stageIndex >= 5) ||
      (heart?.unlocked)
    );
  }
  const realm = state.realms[need.realm];
  return Boolean(realm?.unlocked && realm.stageIndex >= need.tier - 1);
}

module.exports = {
  ORDER,
  LABEL,
  UNLOCK,
  PIERCE_MULT,
  rank,
  pierces,
  maxLayer,
  canResist
};
