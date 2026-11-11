'use strict';

/**
 * 效果执行器（设计/04 §4–§6）。
 *
 * `do` 是效果数组，按书写顺序执行。算子只有这些，加新算子才动代码（I20）。
 *
 * 纪律：
 *   - 一条效果抛错 → 前面已生效的不回滚，后面中止，错误写进纪事（设计/04 §11）。
 *   - 修为条只许 add / set 0，乘算与修饰器一律拒绝（I2）。
 *   - `path.*.level` 只许破境判定写（I3 / I25）。
 *   - `$roll` 在同一效果块里是同一个数（含宏内部），读档才不会漂（§6）。
 */

const config = require('../repository/config');
const mods = require('../rules/mods');
const realm = require('../rules/realm');
const battle = require('../rules/battle');
const { evalWhen, bindArgs } = require('../rules/dsl');

const MAX_DEPTH = 8;
const DAO_BAR = /^path\.([a-z]+)\.bar$/;
const DAO_LEVEL = /^path\.[a-z]+\.level$/;
const NUMERIC = /^(path\.|attr\.|reputation|merit\.|war\.|money\.)/;

class EffectError extends Error {}

function num(v, dflt = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function absMonth(state) {
  return num(state.clock && state.clock.year) * 12 + num(state.clock && state.clock.month);
}

/* ── 上下文 ───────────────────────────────────────────── */

function makeCtx(state, env) {
  const rng = env.rng || Math.random;
  return {
    state,
    rules: env.rules || config.get('rules'),
    conditions: env.conditions || config.get('conditions'),
    macros: env.macros || config.get('macros'),
    args: env.args || {},
    vars: {},
    event: env.event || null,
    choice: env.choice || null,
    rng,
    roll: rng(),
    last: null,
    depth: 0,
    quiet: !!env.quiet,
    notes: [],
    errors: [],
    battles: []      /* 这一串 do 里打过的仗：给前端弹"战斗回放"用（r30） */
  };
}

/** 派生值：月修为、成功率这些"算出来的数"，配置只能引用 */
function rateOf(path, ctx) {
  const parts = path.split('.');
  if (path === 'rate.realm.month.eff' || (parts[1] === 'month' && realm.RANK[parts[2]] != null)) {
    const dao = parts[2] === 'realm' ? String(ctx.args.dao || ctx.vars.dao || 'body') : parts[2];
    return realm.monthGain(ctx.state, dao);
  }
  if (path === 'rate.month.all') return realm.rateMul(ctx.state, 'rate.month.all');
  if (path === 'rate.success.pill') return realm.pillBonus(ctx.state, ctx.rules);
  return 0;
}

/**
 * 取一个"名字"：路径、物品 id、标记 id、宏名、事件 id。
 * **不能**走 valueOf —— 那会把 `attr.aptitude.eff` 读成 66、把 `item.guben` 读成 0。
 */
function ident(spec, ctx) {
  if (typeof spec !== 'string') return String(spec);
  let s = spec;
  const exactArg = /^\$arg\.([A-Za-z0-9_]+)$/.exec(s);
  if (exactArg && ctx.args[exactArg[1]] !== undefined) return String(ctx.args[exactArg[1]]);
  const exactVar = /^\$([A-Za-z0-9_]+)$/.exec(s);
  if (exactVar && ctx.vars[exactVar[1]] !== undefined) return String(ctx.vars[exactVar[1]]);
  s = s.replace(/\$arg\.([A-Za-z0-9_]+)/g, (m, k) => (ctx.args[k] !== undefined ? String(ctx.args[k]) : m));
  return s;
}

/**
 * 取一个"值"：可能是数字、路径、$arg、$last、$prof、rate.*。
 * 找不到的路径不报错，原样当字面量返回（`"fu"` 这类枚举常这么写）。
 */
function valueOf(spec, ctx) {
  if (spec == null) return spec;
  if (typeof spec === 'number' || typeof spec === 'boolean') return spec;
  if (Array.isArray(spec)) return spec.map((x) => valueOf(x, ctx));
  if (typeof spec !== 'string') return spec;

  let s = spec;
  const exactArg = /^\$arg\.([A-Za-z0-9_]+)$/.exec(s);
  if (exactArg && ctx.args[exactArg[1]] !== undefined) return ctx.args[exactArg[1]];
  const exactVar = /^\$([A-Za-z0-9_]+)$/.exec(s);
  if (exactVar && ctx.vars[exactVar[1]] !== undefined) return ctx.vars[exactVar[1]];

  if (s.includes('$arg.')) {
    s = s.replace(/\$arg\.([A-Za-z0-9_]+)/g, (m, k) => (ctx.args[k] !== undefined ? String(ctx.args[k]) : m));
  }
  if (s === '$roll') return ctx.roll;
  if (s.startsWith('$last.')) return ctx.last ? ctx.last[s.slice(6)] : undefined;
  if (s.startsWith('$prof.')) {
    const [, dao, tier] = s.split('.');
    return ((ctx.rules.PROF || {})[dao] || [])[num(tier) - 1];
  }
  if (s.startsWith('rate.')) return rateOf(s, ctx);
  if (mods.isPath(s)) {
    const v = mods.get(ctx.state, s);
    return v === undefined ? s : v;
  }
  return s;
}

/* ── 写 ───────────────────────────────────────────────── */

function note(ctx, text) {
  if (!ctx.notes.includes(text)) ctx.notes.push(text);
}

/** 数值类写入：唯一的门，I2 / I3 在这里拦 */
function setNumber(path, next, ctx) {
  const m = DAO_BAR.exec(path);
  if (m && next < 0) next = 0;
  mods.write(ctx.state, path, next);
  return next;
}

/**
 * 修为条的上限：**问 realm，不要在这里另写一套**（I18）。
 * r28 口径：PROF[n-1] = 站在第 n 品练满的量；未入品没有条（null）。
 */
function barCap(ctx, dao) {
  return realm.barMax(ctx.state, dao, ctx.rules);
}

function addNumber(path, delta, ctx) {
  if (DAO_LEVEL.test(path)) throw new EffectError('层级只能由破境判定写（I3 / I25）');
  const cur = num(mods.get(ctx.state, path));

  let next = cur + delta;
  const m = DAO_BAR.exec(path);
  if (m) {
    const cap = barCap(ctx, m[1]);
    /* 没有修为条（还没入品 / 已到顶）：这一笔修为无处可放，直接不写。
       r28："未入门"没有进度条，所以事件也不该偷偷往里灌 9999。 */
    if (cap == null) return cur;
    if (next > cap) next = cap;
  }
  next = setNumber(path, next, ctx);

  /* 外溢按**实际涨到的量**算，不是按想涨的量（满了的那部分不该带动别处） */
  if (m && next > cur) realm.spill(ctx.state, m[1], next - cur, ctx.rules);

  if (path.startsWith('merit.')) note(ctx, `${MERIT_NAME[path.slice(6)] || path.slice(6)} ${delta > 0 ? '+' : ''}${round(delta)}`);
  return next;
}

const MERIT_NAME = { war: '军功', craft: '技艺', office: '官绩' };

function round(v) {
  return Math.round(v * 10) / 10;
}

/* ── 算子 ─────────────────────────────────────────────── */

const OPS = {
  add(arg, ctx) {
    const [path, v] = arg;
    const p = ident(path, ctx);
    return { ok: true, path: p, value: addNumber(p, num(valueOf(v, ctx)), ctx) };
  },

  sub(arg, ctx) {
    const [path, v] = arg;
    const p = ident(path, ctx);
    return { ok: true, path: p, value: addNumber(p, -num(valueOf(v, ctx)), ctx) };
  },

  mul(arg, ctx) {
    const [path, v] = arg;
    const p = ident(path, ctx);
    if (DAO_BAR.test(p)) throw new EffectError(`I2：修为条不许乘算（${p}）`);
    if (p.startsWith('rate.')) throw new EffectError(`派生值不能直接 mul，请用 mod（${p}）`);
    const cur = num(mods.get(ctx.state, p));
    const next = setNumber(p, cur * num(valueOf(v, ctx)), ctx);
    return { ok: true, path: p, value: next };
  },

  set(arg, ctx) {
    const [path, v] = arg;
    const p = ident(path, ctx);
    if (DAO_LEVEL.test(p)) throw new EffectError('层级只能由破境判定写（I3 / I25）');
    const val = valueOf(v, ctx);
    const next = NUMERIC.test(p) ? setNumber(p, num(val), ctx) : mods.write(ctx.state, p, val);
    return { ok: true, path: p, value: next };
  },

  clampAdd(arg, ctx) {
    const [path, v, lo, hi] = arg;
    const p = ident(path, ctx);
    const cur = num(mods.get(ctx.state, p));
    const next = Math.min(num(hi), Math.max(num(lo), cur + num(valueOf(v, ctx))));
    setNumber(p, next, ctx);
    return { ok: true, path: p, value: next };
  },

  /**
   * 按月修炼：`train: { dao, months }`。
   * 一次点到底（界面上"修炼"就是修满剩余月份），所以这里要把月数乘进去。
   * 走 add 是故意的——钳上限与外溢都在 addNumber 里，别绕开它。
   */
  train(arg, ctx) {
    const dao = ident(arg.dao, ctx);
    const months = num(valueOf(arg.months, ctx));
    if (!ctx.state.path[dao]) throw new EffectError(`没有这一道：${dao}`);
    if (dao === 'heart') throw new EffectError('道心不吃月修为（I4）');
    const gain = realm.monthGain(ctx.state, dao) * months;
    return OPS.add([`path.${dao}.bar`, gain], ctx);
  },

  money(arg, ctx) {
    if (!arg || typeof arg !== 'object') throw new EffectError('money 要写成 {copper|silver|gold}');
    const C = (ctx.rules || {}).CURRENCY || { copper: 100, silver: 100 };
    const per = { copper: 1, silver: C.copper, gold: C.copper * C.silver };
    let total = mods.moneyTotal(ctx.state);
    const parts = [];
    for (const [k, v] of Object.entries(arg)) {
      if (!per[k]) continue;
      const delta = num(valueOf(v, ctx));
      total += delta * per[k];
      parts.push(`${CN_MONEY[k]} ${delta > 0 ? '+' : ''}${delta}`);
    }
    const after = mods.moneySet(ctx.state, total);
    if (parts.length && !ctx.quiet) note(ctx, parts.join(' '));
    return { ok: true, money: after };
  },

  mod(arg, ctx) {
    const target = ident(arg.target, ctx);
    let mod = null;
    try {
      mod = mods.apply(ctx.state, {
        target,
        op: arg.op || 'add',
        value: num(valueOf(arg.value, ctx)),
        duration: arg.duration || { kind: 'permanent' },
        source: arg.source ? ident(arg.source, ctx) : (ctx.event ? `event.${ctx.event.id}` : 'effect'),
        stack: arg.stack || 'unique',
        tags: arg.tags || []
      });
    } catch (e) {
      throw new EffectError(e.message);
    }
    return { ok: !!mod, mod };
  },

  unmod(arg, ctx) {
    const source = ident(arg, ctx);
    return { ok: true, removed: mods.remove(ctx.state, source) };
  },

  grant(arg, ctx) {
    const item = ident(arg.item, ctx);
    const n = num(valueOf(arg.n != null ? arg.n : 1, ctx));
    const cur = num((ctx.state.items || {})[item]);
    mods.write(ctx.state, item, cur + n);
    const name = itemName(item);
    note(ctx, `得${name} ×${n}`);
    return { ok: true, item, n };
  },

  flag(arg, ctx) {
    /* 两种写法都收：`{flag:{id:'x.y'}}` 与 `{flag:'flag.x.y'}`。
       只收对象时，写成字符串会静默写进 `flags.undefined`——这个坑已经踩过一次。 */
    const raw = typeof arg === 'string' ? arg : (arg && arg.id);
    if (raw == null) throw new EffectError('flag 要写成 {id, value} 或 "flag.x.y"');
    const id = ident(raw, ctx);
    const value = (arg && typeof arg === 'object' && arg.value !== undefined)
      ? valueOf(arg.value, ctx)
      : true;
    mods.write(ctx.state, `flag.${String(id).replace(/^flag\./, '')}`, value);
    return { ok: true, flag: id, value };
  },

  chain(arg, ctx) {
    const event = ident(arg.event, ctx);
    const delay = num(valueOf(arg.delayMonths, ctx));
    ctx.state.pending = ctx.state.pending || [];
    ctx.state.pending.push({ event, at: absMonth(ctx.state) + delay });
    return { ok: true, event, at: absMonth(ctx.state) + delay };
  },

  log(arg, ctx) {
    const text = String(valueOf(arg, ctx));
    ctx.state.log.push(text);
    return { ok: true, text };
  },

  if(arg, ctx) {
    const branch = evalWhen(arg.when || [], ctx) ? arg.then : arg.else;
    return runList(branch, ctx);
  },

  each(arg, ctx) {
    const list = valueOf(arg.list, ctx);
    if (!Array.isArray(list)) throw new EffectError(`each 的 list 不是数组（${arg.list}）`);
    const as = arg.as || 'x';
    const prev = ctx.vars[as];
    let out = { ok: true };
    for (const item of list) {
      ctx.vars[as] = item;
      out = runList(arg.do, ctx);
    }
    if (prev === undefined) delete ctx.vars[as];
    else ctx.vars[as] = prev;
    return out;
  },

  roll() {
    throw new EffectError('roll 尚未实现：缺 tables 数据源（设计/04 §9）');
  },

  /**
   * 掷一次概率，把结果写进 `$last.ok`（r35）。
   *
   * 为什么不是 `judge(attr)`：`judgeAttr` 的公式是 `0.5 + (a−b)×scale`，
   * 想表达"三成概率"得让 `a−b` 恰好凑出 −0.2，写起来不可读、也容易被改坏。
   * 这个算子只做一件事：**按给定概率掷一次**。
   *
   * 参数：{ p: 0.3 } 或 { chance: 0.3 }
   */
  random(arg, ctx) {
    const raw = (arg && (arg.p != null ? arg.p : arg.chance)) != null
      ? (arg.p != null ? arg.p : arg.chance)
      : 0.5;
    const p = Math.min(1, Math.max(0, num(valueOf(raw, ctx))));
    const roll = ctx.rng();
    return { ok: roll < p, why: 'random', p, roll };
  },

  /**
   * **世界认可**（r44，`需求/11` §1.2.2）。
   *
   * 三道（锻体 / 炼气 / 养灵）共用同一张门票：拿到之后，
   * 另外两道冲第 5 品时事件 1 会直接放行。
   *
   * 参数：{ dao: 'body' } —— 哪个道办成的（拿认可 + 通那一层的 lv）
   * 不传 dao 时，只拿认可、不通层级（给"别人给你认可"这种场景留口子）。
   */
  recognize(arg, ctx) {
    const recog = require('./recognition');
    const dao = String(valueOf((arg && arg.dao) || '', ctx) || '');
    recog.grant(ctx.state, dao);

    if (dao && ctx.state.path && ctx.state.path[dao]) {
      const p = ctx.state.path[dao];
      const realm = require('../rules/realm');
      p.lv = Math.max(num(p.lv), 5);
      p.attempts = 0;
      p.fail = 0;
      realm.breakWall(ctx.state, dao, 5);
    }
    return { ok: true, why: 'recognized', dao };
  },

  /**
   * 学会一门术法（r35，需求/12 §0.1.2 奇遇来源）。
   *
   * 为什么不写 `set: ['spells.$arg.spell.lvl', 0]`：
   * 路径会被按点号拆成段，`$arg.spell` 里的点让拼接塌掉（实测写成空键）。
   * 所以给一个专门的算子——**它一次只做一件事：把这门术法记成已学**。
   *
   * 参数：{ spell: 'spell.xxx', lvl?: 0 }   lvl 默认 0（入门，放不出来）
   * 已学过就不动（奇遇不降级）。
   */
  learn(arg, ctx) {
    const id = ident(arg && arg.spell, ctx);
    if (!id || id.startsWith('$arg')) throw new EffectError(`learn 缺 spell：${id}`);
    const lvl = num(valueOf(arg.lvl != null ? arg.lvl : 0, ctx));

    const spells = require('../rules/spells');
    const all = spells.list();
    const def = all.find((s) => s.id === id);
    if (!def) throw new EffectError(`没有这门术法：${id}`);

    ctx.state.spells = ctx.state.spells || {};
    if (ctx.state.spells[id]) {
      note(ctx, '这门你早就学过了');
      return { ok: true, spell: id, already: true };
    }
    ctx.state.spells[id] = { lvl, exp: 0 };
    note(ctx, `学会「${def.name || id}」`);
    return { ok: true, spell: id, lvl, already: false };
  },

  call(arg, ctx) {
    const name = ident(arg.macro, ctx);
    const macro = (ctx.macros || {})[name];
    if (!macro) throw new EffectError(`宏不存在：${name}`);
    if (ctx.depth >= MAX_DEPTH) throw new EffectError(`宏嵌套超过 ${MAX_DEPTH} 层（${name}）`);

    const bind = {};
    for (const [k, v] of Object.entries(arg.args || {})) bind[k] = valueOf(v, ctx);

    const child = {
      ...ctx,
      args: { ...ctx.args, ...bind },
      last: null,
      depth: ctx.depth + 1,
      vars: { ...ctx.vars }
    };
    return runList(bindArgs(macro.do || [], bind), child);
  },

  judge(arg, ctx) {
    const params = {};
    for (const [k, v] of Object.entries(arg)) {
      if (k === 'kind') continue;
      params[k] = valueOf(v, ctx);
    }
    const kind = String(arg.kind || '');

    /* r36：`kind` 只认三种字面量（raise / break / attr），**不做 $arg 替换**——
       它是"判定器名字"，不是值。所以事件通道由 `byEvent` 参数决定，不靠 kind。 */
    const byEventRaw = arg.byEvent != null ? valueOf(arg.byEvent, ctx) : params.byEvent;
    const byEvent = byEventRaw === true || byEventRaw === 'true';

    if (kind === 'raise') return realm.raiseLevel(ctx.state, { ...params, byEvent: true }, ctx);
    if (kind === 'break') {
      /* r40：概率瓶颈的玩家动作 = 瓶颈判定 + 真实进品，一次完成。
         byEvent=true 是事件瓶颈通道，只通 lv；真实突破由玩家随后手动点击。 */
      if (!byEvent && realm.bottleneckOf(params.dao, Number(params.tier)) === 'prob') {
        return realm.probabilityBreakthrough(ctx.state, params, ctx);
      }
      return realm.raiseLevel(ctx.state, { ...params, byEvent }, ctx);
    }
    if (kind === 'attr') return judgeAttr(params, ctx);

    /* 战斗：三层结算在 rules/battle.js，这里只把战报写进纪事 */
    if (kind === 'battle') {
      const res = battle.resolve(ctx.state, params, ctx);
      /* 纪事里只留一行摘要：整场过程走"战斗那一屏"逐帧放（r31） */
      const how = res.match === 'spar'
        ? (res.ok ? '赢了这一场切磋' : res.yielded ? '收了手' : '认了输')
        : (res.death ? '没能活着回来' : res.fled ? '跑了' : (res.ok ? '赢了' : '没赢'));
      ctx.state.log.push(`你与${res.enemy}交手，${how}（${res.rounds} 回合）。`);
      ctx.battles.push({
        ok: !!res.ok,
        outcome: res.outcome,
        fled: !!res.fled,
        yielded: !!res.yielded,
        usedTalisman: !!res.usedTalisman,
        match: res.match,
        rounds: res.rounds,
        hp: res.hp,
        hpMax: res.hpMax,
        enemy: res.enemy,
        injury: !!res.injury,
        death: !!res.death,
        usedPill: !!res.usedPill,
        me: res.me,
        foe: res.foe,
        meDodge: res.meDodge,
        foeDodge: res.foeDodge,
        frames: (res.frames || []).slice(),
        report: (res.report || []).slice()
      });

      /* 死斗死了就结束这一世：不是"没打赢"，是没了 */
      if (res.death) {
        ctx.state.dead = true;
        ctx.state.log.push('你死在了这一场里。这一世到此为止。');
        return res;
      }

      if (res.injury) {
        /* 伤病不是一句提示，是一个**修饰器**：一年内月修为 ×0.6（r29）。
           同源唯一，再伤一次只是把这一年重新计起，不会叠成 0.36。 */
        ctx.state.log.push('这一仗伤了根本，往后一年练什么都慢些。');
        ctx.state.flags = ctx.state.flags || {};
        ctx.state.flags.injury = { at: ctx.state.clock && ctx.state.clock.age };
        try {
          mods.apply(ctx.state, {
            target: 'rate.month.all',
            op: 'mul',
            value: 0.6,
            duration: { kind: 'years', value: 1 },
            source: 'injury',
            stack: 'unique',
            tags: ['injury']
          });
        } catch (e) {
          ctx.errors.push(`伤病修饰器没写进去：${e.message}`);
        }
      }
      return res;
    }

    ctx.errors.push(`判定器 ${kind} 尚未实现（设计/04 §3.5）`);
    return { ok: false, why: 'not_implemented', kind };
  }
};

const CN_MONEY = { copper: '铜', silver: '银', gold: '金' };

function itemName(id) {
  const list = config.get('items') || [];
  const found = list.find((x) => x.id === id);
  return found ? found.name : id.replace(/^item\./, '');
}

/** 属性对抗：a vs b + 气运（I5：气运只做加法） */
function judgeAttr(params, ctx) {
  const a = num(valueOf(params.a, ctx));
  const b = num(valueOf(params.b, ctx));
  const scale = num(params.scale != null ? params.scale : 0.01);
  const p = Math.min(0.95, Math.max(0.05, 0.5 + (a - b) * scale + realm.luckAdj(ctx.state)));
  const roll = ctx.rng();
  return { ok: roll < p, why: 'roll', p, roll, a, b };
}

/* ── 执行 ─────────────────────────────────────────────── */

function runList(list, ctx) {
  let out = { ok: true };
  for (const item of list || []) {
    if (!item || typeof item !== 'object') continue;
    const keys = Object.keys(item);
    if (keys.length !== 1) {
      ctx.errors.push(`效果项只能有一个算子：{${keys.join(', ')}}`);
      break;
    }
    const op = keys[0];
    const fn = OPS[op];
    if (!fn) {
      ctx.errors.push(`未注册的算子：${op}`);
      break;
    }
    try {
      out = fn(item[op], ctx);
      ctx.last = out;
      /* 人已经死了，后面的事就别再发生了（军功、声望、赏钱都不该再记上） */
      if (ctx.state.dead) break;
    } catch (e) {
      if (!(e instanceof EffectError)) throw e;
      ctx.errors.push(e.message);
      ctx.state.log.push(`（这一条没能生效：${e.message}）`);
      break;   /* §11：前面已生效的保留，后面中止 */
    }
  }
  return out;
}

/**
 * 跑一段 `do`。
 * @param {object} state
 * @param {Array} list  效果数组
 * @param {object} env  { rules, conditions, macros, args, event, choice, rng }
 */
function run(state, list, env) {
  if (!Array.isArray(list) || !list.length) return { ok: true, last: { ok: true }, notes: [], errors: [], battles: [] };

  const ctx = makeCtx(state, env || {});
  const last = runList(list, ctx);

  if (ctx.notes.length) state.log.push(`（${ctx.notes.join(' · ')}）`);
  for (const err of ctx.errors) console.warn('[effects]', err);

  return { ok: ctx.errors.length === 0, last, notes: ctx.notes, errors: ctx.errors, battles: ctx.battles };
}

module.exports = { run, valueOf, OPS, EffectError };
