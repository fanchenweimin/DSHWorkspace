'use strict';

/** 铜为本位：1 金 = 100 银 = 10000 铜 */
const GOLD = 10000;
const SILVER = 100;

function format(copper) {
  const value = Math.max(0, Math.round(Number(copper) || 0));
  const gold = Math.floor(value / GOLD);
  const silver = Math.floor((value % GOLD) / SILVER);
  const rest = value % SILVER;
  const parts = [];
  if (gold) parts.push(`${gold}金`);
  if (silver) parts.push(`${silver}银`);
  if (rest || !parts.length) parts.push(`${rest}铜`);
  return parts.join(' ');
}

/** 中文口语金额，用于事件文案 */
function short(copper) {
  const value = Math.max(0, Math.round(Number(copper) || 0));
  if (value >= GOLD) return `${trim(value / GOLD)}金`;
  if (value >= SILVER) return `${trim(value / SILVER)}银`;
  return `${value}铜`;
}

function trim(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

const gold = (n) => n * GOLD;
const silver = (n) => n * SILVER;

module.exports = { GOLD, SILVER, format, short, gold, silver };
