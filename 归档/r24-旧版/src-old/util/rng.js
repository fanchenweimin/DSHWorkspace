'use strict';

/* 确定性/可注入随机源。测试可替换。 */

let source = Math.random;

function setSource(fn) {
  source = typeof fn === 'function' ? fn : Math.random;
}

function next() {
  return source();
}

function int(min, max) {
  return Math.floor(next() * (max - min + 1)) + min;
}

function pick(list) {
  if (!list || !list.length) return null;
  return list[Math.floor(next() * list.length)];
}

/** 百分比判定：chance 为 0-100 */
function roll(chance) {
  return next() * 100 < clamp(chance, 0, 100);
}

/** 0.001% 这类极低概率直接用原始值判定，避免被 clamp 成 0 */
function rollRaw(chance) {
  return next() * 100 < chance;
}

function range(min, max) {
  return min + next() * (max - min);
}

function weightPick(items, weightOf) {
  const total = items.reduce((sum, item) => sum + Math.max(0, weightOf(item)), 0);
  if (total <= 0) return pick(items);
  let ticket = next() * total;
  for (const item of items) {
    ticket -= Math.max(0, weightOf(item));
    if (ticket <= 0) return item;
  }
  return items[items.length - 1];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

module.exports = { setSource, next, int, pick, roll, rollRaw, range, weightPick, clamp };
