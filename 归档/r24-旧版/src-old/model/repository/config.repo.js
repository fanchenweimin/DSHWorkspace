'use strict';

const { db } = require('./db.repo');
const { defaultConfig } = require('../../seed/realms.seed');

const stmt = {
  get: db.prepare('SELECT config_json, updated_at FROM game_config WHERE id = 1'),
  set: db.prepare('UPDATE game_config SET config_json = ?, updated_at = ? WHERE id = 1'),
  insert: db.prepare('INSERT INTO game_config (id, config_json, updated_at) VALUES (1, ?, ?)')
};

function load() {
  const row = stmt.get.get();
  if (!row) {
    const config = defaultConfig();
    stmt.insert.run(JSON.stringify(config), new Date().toISOString());
    return config;
  }
  try {
    const config = JSON.parse(row.config_json);
    // 补齐缺失的默认字段
    const base = defaultConfig();
    return {
      ...base,
      ...config,
      thresholds: { ...base.thresholds, ...(config.thresholds || {}) },
      admission: { ...base.admission, ...(config.admission || {}) },
      eventRatio: { ...base.eventRatio, ...(config.eventRatio || {}) }
    };
  } catch {
    return defaultConfig();
  }
}

function save(config) {
  const next = { ...config, version: (Number(config.version) || 1) + 1 };
  const now = new Date().toISOString();
  const row = stmt.get.get();
  if (row) stmt.set.run(JSON.stringify(next), now);
  else stmt.insert.run(JSON.stringify(next), now);
  return next;
}

function reset() {
  const config = defaultConfig();
  const now = new Date().toISOString();
  const row = stmt.get.get();
  if (row) stmt.set.run(JSON.stringify(config), now);
  else stmt.insert.run(JSON.stringify(config), now);
  return config;
}

module.exports = { load, save, reset };
