'use strict';

/**
 * 百艺规则（需求/13 §11.0）。
 *
 *  基数     = 资质 × w资 + 悟性 × w悟        （每门艺的权重不同，写在 arts.json）
 *  积累     += 基数 × monthCoef / 月
 *  一档     exp1 = 120；二档 exp2 = 600；三档 exp3 = 1800
 *  档次     按"阶 + 品"报：1 阶 1 品 / 1 阶 2 品 / 1 阶 3 品 / 2 阶 1 品 …
 *  上限     由天赋决定：无 1 档（1 阶 1 品）/ 下品 2 / 上品 3 / 绝品 4（2 阶 1 品）
 *
 * 这里只管"算"，不写状态、不写纪事——那是 systems/turn.js 的事。
 */

const config = require('../repository/config');
const mods = require('./mods');
const grade = require('./grade');

const TALENT_RANK = { none: 0, low: 1, high: 2, peak: 3 };
const TALENT_CN = { none: '无', low: '下品', high: '上品', peak: '绝品' };

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function list() {
  return config.get('arts') || [];
}

function byId(id) {
  return list().find((a) => a.id === id) || null;
}

/** 12 门都补齐，免得 `arts.alchemy.talent` 这种路径写不进去 */
function ensure(state) {
  state.arts = state.arts || {};
  for (const a of list()) {
    if (!state.arts[a.id]) state.arts[a.id] = { lvl: 0, exp: 0, talent: 'none', learned: false };
    else if (state.arts[a.id].learned === undefined) state.arts[a.id].learned = false;
  }
  return state.arts;
}

function stateOf(state, id) {
  ensure(state);
  return state.arts[id] || (state.arts[id] = { lvl: 0, exp: 0, talent: 'none', learned: false });
}

/** 学没学过（r30：没学过的不给练，只能先花钱求学） */
function learned(state, id) {
  ensure(state);
  return !!state.arts[id].learned;
}

/** 已经学了几门（第一门免费，后面的要交学费） */
function learnedCount(state) {
  ensure(state);
  return list().filter((a) => state.arts[a.id].learned).length;
}

function talentOf(state, id) {
  return stateOf(state, id).talent || 'none';
}

function talentRank(state, id) {
  return TALENT_RANK[talentOf(state, id)] || 0;
}

/** 百艺基数：资质与悟性加权 */
function baseRate(state, art) {
  const apt = mods.get(state, 'attr.aptitude.eff');
  const ins = mods.get(state, 'attr.insight.eff');
  return num(art.wApt) * apt + num(art.wIns) * ins;
}

/** 天赋上限（阶）：无天赋停在 1 阶，绝品到 4 阶 */
function capOf(state, artId) {
  const A = (config.get('rules') || {}).ARTS || {};
  const rank = talentRank(state, artId);
  if (rank === 0) return num(A.noArtTalent != null ? A.noArtTalent : 1);
  if (rank === 1) return num(A.lowTalent != null ? A.lowTalent : 2);
  if (rank === 2) return num(A.highTalent != null ? A.highTalent : 3);
  return num(A.peakTalent != null ? A.peakTalent : 4);
}

/** 升到下一阶要多少经验 */
function needFor(lvl) {
  const A = (config.get('rules') || {}).ARTS || {};
  if (lvl <= 0) return num(A.exp1 != null ? A.exp1 : 120);
  if (lvl === 1) return num(A.exp2 != null ? A.exp2 : 600);
  if (lvl === 2) return num(A.exp3 != null ? A.exp3 : 1800);
  return num(A.exp3 != null ? A.exp3 : 1800);
}

/**
 * 百艺的档次按**阶 + 品**说，而且**起点就是这个门艺的入门阶**（用户口径 r33）：
 *   `req: { body: 1 }`（锻体·体魄）→ 从 1 阶 1 品起
 *   `req: { qi: 2 }`（炼气·破胎）  → 从 **2 阶 2 品**起，**没有 2 阶 1 品**
 * 之后每练一档 +1 品（满 6 品进一阶）。
 *
 * 练出来的**东西**比人低一品：符箓师 2 阶 2 品 → 出 2 阶 1 品（2 阶黄下）的符。
 */
const DAO_JIE = { body: 1, qi: 2, spirit: 3, heart: 4 };

function startOf(art) {
  const req = (art && art.req) || {};
  for (const [dao, lv] of Object.entries(req)) {
    return { jie: DAO_JIE[dao] || 1, pin: Math.max(1, num(lv)) };
  }
  return { jie: 1, pin: 1 };
}

/** 练到某一档时的阶品（不看状态，只看门艺的起点与档位） */
function jiePin(art, lvl) {
  const st = startOf(art);
  const n = Math.round(num(lvl));
  if (n < 1) return { jie: st.jie, pin: st.pin };
  return grade.add(st.jie, st.pin, n - 1);
}

/** 练出来的东西的阶品：比人低一品 */
function productOf(art, lvl) {
  const j = jiePin(art, lvl);
  return grade.add(j.jie, j.pin, -1);
}

function levelName(art, lvl) {
  const n = Math.round(num(lvl));
  if (n < 1) return '学徒';
  const j = jiePin(art, n);
  return grade.short(j.jie, j.pin);
}

function levelFull(art, lvl) {
  const n = Math.round(num(lvl));
  if (n < 1) return '学徒（还没出东西）';
  const j = jiePin(art, n);
  return grade.label(j.jie, j.pin);
}

/** 月入（铜）：`income[lvl]` */
function incomeOf(art, lvl) {
  const arr = art.income || [];
  const v = arr[Math.min(arr.length - 1, Math.max(0, lvl))];
  return num(v);
}

function repOf(art, lvl) {
  const arr = art.repGain || [];
  if (!arr.length) return 0;
  return num(arr[Math.min(arr.length - 1, Math.max(0, lvl))]);
}

/**
 * 修一个月。
 * 返回 { exp, lvl, up, income, rep, blocked }，**不改状态**。
 * `blocked` = 已到天赋上限，再练也不涨（但还能赚钱，只是赚得慢）。
 */
function month(state, artId) {
  const art = byId(artId);
  if (!art) return { blocked: true, exp: 0, income: 0, rep: 0, lvl: 0, up: false };

  const s = stateOf(state, artId);
  const A = (config.get('rules') || {}).ARTS || {};
  const cap = capOf(state, artId);
  const coef = num(A.monthCoef != null ? A.monthCoef : 0.2);

  const exp = baseRate(state, art) * coef;
  const atCap = s.lvl >= cap;
  return {
    exp: atCap ? 0 : exp,
    income: Math.round(incomeOf(art, s.lvl)),
    rep: repOf(art, s.lvl),
    lvl: s.lvl,
    cap,
    blocked: atCap,
    up: false
  };
}

/**
 * 把一次修炼的结果落进状态（唯一写入点）。
 * @returns {{ lvl:number, up:boolean, exp:number, atCap:boolean }}
 */
function applyMonth(state, artId, months) {
  const art = byId(artId);
  const s = stateOf(state, artId);
  const cap = capOf(state, artId);
  const A = (config.get('rules') || {}).ARTS || {};
  const coef = num(A.monthCoef != null ? A.monthCoef : 0.2);
  const gain = baseRate(state, art) * coef * Math.max(0, months);

  const before = s.lvl;
  if (s.lvl < cap) {
    s.exp = num(s.exp) + gain;
    while (s.lvl < cap && s.exp >= needFor(s.lvl)) {
      s.exp -= needFor(s.lvl);
      s.lvl += 1;
    }
    if (s.lvl >= cap) s.exp = 0;
  }
  /* r34：升一档就出一件成品（产物比人低一品，见 productOf） */
  const made = s.lvl > before ? (s.lvl - before) : 0;
  return { lvl: s.lvl, up: s.lvl > before, exp: s.exp, cap, atCap: s.lvl >= cap, made };
}

/** 还要做几个月才升下一档（r34）；到天赋上限返回 0 */
function monthsToNext(state, artId) {
  const art = byId(artId);
  if (!art) return 0;
  const s = stateOf(state, artId);
  const cap = capOf(state, artId);
  if (s.lvl >= cap) return 0;
  const A = (config.get('rules') || {}).ARTS || {};
  const coef = num(A.monthCoef != null ? A.monthCoef : 0.2);
  const gain = baseRate(state, art) * coef;
  if (!(gain > 0)) return 0;
  return Math.max(1, Math.ceil((needFor(s.lvl) - num(s.exp)) / gain));
}

/** 给玩家看的百艺一行：只给名字、阶、进度，不给权重 */
function publicList(state) {
  ensure(state);
  const rules = config.get('rules') || {};
  const tiers = rules.TIERS || {};
  const DAO_CN = { body: '锻体', qi: '炼气', spirit: '养灵', heart: '修心' };

  return list().map((a) => {
    const s = state.arts[a.id];
    const need = s.lvl >= capOf(state, a.id) ? 0 : needFor(s.lvl);

    /* 门槛：`req: { qi: 2 }` = 炼气要到第二品。没过的门不能练（r28） */
    let locked = false;
    let lockHint = '';
    for (const [dao, lv] of Object.entries(a.req || {})) {
      const have = num((state.path[dao] || {}).level);
      if (have >= num(lv)) continue;
      locked = true;
      const tierName = (tiers[dao] || [])[num(lv) - 1] || `第 ${lv} 品`;
      lockHint = `要先到${DAO_CN[dao] || dao}·${tierName}。`;
      break;
    }

    return {
      id: a.id,
      no: a.no,
      name: a.name,
      sub: a.sub,
      learned: !!s.learned,
      lvl: s.lvl,
      lvlName: levelName(a, s.lvl),
      lvlFull: levelFull(a, s.lvl),
      product: s.lvl < 1 ? '' : grade.short(productOf(a, s.lvl).jie, productOf(a, s.lvl).pin),
      talent: TALENT_CN[s.talent] || '无',
      exp: Math.round(num(s.exp) * 10) / 10,
      need,
      cap: capOf(state, a.id),
      income: incomeOf(a, s.lvl),
      req: a.req || {},
      locked,
      lockHint,
      blocked: s.lvl >= capOf(state, a.id)
    };
  });
}

module.exports = {
  jiePin, startOf, productOf, levelFull,
  TALENT_RANK, TALENT_CN, list, byId, ensure, stateOf, learned, learnedCount,
  talentOf, talentRank,
  baseRate, capOf, needFor, monthsToNext, levelName, incomeOf, repOf, month, applyMonth, publicList
};
