'use strict';

const { sendJSON, readBody } = require('../util/http');
const session = require('../middleware/session');
const seed = require('../model/repository/seed');
const config = require('../model/repository/config');
const db = require('../model/repository/db');
const { cropEvents, cropWorld } = require('./serialize');

/** 世界：公开 */
function world(req, res) {
  return sendJSON(res, 200, cropWorld(config.get('world')));
}

/** 事件：按 viewer 裁剪；玩家拿不到权重、判定、效果 */
function events(req, res) {
  const viewer = session.viewerOf(req);
  return sendJSON(res, 200, cropEvents(config.get('events'), viewer));
}

/** 配置目录：只有 sysadmin 看得到有哪些档 */
function configIndex(req, res) {
  const viewer = session.viewerOf(req);
  if (viewer !== 'sysadmin') return sendJSON(res, 403, { ok: false, error: '需要 sysadmin' });
  return sendJSON(res, 200, config.list());
}

/**
 * 配置页的「字典」：字段中文名、列宽、哪些路径只读、每份文件的说明。
 * 前端不许再硬编码中文表——加一个字段只改 schema.json。
 */
function schemaDoc(req, res) {
  const viewer = session.viewerOf(req);
  if (viewer !== 'sysadmin') return sendJSON(res, 403, { ok: false, error: '需要 sysadmin' });
  return sendJSON(res, 200, seed.raw('schema'));
}

/** 单份配置：磁盘原值 + 覆盖层（覆盖层优先） */
function getConfig(req, res, name) {
  const viewer = session.viewerOf(req);
  if (viewer !== 'sysadmin') return sendJSON(res, 403, { ok: false, error: '需要 sysadmin' });
  if (!seed.has(name)) return sendJSON(res, 404, { ok: false, error: '没有这份配置' });
  const over = db.getOverride(name);
  return sendJSON(res, 200, {
    name,
    overridden: over != null,
    data: over != null ? over : seed.raw(name)
  });
}

async function putConfig(req, res, name) {
  const viewer = session.viewerOf(req);
  if (viewer !== 'sysadmin') return sendJSON(res, 403, { ok: false, error: '需要 sysadmin' });
  if (!seed.has(name)) return sendJSON(res, 404, { ok: false, error: '没有这份配置' });
  const body = await readBody(req);
  if (body == null || typeof body !== 'object') {
    return sendJSON(res, 400, { ok: false, error: '要是 JSON 对象或数组' });
  }
  db.setOverride(name, body);
  return sendJSON(res, 200, { ok: true, name, overridden: true });
}

function deleteConfig(req, res, name) {
  const viewer = session.viewerOf(req);
  if (viewer !== 'sysadmin') return sendJSON(res, 403, { ok: false, error: '需要 sysadmin' });
  db.clearOverride(name);
  seed.invalidate();
  return sendJSON(res, 200, { ok: true, name, overridden: false });
}

module.exports = { world, events, configIndex, schemaDoc, getConfig, putConfig, deleteConfig };
