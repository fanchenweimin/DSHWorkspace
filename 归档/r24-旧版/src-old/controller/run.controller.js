'use strict';

const { GameError } = require('../model/systems/view.helper');
const runRepo = require('../model/repository/run.repo');
const configRepo = require('../model/repository/config.repo');
const eventRepo = require('../model/repository/event.repo');
const { createState } = require('../model/state/create.state');
const { FATES } = require('../seed/fates.seed');
const { TALENTS } = require('../seed/talents.seed');
const { ITEMS } = require('../seed/items.seed');
const { METHODS, ARTS } = require('../seed/arts.seed');
const { IDENTITIES } = require('../seed/identities.seed');
const turn = require('../model/systems/turn.system');
const combat = require('../model/systems/combat.system');
const action = require('../model/systems/action.system');
const { serializeState, serializeHidden } = require('./serializer/state.view');
const { viewerOf } = require('../middleware/auth.middleware');

function assertRev(state, rev) {
  if (rev != null && Number(rev) !== Number(state.rev)) {
    throw new GameError('STALE', '页面与存档不同步，请刷新。', 409);
  }
}

function loadRun(id) {
  const state = runRepo.load(id);
  if (!state) throw new GameError('NOT_FOUND', '这份命途已经找不到了。', 404);
  return state;
}

/** 新开一局 */
function createRun(name, user) {
  const config = configRepo.load();
  const state = createState(name, config);
  state.userId = user?.id || null;
  turn.nextTurn(state);
  runRepo.save(state);
  return state;
}

/** 读取 */
function getRun(id, user) {
  const state = loadRun(id);
  return serializeState(state, viewerOf(user));
}

/** 隐藏信息 */
function getHidden(id, user) {
  if (!user || user.role !== 'sysadmin') {
    throw new GameError('FORBIDDEN', '天机不可轻泄，需要管理员权限。', 403);
  }
  const state = loadRun(id);
  return serializeHidden(state);
}

/** 选择 */
function choose(id, body, user) {
  const state = loadRun(id);
  assertRev(state, body.rev);
  turn.choose(state, body.choiceId);
  runRepo.save(state);
  return serializeState(state, viewerOf(user));
}

/** 继续 */
function next(id, body, user) {
  const state = loadRun(id);
  assertRev(state, body.rev);
  turn.continueRun(state);
  runRepo.save(state);
  return serializeState(state, viewerOf(user));
}

/** 战斗 */
function battle(id, body, user) {
  const state = loadRun(id);
  assertRev(state, body.rev);
  if (body.actionId === 'finish') combat.finishBattle(state);
  else if (body.actionId === 'surrender') combat.surrender(state);
  else if (body.actionId === 'flee') combat.flee(state);
  else combat.performAction(state, body.actionId);
  runRepo.save(state);
  return serializeState(state, viewerOf(user));
}

/** 切换主修 */
function focus(id, body, user) {
  const state = loadRun(id);
  assertRev(state, body.rev);
  turn.focusRealm(state, body.realmKey);
  runRepo.save(state);
  return serializeState(state, viewerOf(user));
}

/** 修炼 / 委托 */
function act(id, body, user) {
  const state = loadRun(id);
  assertRev(state, body.rev);
  if (body.kind === 'cultivate') {
    action.cultivate(state, body.optionId, body.years);
  } else if (body.kind === 'commission') {
    action.takeCommission(state, body.commissionId);
  } else {
    throw new GameError('BAD_ACTION', '没有这个行动。', 400);
  }
  runRepo.save(state);
  return serializeState(state, viewerOf(user));
}

/** 中止 */
function abandon(id, body, user) {
  const state = loadRun(id);
  assertRev(state, body.rev);
  turn.abandonRun(state);
  runRepo.save(state);
  return serializeState(state, viewerOf(user));
}

/** 配置 */
function getConfig() {
  const config = configRepo.load();
  const events = eventRepo.all();
  return { config, events };
}

function saveConfig(body) {
  if (!body?.config) throw new GameError('BAD_CONFIG', '缺少配置内容。', 400);
  const config = configRepo.save(body.config);
  return config;
}

function resetConfig() {
  return configRepo.reset();
}

/** 事件库 */
function listEvents() {
  return eventRepo.all();
}

function saveEvent(body) {
  if (!body?.event?.id) throw new GameError('BAD_EVENT', '事件缺少 id。', 400);
  return eventRepo.upsert(body.event, 'custom');
}

function toggleEvent(id, enabled) {
  return eventRepo.toggle(id, enabled);
}

function deleteEvent(id) {
  const ok = eventRepo.remove(id);
  if (!ok) throw new GameError('BUILTIN_LOCKED', '内置事件不能删除。', 400);
  return { ok: true };
}

function listRuns() {
  return runRepo.list();
}

/** 静态资源字典（给管理页用） */
function getLibrary() {
  return {
    fates: FATES.map((f) => ({
      key: f.key,
      name: f.name,
      tag: f.tag,
      desc: f.desc,
      hidden: f.hidden || {},
      nature: f.nature || 0,
      lifespan: f.lifespan || 0,
      cap: f.cap || 0
    })),
    talents: TALENTS.map((t) => ({
      key: t.key,
      name: t.name,
      cat: t.cat,
      craft: t.craft || null,
      tier: t.tier || null,
      desc: t.desc
    })),
    items: Object.values(ITEMS).map((i) => ({
      id: i.id,
      name: i.name,
      type: i.type,
      tier: i.tier || null,
      grade: i.grade,
      price: i.price,
      desc: i.desc
    })),
    methods: Object.values(METHODS).map((m) => ({
      id: m.id,
      name: m.name,
      realm: m.realm,
      grade: m.grade
    })),
    arts: Object.values(ARTS).map((a) => ({
      id: a.id,
      name: a.name,
      realm: a.realm,
      category: a.category,
      grade: a.grade,
      layer: a.layer
    })),
    identities: Object.values(IDENTITIES).map((i) => ({
      key: i.key,
      name: i.name,
      rank: i.rank,
      subjects: i.subjects,
      desc: i.desc
    }))
  };
}

module.exports = {
  createRun,
  getRun,
  getHidden,
  choose,
  next,
  battle,
  focus,
  act,
  abandon,
  getConfig,
  saveConfig,
  resetConfig,
  listEvents,
  saveEvent,
  toggleEvent,
  deleteEvent,
  listRuns,
  getLibrary
};
