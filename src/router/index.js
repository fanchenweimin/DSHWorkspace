'use strict';

const { createServer: createHttpServer } = require('node:http');
const http = require('../util/http');
const statics = require('./static');
const auth = require('../controller/auth');
const content = require('../controller/content');
const game = require('../controller/game');

const ROUTES = [
  ['GET', '/api/health', (req, res) => http.sendJSON(res, 200, { ok: true, version: 'r25' })],
  ['GET', '/api/me', auth.me],
  ['POST', '/api/login', auth.login],
  ['POST', '/api/logout', auth.logout],
  ['GET', '/api/world', content.world],
  ['GET', '/api/events', content.events],
  ['GET', '/api/hand', game.current],
  ['GET', '/api/has', game.has],
  ['POST', '/api/act', game.act],
  ['POST', '/api/new', game.create],
  ['POST', '/api/save', game.saveNow],
  ['POST', '/api/forget', game.forget],
  ['GET', '/api/config', content.configIndex],
  ['GET', '/api/schema', content.schemaDoc],
  /* r39：排查用——告诉你"这台浏览器是哪一局、那一局在不在库里" */
  ['GET', '/api/diag', game.diag]
];

function matchConfig(method, pathname) {
  const m = /^\/api\/config\/([a-zA-Z0-9_.-]+)$/.exec(pathname);
  if (!m) return null;
  return { name: m[1], method };
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = url.pathname;

  res.setHeader('x-content-type-options', 'nosniff');

  /* 配置页整页拦截：没 sysadmin 会话连 HTML 都拿不到 */
  if (pathname === '/admin.html' || pathname === '/admin') {
    return auth.requireAdmin(req, res, () => {
      if (statics.serve(req, res, '/admin.html')) return;
      statics.notFound(res);
    });
  }

  for (const [method, path, handler] of ROUTES) {
    if (pathname === path) {
      if (req.method !== method) return http.sendJSON(res, 405, { ok: false, error: '方法不对' });
      return handler(req, res);
    }
  }

  const cfg = matchConfig(req.method, pathname);
  if (cfg) {
    if (req.method === 'GET') return content.getConfig(req, res, cfg.name);
    if (req.method === 'PUT') return content.putConfig(req, res, cfg.name);
    if (req.method === 'DELETE') return content.deleteConfig(req, res, cfg.name);
    return http.sendJSON(res, 405, { ok: false, error: '方法不对' });
  }

  if (pathname.startsWith('/api/')) {
    return http.sendJSON(res, 404, { ok: false, error: '没有这个接口' });
  }

  if (statics.serve(req, res, pathname)) return;
  statics.notFound(res);
}

function createServer() {
  return createHttpServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('[500]', req.method, req.url, err);
      if (!res.headersSent) http.sendJSON(res, 500, { ok: false, error: '服务器出错了' });
      else res.end();
    });
  });
}

module.exports = { createServer };
