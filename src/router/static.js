'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sendText, mimeOf } = require('../util/http');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SEED_DIR = path.join(ROOT, 'src', 'seed');

function safeJoin(base, urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const abs = path.resolve(base, rel);
  if (!abs.startsWith(path.resolve(base))) return null;
  return abs;
}

function serveFile(res, abs) {
  if (!abs || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return false;
  const body = fs.readFileSync(abs);
  res.writeHead(200, {
    'content-type': mimeOf(abs),
    'content-length': body.length,
    'cache-control': 'no-store'
  });
  res.end(body);
  return true;
}

/** 静态资源：public/ 与 /seed/*.json（阶段二后端起来后前端可完全不碰 seed） */
function serve(req, res, pathname) {
  if (pathname.startsWith('/seed/')) {
    const name = pathname.slice('/seed/'.length);
    const abs = safeJoin(SEED_DIR, name);
    if (serveFile(res, abs)) return true;
  }

  const rel = pathname === '/' ? '/index.html' : pathname;
  const abs = safeJoin(PUBLIC_DIR, rel);
  if (serveFile(res, abs)) return true;

  return false;
}

function notFound(res) {
  sendText(res, 404, '404 · 这里没有东西', 'text/plain; charset=utf-8');
}

module.exports = { serve, notFound, PUBLIC_DIR, SEED_DIR };
