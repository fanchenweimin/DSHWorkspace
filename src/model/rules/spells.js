'use strict';

/**
 * 术法（需求/12 §2、设计/12 §1）。
 *
 * 熟练只有四档，而且**档位是有语义的**（用户口径 r32）：
 *
 *   入门  刚背下来，**战斗里用不出来**（手里有，嘴上会，打不出来）
 *   小成  术法的**最低使用要求**——从这一档起才能在战斗里放
 *   大成  术法的**最适合阶段**（威力吃满）
 *   圆满  术法的**最高适用阶段**（再练也没有更多了）
 *
 * 品阶（`tier` / `rank`）走「天地玄黄 × 上中下」：
 *   黄下 = 1 品 · 黄中 = 2 品 · 黄上 = 3 品 · 玄下 = 4 品 · 玄中 = 5 品 · 玄上 = 6 品
 *   地 / 天同理往上走。**品阶决定"这门术法厉不厉害"，熟练决定"你自己练到哪"**。
 *
 * 另外两样东西跟术法绑在一起，战斗里要用：
 *   `shield`  防御术法生成的护盾量（金刚罩这类）
 *   `dodge`   身法术法给的闪避（御风步这类）
 */

const config = require('../repository/config');

/** 熟练四档（0 = 入门） */
const LVL_NAME = ['入门', '小成', '大成', '圆满'];
/** 升到下一档要多少积累 */
const NEED = [60, 180, 420];
const MAX_LVL = 3;

/**
 * 品阶就是"品"（r33）：1 黄下 · 2 黄中 · 3 黄上 · 4 玄 · 5 地 · 6 天。
 * 阶（大境界）由施法者的手段层给：物理=1 锻体 / 法力=2 炼气 / 灵力=3 养灵 / 道=4 修心。
 */
const grade = require('./grade');

const GRADE = grade.PIN_NAME;

/** 手段层 → 阶 */
const MEANS_JIE = { physical: 1, mana: 2, spirit: 3, dao: 4 };

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function list() {
  return config.get('spells') || [];
}

function byId(id) {
  return list().find((s) => s.id === id) || null;
}

function ensure(state) {
  state.spells = state.spells || {};
  return state.spells;
}

function stateOf(state, id) {
  ensure(state);
  if (!state.spells[id]) state.spells[id] = { lvl: 0, exp: 0 };
  return state.spells[id];
}

function know(state, id) {
  return !!(state.spells && state.spells[id]);
}

/** 战斗里能不能放出来：入门不行，小成起才行 */
function usable(state, id) {
  if (!know(state, id)) return false;
  return num(state.spells[id].lvl) >= 1;
}

function lvlOf(state, id) {
  return know(state, id) ? num(state.spells[id].lvl) : 0;
}

/** 品阶数（品）：1..6 */
function rankOf(spell) {
  if (!spell) return 0;
  const r = num(spell.rank);
  if (r > 0) return grade.clampPin(r);
  const i = GRADE.indexOf(String(spell.tier || ''));
  return i >= 0 ? i + 1 : 1;
}

function gradeOf(spell) {
  return grade.pinName(rankOf(spell));
}

/** 这门术法"用什么阶"：由手段层定，不是由人最高的境界定 */
function jieOf(spell) {
  return MEANS_JIE[(spell && spell.means) || 'physical'] || 1;
}

/**
 * 熟练对**有效品**的偏移（用户口径 r33）：
 *   入门 放不出来（null）；小成 −1 品；大成 ±0；圆满 +1 品。
 * 所以「黄上（3 品）」在小成时是 **2 阶 2 品**，打 2 阶 3 品的人就只剩一成威力。
 */
const PIN_OFFSET = [null, -1, 0, 1];
function offsetOf(lvl) {
  const i = Math.min(PIN_OFFSET.length - 1, Math.max(0, num(lvl)));
  return PIN_OFFSET[i];
}

/** 这门术法此刻的"有效阶品"：{ jie, pin, lvl }；入门返回 null */
function effectiveOf(state, spell, lvlOverride) {
  if (!spell) return null;
  const lvl = lvlOverride != null ? num(lvlOverride) : lvlOf(state, spell.id);
  const off = offsetOf(lvl);
  if (off == null) return null;
  const base = grade.add(jieOf(spell), rankOf(spell), off);
  return { jie: base.jie, pin: base.pin, lvl };
}

/** 熟练带来的伤害系数：入门 0（放不出来）、小成 0.85、大成 1.0、圆满 1.15 */
const MULT = [0, 0.85, 1.0, 1.15];
function multOf(lvl) {
  return MULT[Math.min(MULT.length - 1, Math.max(0, num(lvl)))];
}

/** 练一季能攒多少：悟性为主、资质为辅（术法是"想明白"的事） */
function gainOf(state, months) {
  const mods = require('./mods');
  const apt = num(mods.get(state, 'attr.aptitude.eff'));
  const ins = num(mods.get(state, 'attr.insight.eff'));
  return (ins * 0.5 + apt * 0.3) * 0.2 * Math.max(0, months);
}

function needFor(lvl) {
  return NEED[Math.min(NEED.length - 1, Math.max(0, lvl))] || 0;
}

/**
 * 还要练几个月才升下一档（r34）。
 * 已经圆满返回 0；算不出（悟性太低）也返回 0，让调用方"用到年底"。
 */
function monthsToNext(state, id) {
  if (!know(state, id)) return 0;
  const s = state.spells[id];
  const lvl = num(s.lvl);
  if (lvl >= MAX_LVL) return 0;
  const gain = gainOf(state, 1);
  if (!(gain > 0)) return 0;
  const left = needFor(lvl) - num(s.exp);
  return Math.max(1, Math.ceil(left / gain));
}

/**
 * 这门术法此刻能从哪学（r35：学院 / 坊市 / 城主府 / 奇遇）。
 * 返回 { kind, label, cost, merit, ok, why }
 *   academy  在学的学堂教（蒙/府/太），免费；卒业或不在校就不行
 *   market   坊市买（书册），花钱；**只到黄上（rank ≤ 3）**
 *   office   城主府用军功换，得先有军职
 *   chance   奇遇事件，不可主动购买
 *
 * 顺序即优先级：学堂（免费）→ 坊市 → 城主府 → 奇遇。
 */
function sourceOf(state, sp) {
  const rules = config.get('rules') || {};
  const C = rules.CURRENCY || { copper: 100, silver: 100 };
  const src = sp.sources || { market: true };
  const edu = state.education || {};
  const stage = String(edu.stage || '');
  const rank = num(sp.rank);

  /* ① 学堂：只有在学（且没卒业）才教 */
  if (Array.isArray(src.academy)) {
    const inSchool = !edu.graduated && src.academy.indexOf(stage) >= 0;
    if (inSchool) {
      return { kind: 'academy', label: `${STAGE_CN[stage] || '学堂'}授`, cost: 0, merit: 0, ok: true, why: '' };
    }
  }

  /* ② 坊市：花钱买册子。
     **货架顶格是黄上（rank ≤ 3）**——玄以上不走坊市（需求/12 §2）。
     配置里若把玄级挂进 market，这里直接拒收，避免"散修买到玄阶"。 */
  const SHELF_MAX = num((rules.SPELL_SHELF || {}).max != null ? rules.SPELL_SHELF.max : 3);
  if (src.market && rank <= SHELF_MAX) {
    const pr = sp.price || {};
    const cost = num(pr.copper) + num(pr.silver) * num(C.copper) + num(pr.gold) * num(C.copper) * num(C.silver);
    const ok = mods().moneyTotal(state) >= cost;
    return {
      kind: 'market', label: `坊市 ${cost} 文`, cost, merit: 0,
      ok, why: ok ? '' : '钱不够'
    };
  }

  /* ③ 城主府：军功换（需求/12 §0.1.2：还要有军职） */
  if (src.office != null) {
    const merit = num(src.office);
    const has = num((state.merit || {}).war);
    const army = !!(state.flags && state.flags.office && state.flags.office.army);
    const ok = has >= merit && army;
    const why = !army ? '要先有军职'
      : (has >= merit ? '' : `军功不够（${has}/${merit}）`);
    return {
      kind: 'office', label: `城主府 · 军功 ${merit}`, cost: 0, merit, ok, why
    };
  }

  /* ④ 奇遇：只能靠事件给，不能主动学 */
  if (src.chance) {
    return {
      kind: 'chance', label: '奇遇得', cost: 0, merit: 0,
      ok: false, why: '要遇到才行'
    };
  }

  /* ⑤ 只有学堂能教、但你已卒业（或者还没到那个学籍） */
  if (Array.isArray(src.academy)) {
    return {
      kind: 'academy', label: '学堂授（已出学门）', cost: 0, merit: 0,
      ok: false, why: '这门只有学堂教，你已经不在学了'
    };
  }

  return { kind: '', label: '来路不明', cost: 0, merit: 0, ok: false, why: '不知道去哪学' };
}

const STAGE_CN = { meng: '蒙学', fu: '府学', tai: '太学' };

function mods() {
  return require('./mods');
}

/** 练一段：返回 { lvl, up, exp, atCap } */
function train(state, id, months) {
  const s = stateOf(state, id);
  if (s.lvl >= MAX_LVL) return { lvl: s.lvl, up: false, exp: s.exp, atCap: true };
  s.exp = num(s.exp) + gainOf(state, months);
  const before = s.lvl;
  while (s.lvl < MAX_LVL && s.exp >= needFor(s.lvl)) {
    s.exp -= needFor(s.lvl);
    s.lvl += 1;
  }
  if (s.lvl >= MAX_LVL) s.exp = 0;
  return { lvl: s.lvl, up: s.lvl > before, exp: s.exp, atCap: s.lvl >= MAX_LVL };
}

/**
 * 一门术法给战斗的攻击加成。
 * **入门（lvl 0）不给加成**——它还放不出来；小成起每档 × 品阶威力。
 */
function powerOf(state, id) {
  const art = byId(id);
  if (!art || !know(state, id)) return 0;
  const lvl = num(state.spells[id].lvl);
  if (lvl < 1) return 0;
  return num(art.power) * lvl;
}

/** 全部已学术法的战力合计 */
function totalPower(state) {
  let sum = 0;
  for (const s of list()) sum += powerOf(state, s.id);
  return sum;
}

/** 已学且能用的术法里，护盾最多的那一门给多少盾（防御术法） */
function shieldOf(state, id) {
  const art = byId(id);
  if (!art || !know(state, id)) return 0;
  if (num(state.spells[id].lvl) < 1) return 0;
  return num(art.shield) * num(state.spells[id].lvl);
}

/** 闪避：所有已学（能用的）身法术法的加成合计 */
function dodgeOf(state) {
  let sum = 0;
  for (const s of list()) {
    if (!num(s.dodge)) continue;
    if (!know(state, s.id)) continue;
    const lvl = num(state.spells[s.id].lvl);
    if (lvl < 1) continue;
    sum += num(s.dodge) * lvl;
  }
  return sum;
}

function lvlName(lvl) {
  return LVL_NAME[Math.min(LVL_NAME.length - 1, Math.max(0, num(lvl)))] || '入门';
}

/** 门槛检查：{ body: 1 } 这种 */
function reqOk(state, spell) {
  for (const [dao, need] of Object.entries(spell.req || {})) {
    if (num((state.path[dao] || {}).level) < num(need)) return false;
  }
  return true;
}

/** 给玩家看的一行 */
function publicList(state) {
  ensure(state);
  const DAO_CN = { body: '锻体', qi: '炼气', spirit: '养灵', heart: '修心' };
  const rules = config.get('rules') || {};
  const tiers = rules.TIERS || {};
  const C = rules.CURRENCY || { copper: 100, silver: 100 };

  return list().map((s) => {
    const known = know(state, s.id);
    const pr = s.price || {};
    const cost = num(pr.copper)
      + num(pr.silver) * num(C.copper)
      + num(pr.gold) * num(C.copper) * num(C.silver);
    const st = known ? stateOf(state, s.id) : { lvl: 0, exp: 0 };
    const lvl = num(st.lvl);

    let lockHint = '';
    for (const [dao, need] of Object.entries(s.req || {})) {
      if (num((state.path[dao] || {}).level) >= num(need)) continue;
      const tier = (tiers[dao] || [])[num(need) - 1] || `第 ${need} 品`;
      lockHint = `要先到${DAO_CN[dao] || dao}·${tier}`;
      break;
    }

    const eff = known ? effectiveOf({ spells: state.spells }, s, lvl) : null;
    const src = known ? { kind: '', label: '', cost: 0, merit: 0, ok: true, why: '' } : sourceOf(state, s);

    return {
      id: s.id,
      no: s.no,
      name: s.name,
      tier: gradeOf(s),
      rank: rankOf(s),
      jie: jieOf(s),
      pin: rankOf(s),
      effJie: eff ? eff.jie : null,
      effPin: eff ? eff.pin : null,
      effLabel: eff ? grade.short(eff.jie, eff.pin) : '',
      means: s.means || 'physical',
      form: s.kind === 'guard' ? 'guard' : 'attack',
      desc: s.desc || '',
      known,
      usable: known && lvl >= 1,
      lvl,
      lvlName: lvlName(lvl),
      exp: Math.round(num(st.exp) * 10) / 10,
      need: lvl >= MAX_LVL ? 0 : needFor(lvl),
      power: num(s.power),
      shield: num(s.shield),
      dodge: num(s.dodge),
      combat: powerOf(state, s.id),
      price: s.price || {},
      cost,
      source: src.kind,
      sourceLabel: src.label,
      sourceOk: src.ok,
      sourceWhy: src.why,
      meritCost: src.merit || 0,
      locked: !!lockHint,
      lockHint
    };
  });
}

module.exports = {
  LVL_NAME, NEED, MAX_LVL, GRADE, MULT, MEANS_JIE, PIN_OFFSET,
  list, byId, ensure, stateOf, know, usable, lvlOf, rankOf, gradeOf, jieOf, monthsToNext, sourceOf, STAGE_CN,
  offsetOf, effectiveOf, multOf,
  gainOf, needFor, train, powerOf, totalPower, shieldOf, dodgeOf,
  lvlName, reqOk, publicList
};
