'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const auth = require('../middleware/auth.middleware');
const http = require('../middleware/error.middleware');
const run = require('../controller/run.controller');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon'
};

const MAX_BODY = 256 * 1024;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) {
        reject(new (require('../model/systems/view.helper').GameError)('BODY_TOO_LARGE', '内容过大。', 413));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new (require('../model/systems/view.helper').GameError)('BAD_JSON', '请求格式不正确。', 400));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, http.headers({ Allow: 'GET, HEAD' }));
    res.end('Method Not Allowed');
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, http.headers({ 'Content-Type': 'text/plain; charset=utf-8' }));
    res.end('Bad Request');
    return;
  }
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  if (pathname === '/admin') pathname = '/admin.html';
  if (pathname === '/login') pathname = '/login.html';
  if (pathname === '/game') pathname = '/game.html';
  if (pathname === '/favicon.ico') pathname = '/assets/favicon.svg';

  const filePath = path.join(PUBLIC_DIR, pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, http.headers({ 'Content-Type': 'text/plain; charset=utf-8' }));
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, http.headers({ 'Content-Type': 'text/plain; charset=utf-8' }));
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(
      200,
      http.headers({
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300',
        'Content-Length': stat.size
      })
    );
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

async function handleApi(req, res, url) {
  const method = req.method || 'GET';
  const pathname = url.pathname;
  const user = auth.currentUser(req);

  if (method === 'GET' && pathname === '/api/health') {
    http.json(res, 200, { ok: true, game: '大曜问仙录', node: process.version });
    return true;
  }

  if (method === 'GET' && pathname === '/api/auth/me') {
    http.json(res, 200, { user: user ? { username: user.username, role: user.role } : null });
    return true;
  }

  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = await readJson(req);
    const result = auth.login(body.username, body.password);
    if (!result) throw new (require('../model/systems/view.helper').GameError)('BAD_LOGIN', '账号或密码不对。', 401);
    http.json(res, 200, { user: result.user }, { 'Set-Cookie': auth.cookieHeader(result.token) });
    return true;
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    auth.logout(req);
    http.json(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookieHeader() });
    return true;
  }

  // 管理端
  if (pathname.startsWith('/api/admin/')) {
    if (!user || user.role !== 'sysadmin') {
      throw new (require('../model/systems/view.helper').GameError)('FORBIDDEN', '需要管理员权限。', 403);
    }
    if (method === 'GET' && pathname === '/api/admin/config') {
      http.json(res, 200, run.getConfig());
      return true;
    }
    if (method === 'PUT' && pathname === '/api/admin/config') {
      http.json(res, 200, { config: run.saveConfig(await readJson(req)) });
      return true;
    }
    if (method === 'POST' && pathname === '/api/admin/config/reset') {
      http.json(res, 200, { config: run.resetConfig() });
      return true;
    }
    if (method === 'GET' && pathname === '/api/admin/library') {
      http.json(res, 200, run.getLibrary());
      return true;
    }
    if (method === 'GET' && pathname === '/api/admin/events') {
      http.json(res, 200, { events: run.listEvents() });
      return true;
    }
    if (method === 'POST' && pathname === '/api/admin/events') {
      http.json(res, 200, { event: run.saveEvent(await readJson(req)) });
      return true;
    }
    if (method === 'DELETE' && pathname.startsWith('/api/admin/events/')) {
      const id = pathname.slice('/api/admin/events/'.length);
      http.json(res, 200, run.deleteEvent(id));
      return true;
    }
    if (method === 'POST' && pathname === '/api/admin/events/toggle') {
      const body = await readJson(req);
      http.json(res, 200, { event: run.toggleEvent(body.id, body.enabled) });
      return true;
    }
    throw new (require('../model/systems/view.helper').GameError)('METHOD_NOT_ALLOWED', '这条路不通。', 405);
  }

  // 存档
  if (method === 'POST' && pathname === '/api/runs') {
    const body = await readJson(req);
    const state = run.createRun(body.name, user);
    http.json(res, 201, { state: run.getRun(state.id, user) });
    return true;
  }

  if (method === 'GET' && pathname === '/api/runs') {
    http.json(res, 200, { runs: run.listRuns() });
    return true;
  }

  const match = pathname.match(
    /^\/api\/runs\/([0-9a-f-]{36})(?:\/(choose|next|battle|focus|act|abandon|hidden))?$/
  );
  if (!match) return false;

  const id = match[1];
  const action = match[2];

  if (method === 'GET' && !action) {
    http.json(res, 200, { state: run.getRun(id, user) });
    return true;
  }
  if (method === 'GET' && action === 'hidden') {
    http.json(res, 200, { hidden: run.getHidden(id, user) });
    return true;
  }
  if (method === 'POST' && action) {
    const body = await readJson(req);
    const handlers = {
      choose: () => run.choose(id, body, user),
      next: () => run.next(id, body, user),
      battle: () => run.battle(id, body, user),
      focus: () => run.focus(id, body, user),
      act: () => run.act(id, body, user),
      abandon: () => run.abandon(id, body, user)
    };
    const handler = handlers[action];
    if (!handler) throw new (require('../model/systems/view.helper').GameError)('METHOD_NOT_ALLOWED', '这条路不通。', 405);
    http.json(res, 200, { state: handler() });
    return true;
  }

  throw new (require('../model/systems/view.helper').GameError)('METHOD_NOT_ALLOWED', '这条路不通。', 405);
}

function createServer() {
  const server = require('node:http').createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

    if (url.pathname.startsWith('/api/')) {
      handleApi(req, res, url).catch((error) => http.fail(res, error));
      return;
    }
    serveStatic(req, res, url);
  });
  return server;
}

module.exports = { createServer, PUBLIC_DIR };
