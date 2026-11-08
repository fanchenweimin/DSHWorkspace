'use strict';

const { sha256, randomToken, verifyPassword } = require('../util/security');
const userRepo = require('../model/repository/user.repo');

const COOKIE = 'dayao_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  return userRepo.sessionUser(sha256(token));
}

function login(username, password) {
  const user = userRepo.findByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
  userRepo.createSession(sha256(token), user.id, expiresAt);
  return { token, user: { id: user.id, username: user.username, role: user.role } };
}

function logout(req) {
  const token = parseCookies(req)[COOKIE];
  if (token) userRepo.deleteSession(sha256(token));
}

function cookieHeader(token) {
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_MS / 1000)}`;
}

function clearCookieHeader() {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function viewerOf(user) {
  if (!user) return 'guest';
  return user.role === 'sysadmin' ? 'sysadmin' : 'user';
}

module.exports = { currentUser, login, logout, cookieHeader, clearCookieHeader, viewerOf, parseCookies };
