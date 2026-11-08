'use strict';

const rng = require('../../util/rng');
const { clamp } = require('../../util/text');
const money = require('../../util/money');
const helper = require('./view.helper');
const { GameError } = helper;
const rank = require('../rules/rank.rule');
const suppression = require('../rules/suppression.rule');
const layer = require('../rules/layer.rule');
const { byId: opponentById } = require('../../seed/opponents.seed');
const { byId: itemById } = require('../../seed/items.seed');
const { artById } = require('../../seed/arts.seed');

const MAX_ROUNDS = 10;

const INTENTS = {
  attack: { key: 'attack', label: '强攻', desc: '对方气机外放，下一招会硬碰硬。', hint: '守势可卸力。' },
  charge: { key: 'charge', label: '蓄势', desc: '对方正在聚气，下一击会很重。', hint: '兵刃抢攻可打断。' },
  evade: { key: 'evade', label: '游斗', desc: '对方身法飘忽，正寻你的破绽。', hint: '术法与符箓可覆盖。' }
};

const LEVEL_LABEL = {
  spar: '切磋',
  duel: '斗法',
  life: '生死斗',
  death: '不死不休'
};

function pickIntent() {
  const v = rng.next();
  if (v < 0.38) return 'attack';
  if (v < 0.7) return 'charge';
  return 'evade';
}

function playerExtreme(state) {
  for (const [key, realm] of Object.entries(state.realms)) {
    if (!realm?.unlocked) continue;
    if (rank.isExtreme(key, realm.stageIndex)) return { key, stageIndex: realm.stageIndex };
  }
  return null;
}

/** 计算压制 */
function computeGap(state, opponent) {
  const pKey = state.activeRealm || 'body';
  const pRealm = state.realms[pKey];
  const pExtreme = playerExtreme(state);
  const oExtreme = rank.isExtreme(opponent.realmKey, opponent.stageIndex);
  const pTier = (pRealm?.stageIndex ?? 0) + 1;

  // 极境对常境
  if (pExtreme && !oExtreme) {
    return { key: 'extreme', name: '极境压制', out: suppression.EXTREME_OUT, incoming: suppression.EXTREME_IN };
  }
  if (!pExtreme && oExtreme) {
    return { key: 'doomed', name: '被极境压制', out: 0.35, incoming: 2.1 };
  }
  if (pExtreme && oExtreme) {
    const ab = suppression.breadthOf(pExtreme.key, pExtreme.stageIndex);
    const db = suppression.breadthOf(opponent.realmKey, opponent.stageIndex);
    const win = suppression.extremeWinRate(ab, db);
    return { key: 'extreme-even', name: '问道', out: 1 + (win - 50) / 100, incoming: 1 - (win - 50) / 100, win };
  }

  const d = suppression.gap({
    atkRank: rank.rankOfRealm(pKey),
    atkTier: pTier,
    atkProf: pRealm?.prof ?? 0,
    defRank: rank.rankOfRealm(opponent.realmKey),
    defTier: (opponent.stageIndex ?? 0) + 1,
    defProf: opponent.prof ?? 0
  });
  const t = suppression.tierOf(d);
  return { key: t.key, name: t.name, out: t.out, incoming: t.incoming, d };
}

/** 玩家 layer */
function playerLayer(state, actionId, art) {
  if (actionId === 'unarmed') return 'physical';
  if (actionId === 'weapon') return itemById(state.equipment.weapon)?.layer || 'physical';
  if (actionId === 'talisman') return 'mana';
  if (art) return art.layer || 'physical';
  return 'physical';
}

/** 对手 layer */
function opponentLayer(opponent) {
  if (rank.isExtreme(opponent.realmKey, opponent.stageIndex)) return 'dao';
  if (opponent.realmKey === 'body') return 'physical';
  if (opponent.realmKey === 'qi') return opponent.stageIndex >= 1 ? 'mana' : 'physical';
  if (opponent.realmKey === 'spirit') return opponent.stageIndex >= 1 ? 'spirit' : 'mana';
  return 'dao';
}

/** 起手 */
function startBattle(state, opponentId, event, choice, years, preText, preCtx) {
  const opponent = opponentById(opponentId);
  if (!opponent) throw new GameError('NO_OPPONENT', '对手不在这里。', 500);

  const gap = computeGap(state, opponent);
  const hpBonus = 0;

  state.phase = 'battle';
  state.battle = {
    opponentId,
    opponent: {
      id: opponent.id,
      name: opponent.name,
      seal: opponent.seal,
      title: opponent.title,
      realmKey: opponent.realmKey,
      stageIndex: opponent.stageIndex,
      prof: opponent.prof || 0,
      basePower: opponent.basePower,
      desc: opponent.desc
    },
    combatLevel: opponent.combatLevel || 'duel',
    playerHp: 100 + hpBonus,
    playerMaxHp: 100 + hpBonus,
    enemyHp: opponent.hpBase,
    enemyMaxHp: opponent.hpBase,
    round: 1,
    intent: pickIntent(),
    stage: 'prepare',
    guard: 0,
    buff: 0,
    artCooldown: 0,
    qi: 20,
    gap,
    log: [preText || `你与${opponent.name}对上。`, opponent.desc],
    over: false,
    outcome: null,
    pierced: false,
    eventId: event?.id || null,
    choiceId: choice?.id || null,
    years: years || 1,
    preChanges: preCtx?.changes || [],
    preNotes: preCtx?.notes || []
  };
  state.result = null;
  state.currentEventId = event?.id || null;
  helper.bumpRev(state);
  return state;
}

/** 可用行动 */
function actionList(state) {
  const battle = state.battle;
  const actions = [];
  const arts = Object.values(state.arts).flat().map(artById).filter(Boolean);

  // 拳脚
  const fist = arts.find((a) => a.style === 'unarmed');
  actions.push({
    id: 'unarmed', name: fist?.name || '拳脚', seal: '拳',
    desc: fist?.desc || '以拳脚迎敌。', available: true, reason: ''
  });

  // 术法
  const bestArt = arts
    .filter((a) => a.category !== 'unarmed' && a.category !== 'weapon')
    .sort((a, b) => (b.grade.rank * 10 + b.grade.tier) - (a.grade.rank * 10 + a.grade.tier))[0];
  if (bestArt) {
    const needLayer = bestArt.layer;
    const usable = needLayer === 'physical' || layer.canResist(state, needLayer);
    actions.push({
      id: 'art', name: bestArt.name, seal: '术', desc: bestArt.desc,
      available: usable && battle.artCooldown <= 0,
      reason: !usable ? `需${layer.LABEL[needLayer]}` : battle.artCooldown > 0 ? '尚在调息' : ''
    });
  }

  // 兵器
  const weapon = itemById(state.equipment.weapon);
  if (weapon) {
    const weaponArts = arts.filter((a) => a.category === 'weapon' && a.weaponType === weapon.weaponType);
    const hasArt = weaponArts.length > 0;
    const usable = weapon.layer === 'physical' || layer.canResist(state, weapon.layer);
    actions.push({
      id: 'weapon',
      name: hasArt ? weaponArts[0].name : `${weapon.name}·凡俗劈砍`,
      seal: '兵',
      desc: hasArt ? weaponArts[0].desc : '你握着兵器，却不会它的招式，只能硬劈。',
      available: usable,
      reason: !usable ? `需${layer.LABEL[weapon.layer]}` : ''
    });
  }

  // 符箓
  if ((state.items.thunder_talisman || 0) > 0) {
    const usable = layer.canResist(state, 'mana');
    actions.push({
      id: 'talisman', name: '雷火符', seal: '符',
      desc: '一次性符箓，破胎后才能引动。',
      available: usable, reason: usable ? '' : '需炼气·破胎'
    });
  }

  // 丹药
  if ((state.items.peiyuan_pill || 0) > 0) {
    actions.push({ id: 'pill_buff', name: '服培元丹', seal: '丹', desc: '临时提升气血。', available: true, reason: '' });
  }
  if ((state.items.huxin_pill || 0) > 0) {
    actions.push({ id: 'pill_heal', name: '服护心丹', seal: '护', desc: '缓一口气。', available: true, reason: '' });
  }

  actions.push({ id: 'defend', name: '守势', seal: '守', desc: '稳住架势，减少受伤。', available: true, reason: '' });
  actions.push({ id: 'meditate', name: '调息', seal: '息', desc: '回一口气机。', available: true, reason: '' });

  return actions;
}

/** 玩家伤害 */
function playerDamage(state, actionId, intent) {
  const battle = state.battle;
  const pKey = state.activeRealm || 'body';
  const pTier = (state.realms[pKey]?.stageIndex ?? 0) + 1;
  const arts = Object.values(state.arts).flat().map(artById).filter(Boolean);

  let damage = 0;
  let art = null;

  if (actionId === 'unarmed') {
    art = arts.find((a) => a.style === 'unarmed');
    damage = 9 + pTier * 2 + (art?.power || 4);
  } else if (actionId === 'art') {
    art = arts
      .filter((a) => a.category !== 'unarmed' && a.category !== 'weapon')
      .sort((a, b) => (b.grade.rank * 10 + b.grade.tier) - (a.grade.rank * 10 + a.grade.tier))[0];
    damage = 14 + (art?.power || 8) + pTier * 3;
    if (intent === 'evade') damage *= 1.55;
    battle.artCooldown = art?.cooldown || 2;
  } else if (actionId === 'weapon') {
    const weapon = itemById(state.equipment.weapon);
    art = arts.find((a) => a.category === 'weapon' && a.weaponType === weapon?.weaponType);
    if (art) {
      damage = 14 + (weapon?.power || 0) + pTier * 2.5;
      if (art.intentBonus?.[intent]) damage *= art.intentBonus[intent];
    } else {
      damage = 14 + (weapon?.power || 0) * 0.45 + pTier * 1.2;
    }
  } else if (actionId === 'talisman') {
    damage = 22 + pTier * 2;
    if (intent === 'evade') damage *= 1.5;
    if (intent === 'attack') damage *= 1.2;
  }

  damage *= battle.gap.out;
  damage += battle.buff;
  damage += (state.hidden.luck - 55) * 0.12;
  damage += rng.int(-3, 5);

  // 手段代差
  const atkLayer = playerLayer(state, actionId, art);
  const defLayer = opponentLayer(battle.opponent);
  if (layer.pierces(atkLayer, defLayer)) {
    damage *= layer.PIERCE_MULT;
    battle.pierced = true;
  }

  return Math.max(4, Math.round(damage));
}

/** 对手伤害 */
function enemyDamage(state, guarded) {
  const battle = state.battle;
  const op = battle.opponent;
  let damage = 11 + op.basePower * 3.2 + battle.round * 1.4;
  damage -= (state.realms.body?.stageIndex || 0) * 1.1;
  if (battle.intent === 'attack') damage *= 1.35;
  if (battle.intent === 'charge') damage *= 1.45;
  if (battle.intent === 'evade') damage *= 0.78;
  if (guarded) damage *= 0.45;
  damage *= battle.gap.incoming;
  damage += rng.int(-3, 4);
  return Math.max(4, Math.round(damage));
}

/** 执行一回合 */
function performAction(state, actionId) {
  const battle = state.battle;
  if (!battle || battle.over) throw new GameError('BATTLE_OVER', '斗法已经结束。', 409);

  const action = actionList(state).find((a) => a.id === actionId);
  if (!action) throw new GameError('NO_ACTION', '没有这个行动。', 400);
  if (!action.available) throw new GameError('NOT_AVAILABLE', action.reason, 400);

  const intent = battle.intent;
  let playerHp = battle.playerHp;
  let enemyHp = battle.enemyHp;
  let guarded = false;

  if (actionId === 'defend') {
    guarded = true;
    battle.guard = Math.min(3, battle.guard + 1);
    battle.log.push('你稳住了架势。');
  } else if (actionId === 'meditate') {
    battle.qi = Math.min(40, battle.qi + 8);
    battle.log.push('你退后半步，调匀呼吸。');
  } else if (actionId === 'pill_buff') {
    state.items.peiyuan_pill = Math.max(0, (state.items.peiyuan_pill || 0) - 1);
    if (!state.items.peiyuan_pill) delete state.items.peiyuan_pill;
    battle.buff += 12;
    battle.log.push('你咬碎培元丹，一股热流冲开四肢。');
  } else if (actionId === 'pill_heal') {
    state.items.huxin_pill = Math.max(0, (state.items.huxin_pill || 0) - 1);
    if (!state.items.huxin_pill) delete state.items.huxin_pill;
    playerHp = Math.min(battle.playerMaxHp, playerHp + 28);
    battle.log.push('护心丹化开，胸口那股要断的气又续上了。');
  } else {
    if (actionId === 'talisman') {
      state.items.thunder_talisman = Math.max(0, (state.items.thunder_talisman || 0) - 1);
      if (!state.items.thunder_talisman) delete state.items.thunder_talisman;
      battle.log.push('雷火符无风自燃。');
    }
    const dmg = playerDamage(state, actionId, intent);
    enemyHp -= dmg;
    battle.log.push(`${action.name}，你打出了 ${dmg} 点伤害。`);
  }

  // 对手反击
  if (enemyHp > 0) {
    const back = enemyDamage(state, guarded);
    playerHp -= back;
    battle.log.push(`${battle.opponent.name}反击，你受了 ${back} 点伤。`);
  }

  battle.playerHp = Math.max(0, playerHp);
  battle.enemyHp = Math.max(0, enemyHp);

  if (battle.enemyHp <= 0 || battle.playerHp <= 0 || battle.round >= MAX_ROUNDS) {
    battle.over = true;
    if (battle.enemyHp <= 0 && battle.playerHp > 0) battle.outcome = 'win';
    else if (battle.playerHp <= 0) battle.outcome = 'lose';
    else battle.outcome = battle.playerHp / battle.playerMaxHp >= battle.enemyHp / battle.enemyMaxHp ? 'win' : 'lose';
    battle.intent = null;
    battle.log.push(battle.outcome === 'win' ? '对方倒下了。' : '你撑不住了。');
  } else {
    battle.round += 1;
    battle.intent = pickIntent();
    battle.guard = 0;
    if (battle.artCooldown > 0) battle.artCooldown -= 1;
  }

  helper.bumpRev(state);
  return state;
}

/** 结束战斗 */
function finishBattle(state) {
  const battle = state.battle;
  if (!battle?.over) throw new GameError('BATTLE_NOT_OVER', '斗法还没结束。', 409);

  const opponent = opponentById(battle.opponentId);
  const c = helper.ctx();
  c.changes = [...(battle.preChanges || [])];
  c.notes = [...(battle.preNotes || [])];

  const win = battle.outcome === 'win';

  if (win) {
    applyEffects(state, opponent.reward, c);
    c.note?.(opponent.winText);
    state.reputation = clamp(state.reputation + 3, -50, 100);
    c.change?.('声望', '+3', 'reputation');
  } else {
    const lethal = ['life', 'death'].includes(battle.combatLevel);
    if (lethal) {
      state.pendingEnding = { cause: 'battle', opponent: opponent.name };
      c.note?.('这一战没有退路。');
    } else {
      applyEffects(state, opponent.penalty || {}, c);
      c.note?.(opponent.loseText);
      state.flags.near_death = true;
      // 心性波动：以为必胜却输
      const gapKey = battle.gap.key;
      if (['chasm', 'crush', 'press', 'edge'].includes(gapKey)) {
        state.hidden.heart = Math.max(10, state.hidden.heart - 3);
        c.change?.('心性', '重挫', 'hidden');
      } else {
        state.hidden.heart = Math.max(10, state.hidden.heart - 1);
        c.change?.('心性', '略有动摇', 'hidden');
      }
      // 赔偿
      const assets = 10000;
      const comp = Math.round(assets * (0.01 + rng.next() * 0.09));
      if (battle.combatLevel === 'duel') {
        if ((state.items.money || 0) >= comp) {
          state.items.money -= comp;
          c.change?.('赔偿', `-${money.format(comp)}`, 'money');
        } else {
          state.flags.debt = (state.flags.debt || 0) + comp;
          c.note?.('钱不够赔。你欠了一笔。');
        }
        state.reputation = clamp(state.reputation - 5, -50, 100);
        c.change?.('声望', '-5', 'reputation');
      } else {
        state.reputation = clamp(state.reputation - 3, -50, 100);
        c.change?.('声望', '-3', 'reputation');
      }
    }
  }

  helper.module;
  const years = battle.years || 1;
  require('./realm.system').advanceAge(state, years, c);
  if (!state.pendingEnding) {
    require('./realm.system').resolveAwaiting(state, c);
    require('./realm.system').processProgression(state, c);
  }

  state.battle = null;
  state.phase = 'result';
  makeBattleResult(state, c, win, opponent, years);
  helper.bumpRev(state);
  return state;
}

function makeBattleResult(state, c, win, opponent, years) {
  state.result = {
    title: win ? `胜 ${opponent.name}` : `败于${opponent.name}`,
    kicker: `景和${12 + state.age - 7}年 · ${state.age}岁`,
    paragraphs: [win ? opponent.winText : opponent.loseText],
    changes: c.changes,
    notes: c.notes,
    years
  };
}

/** 认输 / 遁走 */
function surrender(state) {
  const battle = state.battle;
  if (!battle || battle.over) throw new GameError('BATTLE_OVER', '斗法已经结束。', 409);
  const level = battle.combatLevel;
  if (['life', 'death'].includes(level)) {
    throw new GameError('CANNOT_SURRENDER', '生死斗不能认输。', 400);
  }
  battle.over = true;
  battle.outcome = 'lose';
  battle.intent = null;
  battle.log.push('你认输了。');
  helper.bumpRev(state);
  return state;
}

function flee(state) {
  const battle = state.battle;
  if (!battle || battle.over) throw new GameError('BATTLE_OVER', '斗法已经结束。', 409);
  const level = battle.combatLevel;
  if (level === 'death') throw new GameError('CANNOT_FLEE', '不死不休，没有退路。', 400);

  const chance = level === 'life' ? 40 : 70;
  if (rng.roll(chance)) {
    battle.over = true;
    battle.outcome = 'fled';
    battle.intent = null;
    battle.log.push('你脱身了。');
    helper.bumpRev(state);
    return state;
  }

  battle.playerHp = 0;
  battle.over = true;
  battle.outcome = 'lose';
  battle.intent = null;
  battle.log.push('你没跑掉。');
  helper.bumpRev(state);
  return state;
}

/** 公共战斗视图 */
function publicBattle(state) {
  const battle = state.battle;
  if (!battle) return null;
  const levels = LEVEL_LABEL;
  return {
    opponent: {
      name: battle.opponent.name,
      seal: battle.opponent.seal,
      title: battle.opponent.title,
      desc: battle.opponent.desc,
      rank: rank.labelOf(rank.rank(battle.opponent.realmKey, battle.opponent.stageIndex))
    },
    combatLevel: battle.combatLevel,
    combatLevelLabel: levels[battle.combatLevel] || '斗法',
    round: battle.round,
    maxRounds: MAX_ROUNDS,
    playerHp: battle.playerHp,
    playerMaxHp: battle.playerMaxHp,
    enemyHp: battle.enemyHp,
    enemyMaxHp: battle.enemyMaxHp,
    qi: battle.qi,
    guard: battle.guard,
    gap: { key: battle.gap.key, name: battle.gap.name },
    intent: battle.intent
      ? { key: battle.intent, ...INTENTS[battle.intent] }
      : null,
    actions: battle.over ? [] : actionList(state),
    log: battle.log.slice(-8),
    over: battle.over,
    outcome: battle.outcome,
    canSurrender: !battle.over && ['spar', 'duel'].includes(battle.combatLevel),
    canFlee: !battle.over && battle.combatLevel !== 'death'
  };
}

module.exports = {
  MAX_ROUNDS,
  INTENTS,
  LEVEL_LABEL,
  startBattle,
  actionList,
  performAction,
  finishBattle,
  surrender,
  flee,
  publicBattle,
  computeGap,
  pickIntent
};
