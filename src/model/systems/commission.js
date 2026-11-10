'use strict';

/**
 * 委托（r39，需求/20 §7.4）。
 *
 * **它不是"一个按钮扣两个月给点钱"**，而是每门百艺的一条实战线：
 *   · 你的这门艺够不够（`reqLv`）
 *   · 你要接"杂活"还是"正活"（报酬与风险都不同）
 *   · 要不要出城（出城才掷路上事件）
 *
 * 字段见 `seed/commissions.json`。
 */

const config = require('../repository/config');
const arts = require('../rules/arts');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function list() {
  const c = config.get('commissions') || {};
  const arr = c['tbl.commissions'] || c.commissions || [];
  return Array.isArray(arr) ? arr : [];
}

/** 玩家这门艺到第几档（0 = 学徒 / 没学） */
function artLevel(state, artId) {
  const a = (state.arts || {})[artId];
  if (!a || !a.learned) return 0;
  return num(a.lvl);
}

/**
 * 当前能接哪些委托。
 *
 * 返回每一条带 `unlocked` / `lockedWhy`——**手艺不够的也要返回**，
 * 因为界面要"灰着写明原因"（r34 定的「门摆在明面上」），
 * 而不是藏起来让玩家不知道还有这门生意。
 */
function available(state) {
  return list().map((c) => {
    const lv = artLevel(state, c.art);
    const learned = lv > 0 || ((state.arts || {})[c.art] || {}).learned;
    const need = num(c.reqLv);

    let lockedWhy = '';
    if (!learned) lockedWhy = '这门手艺你还没学';
    else if (lv < need) lockedWhy = `手艺不够（要 ${need} 档）`;

    return {
      id: `com.${c.art}`,
      art: c.art,
      name: c.name,
      desc: c.desc || '',
      months: num(c.months) || 2,
      pay: num(c.pay),
      outing: !!c.outing,
      risk: num(c.risk),
      need,
      lv,
      unlocked: !lockedWhy,
      lockedWhy,
      /* 两种做法：杂活（0.4 倍、无风险）与正活（1.0 倍、掷风险） */
      odd: { pay: Math.round(num(c.pay) * 0.4), risk: 0 },
      main: { pay: Math.round(num(c.pay)), risk: num(c.risk) }
    };
  });
}

/** 只给"能接"的（界面主列表用） */
function unlocked(state) {
  return available(state).filter((c) => c.unlocked);
}

module.exports = { list, available, unlocked, artLevel };
