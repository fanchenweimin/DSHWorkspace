'use strict';

const { sendJSON, sendText, redirect, readBody } = require('../util/http');
const session = require('../middleware/session');
const db = require('../model/repository/db');

async function login(req, res) {
  const body = await readBody(req);
  const name = String(body.name || '').trim();
  const password = String(body.password || '');
  if (!name || !password) return sendJSON(res, 400, { ok: false, error: '账号和密码都要填' });

  const user = db.checkLogin(name, password);
  if (!user) {
    await new Promise((r) => setTimeout(r, 240)); // 拖一下，别让人拿它当探测接口
    return sendJSON(res, 401, { ok: false, error: '账号或密码不对' });
  }

  const sid = session.issue(user);
  res.setHeader('set-cookie', session.cookie(sid));
  return sendJSON(res, 200, { ok: true, viewer: user.role, name: user.name });
}

function logout(req, res) {
  session.destroy(req);
  res.setHeader('set-cookie', session.clearCookie());
  return sendJSON(res, 200, { ok: true, viewer: 'guest' });
}

function me(req, res) {
  const s = session.read(req);
  if (!s) return sendJSON(res, 200, { viewer: 'guest', name: null });
  return sendJSON(res, 200, { viewer: s.role, name: s.name });
}

/** 配置页与配置接口共用的一道门 */
function requireAdmin(req, res, next) {
  const s = session.read(req);
  if (!s || s.role !== 'sysadmin') {
    if (req.url.startsWith('/api/')) return sendJSON(res, 403, { ok: false, error: '需要 sysadmin' });
    return redirect(res, '/login.html?next=' + encodeURIComponent(req.url));
  }
  return next(s);
}

module.exports = { login, logout, me, requireAdmin };
