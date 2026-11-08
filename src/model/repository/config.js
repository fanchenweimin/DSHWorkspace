'use strict';

/**
 * 配置的"有效值" = 磁盘种子 + 数据库覆盖层。
 * 运行时只准读这里，不准直接读 seed —— 否则配置页改了也不生效。
 */

const seed = require('./seed');
const db = require('./db');

function get(name) {
  const over = db.getOverride(name);
  return over != null ? over : seed.raw(name);
}

function list() {
  return seed.list().map((name) => ({ name, overridden: db.getOverride(name) != null }));
}

function has(name) {
  return seed.has(name);
}

module.exports = { get, list, has };
