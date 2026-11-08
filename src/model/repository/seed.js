'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SEED_DIR = path.join(__dirname, '..', '..', 'seed');
const cache = new Map();

function list() {
  return fs.readdirSync(SEED_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}

function has(name) {
  return fs.existsSync(path.join(SEED_DIR, `${name}.json`));
}

/** 磁盘上的原始配置（不可变，改动一律走 db 覆盖层）
 *  按 mtime 失效：改完 JSON 不用重启服务，刷新页面就生效。 */
function raw(name) {
  const file = path.join(SEED_DIR, `${name}.json`);
  if (!fs.existsSync(file)) throw new Error(`没有这份配置：${name}`);
  const mtime = fs.statSync(file).mtimeMs;
  const hit = cache.get(name);
  if (hit && hit.mtime === mtime) return hit.value;
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  cache.set(name, { mtime, value });
  return value;
}

function invalidate(name) {
  if (name) cache.delete(name); else cache.clear();
}

module.exports = { list, has, raw, invalidate, SEED_DIR };
