'use strict';

const { db } = require('./db.repo');
const { hashPassword, verifyPassword } = require('../../util/security');

const stmt = {
  byName: db.prepare('SELECT * FROM users WHERE username = ?'),
  byId: db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?'),
  insert: db.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)'),
  count: db.prepare('SELECT COUNT(*) AS c FROM users'),
  updatePass: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'),
  sessionUser: db.prepare(`
    SELECT u.id, u.username, u.role FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?')
};

const DEFAULTS = [
  { username: 'sysadmin', password: 'sysadmin', role: 'sysadmin' },
  { username: 'user', password: 'useradmin', role: 'user' }
];

function seed() {
  const { c } = stmt.count.get();
  if (c > 0) {
    // 修正旧默认密码
    for (const item of DEFAULTS) {
      const row = stmt.byName.get(item.username);
      if (row && verifyPassword(item.username, row.password_hash)) {
        stmt.updatePass.run(hashPassword(item.password), row.id);
      }
    }
    return;
  }
  const now = new Date().toISOString();
  for (const item of DEFAULTS) {
    stmt.insert.run(item.username, hashPassword(item.password), item.role, now);
  }
}

seed();

function findByUsername(username) {
  return stmt.byName.get(String(username || '').trim()) || null;
}

function findById(id) {
  return stmt.byId.get(id) || null;
}

function createSession(tokenHash, userId, expiresAt) {
  stmt.insertSession.run(tokenHash, userId, expiresAt, new Date().toISOString());
}

function sessionUser(tokenHash) {
  return stmt.sessionUser.get(tokenHash, new Date().toISOString()) || null;
}

function deleteSession(tokenHash) {
  stmt.deleteSession.run(tokenHash);
}

function purgeExpired() {
  stmt.purgeSessions.run(new Date().toISOString());
}

module.exports = { findByUsername, findById, createSession, sessionUser, deleteSession, purgeExpired };
