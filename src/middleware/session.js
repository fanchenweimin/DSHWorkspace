'use strict';

/**
 * 会话：Cookie 里只放一个不可猜的 sid，用户信息留在服务端。
 *
 * r29：从内存搬到 `sessions` 表——重启服务不用重新登录。
 * 接口没变（issue / read / destroy / cookie / clearCookie / viewerOf / gameId），
 * 上层（auth / 游戏 / 配置）一个字都不用改。
 */

const crypto = require('node:crypto');
const db = require('../model/repository/db');

const COOKIE = 'dayao_sid';
const TTL_MS = 1000 * 60 * 60 * 24 * 7;

let sweptAt = 0;
function sweep() {
  const now = Date.now();
  if (now - sweptAt < 1000 * 60 * 10) return;
  sweptAt = now;
  db.sessionSweep(now - TTL_MS);
}

function issue(user) {
  const sid = crypto.randomBytes(24).toString('hex');
  db.sessionPut(sid, { uid: user.id, name: user.name, role: user.role });
  sweep();
  return sid;
}

function read(req) {
  const { parseCookies } = require('../util/http');
  const sid = parseCookies(req)[COOKIE];
  if (!sid) return null;

  const row = db.sessionGet(sid);
  if (!row) return null;
  if (Date.now() - row.at > TTL_MS) {
    db.sessionDel(sid);
    return null;
  }
  db.sessionTouch(sid);
  return { uid: row.uid, name: row.name, role: row.role, at: row.at };
}

function destroy(req) {
  const { parseCookies } = require('../util/http');
  const sid = parseCookies(req)[COOKIE];
  if (sid) db.sessionDel(sid);
}

function cookie(sid) {
  return `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_MS / 1000}`;
}

function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** 谁在看：guest / user / sysadmin —— 所有裁剪都只认这一个值 */
function viewerOf(req) {
  const s = read(req);
  return s ? s.role : 'guest';
}

/**
 * 玩局 id：和登录无关。
 * 存档按这台浏览器走，游客也能连续玩；登录与否只影响"能看到什么"。
 * 第一次访问时发一个不可猜的 gid，此后同一个浏览器始终是同一局。
 */
const GID_COOKIE = 'dayao_gid';

function gameId(req, res) {
  const { parseCookies } = require('../util/http');
  const old = parseCookies(req)[GID_COOKIE];
  if (old && /^[a-f0-9]{24}$/.test(old)) return old;
  const gid = crypto.randomBytes(12).toString('hex');
  res.setHeader('set-cookie', `${GID_COOKIE}=${gid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_MS / 1000}`);
  return gid;
}

module.exports = {
  issue, read, destroy, cookie, clearCookie, viewerOf, gameId, COOKIE, GID_COOKIE
};
