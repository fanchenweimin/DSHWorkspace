'use strict';

/**
 * 耗时（r33）：凡是"要花几个月"的事，都从这里出，**与属性成反比**。
 *
 *   months = base × ref / 你的属性分   （再按品阶 / 事情本身加权，最后取整并夹在 [min,max]）
 *
 * 为什么单独一件：以前突破、学艺、学法术的月数是写死的数字，属性再好也快不了，
 * 于是"资质/悟性"只在成功率上有用，在**时间**上完全没用。用户口径：
 * 「突破需要的时间与属性成反比」。
 *
 * 四类事各吃不同的属性（权重写在 `rules.TIME.weights`）：
 *   break  闭关破境   资质为主、悟性为辅（身子得撑得住）
 *   art    学一门手艺 悟性为主（手艺是"看会"的）
 *   spell  学一门术法 悟性为主
 *   season 百艺/法术练一季 不按属性缩，只按"一季"（但会被 `artFactor` 微调）
 */

const config = require('../repository/config');
const mods = require('./mods');

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function T() {
  return (config.get('rules') || {}).TIME || {};
}

const DEFAULT_W = {
  break: { aptitude: 0.6, insight: 0.4 },
  art: { aptitude: 0.3, insight: 0.7 },
  spell: { aptitude: 0.25, insight: 0.75 },
  season: { aptitude: 0.5, insight: 0.5 }
};

/** 属性分：按权重把资质 / 悟性 / 心性揉成一个数 */
function score(state, kind) {
  const w = ((T().weights || {})[kind]) || DEFAULT_W[kind] || DEFAULT_W.season;
  const apt = num(mods.get(state, 'attr.aptitude.eff'), 50);
  const ins = num(mods.get(state, 'attr.insight.eff'), 50);
  const heart = num(mods.get(state, 'attr.heart.eff'), 50);
  return w.aptitude * apt + w.insight * ins + num(w.heart) * heart;
}

/**
 * 通用：base 个月，按属性反比缩放。
 * @param {object} state
 * @param {string} kind  break / art / spell / season
 * @param {number} base  基准月数
 * @param {number} factor 事情本身的倍数（品阶越高越久）
 */
function months(state, kind, base, factor) {
  const t = T();
  const ref = num(t.ref, 60);
  const s = Math.max(1, score(state, kind));
  let m = num(base, 1) * num(factor, 1) * (ref / s);
  m = Math.round(m * 10) / 10;
  const lo = num(t.min, 1);
  const hi = num(t.max, 6);
  return Math.max(lo, Math.min(hi, Math.ceil(m - 0.001)));
}

/**
 * 闭关破境要几个月：品越高越久（`tierFactor` 每品 +15%），人越强越快。
 * 入门关（1 品）只有 base，不加品阶系数——"能不能开始"不该比"再进一步"还费时间。
 */
function breakMonths(state, dao, tier) {
  const t = T();
  const base = num(t.breakBase, 2);
  const per = num(t.tierFactor, 0.15);
  const lv = Math.max(1, num(tier, 1));
  const factor = lv <= 1 ? 1 : 1 + per * (lv - 1);
  return months(state, 'break', base, factor);
}

/** 学一门手艺 / 一门术法要几个月 */
function learnMonths(state, kind) {
  const t = T();
  const base = kind === 'spell' ? num(t.spellBase, 3) : num(t.learnBase, 3);
  return months(state, kind === 'spell' ? 'spell' : 'art', base, 1);
}

/** 百艺 / 法术"练一季"是几个月：一季就是三个月，不按人快慢 */
function seasonMonths(state) {
  const t = T();
  return Math.max(1, Math.round(num(t.season, 3)));
}

module.exports = { score, months, breakMonths, learnMonths, seasonMonths };
