'use strict';

/**
 * 阶 / 品（r33）。
 *
 * 这个世界只用一个刻度说话：
 *   **阶** = 大境界：1 锻体 · 2 炼气 · 3 养灵 · 4 修心
 *   **品** = 小境界：1..6，名字就是"天地玄黄"那一套
 *
 *     1 黄下 · 2 黄中 · 3 黄上 · 4 玄 · 5 地 · 6 天
 *
 * 所以「2 阶 1 品」= 2 阶黄下，「黄上」= 3 品——**品阶名字不是另一套数字，它就是品**。
 *
 * ── 影响等级（用户口径 r33）───────────────────────────────
 *
 * 「在一二三阶的 4 品（含）内，高一阶的能影响低一阶高一品的」：
 *
 *     L = 阶 + 品        （只在品 ≤ 4 时成立）
 *
 *     3 阶 2 品（L=5）→ 够得着 2 阶 3 品（L=5）、1 阶 4 品（L=5）
 *     2 阶 2 品（L=4）→ 够不着 2 阶 3 品（L=5），威力只剩一成
 *
 * 品 5 / 6（地 / 天）之后不再做这个换算：只能同阶比品。
 *
 * 这个等级同时被三处用：
 *   法术：品阶 + 熟练 → 有效品；对不上对手的阶品就打不动
 *   百艺：练到哪一档 = 几阶几品；做出来的东西比人低一品
 *   战斗：压制档仍看大境界（`battle.suppressMul`），这里只管"术法够不够得着"
 */

/** 品 → 名字（1..6） */
const PIN_NAME = ['黄下', '黄中', '黄上', '玄', '地', '天'];
/** 阶 → 中文数字（1..4） */
const JIE_NAME = ['', '一', '二', '三', '四'];

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clampPin(p) {
  return Math.max(1, Math.min(PIN_NAME.length, Math.round(num(p, 1))));
}

function pinName(pin) {
  return PIN_NAME[clampPin(pin) - 1];
}

function jieName(jie) {
  return JIE_NAME[Math.max(1, Math.min(JIE_NAME.length - 1, Math.round(num(jie, 1))))] || String(jie);
}

/**
 * 「2 阶 · 黄上（3 品）」
 * 用户口径 r34：**光写"黄上"看不出是几阶**，阶必须写在前面——
 * 同样是黄上，1 阶和 2 阶差着一整个大境界。
 */
function label(jie, pin) {
  const j = Math.max(1, Math.round(num(jie, 1)));
  const p = clampPin(pin);
  return `${j} 阶 · ${pinName(p)}（${p} 品）`;
}

/** 短标签「2 阶 · 黄上」——凡是给玩家看的阶品，都用这个 */
function short(jie, pin) {
  return `${Math.max(1, Math.round(num(jie, 1)))} 阶 · ${pinName(pin)}`;
}

/**
 * **物品**的写法：「2 阶黄上级」（r39，需求/11 §2.9.0）。
 *
 * 人和物用两套写法：
 *   人 → `2 阶 3 品`（`short`）
 *   物 → `2 阶黄上级`（这个函数）
 *
 * 因为物品没有"站在第几品"，它只有"给哪个境界用的"。
 * 数值上两者是同一把尺子（黄下1…天6），只是叫法不同。
 */
function itemLabel(jie, pin) {
  const j = Math.max(1, Math.round(num(jie, 1)));
  return `${j} 阶${pinName(pin)}级`;
}

/**
 * 这件物品对这个人还有没有用（r39，需求/11 §2.9.0.1）。
 *
 *   userJie > itemJie          → 完全无效（**跨大阶一律无效，没有例外**）
 *   userJie < itemJie          → 满效果（新手用高阶货）
 *   同阶：userPin <= itemPin   → 满效果
 *   同阶：userPin == itemPin+1 → 打折（默认 0.1）
 *   同阶：userPin >= itemPin+2 → 无效
 *
 * @returns {{usable:boolean, mul:number, why:string}}
 */
function itemFit(userJie, userPin, itemJie, itemPin, discount) {
  const d = discount == null ? 0.1 : num(discount, 0.1);
  const uj = Math.max(1, Math.round(num(userJie, 1)));
  const ij = Math.max(1, Math.round(num(itemJie, 1)));
  const up = clampPin(userPin);
  const ip = clampPin(itemPin);

  if (uj > ij) return { usable: false, mul: 0, why: 'cross_tier' };
  if (uj < ij) return { usable: true, mul: 1, why: 'ok' };

  if (up <= ip) return { usable: true, mul: 1, why: 'ok' };
  if (up === ip + 1) return { usable: true, mul: d, why: 'diluted' };
  return { usable: false, mul: 0, why: 'out_of_range' };
}

/**
 * 前进 / 后退若干品，满 6 品进一阶，掉到 0 品退一阶。
 * 用来算"练了几档"和"做出来的东西低一品"。
 */
function add(jie, pin, steps) {
  let j = Math.max(1, Math.round(num(jie, 1)));
  let p = clampPin(pin) + Math.round(num(steps));
  while (p > PIN_NAME.length) { p -= PIN_NAME.length; j += 1; }
  while (p < 1) { p += PIN_NAME.length; j -= 1; }
  if (j < 1) { j = 1; p = 1; }
  return { jie: j, pin: p };
}

/** 影响等级 L（品 ≤ 4 才是"阶+品"的可换算区） */
function level(jie, pin) {
  return Math.max(1, Math.round(num(jie, 1))) + clampPin(pin);
}

/**
 * 够不够得着：返回伤害系数。
 *   够得着 → 1；差一级 → 0.1（威力只剩一成，用户口径"减少 90%"）。
 * 品 5 / 6 不进 L 的换算，只能同阶比品。
 */
function reach(srcJie, srcPin, dstJie, dstPin) {
  const sj = Math.max(1, Math.round(num(srcJie, 1)));
  const dj = Math.max(1, Math.round(num(dstJie, 1)));
  const sp = clampPin(srcPin);
  const dp = clampPin(dstPin);

  if (sp <= 4 && dp <= 4) {
    return (sj + sp) >= (dj + dp) ? 1 : 0.1;
  }
  if (sj > dj) return 1;
  if (sj === dj && sp >= dp) return 1;
  return 0.1;
}

/** 够不够得着（布尔版，给界面判断"这门术法对他有没有用"） */
function canReach(srcJie, srcPin, dstJie, dstPin) {
  return reach(srcJie, srcPin, dstJie, dstPin) > 0.5;
}

module.exports = {
  PIN_NAME, JIE_NAME,
  pinName, jieName, label, short, itemLabel, add, level, reach, canReach, itemFit, clampPin
};
