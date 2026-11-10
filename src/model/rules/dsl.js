'use strict';

/**
 * when 求值（业务层最小实现）。
 * 只做判定，不写状态 —— 与 设计/04 的 DSL 同一套语法。
 */

const ROOTS = new Set([
  'luck', 'money', 'merit', 'war', 'city', 'zone', 'path', 'attr',
  'education', 'flags', 'clock', 'turn', 'world', 'identity', 'spiritMass',
  'arts', 'battle', 'reputation', 'items'
]);

function toNum(v) {
  if (typeof v === 'number') return v;
  if (v === '' || v == null || typeof v === 'object') return NaN;
  return Number(v);
}

function getPath(path, ctx) {
  if (typeof path !== 'string') return path;
  const args = ctx.args || {};
  if (path === '$arg.tierMinus1') return (args.tier != null ? args.tier : 1) - 1;
  const exact = /^\$arg\.([A-Za-z0-9_]+)$/.exec(path);
  if (exact) return args[exact[1]];

  let s = path;
  if (s.includes('$arg.')) {
    s = s.replace(/\$arg\.([A-Za-z0-9_]+)/g, (m, k) =>
      args[k] !== undefined ? String(args[k]) : m);
  }
  if (s.startsWith('$prof.')) {
    const p = s.split('.');
    return ((ctx.rules.PROF || {})[p[1]] || [])[Number(p[2]) - 1];
  }
  if (s.startsWith('$last.')) return ctx.last ? ctx.last[s.slice(6)] : undefined;
  if (s.startsWith('flag.')) {
    return s.split('.').slice(1).reduce((o, k) => (o == null ? undefined : o[k]), ctx.state.flags || {});
  }
  if (!s.includes('.') && !ROOTS.has(s)) return s; // 字面量（'city'、'meng'）

  /* r37 修：`.eff` 结尾的路径必须走 `mods.get()`。
     状态里存的是 `{ base: 85 }` 这样的对象，`.eff` 是**现算**的（修饰器 + 上限）。
     直接 reduce 会拿到对象，`cmp()` 判成 NaN，于是 `gte ['attr.aptitude.eff', 80]`
     永远为假——这会让所有读 `.eff` 的条件静默失效。 */
  if (s.endsWith('.eff')) {
    const mods = require('./mods');
    const v = mods.get(ctx.state, s);
    if (v !== undefined) return v;
  }

  return s.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx.state);
}

/** 数值比较；任一边不是数就返回 null（gt/lt 据此判假） */
function cmp(a, b) {
  const na = toNum(a);
  const nb = toNum(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return null;
  return na - nb;
}

/** 相等：数值按数值比，其余按字符串比（`flag.exam.rank == "上等"` 要能用） */
function eqOf(a, b) {
  const na = toNum(a);
  const nb = toNum(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  return String(a) === String(b);
}

function evalWhen(c, ctx) {
  if (c == null) return true;
  if (Array.isArray(c)) return c.every((x) => evalWhen(x, ctx));
  if (typeof c !== 'object') return false;

  if (typeof c.use === 'string') {
    const raw = (ctx.conditions || {})[c.use];
    if (!raw) return false;
    const cond = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'params' || k === 'desc' || k === 'id') continue;
      cond[k] = v;
    }
    return evalWhen(cond, { ...ctx, args: { ...ctx.args, ...(c.args || {}) } });
  }

  const keys = Object.keys(c);
  if (keys.length > 1) return keys.every((k) => evalWhen({ [k]: c[k] }, ctx));

  const op = keys[0];
  const arg = c[op];

  switch (op) {
    case 'all': return (arg || []).every((x) => evalWhen(x, ctx));
    case 'any': return (arg || []).some((x) => evalWhen(x, ctx));
    case 'none': return !(arg || []).some((x) => evalWhen(x, ctx));
    case 'not': return !evalWhen(arg, ctx);
    case 'eq': return eqOf(getPath(arg[0], ctx), getPath(arg[1], ctx));
    case 'neq': return !eqOf(getPath(arg[0], ctx), getPath(arg[1], ctx));
    case 'gt': { const d = cmp(getPath(arg[0], ctx), getPath(arg[1], ctx)); return d != null && d > 0; }
    case 'gte': { const d = cmp(getPath(arg[0], ctx), getPath(arg[1], ctx)); return d != null && d >= 0; }
    case 'lt': { const d = cmp(getPath(arg[0], ctx), getPath(arg[1], ctx)); return d != null && d < 0; }
    case 'lte': { const d = cmp(getPath(arg[0], ctx), getPath(arg[1], ctx)); return d != null && d <= 0; }
    case 'flag': { const v = getPath(arg, ctx); return v === true || v === 'true' || (typeof v === 'number' && v !== 0); }
    case 'notFlag': { const v = getPath(arg, ctx); return !(v === true || v === 'true' || (typeof v === 'number' && v !== 0)); }
    case 'stage': return ctx.state.education && ctx.state.education.stage === arg;
    case 'zone': return ctx.state.zone === arg;
    case 'realm': {
      const p = ctx.state.path && ctx.state.path[arg.dao];
      return !!p && p.level >= arg.gte;
    }
    case 'has': { const d = cmp(getPath(arg[0], ctx), arg[1]); return d != null && d >= 0; }
    case 'count': return (arg.of || []).filter((x) => evalWhen(x, ctx)).length >= (arg.gte != null ? arg.gte : 1);
    case 'chance': return true;
    case 'judge': return true;
    default:
      console.warn('[dsl] 未实现的算子', op);
      return false;
  }
}

/**
 * 把 `$arg.x` 绑成具体值（模板展开与宏调用共用）。
 * 整串命中就返回原类型（数字/布尔不变成字符串），局部命中只做替换。
 */
function bindArgs(node, args) {
  if (typeof node === 'string') {
    const exact = /^\$arg\.([A-Za-z0-9_]+)$/.exec(node);
    if (exact && args[exact[1]] !== undefined) return args[exact[1]];
    return node.replace(/\$arg\.([A-Za-z0-9_]+)/g, (m, k) =>
      args[k] !== undefined ? String(args[k]) : m);
  }
  if (Array.isArray(node)) return node.map((x) => bindArgs(x, args));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      const nk = k.replace(/\$arg\.([A-Za-z0-9_]+)/g, (m, kk) =>
        args[kk] !== undefined ? String(args[kk]) : m);
      out[nk] = bindArgs(v, args);
    }
    return out;
  }
  return node;
}

module.exports = { evalWhen, getPath, bindArgs };
