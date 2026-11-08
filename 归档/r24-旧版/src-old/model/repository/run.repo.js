'use strict';

const { db } = require('./db.repo');

const stmt = {
  upsert: db.prepare(`
    INSERT INTO runs (id, user_id, name, state_json, age, realm_line, phase, ended, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      name = excluded.name,
      state_json = excluded.state_json,
      age = excluded.age,
      realm_line = excluded.realm_line,
      phase = excluded.phase,
      ended = excluded.ended,
      updated_at = excluded.updated_at
  `),
  get: db.prepare('SELECT * FROM runs WHERE id = ?'),
  list: db.prepare('SELECT id, name, age, realm_line, phase, ended, updated_at FROM runs ORDER BY updated_at DESC LIMIT 40'),
  remove: db.prepare('DELETE FROM runs WHERE id = ?'),
  count: db.prepare('SELECT COUNT(*) AS c FROM runs')
};

function save(state) {
  const now = new Date().toISOString();
  const line = Object.entries(state.realms || {})
    .filter(([, realm]) => realm?.unlocked)
    .map(([key, realm]) => {
      const cfg = state.config.realms.find((r) => r.key === key);
      return `${cfg?.name || key}·${cfg?.stages?.[realm.stageIndex]?.name || '?'}`;
    })
    .join(' / ');
  stmt.upsert.run(
    state.id,
    state.userId || null,
    state.name,
    JSON.stringify(state),
    state.age,
    line,
    state.phase,
    state.phase === 'ended' ? 1 : 0,
    state.createdAt || now,
    now
  );
}

function load(id) {
  const row = stmt.get.get(id);
  if (!row) return null;
  try {
    return JSON.parse(row.state_json);
  } catch {
    return null;
  }
}

function list() {
  return stmt.list.all();
}

function remove(id) {
  stmt.remove.run(id);
}

function count() {
  return stmt.count.get().c;
}

module.exports = { save, load, list, remove, count };
