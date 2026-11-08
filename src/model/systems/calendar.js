'use strict';

/**
 * 战事日历（r29 / 设计21）。
 *
 * `calendar.json` 里每一条 = 「第几年、哪一件事、什么参数」。
 * 到点的事件**不掷骰、不参与权重**：那一年就是它，城战还会把整年封住（模板里 `forced: true`）。
 *
 * 三个职责：
 *   phaseFor(year)  按日历推 `war.phase`（peace / warning / city / nation）
 *   sync(state)     跨年时把 phase 落到状态上，并在换档时写一句纪事
 *   take(state)     这一年有没有"到点该来"的那一条；有就返回展开后的完整事件
 *
 * 到点的事件仍然要过 `fired`（打过就不再来）与 `ifFlag`（上一座城破了才轮到下一座）。
 */

const config = require('../repository/config');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function entries() {
  const c = config.get('calendar') || {};
  const list = c['tbl.calendar'] || c.calendar || [];
  return Array.isArray(list) ? list : [];
}

/** 某一年的日历条目（不看 flag、不看打没打过） */
function ofYear(year) {
  const y = num(year);
  return entries().filter((e) => num(e.atYear) === y);
}

/** 这一年该是什么战事档 */
function phaseFor(year) {
  const ids = ofYear(year).map((e) => String(e.event || ''));
  if (!ids.length) return 'peace';
  if (ids.some((id) => id.includes('.nation'))) return 'nation';
  if (ids.some((id) => id.includes('.city'))) return 'city';
  if (ids.some((id) => id.includes('.warning'))) return 'warning';
  return 'peace';
}

const PHASE_CN = { peace: '', warning: '北边不太平了。', city: '兵临城下。', nation: '七国都在征人。' };

/**
 * 跨年时调用：把 `war.phase` 推到今年该有的样子。
 * 只写状态与纪事，不抽事件。
 */
function sync(state) {
  const want = phaseFor(state.clock.year);
  const have = (state.war && state.war.phase) || 'peace';
  if (want === have) return { changed: false, phase: have };
  state.war = state.war || {};
  state.war.phase = want;
  const line = PHASE_CN[want];
  if (line) state.log.push(line);
  return { changed: true, phase: want };
}

function flagOn(state, path) {
  if (!path) return true;
  const p = String(path).replace(/^flag\./, '').split('.');
  let cur = state.flags || {};
  for (const k of p) {
    if (cur == null) return false;
    cur = cur[k];
  }
  return !!cur;
}

function firedAt(state, id) {
  const f = state.fired || {};
  return f[id] != null;
}

/**
 * 今年到点、还没打过、前置也满足的那一条（按 order 小的先）。
 * 返回 `{ entry, event }`：event 是从事件表里取出来的原对象（还没展开模板）。
 */
function due(state) {
  const list = ofYear(state.clock.year)
    .filter((e) => e.event && !firedAt(state, e.event))
    .filter((e) => flagOn(state, e.ifFlag))
    .sort((a, b) => num(a.order) - num(b.order));
  if (!list.length) return null;
  const entry = list[0];
  const ev = (config.get('events') || []).find((x) => x.id === entry.event) || null;
  if (!ev) return null;
  return { entry, event: ev };
}

module.exports = { entries, ofYear, phaseFor, sync, due, flagOn, PHASE_CN };
