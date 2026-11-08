'use strict';

const rng = require('../../util/rng');
const { ALL } = require('../../seed/events.seed');
const condition = require('./condition.system');
const realmSystem = require('./realm.system');
const { PROF_MAX, HEART_GATE } = require('../rules/breakthrough.rule');

const BY_ID = new Map(ALL.map((ev) => [ev.id, ev]));

function get(id) {
  return BY_ID.get(id) || null;
}

function byKind(kind) {
  return ALL.filter((ev) => ev.kind === kind);
}

/** 事件是否可触发 */
function eligible(state, event) {
  if (!event) return false;
  if (event.once && state.seenEvents.includes(event.id)) return false;
  if (event.when && !condition.test(state, event.when)) return false;
  return true;
}

/** 随机区间比例 */
function pickRatio(state) {
  const cfg = state.config.eventRatio || {};
  let bucket = cfg.default;
  if (state.realms.heart?.unlocked) bucket = cfg.修心;
  else if (state.realms.spirit?.unlocked) bucket = cfg.养灵;
  else if (state.identity.base === 'general' || state.identity.base === 'lord' || state.identity.base === 'sect_master') {
    bucket = cfg.default;
  } else if (state.education.stage === '太学') bucket = cfg.太学;
  else if (state.education.stage === '府学') bucket = cfg.府学;
  else if (state.education.stage === '蒙学') bucket = cfg.蒙学;
  else bucket = cfg.散修;

  const ambient = rng.range(bucket.ambient[0], bucket.ambient[1]);
  const encounter = rng.range(bucket.encounter[0], bucket.encounter[1]);
  return { ambient, encounter };
}

/** 是否修为满、可破境 */
function canBreakthrough(state) {
  return state.config.realms.some((cfg) => {
    const realm = state.realms[cfg.key];
    if (!realm?.unlocked || realm.completed) return false;
    if (!realm.blocked) return false;
    if (realm.awaiting) return false;
    const target = cfg.stages[realm.stageIndex + 1];
    if (!target) return false;
    const type = target.breakthrough?.type;
    return type === 'normal' || type === 'effort' || type === 'heart';
  });
}

/** 强制事件 */
function drawForced(state) {
  // 同一强制事件 3 年内不重复
  const cooldown = state.flags.forcedCooldown || {};
  const now = state.age;

  // 强制事件带概率闸门：约 16% 的回合会真的被强制，避免刷屏
  if (rng.next() > 0.16) return null;

  const forced = byKind('forced').filter((ev) => eligible(state, ev));
  if (!forced.length) return null;

  const list = forced.filter((ev) => {
    const key = ev.forcedBy || ev.id;
    const last = cooldown[key];
    if (last != null && now - last < 8) return false;
    return !ev.when || condition.test(state, ev.when);
  });
  if (!list.length) return null;

  const picked = rng.weightPick(list, (ev) => ev.weight || 10);
  if (picked) {
    state.flags.forcedCooldown = { ...cooldown, [picked.forcedBy || picked.id]: now };
  }
  return picked;
}

/** 破境事件（条件必出） */
function drawBreakthrough(state) {
  if (!canBreakthrough(state)) return null;
  const event = BUILT.BREAKTHROUGH;
  return { ...event, payload: { realmKey: pickBlockedRealm(state) } };
}

function pickBlockedRealm(state) {
  const list = state.config.realms.filter((cfg) => {
    const realm = state.realms[cfg.key];
    if (!realm?.unlocked || realm.completed || !realm.blocked || realm.awaiting) return false;
    const target = cfg.stages[realm.stageIndex + 1];
    if (!target) return false;
    const type = target.breakthrough?.type;
    return type === 'normal' || type === 'effort' || type === 'heart';
  });
  if (!list.length) return null;
  return list[0].key;
}

/** 门槛事件 */
function drawThreshold(state) {
  const list = byKind('threshold').filter((ev) => eligible(state, ev));
  if (!list.length) return null;
  return rng.weightPick(list, (ev) => ev.weight || 10);
}

/** 环境 */
function drawAmbient(state) {
  const list = byKind('ambient').filter((ev) => eligible(state, ev));
  if (!list.length) return null;
  return rng.weightPick(list, (ev) => ev.weight || 10);
}

/** 奇遇 */
function drawEncounter(state) {
  const list = byKind('encounter').filter((ev) => eligible(state, ev));
  if (!list.length) return null;
  return rng.weightPick(list, (ev) => ev.weight || 10);
}

/** 普通（含门槛，同池按权重） */
function drawNormal(state) {
  const normal = byKind('normal').filter((ev) => eligible(state, ev));
  const threshold = byKind('threshold').filter((ev) => eligible(state, ev));
  const pool = [...normal, ...threshold];
  if (!pool.length) return null;
  return rng.weightPick(pool, (ev) => ev.weight || 10);
}

/** 破境事件模板（动态生成） */
const BUILT = {
  BREAKTHROUGH: {
    id: 'sys_breakthrough',
    kind: 'breakthrough',
    icon: '关',
    title: '关隘',
    kicker: '闭关 · 破境',
    years: 1,
    body: '修为已满。你可以选择现在冲关，也可以先把修为压着，去做别的事。',
    choices: []
  }
};

/**
 * 主抽取。
 * 返回 { event, kind } 或 null
 */
function drawNext(state) {
  // 1. 强制
  const forced = drawForced(state);
  if (forced) return { event: forced, kind: 'forced' };

  // 2. 破境（条件必出）
  const bt = drawBreakthrough(state);
  if (bt) return { event: bt, kind: 'breakthrough' };

  // 3. 门槛事件：条件满足时优先，保证事件链能推进
  const threshold = drawThreshold(state);
  if (threshold && rng.next() < 0.45) {
    return { event: threshold, kind: 'threshold' };
  }

  // 4. 掷骰
  const ratio = pickRatio(state);
  const r = rng.next();
  if (r < ratio.ambient) {
    const ev = drawAmbient(state) || drawNormal(state);
    if (ev) return { event: ev, kind: ev.kind };
  } else if (r < ratio.ambient + ratio.encounter) {
    const ev = drawEncounter(state) || drawNormal(state);
    if (ev) return { event: ev, kind: ev.kind };
  } else {
    const ev = drawNormal(state);
    if (ev) return { event: ev, kind: ev.kind };
  }

  // 兜底
  const fallback = byKind('ambient')[0];
  return fallback ? { event: fallback, kind: 'ambient' } : null;
}

/** 记录已见 */
function markSeen(state, event) {
  if (!event) return;
  state.lastEventId = event.id;
  if (!event.repeatable && !state.seenEvents.includes(event.id)) {
    state.seenEvents.push(event.id);
  }
}

module.exports = {
  get,
  byKind,
  eligible,
  drawNext,
  drawForced,
  drawBreakthrough,
  drawThreshold,
  pickBlockedRealm,
  canBreakthrough,
  markSeen,
  BUILT
};
