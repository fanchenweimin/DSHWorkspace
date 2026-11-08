'use strict';

/**
 * 状态路径 + 修饰器管线（设计/03 §2–§5）。
 *
 * 三件事，别加第四件：
 *   1. get(state, path)     读；带 .eff 的走修饰器，不带的读存储值
 *   2. write(state, path, v) 写；写 .eff 等于写它的底子（洗髓/药浴/成长那一类）
 *   3. apply/remove/expire  修饰器的增删与到期
 *
 * 四层顺序写死：加 → 乘 → 取大 → 取小 → 钳制（I19）。
 * `mul` 的 value 是**倍数**（1.10 = ×1.10），与 items.json 的写法一致。
 *
 * 修为条（path.*.bar）不吃修饰器 —— I2，apply() 会直接拒绝。
 */

const config = require('../repository/config');

const EFF = /\.eff$/;

const ROOTS = new Set([
  'luck', 'money', 'merit', 'war', 'city', 'zone', 'path', 'attr', 'reputation',
  'education', 'flags', 'flag', 'clock', 'turn', 'world', 'identity', 'spiritMass', 'items', 'item',
  'arts', 'battle'
]);

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isPath(s) {
  if (typeof s !== 'string') return false;
  if (!s.includes('.')) return false;
  return ROOTS.has(s.split('.')[0]);
}

function stripEff(path) {
  return EFF.test(path) ? path.slice(0, -4) : path;
}

/** 把 'flag.edu.meng.done' 规整成存储路径 'flags.edu.meng.done' */
function storagePath(path) {
  return path.startsWith('flag.') ? `flags.${path.slice(5)}` : path;
}

function get(state, path) {
  if (typeof path !== 'string') return undefined;
  if (EFF.test(path)) return resolve(state, path);
  return raw(state, path);
}

function raw(state, path) {
  if (typeof path !== 'string') return undefined;
  if (path.startsWith('item.')) return (state.items || {})[path] || 0;
  const v = storagePath(path)
    .split('.')
    .reduce((o, k) => (o == null ? undefined : o[k]), state);
  if (v && typeof v === 'object' && 'base' in v) return v.base;
  return v;
}

/** 派生值：底子 + 修饰器，四层固定顺序，最后钳制 */
function resolve(state, path) {
  const base = num(raw(state, stripEff(path)));
  const list = (state.mods || []).filter((m) => m.target === path);
  let v = base;
  for (const m of list) if (m.op === 'add') v += num(m.value);
  for (const m of list) if (m.op === 'mul') v *= num(m.value);
  for (const m of list) if (m.op === 'setMax') v = Math.max(v, num(m.value));
  for (const m of list) if (m.op === 'setMin') v = Math.min(v, num(m.value));
  return clamp(path, v);
}

function setRaw(state, path, value) {
  if (path.startsWith('item.')) {
    state.items = state.items || {};
    state.items[path] = value;
    return;
  }
  const keys = storagePath(path).split('.');
  let o = state;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  const k = keys[keys.length - 1];
  if (o[k] && typeof o[k] === 'object' && 'base' in o[k]) o[k].base = value;
  else o[k] = value;
}

function write(state, path, value) {
  setRaw(state, stripEff(path), value);
  state.rev = (state.rev || 0) + 1;
  return value;
}

/* ── 边界 ─────────────────────────────────────────────── */

function limitsOf(path) {
  const p = stripEff(path);
  const L = config.get('limits') || {};
  if (p === 'reputation' || p === 'reputation.eff') return L.attr && L.attr.reputation;
  if (p.startsWith('attr.')) {
    const k = p.split('.')[1];
    if (L.attr && L.attr[k]) return L.attr[k];
    return null;
  }
  const [head, key] = p.split('.');
  if (L[head] && key && L[head][key]) return L[head][key];
  return null;
}

function clamp(path, v) {
  const lim = limitsOf(path);
  if (!lim) return v;
  const lo = lim[0] != null ? lim[0] : -Infinity;
  const hi = lim[1] != null ? lim[1] : Infinity;
  return Math.min(hi, Math.max(lo, v));
}

/* ── 修饰器 ───────────────────────────────────────────── */

let seq = 0;

function apply(state, m) {
  if (/^path\.[a-z]+\.bar$/.test(m.target)) {
    throw new Error(`I2：修为条不吃修饰器（${m.target}）`);
  }
  state.mods = state.mods || [];

  /* 同源唯一：同一 source + 同一 target 的旧条目先摘掉（stack:'stack' 例外） */
  if (m.stack !== 'stack') {
    state.mods = state.mods.filter((x) => !(x.source === m.source && x.target === m.target));
  }
  if (m.stack === 'max') {
    const same = state.mods.filter((x) => x.target === m.target && x.op === m.op);
    if (same.some((x) => num(x.value) >= num(m.value))) return null;
  }

  seq += 1;
  const mod = {
    id: m.id || `mod_${Date.now().toString(36)}_${seq}`,
    target: m.target,
    op: m.op || 'add',
    value: num(m.value),
    duration: m.duration || { kind: 'permanent' },
    source: m.source || 'effect',
    stack: m.stack || 'unique',
    tags: m.tags || []
  };
  state.mods.push(mod);
  state.rev = (state.rev || 0) + 1;
  return mod;
}

function remove(state, source) {
  const before = (state.mods || []).length;
  state.mods = (state.mods || []).filter((m) => m.source !== source);
  const removed = before - state.mods.length;
  if (removed) state.rev = (state.rev || 0) + 1;
  return removed;
}

/** 跨年：按年的减 1，按月的减 12；到期的摘掉。永久的不进这个队列。 */
function expire(state) {
  const keep = [];
  for (const m of state.mods || []) {
    const d = m.duration || { kind: 'permanent' };
    if (d.kind === 'years') {
      const left = num(d.value) - 1;
      if (left > 0) keep.push({ ...m, duration: { kind: 'years', value: left } });
    } else if (d.kind === 'months') {
      const left = num(d.value) - 12;
      if (left > 0) keep.push({ ...m, duration: { kind: 'months', value: left } });
    } else {
      keep.push(m);
    }
  }
  if (keep.length !== (state.mods || []).length) state.rev = (state.rev || 0) + 1;
  state.mods = keep;
}

/* ── 钱 ───────────────────────────────────────────────── */

function moneyTotal(state) {
  const C = (config.get('rules') || {}).CURRENCY || { copper: 100, silver: 100 };
  const m = state.money || {};
  return num(m.copper) + num(m.silver) * C.copper + num(m.gold) * C.silver * C.copper;
}

/** 进位归一：一份"铜"为最小单位，永远不出现负数（设计/04 §11） */
function moneySet(state, copperTotal) {
  const C = (config.get('rules') || {}).CURRENCY || { copper: 100, silver: 100 };
  let left = Math.floor(copperTotal);
  let debt = false;
  if (left < 0) {
    left = 0;
    debt = true;
  }
  const perGold = C.copper * C.silver;
  const gold = Math.floor(left / perGold);
  left -= gold * perGold;
  const silver = Math.floor(left / C.copper);
  left -= silver * C.copper;
  state.money = { copper: left, silver, gold };
  if (debt) write(state, 'flag.money.debt', true);
  return state.money;
}

module.exports = {
  get, raw, resolve, write, setRaw, isPath, stripEff,
  apply, remove, expire, clamp, limitsOf,
  moneyTotal, moneySet, num
};
