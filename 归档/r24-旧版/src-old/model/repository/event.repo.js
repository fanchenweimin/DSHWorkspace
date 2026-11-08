'use strict';

const { db } = require('./db.repo');
const { ALL } = require('../../seed/events.seed');

const stmt = {
  upsertBuiltin: db.prepare(`
    INSERT INTO events (id, kind, payload_json, enabled, source, updated_at)
    VALUES (?, ?, ?, 1, 'builtin', ?)
    ON CONFLICT(id) DO NOTHING
  `),
  list: db.prepare('SELECT id, kind, payload_json, enabled, source, updated_at FROM events ORDER BY kind, id'),
  get: db.prepare('SELECT * FROM events WHERE id = ?'),
  insert: db.prepare('INSERT INTO events (id, kind, payload_json, enabled, source, updated_at) VALUES (?, ?, ?, 1, ?, ?)'),
  update: db.prepare('UPDATE events SET kind = ?, payload_json = ?, enabled = ?, updated_at = ? WHERE id = ?'),
  remove: db.prepare('DELETE FROM events WHERE id = ?'),
  removeBuiltin: db.prepare("DELETE FROM events WHERE source = 'builtin'")
};

/** 首次启动时把内置事件写进表 */
function syncBuiltin() {
  const now = new Date().toISOString();
  for (const event of ALL) {
    stmt.upsertBuiltin.run(event.id, event.kind, JSON.stringify(event), now);
  }
}

syncBuiltin();

function all() {
  return stmt.list.all().map((row) => {
    let payload = {};
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      payload = {};
    }
    return {
      id: row.id,
      kind: row.kind,
      enabled: Boolean(row.enabled),
      source: row.source,
      updatedAt: row.updated_at,
      event: payload
    };
  });
}

function get(id) {
  const row = stmt.get.get(id);
  if (!row) return null;
  try {
    return { ...row, event: JSON.parse(row.payload_json) };
  } catch {
    return null;
  }
}

function upsert(event, source = 'custom') {
  const now = new Date().toISOString();
  const existing = stmt.get.get(event.id);
  if (existing) {
    stmt.update.run(event.kind, JSON.stringify(event), 1, now, event.id);
  } else {
    stmt.insert.run(event.id, event.kind, JSON.stringify(event), source, now);
  }
  return event;
}

function toggle(id, enabled) {
  const row = stmt.get.get(id);
  if (!row) return null;
  stmt.update.run(row.kind, row.payload_json, enabled ? 1 : 0, new Date().toISOString(), id);
  const next = get(id);
  if (!next) return null;
  // 统一成布尔，避免把 0/1 漏给前端
  return { id: next.id, kind: next.kind, enabled: Boolean(next.enabled), source: next.source, event: next.event };
}

function remove(id) {
  const row = stmt.get.get(id);
  if (row && row.source === 'builtin') return false;
  stmt.remove.run(id);
  return true;
}

module.exports = { all, get, upsert, toggle, remove, syncBuiltin };
