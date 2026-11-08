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

function pathState() {
  return { level: 0, bar: 0, attempts: 0, fail: 0, wall: {}, study: {} };
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
    clock: { age: 10, year: 309, month: 1 },
    lifespan: 72,
    zone: 'city',
    luck: roll.luck,
    attr: {
      aptitude: { base: roll.aptitude },
      insight: { base: roll.insight },
      heart: { base: roll.heart }
    },
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
    mods: [],
    pending: [],
    flags,
    war: { phase: 'peace' },
    spiritMass: { own: 0, city: 0 },
    turn: { breakthroughUsed: false },
    log: [
      '大曜历三〇九年，你十岁，在蒙学坐第三排。',
      roll.aptitude >= 75 ? '先生说你筋骨长得快，是块练武的料。'
        : roll.aptitude >= 55 ? '先生说你筋骨长得不算慢。'
          : '先生说你筋骨单薄，得多吃些。',
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
