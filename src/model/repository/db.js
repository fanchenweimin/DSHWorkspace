'use strict';

/**
 * 数据库：只做"谁是谁"和"配置改过什么"。
 * TODO(r26-2): 加 saves 表（存档）；TODO(r26-3): 加 sessions 表（会话落库）。
 * 游戏进度、存档暂时不进库。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..', '..', '..');
const DB_PATH = path.join(ROOT, 'data', 'dayao.db');

let db = null;

function hash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function makeUser(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: hash(password, salt) };
}

function verify(password, salt, expected) {
  const got = hash(password, salt);
  return crypto.timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(expected, 'hex'));
}

function open() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);

  /* 结构守卫：旧版本的 users 表列名不同，直接重建。
     这是开发期库，不留迁移脚本；正式存档以后另开表。 */
  const probe = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (probe) {
    const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
    if (!cols.includes('name') || !cols.includes('salt')) {
      console.warn('[db] users 表结构已变，重建');
      db.exec('DROP TABLE users');
    }
  }

  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      salt       TEXT NOT NULL,
      pass       TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS config_overrides (
      file       TEXT PRIMARY KEY,
      json       TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS saves (
      gid        TEXT PRIMARY KEY,
      state      TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      sid        TEXT PRIMARY KEY,
      uid        INTEGER,
      name       TEXT NOT NULL DEFAULT '',
      role       TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER NOT NULL,
      at         INTEGER NOT NULL
    );
  `);
  seedUsers();
  return db;
}

function seedUsers() {
  const defaults = [
    { name: 'sysadmin', password: 'sysadmin', role: 'sysadmin' },
    { name: 'user', password: 'useradmin', role: 'user' }
  ];
  const find = db.prepare('SELECT id FROM users WHERE name = ?');
  const insert = db.prepare(
    'INSERT INTO users (name, salt, pass, role, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  for (const u of defaults) {
    if (find.get(u.name)) continue;
    const { salt, hash: h } = makeUser(u.password);
    insert.run(u.name, salt, h, u.role, Date.now());
  }
}

function findUser(name) {
  open();
  return db.prepare('SELECT * FROM users WHERE name = ?').get(name) || null;
}

function checkLogin(name, password) {
  const u = findUser(name);
  if (!u) return null;
  if (!verify(password, u.salt, u.pass)) return null;
  return { id: u.id, name: u.name, role: u.role };
}

function getOverride(file) {
  open();
  const row = db.prepare('SELECT json FROM config_overrides WHERE file = ?').get(file);
  if (!row) return null;
  try { return JSON.parse(row.json); } catch { return null; }
}

function setOverride(file, value) {
  open();
  db.prepare(
    `INSERT INTO config_overrides (file, json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(file) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
  ).run(file, JSON.stringify(value), Date.now());
}

function clearOverride(file) {
  open();
  db.prepare('DELETE FROM config_overrides WHERE file = ?').run(file);
}

/* ── 存档（r29）：一局一份，键是浏览器的 gid ─────────────
   和登录无关：游客也能续着玩；登录只决定"能看到什么"。
   整份 state 存 JSON——`wall / study / arts / mods / pending / turn.mainId`
   都在里面，漏存任何一个都能读档刷数值，所以不做字段挑选。 */

function saveGet(gid) {
  open();
  const row = db.prepare('SELECT state, updated_at FROM saves WHERE gid = ?').get(gid);
  return row || null;
}

function savePut(gid, json) {
  open();
  const now = Date.now();
  db.prepare(
    `INSERT INTO saves (gid, state, created_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(gid) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`
  ).run(gid, json, now, now);
}

function saveDrop(gid) {
  open();
  db.prepare('DELETE FROM saves WHERE gid = ?').run(gid);
}

/** 只留最近 n 份：开发期防手滑，不至于把库撑爆 */
function saveTrim(keep) {
  open();
  const n = Math.max(1, Number(keep) || 200);
  db.prepare(
    `DELETE FROM saves WHERE gid NOT IN (SELECT gid FROM saves ORDER BY updated_at DESC LIMIT ?)`
  ).run(n);
}

/* ── 会话（r29）：登录状态落库，重启服务不用重新登录 ── */

function sessionPut(sid, s) {
  open();
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions (sid, uid, name, role, created_at, at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(sid) DO UPDATE SET at = excluded.at`
  ).run(sid, s.uid == null ? null : s.uid, s.name || '', s.role || 'user', now, now);
}

function sessionGet(sid) {
  open();
  return db.prepare('SELECT * FROM sessions WHERE sid = ?').get(sid) || null;
}

function sessionTouch(sid) {
  open();
  db.prepare('UPDATE sessions SET at = ? WHERE sid = ?').run(Date.now(), sid);
}

function sessionDel(sid) {
  open();
  db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
}

/** 过期的会话直接清掉（TTL 由调用方给） */
function sessionSweep(before) {
  open();
  db.prepare('DELETE FROM sessions WHERE at < ?').run(before);
}

module.exports = {
  open, findUser, checkLogin, getOverride, setOverride, clearOverride,
  saveGet, savePut, saveDrop, saveTrim,
  sessionPut, sessionGet, sessionTouch, sessionDel, sessionSweep,
  DB_PATH
};
