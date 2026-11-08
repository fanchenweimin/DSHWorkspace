'use strict';

/**
 * 事件抽取（设计/20 §6–§7）。
 *
 * 这一步只回答一个问题：**这一手，桌上放哪一件事**。
 * 不改数值、不写纪事、不推进时间——那些是 turn.js 的事。
 *
 * 四步入池（不掷骰）：
 *   ① 时间窗 window  → ② 条件 when → ③ 额度 quota → ④ ttl（还能等几年）
 *
 * 上桌（掷骰）：
 *   ⑤ 取最优先的那一批（priority 小者先）
 *   ⑥ 批内有 forced 就只抽 forced，否则整批抽
 *   ⑦ 批内按 weight 归一化；气运只偏置写了 luckBias 的条目
 *
 * 两条容易写错的：
 *   - `weight` **不是**"每年出不出的闸门"，只是同批内的份额。低权重只是"晚"，不是"没有"。
 *   - 抽中后要记住（`state.turn.mainId`），否则每刷一次页面就换一张卡。
 */

const { evalWhen } = require('../rules/dsl');

const DEFAULT_PRIORITY = 3;
const DEFAULT_WEIGHT = 1;

/**
 * 绝对月序号。用 `年*12 + 本月已耗`，而不是 `clock.month`
 * —— `clock.month` 现在没人推进，拿它算冷却会永远停在 1。
 */
function absMonth(state) {
  const year = Number(state.clock && state.clock.year) || 0;
  const used = Number(state.monthsUsed) || 0;
  return year * 12 + used;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function priorityOf(e) {
  return e.priority != null ? Number(e.priority) : DEFAULT_PRIORITY;
}

/* ── ① 时间窗 ─────────────────────────────────────────── */

function inWindow(state, w) {
  if (!w) return true;
  const age = Number(state.clock && state.clock.age) || 0;
  const year = Number(state.clock && state.clock.year) || 0;
  if (w.fromAge != null && age < w.fromAge) return false;
  if (w.toAge != null && age > w.toAge) return false;
  if (w.fromYear != null && year < w.fromYear) return false;
  if (w.toYear != null && year > w.toYear) return false;
  return true;
}

/* ── ③ 资格额度 ───────────────────────────────────────── */

/**
 * `once` 与 `cooldown` 是两件事：前者"一生一次"，后者"隔多久才轮到下一次"。
 * `perYear` 是"一年最多几次"，靠 `fired[id].year` 判断，跨年自然清零。
 */
function quotaOk(state, e) {
  const q = e.quota || {};
  if (!q.once && !q.cooldown && !q.perYear) return true;

  const rec = (state.fired || {})[e.id];
  if (!rec) return true;
  if (q.once) return false;

  if (q.cooldown && absMonth(state) - (Number(rec.at) || 0) < Number(q.cooldown)) return false;
  if (q.perYear && rec.year === (state.clock && state.clock.year)
      && (Number(rec.n) || 1) >= Number(q.perYear)) return false;
  return true;
}

/** 记一次"来过"：cooldown 读 at，perYear 读 year + n */
function markFired(state, id) {
  const year = state.clock && state.clock.year;
  state.fired = state.fired || {};
  const prev = state.fired[id];
  const n = prev && prev.year === year ? (Number(prev.n) || 1) : 0;
  state.fired[id] = { at: absMonth(state), year, n: n + 1 };
  return state.fired[id];
}

/* ── ④ ttl：还能等几年 ────────────────────────────────── */

/**
 * `ttl` 是"从第一次有机会起，最多保留 N 年"（城战写着 3）。
 * 过期就再也不上桌——战事过去了，没人会再问你守不守那座城。
 * 第一次入池的时间记在 `state.seen[id]`，必须存档，否则读档能续命。
 */
function ttlOk(state, e) {
  if (!e.ttl) return true;
  state.seen = state.seen || {};
  const abs = absMonth(state);
  if (state.seen[e.id] == null) state.seen[e.id] = abs;
  return abs - state.seen[e.id] <= Number(e.ttl) * 12;
}

/* ── ⓪ 日历 / 排定：到点必来 ─────────────────────────── */

function dueIds(state) {
  const abs = absMonth(state);
  return new Set((state.pending || []).filter((p) => Number(p.at) <= abs).map((p) => p.event));
}

/* ── 池子 ─────────────────────────────────────────────── */

/**
 * 四步入池。`list` 由 hand.js 展开模板后传进来（这里不读配置，方便测试）。
 * 排定到点的事件不过 ①–④，但仍要过 `handled`——打完就不再上桌。
 */
function candidates(state, list, ctx) {
  const handled = new Set(state.handled || []);
  const due = dueIds(state);
  const out = [];

  for (const e of list || []) {
    if (!e || !e.id || handled.has(e.id)) continue;

    if (due.has(e.id)) {
      /* 日历事件排最前：世界记着这件事，不该被别的机缘挤掉 */
      out.push({ ...e, fromCalendar: true, priority: 0 });
      continue;
    }

    if (!inWindow(state, e.window)) continue;
    if (!evalWhen(e.when || [], { ...ctx, args: e.args || {} })) continue;
    if (!quotaOk(state, e)) continue;
    if (!ttlOk(state, e)) continue;

    out.push(e);
  }
  return out;
}

/* ── 权重 ─────────────────────────────────────────────── */

/** 气运只偏置写了 `luckBias` 的条目（机缘/灾祸），不碰主线（设计/02 §6） */
function effWeight(state, e) {
  const w = e.weight != null ? Number(e.weight) : DEFAULT_WEIGHT;
  const luck = Number(state.luck);
  /* 别写 `state.luck || 50`：气运 0 是合法值，`||` 会把它当缺省 */
  const bias = e.luckBias ? ((Number.isFinite(luck) ? luck : 50) - 50) * 0.002 : 0;
  return clamp(w + bias, 0.1, 10);
}

function weighted(state, batch, rng) {
  if (batch.length === 1) return batch[0];
  const total = batch.reduce((a, e) => a + effWeight(state, e), 0);
  let r = rng() * total;
  for (const e of batch) {
    r -= effWeight(state, e);
    if (r <= 0) return e;
  }
  return batch[batch.length - 1];
}

/** ⑤⑥⑦：最小批 → forced 优先 → 批内按权重 */
function pick(state, cands, rng) {
  if (!cands || !cands.length) return null;
  const minP = Math.min(...cands.map(priorityOf));
  const batch = cands.filter((e) => priorityOf(e) === minP);
  const forced = batch.filter((e) => e.forced);
  return weighted(state, forced.length ? forced : batch, rng || Math.random);
}

/* ── 主卡 ─────────────────────────────────────────────── */

/**
 * 这一手的主卡。
 *
 * 抽中后记 `state.turn.mainId`：下一次结算（或跨年）才重抽。
 * 不记的话 `GET /api/hand` 每次都重掷，玩家会看见卡来回换。
 */
function mainOf(state, list, ctx, opts) {
  const rng = (opts && opts.rng) || Math.random;
  const cands = candidates(state, list, ctx);

  state.turn = state.turn || {};
  const remembered = state.turn.mainId;
  if (remembered) {
    const hit = cands.find((e) => e.id === remembered);
    if (hit) return hit;
    state.turn.mainId = null;
  }

  const picked = pick(state, cands, rng);
  state.turn.mainId = picked ? picked.id : null;
  return picked;
}

/**
 * 兜底：这一年还有月，但桌上没有一件做得成的事。
 * 设计/20 §9 的语义是"挡住的年底就结束"，所以这时候要允许把剩下的月过掉，
 * 否则强制事件要 5 个月、只剩 3 个月时，玩家会彻底卡死。
 */
function nothingToDo(state, main) {
  const used = Number(state.monthsUsed) || 0;
  const left = 12 - used;
  if (left <= 0) return false;
  if (!main) return true;
  const choices = (main.choices && main.choices.length) ? main.choices : [{ months: main.months }];
  return !choices.some((c) => {
    const m = c.months != null ? c.months : main.months;
    return (m != null ? m : 1) <= left;
  });
}

module.exports = {
  absMonth, inWindow, quotaOk, markFired, ttlOk, dueIds,
  candidates, effWeight, weighted, pick, mainOf, nothingToDo, priorityOf
};
