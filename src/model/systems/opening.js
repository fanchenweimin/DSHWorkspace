'use strict';

/**
 * 开局：七岁入蒙学，到十岁这三年。
 *
 * r28 口径（用户口径 + `归档/境界系统总纲.md` §「修为总量的定义」）：
 *   **入第一品不是"攒满进度条"，而是一次瓶颈判定。**
 *     · 没墙 → 直接站在体魄（level 1）；
 *     · 有墙 → 停在门口（level 0），当年只剩这一关。
 *   所以 level 0 **没有修为条**，界面上也就不该出现"未入门 + 进度条"那一格。
 *
 *   修为条从第 1 品才开始有：站在体魄练满 140，才有资格破脏腑（`PROF[0]`）。
 *
 * 这里只改开局那一瞬，不参与回合结算。
 */

const realm = require('../rules/realm');

const START_AGE = 10;

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
  p.bar = 0;

  const q = realm.appearRate(state, 'body', 1, rules);

  if (q > 0 && rng() < q) {
    p.wall[1] = true;
    state.lifespan = realm.lifespanOf(state, rules);
    state.log.push('你今年十岁。筋骨还没练开——体魄这一关，得你自己过。');
    return { entered: false, q, bar: 0 };
  }

  p.level = 1;
  p.wall[1] = false;

  /* 三年蒙学不是白坐的：先给不到半条内力，剩下的自己练 */
  const cap = ((rules.PROF || {}).body || [])[0] || 0;
  p.bar = Math.round(cap * 0.45);

  state.lifespan = realm.lifespanOf(state, rules);
  state.log.push(`你今年十岁，已经站在体魄上（${Math.round(p.bar)} / ${cap}）。`);
  return { entered: true, q, bar: p.bar };
}

module.exports = { apply, START_AGE };
