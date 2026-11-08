'use strict';

/*
 * 序列化：按 viewer 裁剪。
 *   sysadmin → 完整（含 tags / changes / 数值预览 / 隐藏属性）
 *   user / guest → 玩家视图（只有标题、提示、时长）
 *
 * 白名单式：玩家视图只取允许的字段，避免误泄。
 */

const money = require('../../util/money');
const { FATES } = require('../../seed/fates.seed');
const { TALENTS } = require('../../seed/talents.seed');
const { byId: itemById } = require('../../seed/items.seed');
const { IDENTITIES } = require('../../seed/identities.seed');
const economy = require('../../model/systems/economy.system');
const viewHelper = require('../../model/systems/view.helper');
const actionSystem = require('../../model/systems/action.system');
const combat = require('../../model/systems/combat.system');
const realmSystem = require('../../model/systems/realm.system');
const eventSystem = require('../../model/systems/event.system');

const isAdmin = (viewer) => viewer === 'sysadmin';

const SKILL_NAMES = { alchemy: '炼丹', forging: '炼器', talisman: '符箓', formation: '阵法' };

function stageTagOf(realm) {
  if (realm.completed) return '大圆满';
  if (realm.stageIndex === 4) return '圆满';
  if (realm.stageIndex === 3) return '大成';
  return '';
}

function serializeRealms(state) {
  return state.config.realms
    .filter((cfg) => state.realms[cfg.key]?.unlocked)
    .map((cfg) => {
      const realm = state.realms[cfg.key];
      const current = cfg.stages[realm.stageIndex];
      return {
        key: cfg.key,
        name: cfg.name,
        seal: cfg.seal,
        accent: cfg.accent,
        soft: cfg.soft,
        rank: cfg.combatRank,
        stageName: current?.name || '未启',
        stageIndex: realm.stageIndex,
        stageCount: cfg.stages.length,
        stageTag: stageTagOf(realm),
        progress: realm.completed ? 100 : Math.round(realm.prof),
        completed: realm.completed,
        blocked: Boolean(realm.blocked),
        awaiting: realm.awaiting,
        active: state.activeRealm === cfg.key,
        desc: current?.description || '',
        policy: cfg.policy
      };
    });
}

function serializeEvent(state, event, viewer) {
  if (!event) return null;
  const admin = isAdmin(viewer);
  const visible = viewHelper.visibleChoices(state, event);
  return {
    id: event.id,
    kind: event.kind,
    icon: event.icon,
    title: event.title,
    kicker: event.kicker || '',
    body: event.body,
    forcedBy: event.forcedBy || null,
    choices: visible.map((choice) => {
      const st = viewHelper.choiceState(state, choice);
      const base = {
        id: choice.id,
        label: choice.label,
        hint: choice.hint || '',
        years: choice.years ?? event.years ?? 1,
        available: st.available,
        reason: st.available ? '' : st.reason,
        evil: Boolean(choice.evil)
      };
      if (!admin) return base;
      return { ...base, tags: choice.tags || [], special: choice.special || null };
    })
  };
}

function serializeResult(state, viewer) {
  const result = state.result;
  if (!result) return null;
  const out = {
    title: result.title,
    kicker: result.kicker,
    paragraphs: result.paragraphs,
    notes: result.notes,
    years: result.years
  };
  if (isAdmin(viewer)) out.changes = result.changes || [];
  return out;
}

function serializeInventory(state) {
  const items = Object.entries(state.items || {})
    .filter(([id]) => id !== 'money')
    .map(([id, count]) => {
      const item = itemById(id);
      return {
        id,
        name: item?.name || id,
        count,
        type: item?.type || 'material',
        desc: item?.desc || '',
        equipped: state.equipment?.weapon === id
      };
    });
  const weapon = itemById(state.equipment?.weapon);
  return {
    money: state.items.money || 0,
    moneyLabel: money.format(state.items.money || 0),
    items,
    weapon: weapon ? weapon.name : null,
    weaponTier: weapon?.tier || null,
    canUseWeapon: Boolean(weapon)
  };
}

function serializeSkills(state) {
  return Object.entries(state.skills).map(([key, level]) => ({
    key,
    name: SKILL_NAMES[key] || key,
    level,
    tier: state.skillTier[key] || 1,
    talent: actionSystem.measureTalent(state, key)
  }));
}

function serializeIdentity(state) {
  const def = IDENTITIES[state.identity.base] || IDENTITIES.citizen;
  const bonus = economy.spiritBonus(state);
  return {
    base: state.identity.base,
    name: def.name,
    org: state.identity.org,
    title: state.identity.title,
    subjects: state.identity.subjects,
    soulMass: Math.round(bonus.mass),
    spiritMultiplier: Number(bonus.multiplier.toFixed(2))
  };
}

function serializeActions(state, viewer) {
  const canAct = ['event', 'result'].includes(state.phase);
  const admin = isAdmin(viewer);
  const stripTags = (list) => admin ? list : list.map((item) => { const { tags, ...rest } = item; return rest; });
  return {
    cultivate: canAct ? stripTags(actionSystem.cultivateOptions(state)) : [],
    commissions: canAct ? actionSystem.commissions(state) : [],
    breakthrough: canAct && eventSystem.canBreakthrough(state)
  };
}

function natureName(value) {
  if (value <= 20) return '大恶';
  if (value <= 40) return '偏恶';
  if (value <= 60) return '中性';
  if (value <= 80) return '偏善';
  return '大善';
}

function serializeState(state, viewer) {
  const view = viewer || 'guest';
  const admin = isAdmin(view);
  const fate = FATES.find((f) => f.key === state.fate);
  const talents = state.talents
    .map((key) => TALENTS.find((t) => t.key === key))
    .filter(Boolean)
    .map((t) => ({ key: t.key, name: t.name, cat: t.cat, desc: t.desc, tier: t.tier || null }));

  const out = {
    id: state.id,
    name: state.name,
    age: state.age,
    turn: state.turn,
    rev: state.rev,
    phase: state.phase,
    calendar: `景和${12 + state.age - 7}年`,
    education: {
      stage: state.education.stage,
      label: state.education.stage,
      study: state.education.study,
      examScore: state.education.examScore,
      examRank: state.education.examRank,
      admission: state.education.admission,
      craft: state.education.craft,
      qiYears: state.education.qiYears,
      qiSensed: Boolean(state.education.qiSensed)
    },
    identity: serializeIdentity(state),
    fate: fate ? { key: fate.key, name: fate.name, tag: fate.tag, desc: fate.desc } : null,
    talents,
    activeRealm: state.activeRealm,
    realms: serializeRealms(state),
    inventory: serializeInventory(state),
    skills: serializeSkills(state),
    actions: serializeActions(state, view),
    event: state.phase === 'event' ? serializeEvent(state, viewHelper.currentEvent(state), view) : null,
    result: state.phase === 'result' ? serializeResult(state, view) : null,
    battle: state.phase === 'battle' ? combat.publicBattle(state) : null,
    ending: state.ending,
    pendingEnding: Boolean(state.pendingEnding),
    journal: state.journal.slice(-30),
    flags: { worldRecognition: state.worldRecognition, trueDao: state.trueDao }
  };

  if (admin) {
    const bonus = economy.spiritBonus(state);
    out.admin = {
      hidden: {
        aptitude: state.hidden.aptitude,
        insight: state.hidden.insight,
        heart: state.hidden.heart,
        nature: state.hidden.nature,
        luck: Math.round(state.hidden.luck),
        caps: state.hidden.caps
      },
      natureLabel: natureName(state.hidden.nature),
      fortune: state.fortune,
      cognition: state.cognition,
      merit: state.merit,
      reputation: state.reputation,
      borrowed: state.borrowed,
      lifespan: state.lifespan,
      remaining: Math.max(0, state.lifespan - state.age),
      soulMass: Math.round(bonus.mass),
      spiritMultiplier: Number(bonus.multiplier.toFixed(2)),
      heartGate: 90,
      canSeekRecognition: realmSystem.canSeekRecognition(state)
    };
  }

  return out;
}

function serializeHidden(state) {
  const bonus = economy.spiritBonus(state);
  return {
    id: state.id,
    age: state.age,
    lifespan: state.lifespan,
    remaining: Math.max(0, state.lifespan - state.age),
    hidden: {
      aptitude: state.hidden.aptitude,
      insight: state.hidden.insight,
      heart: state.hidden.heart,
      nature: state.hidden.nature,
      luck: Math.round(state.hidden.luck),
      caps: state.hidden.caps
    },
    natureLabel: natureName(state.hidden.nature),
    fortune: state.fortune,
    cognition: state.cognition,
    merit: state.merit,
    reputation: state.reputation,
    borrowed: state.borrowed,
    soulMass: Math.round(bonus.mass),
    spiritMultiplier: Number(bonus.multiplier.toFixed(2)),
    flags: state.flags,
    realms: state.config.realms.map((cfg) => ({
      key: cfg.key,
      name: cfg.name,
      unlocked: Boolean(state.realms[cfg.key]?.unlocked),
      stageIndex: state.realms[cfg.key]?.stageIndex,
      stageName: cfg.stages[state.realms[cfg.key]?.stageIndex]?.name || '未启',
      prof: state.realms[cfg.key]?.prof,
      blocked: Boolean(state.realms[cfg.key]?.blocked),
      awaiting: state.realms[cfg.key]?.awaiting,
      completed: Boolean(state.realms[cfg.key]?.completed)
    }))
  };
}

module.exports = { serializeState, serializeHidden, serializeEvent, serializeResult };
