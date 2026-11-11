'use strict';

/**
 * 开局状态（业务层还没接存档，先用一份出生模板）。
 * 与 需求/15 §1 对齐：七岁入蒙学，这里从十岁那一年开始。
 *
 * 形状（设计/03 §2）：
 *   attr.*      .base 是底子，.eff 由 mods.resolve 现算（洗髓/药浴都在这层）
 *   path.*      level / bar / attempts / fail / wall{} / study{}
 *   arts.*      12 门百艺：{ lvl, exp, talent }
 *   mods[]      修饰器（永久 + 临时，靠 duration 区分）
 *   items{}     背包，键就是 `item.xxx`
 *   pending[]   排定的事件（chain 算子写入，到月才上桌）
 */

const DEFAULT_NAME = '沈砚';

/**
 * 一道的状态（r36）。
 *
 * **`level` 与 `lv` 是两件事**（需求/11 §1.3）：
 *   - `level` = **境界**，站到第几品。只有 `commitTier()` 能写，进品才变。
 *   - `lv`    = **层级**，这道门的关窍通到第几层。可能**超前于** `level`
 *               （事件先到、玩家还没点突破）。
 *
 * 所以「能突破但不突破」是合法状态：`lv >= level + 1` 而 `level` 没动。
 */
function pathState() {
  return {
    level: 0,        /* 境界（站在第几品） */
    lv: 0,           /* 层级（门通到第几层） */
    bar: 0,
    attempts: 0,
    fail: 0,
    wall: {},
    study: {}
  };
}

/**
 * 开局四属性（r34）：**每次开局都随机**。
 * 资质 / 悟性 / 心性各取两次 45..90 的平均（分布集中在 60 附近，极端值少见）；
 * 气运单独一段 30..80——它不吃"平均"，命就是命。
 */
function rollAttr(rng) {
  const mid = () => {
    const a = 45 + rng() * 45;
    const b = 45 + rng() * 45;
    return Math.round((a + b) / 2);
  };
  return {
    aptitude: mid(),
    insight: mid(),
    heart: mid(),
    luck: Math.round(30 + rng() * 50)
  };
}

/** 开局百艺天赋：无 75% / 下品 20% / 上品 4.5% / 绝品 0.5%（需求/13 §9.2） */
function rollTalent(rng) {
  const r = rng();
  if (r < 0.75) return 'none';
  if (r < 0.95) return 'low';
  if (r < 0.995) return 'high';
  return 'peak';
}

/**
 * 天生标签（r35 补，设计/01 §1）：命格 fate + 天赋 talents[]。
 *
 * `talents.json` 里 `fates` 是命格（一人一个），`talents` 是天生禀赋（一人 0–2 个）。
 * 命格改起点/上限，天赋是布尔型加成；两者都不进乘法（需求/01 §5）。
 */
function fateList() {
  try {
    const cfg = require('../repository/config');
    const t = cfg.get('talents') || {};
    return (t.fates || []).map((f) => f.id);
  } catch (e) { return []; }
}

function talentList() {
  try {
    const cfg = require('../repository/config');
    const t = cfg.get('talents') || {};
    return (t.talents || []).map((x) => x.id);
  } catch (e) { return []; }
}

function rollFate(rng) {
  const list = fateList();
  if (!list.length) return '';
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

/** 天赋：40% 一个都没有，45% 一个，15% 两个（占位权重，数值待重推） */
function rollTalents(rng) {
  const list = talentList();
  if (!list.length) return [];
  const r = rng();
  const n = r < 0.40 ? 0 : r < 0.85 ? 1 : 2;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const pick = list[Math.floor(rng() * list.length)];
    if (pick && out.indexOf(pick) < 0) out.push(pick);
  }
  return out;
}

/** 属性上限（需求/01 §2.1，r35）：单项 100、总量 200 */
function attrCaps() {
  try {
    const cfg = require('../repository/config');
    const C = (cfg.get('rules') || {}).ATTR_CAP || {};
    return { single: Number(C.single) || 100, hard: Number(C.hard) || 200 };
  } catch (e) {
    return { single: 100, hard: 200 };
  }
}

/**
 * 命格 + 天赋带来的修饰器（r35）。
 *
 * `talents.json` 每条都带一个 `mods[]`（`{target, op, value}`），
 * 这里把它们包成标准修饰器（`duration: permanent`、`source` 指向命格/天赋 id），
 * 于是**面板、判定、事件读取时全都自动生效**，不需要在业务代码里特判。
 */
function birthMods(fateId, talentIds) {
  const out = [];
  let cfg = {};
  try {
    cfg = require('../repository/config').get('talents') || {};
  } catch (e) { return out; }

  const push = (src, list) => {
    for (const m of (list || [])) {
      if (!m || !m.target) continue;
      out.push({
        target: m.target,
        op: m.op || 'add',
        value: m.value,
        duration: { kind: 'permanent' },
        source: src,
        stack: 'unique'
      });
    }
  };

  for (const f of (cfg.fates || [])) {
    if (f.id === fateId) push('fate.' + f.id, f.mods);
  }
  for (const t of (cfg.talents || [])) {
    if (talentIds.indexOf(t.id) >= 0) push('talent.' + t.id, t.mods);
  }
  return out;
}

function artIds() {
  /* 循环引用不碰：这里只读一次种子名字，读不到就用内置兜底 */
  try {
    const cfg = require('../repository/config');
    const list = cfg.get('arts') || [];
    if (list.length) return list.map((a) => a.id);
  } catch (e) { /* 配置还没就绪时走兜底 */ }
  return ['alchemy', 'forge', 'talisman', 'array', 'medicine', 'planting',
    'beast', 'puppet', 'feast', 'geomancy', 'appraise', 'brew'];
}

function initial(name, opts) {
  const rng = (opts && opts.rng) || Math.random;
  const nm = String(name == null ? '' : name).trim() || DEFAULT_NAME;

  const roll = rollAttr(rng);
  const talent = rollTalent(rng);
  const ids = artIds();
  const arts = {};
  for (const id of ids) arts[id] = { lvl: 0, exp: 0, talent: 'none', learned: false };

  /* 天生标签：命格（一人一个）+ 天赋（0–2 个），并把它们的修饰器带上（r35） */
  const fate = rollFate(rng);
  const talents = rollTalents(rng);
  const innateMods = birthMods(fate, talents);

  const flags = {};
  if (talent !== 'none') {
    /* 有天赋 = 小时候被家里送去做过学徒；没有就得靠「拜师学艺」事件 */
    const pick = ids[Math.floor(rng() * ids.length)] || 'alchemy';
    arts[pick].talent = talent;
    arts[pick].learned = true;          /* r30：有天赋的那门 = 已经学过 */
    flags.art = { master: true, main: pick, picked: true };
  }

  return {
    name: nm,
    /* r38：**七岁开局，刚入蒙学**（需求/15 §1）。开局年份 309，战争按年龄推（30 岁 = 332 年）。 */
    clock: { age: 7, year: 309, month: 1 },
    lifespan: 72,
    zone: 'city',
    luck: roll.luck,
    /* 天生标签（r35，设计/01 §1） */
    fate,
    talents,
    attr: {
      aptitude: { base: roll.aptitude },
      insight: { base: roll.insight },
      heart: { base: roll.heart }
    },
    /* 属性上限：单项封顶 + 总量封顶（需求/01 §2.1） */
    attrCaps: attrCaps(),
    reputation: { base: 8 },
    path: {
      body: pathState(),
      qi: pathState(),
      spirit: pathState(),
      heart: pathState()
    },
    arts,
    /* 术法：蒙学必教的罗汉拳（需求/12 §2 黄下） */
    spells: { 'spell.luohan': { lvl: 1, exp: 0 } },
    money: { copper: 260, silver: 0, gold: 0 },
    merit: { war: 0, craft: 0, office: 0 },
    education: { stage: 'meng', graduated: false },
    items: {},
    mods: innateMods,
    pending: [],
    flags,
    war: { phase: 'peace' },
    spiritMass: { own: 0, city: 0 },
    /* r44：**世界认可**——品 5 的一道门票（`需求/11` §1.2.2）。
       · recognized：拿到了没有（永久，除非灌顶作废）
       · awoken：哪个道把它"唤醒"了（事件 2 只有被唤醒才能出现）
       · fromVoidSoul：灌顶过的人永久失格 */
    recognition: { recognized: false, awoken: {}, fromVoidSoul: false },
    turn: { breakthroughUsed: false },
    log: [
      '大曜历三〇九年，你七岁，第一天进蒙学。',
      roll.aptitude >= 75 ? '先生让你站直了看，说你筋骨长得快，是块练武的料。'
        : roll.aptitude >= 55 ? '先生让你站直了看，说你筋骨长得不算慢。'
          : '先生让你站直了看，说你筋骨单薄，得多吃些。',
      roll.insight >= 75 ? '你背书过目不忘，先生很满意。'
        : roll.insight >= 55 ? '你背书不快也不慢。'
          : '你背书总要比别人多念三遍。',
      '北边的消息，今年还没传过来。'
    ],
    monthsUsed: 0,
    handled: []
  };
}

module.exports = { initial, pathState, rollAttr, DEFAULT_NAME };
