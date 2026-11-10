'use strict';

/**
 * 开局：**七岁，刚入蒙学**（r38）。
 *
 * 旧口径（r28–r37）是"十岁开局，蒙学已经坐了三年"，所以开局白送 45% 内力。
 * r38 改成从 7 岁开始，**那三年还没过**，所以：
 *   · 锻体**永远是 0 品起步**（筋骨没练开是常态）；
 *   · **不白送任何修为**——第一年的"打熬筋骨"才是玩家练的第一份内力。
 *
 * 体魄这一关（`appearRate('body', 1)`）仍然在开局判一次：
 *   · 没墙 → 天赋好，直接就站在体魄上（level 1，lv 1，bar 0）
 *   · 有墙 → 停在门口（level 0），要先冲过去
 *
 * 这里只改开局那一瞬，不参与回合结算。
 */

const realm = require('../rules/realm');

const START_AGE = 7;      /* r38：七岁入蒙学 */

/**
 * @param {object} state  demo.initial() 的产物
 * @param {{rules?:object, rng?:Function}} opts
 * @returns {{entered:boolean, q:number, bar:number}}
 */
function apply(state, opts) {
  const o = opts || {};
  const rules = o.rules || require('../repository/config').get('rules');
  const rng = o.rng || Math.random;

  const p = state.path.body;
  p.wall = p.wall || {};
  p.study = p.study || {};
  p.level = 0;
  p.lv = 0;
  p.bar = 0;

  const q = realm.appearRate(state, 'body', 1, rules);

  if (q > 0 && rng() < q) {
    p.wall[1] = true;
    state.lifespan = realm.lifespanOf(state, rules);
    state.log.push('你今年七岁，第一天进蒙学。先生让你站直了看——你的筋骨还没练开。');
    return { entered: false, q, bar: 0 };
  }

  /* 没墙：天生筋骨就开（r36：境界与层级一起写；r38：不给白送的修为） */
  p.level = 1;
  p.lv = 1;
  p.wall[1] = false;
  p.bar = 0;

  state.lifespan = realm.lifespanOf(state, rules);
  state.log.push('你今年七岁，第一天进蒙学。先生说你筋骨已经开了——体魄这一关，你跳过去了。');
  return { entered: true, q, bar: 0 };
}

module.exports = { apply, START_AGE };
