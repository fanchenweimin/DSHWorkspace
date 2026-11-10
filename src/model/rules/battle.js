'use strict';

/**
 * 战斗（设计/30）。
 *
 * 三层，顺序不可倒：
 *   ① 手段层（物理 / 法力 / 灵力 / 道）—— 看"解锁到哪一步"，不看最高境界
 *   ② 压制档（全压制 / 可对抗 / 镜像）—— 攻方看大境界，防方看小境界
 *   ③ 资源对拼（骰子只在这里出现）—— 三根血条：血 / 精神 / 神志
 *
 * 数值全部查表（`rules.BATTLE.tables` = 设计/30 §4.3 基准表）。
 *
 * ── r32 改掉的三件事 ─────────────────────────────────────
 *
 * ① **法力 ≠ 法力盾**。
 *    法力是"放法术的油"——施法扣、每回合回一点，所以炼气修士不会打两下就开始肉搏。
 *    法力盾是"挡刀的那一层"——**只能由法器或防御术法生成**，没练过防御术法就没有盾。
 *    以前把两件事合成一个池子，于是"有法力=有盾"，锻体永远打不穿。
 *
 * ② **闪避**。被打中之前先掷闪避，闪开了这一下**全部伤害归零**（三段的灵术也一样）。
 *    渠道：基础 + 身法术法（御风步 / 游龙步）+ 器物。道伤不看闪避（心念躲不开）。
 *
 * ③ **招式带品阶与熟练**。术法只有小成以上才放得出来（入门不算），
 *    大成是"最适合阶段"、圆满是"最高适用阶段"，伤害系数写在 `spells.multOf`。
 *
 * 两级战斗（需求/30 §7.0）：`spar` 切磋走 10% 危险线、不死不掷伤；`death` 死斗会死人。
 * 输出是 `frames[]`（逐帧），前端拿它把血条一跳一跳地放。
 */

const config = require('../repository/config');
const mods = require('./mods');
const spells = require('./spells');
const grade = require('./grade');

const DAO_CN = { body: '锻体', qi: '炼气', spirit: '养灵', heart: '修心' };

/** 没有对应术法时，用什么动作打 */
const DEFAULT_MOVE = {
  physical: '拳脚', mana: '法术', spirit: '灵压', dao: '道意'
};
const ENEMY_MOVE = {
  physical: '刀', mana: '法诀', spirit: '灵压', dao: '道意'
};

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function B() {
  return (config.get('rules') || {}).BATTLE || {};
}

function T() {
  return B().tables || {};
}

/** 查表：索引 0 = 未入品，1..6 = 品 1..6 */
function at(name, i) {
  const a = T()[name];
  if (!Array.isArray(a) || !a.length) return 0;
  const k = Math.max(0, Math.min(a.length - 1, Math.round(num(i))));
  return num(a[k]);
}

/* ── 器物被动（背包里放着就有用，不用"装备"这一步） ── */

function gearOf(state, target) {
  const items = config.get('items') || [];
  const bag = state.items || {};
  let add = 0;
  let mul = 1;
  for (const it of items) {
    if (!bag[it.id]) continue;
    for (const m of it.mods || []) {
      if (m.target !== target) continue;
      if (m.op === 'add') add += num(m.value);
      if (m.op === 'mul') mul *= num(m.value) || 1;
    }
  }
  return { add, mul };
}

/* ── 境界 → 手段 / 压制资格 ───────────────────────────── */

function levelsOf(state) {
  const p = state.path || {};
  return {
    body: num(p.body && p.body.level),
    qi: num(p.qi && p.qi.level),
    spirit: num(p.spirit && p.spirit.level),
    heart: num(p.heart && p.heart.level)
  };
}

/** 手段层：解锁到哪一步就是哪一层（设计/30 §2.1） */
function meansOf(lv) {
  if (lv.heart >= 1) return 'dao';
  if (lv.spirit >= 2) return 'spirit';
  if (lv.qi >= 2) return 'mana';
  return 'physical';
}

/**
 * 压制资格看大境界，但**感气还不算**：需求/30 §3.4「凡人三境（体魄 / 脏腑 / 感气）没有压制资格」。
 * 开视（养灵 1 品）例外——它放不出灵力，但压得住炼气（§3.4 之一）。
 */
function rankOf(lv) {
  if (lv.heart >= 1) return 4;
  if (lv.spirit >= 1) return 3;
  if (lv.qi >= 2) return 2;      /* 破胎才算炼气那一层 */
  if (lv.body >= 1) return 1;
  return 0;
}

/**
 * 会哪几手：只收"手段层对得上"**且已经练到小成以上**的术法。
 * 入门的还放不出来（用户口径 r32），所以不进招式表。
 */
function movesFor(state, means) {
  const out = [];
  for (const s of spells.list()) {
    if ((s.means || 'physical') !== means) continue;
    if (!spells.usable(state, s.id)) continue;
    const lvl = spells.lvlOf(state, s.id);
    const eff = spells.effectiveOf(state, s, lvl);
    out.push({
      name: s.name,
      grade: spells.gradeOf(s),
      rank: spells.rankOf(s),
      /* 有效阶品：黄上 小成 = 2 阶 2 品（打不动 2 阶 3 品） */
      jie: eff ? eff.jie : spells.jieOf(s),
      pin: eff ? eff.pin : spells.rankOf(s),
      kind: s.kind === 'guard' ? 'guard' : 'attack',
      power: num(s.power),
      shield: num(s.shield),
      lvl,
      mult: spells.multOf(lvl)
    });
  }
  if (!out.length) {
    out.push({
      name: DEFAULT_MOVE[means], grade: '', rank: 0,
      jie: spells.MEANS_JIE[means] || 1, pin: 1,
      kind: 'attack', power: 0, shield: 0, lvl: 0, mult: 1
    });
  }
  return out;
}

/**
 * 玩家的战斗面板。
 * 血 / 攻 / 防 ← 锻体；法力 ← 炼气；灵力 / 精神 ← 养灵；神志 ← 自身心性 ×1。
 * **法力盾只从法器与防御术法来**，不是有法力就有盾。
 */
/**
 * 修为条进度（0..1）：站在这一品上练了多少。
 * 战斗数值按它往下一品插一点——"练到一半"的人，比刚进品的人结实一点。
 */
function progOf(state, dao, lvl) {
  const prof = ((config.get('rules') || {}).PROF || {})[dao] || [];
  if (num(lvl) < 1 || prof[num(lvl) - 1] == null) return 0;
  const cap = num(prof[num(lvl) - 1]);
  const bar = num((state.path[dao] || {}).bar);
  if (!(cap > 0)) return 0;
  return Math.max(0, Math.min(1, bar / cap));
}

/** 查表 + 进度插值：table[n] → table[n+1] 之间走 weight×progress */
function grow(name, lvl, prog, weight) {
  const a = at(name, lvl);
  const b = at(name, num(lvl) + 1);
  const w = num(weight, 0.15) * num(prog);
  return a + (b - a) * w;
}

function stats(state, side) {
  const lv = levelsOf(state);
  const atkGear = gearOf(state, 'battle.atk');
  const shieldGear = gearOf(state, 'battle.shield');
  const dodgeGear = gearOf(state, 'battle.dodge');
  const means = meansOf(lv);

  const spellPower = side === 'enemy' ? 0 : spells.totalPower(state);

  /* 法器自带的护盾（常驻），加上"练过的防御术法最高能给多少"当上限 */
  const shieldBase = shieldGear.add * shieldGear.mul;
  let guardCap = 0;
  if (side !== 'enemy') {
    for (const s of spells.list()) {
      if (s.kind !== 'guard') continue;
      guardCap = Math.max(guardCap, spells.shieldOf(state, s.id));
    }
  }
  const shieldMax = shieldBase + guardCap;

  const pBody = progOf(state, 'body', lv.body);
  const pQi = progOf(state, 'qi', lv.qi);
  const pSpirit = progOf(state, 'spirit', lv.spirit);

  const hpMax = grow('hp', lv.body, pBody, 0.15);
  const manaMax = grow('mana', lv.qi, pQi, 0.15);
  const spiritMax = grow('spirit', lv.spirit, pSpirit, 0.15);
  const mindMax = grow('mind', lv.spirit, pSpirit, 0.15);
  const heartV = num(mods.get(state, 'attr.heart.eff'), 30);

  const dodge = Math.min(0.45, Math.max(0,
    num(B().dodgeBase, 0.04)
    + (side === 'enemy' ? 0 : spells.dodgeOf(state))
    + dodgeGear.add
  ));

  return {
    side: side || 'player',
    name: '你',
    rank: rankOf(lv),
    tier: Math.max(lv.body, lv.qi, lv.spirit, lv.heart),
    means,
    hp: hpMax, hpMax,
    mana: manaMax, manaMax,
    spirit: spiritMax, spiritMax,
    mind: mindMax, mindMax,
    will: Math.max(1, heartV), willMax: Math.max(1, heartV),
    /* 开打之前先把盾结起来：练过防御术法 / 带着法器的人，进场就是满盾 */
    shield: shieldMax, shieldMax,
    atk: (grow('atk', lv.body, pBody, 0.15) + atkGear.add + spellPower * 0.5) * atkGear.mul,
    def: grow('def', lv.body, pBody, 0.15) * atkGear.mul,
    dodge,
    moves: movesFor(state, means)
  };
}

/**
 * 对手怎么造：按 scale 推"品"，再用同一张表算面板。
 * 越一大境界的对手会拿到那一层的家底（破胎才有法力）。
 */
function profileOf(me, params) {
  const scale = num(params && params.scale, 1);
  let rank = Math.max(1, me.rank || 1);
  let tier = Math.max(1, me.tier || 1);

  if (scale < 0.7) { rank = 1; tier = Math.max(1, tier - 2); }
  else if (scale < 0.95) { tier = Math.max(1, tier - 1); }
  else if (scale < 1.45) { /* 同辈：原样，强不强看 adj */ }
  else if (scale < 1.8) { tier = Math.min(6, tier + 1); }
  else {
    rank = Math.min(4, rank + 1);
    tier = Math.max(2, Math.min(6, tier));
  }

  return { rank, tier, scale };
}

function makeEnemy(me, params) {
  const p = profileOf(me, params);
  const adj = 0.7 + 0.3 * p.scale;
  const means = p.rank >= 4 ? 'dao'
    : p.rank >= 3 ? 'spirit'
      : p.rank >= 2 ? 'mana' : 'physical';

  /* 同品的对手按同一张表，但血不高于玩家的一倍半——
     否则"炼气冲上来、锻体没跟上"的人会被同辈三下打死，读着不像对手像天灾 */
  const hpMax = Math.min(at('hp', p.tier) * adj, me.hpMax * 1.25);
  /* 法力/灵力按"玩家自己练到哪"来对齐，不按品查表——
     否则朝元（体 4）配个破胎（气 2）的人，会撞上法相级的 240 法力，四发就被打死。 */
  const manaMax = p.rank >= 2
    ? Math.max(at('mana', 2), me.manaMax) * adj * 0.9
    : 0;
  const spiritMax = p.rank >= 3
    ? Math.max(at('spirit', 2), me.spiritMax) * adj * 0.9
    : 0;
  const mindMax = at('mind', p.rank >= 3 ? p.tier : 0) * adj;
  const willMax = Math.max(20, 30 + p.tier * 14) * adj;

  /* 对手也带护身之物：法修一般有一层，练体的没有 */
  const shieldMax = p.rank >= 2 ? hpMax * 0.16 : 0;

  return {
    side: 'enemy',
    name: (params && params.kindName) || '对手',
    rank: p.rank,
    tier: p.tier,
    means,
    hp: hpMax, hpMax,
    mana: manaMax, manaMax,
    spirit: spiritMax, spiritMax,
    mind: mindMax, mindMax,
    will: willMax, willMax,
    shield: shieldMax, shieldMax,
    atk: Math.min(at('atk', p.tier) * adj, me.atk * 1.35),
    def: Math.min(at('def', p.tier) * adj, me.atk * 0.9),
    dodge: Math.min(0.3, num(B().dodgeBase, 0.04) + (p.rank >= 2 ? 0.02 : 0)),
    moves: [{
      name: ENEMY_MOVE[means], grade: '', rank: 0,
      kind: 'attack', power: 0, shield: 0, lvl: 0, mult: 1
    }]
  };
}

/**
 * 压制倍率（攻方 → 守方）。
 * 低阶方的**品**决定档位；高阶方打低阶方是真实伤害，反过来被挡。
 */
function suppressMul(att, dfd) {
  if (att.rank === dfd.rank) return 1;
  if (att.rank > dfd.rank) {
    if (dfd.tier >= 5) return 1;
    if (dfd.tier === 4) return 0.6;
    return 1;
  }
  if (att.tier >= 5) return 1;
  if (att.tier === 4) return 0.5;
  /*
   * r34：**拳头要能破防**。凡人三境打炼气，物理仍然能打进一半——
   * 气机护体挡得住法术，挡不住一记砸在脸上的拳。法术才吃 0.12。
   * （用户原话：拳头连盾都破不了，还得用术法，用术法又撞上阶级局限——两头堵）
   */
  if (att.means === 'physical') return 0.55;
  return att.means === dfd.means ? 0.35 : 0.12;
}

/** 护盾挡伤：1 点护盾挡 1 点（法力盾是"结出来的层"，不是法力本身） */
function absorbShield(d, dmg, limit) {
  if (!(d.shield > 0) || !(dmg > 0)) return 0;
  const cap = Math.min(dmg, d.shield, limit == null ? dmg : limit);
  d.shield -= cap;
  return cap;
}

/** 施法要多少油：品阶越高越贵，熟练越高越省 */
function castCost(att, move) {
  if (!(att.manaMax > 0)) return 0;
  const rank = num(move && move.rank, 1) || 1;
  const lvl = num(move && move.lvl, 0);
  return att.manaMax * Math.max(0.04, 0.08 + 0.01 * rank - 0.005 * lvl);
}

/** 一拍：谁、用什么招、剩下多少 */
function strike(att0, dfd, move0, rng) {
  const move = move0 || { name: DEFAULT_MOVE[att0.means], kind: 'attack', power: 0, mult: 1, rank: 0, lvl: 0 };
  const roll = 0.85 + rng() * 0.3;

  /* ① 闪避：先掷。闪开了这一下全免——灵术三段也一样 */
  const mental = att0.means === 'dao';
  if (!mental && dfd.dodge > 0 && rng() < dfd.dodge) {
    return { dodged: true, guard: false, seg: { hp: 0, mind: 0, will: 0, shield: 0 }, move, means: att0.means };
  }

  /* ② 运功：不出招，结盾 / 回气（防御术法） */
  if (move.kind === 'guard') {
    const gain = num(move.shield) * Math.max(1, num(move.lvl, 1)) * (spells.multOf(move.lvl) || 1);
    att0.shield = Math.min(att0.shieldMax, att0.shield + (gain || att0.shieldMax * 0.4));
    if (att0.manaMax > 0) att0.mana = Math.min(att0.manaMax, att0.mana + att0.manaMax * 0.06);
    return { guard: true, seg: { hp: 0, mind: 0, will: 0, shield: 0 }, move, means: att0.means };
  }

  /* ③ 法力不继就改动手（招式名也跟着换） */
  let means = att0.means;
  const cost = means === 'mana' ? castCost(att0, move) : 0;
  if (means === 'mana' && att0.mana < cost) means = 'physical';

  const att = means === att0.means ? att0 : Object.assign({}, att0, { means });
  const shown = means === att0.means
    ? move
    : Object.assign({}, move, { name: DEFAULT_MOVE[means], grade: '', rank: 0, mult: 1 });
  const sup = suppressMul(att, dfd);

  /**
   * 两层判定，**顺序不能反**（r39，需求/11 §2.9.0.2）：
   *
   *   ① itemFit —— **这门术法 / 这件东西，你还用得上吗**（代差）
   *        跨大阶 → 完全无效；高一个小品 → 一成；否则满效果
   *   ② reach   —— **使出来之后，压不压制得住对手**（差距）
   *        人的 L=阶+品，差一级 ×0.1
   *
   * 拳脚（rank 0）两套都不套：它没有品阶，只吃大境界压制。
   *
   * **r39：取消"以力驭法"**（用户裁决）。旧规则说"境界高了能用自身阶品撑起低阶术法，
   * 打 0.75 折"，但那与"物品有代差"直接冲突——罗汉拳到了脏腑就只能发挥一成，
   * 到调息就彻底没用。**术法的阶品是它自己的，不随人涨。**
   */
  let gRatio = 1;
  let fitWhy = '';
  if (num(move.rank) > 0) {
    const fit = grade.itemFit(att.rank, att.tier, move.jie, move.pin);
    fitWhy = fit.why;
    if (!fit.usable) {
      gRatio = 0;                       /* 跨阶 / 超两品：彻底没用 */
    } else {
      gRatio = grade.reach(move.jie, move.pin, dfd.rank, dfd.tier) * fit.mul;
    }
  }

  const seg = { hp: 0, mind: 0, will: 0, shield: 0 };

  if (means === 'physical') {
    let dmg = (att.atk * roll + num(move.power) * 0.5 * num(move.mult, 1)) - dfd.def * 0.45;
    dmg = Math.max(1, dmg) * sup;
    /* 拳头是硬砸：气墙最多挡下 55%，剩下的直接打进肉里（r34） */
    seg.shield = absorbShield(dfd, dmg, dmg * 0.55);
    seg.hp = Math.max(0, dmg - seg.shield);
    dfd.hp -= seg.hp;
  } else if (means === 'mana') {
    att0.mana -= cost;
    /* 纯法力：防御力无效，只有护盾挡 */
    const dmg = (att.manaMax * 0.55 + num(move.power) * 0.8 * num(move.mult, 1)) * roll * sup * gRatio;
    seg.shield = absorbShield(dfd, dmg);
    seg.hp = Math.max(0, dmg - seg.shield);
    dfd.hp -= seg.hp;
  } else if (means === 'spirit') {
    /* 灵力术法：一发三段（物理 / 法术 / 精神），三段挡法各不同 */
    const total = (att.spiritMax * 0.75 + num(move.power) * 0.5 * num(move.mult, 1)) * roll * sup * gRatio;
    const pSeg = total * 0.30;
    const mSeg = total * 0.25;
    const sSeg = total * 0.45;

    const dmgP = Math.max(0, pSeg - dfd.def * 0.30);
    seg.shield = absorbShield(dfd, mSeg, mSeg * 0.5);   /* 法术段只挡一半 */
    seg.hp = Math.max(0, dmgP + (mSeg - seg.shield));
    seg.mind = sSeg;
    dfd.hp -= seg.hp;
    dfd.mind -= seg.mind;
  } else {
    const dmg = Math.max(1, (att.will * 0.30 + att.atk * 0.55) * roll * sup * (dfd.rank >= 4 ? 0.85 : 1));
    seg.will = dmg;
    dfd.will -= dmg;
  }

  return { dodged: false, guard: false, seg, sup, gRatio, fitWhy, means, move: shown, rolled: means !== att0.means };
}

function alive(s) {
  return s.hp > 0 && s.mind > 0 && s.will > 0;
}

function danger(s, line) {
  return s.hp <= s.hpMax * line
    || s.mind <= s.mindMax * line
    || s.will <= s.willMax * line;
}

/* ── 战报文字 ─────────────────────────────────────────── */

const VERB = {
  physical: '欺身进招',
  mana: '掐诀出手',
  spirit: '灵压铺开',
  dao: '心念一沉'
};

function dmgText(seg) {
  const parts = [];
  if (seg.hp >= 1) parts.push(`掉血 ${Math.round(seg.hp)}`);
  if (seg.mind >= 1) parts.push(`掉精神 ${Math.round(seg.mind)}`);
  if (seg.will >= 1) parts.push(`掉神志 ${Math.round(seg.will)}`);
  const hit = parts.length ? parts.join('、') : '没能破防';
  const sh = seg.shield >= 1 ? `（护盾挡下 ${Math.round(seg.shield)}）` : '';
  return hit + sh;
}

function snap(s) {
  return {
    hp: Math.max(0, Math.round(s.hp)), hpMax: Math.round(s.hpMax),
    mana: Math.max(0, Math.round(s.mana)), manaMax: Math.round(s.manaMax),
    spirit: Math.max(0, Math.round(s.spirit)), spiritMax: Math.round(s.spiritMax),
    mind: Math.max(0, Math.round(s.mind)), mindMax: Math.round(s.mindMax),
    will: Math.max(0, Math.round(s.will)), willMax: Math.round(s.willMax),
    shield: Math.max(0, Math.round(s.shield)), shieldMax: Math.round(s.shieldMax)
  };
}

/**
 * 出哪一手：
 *   盾破了又有防御术法 → 先结盾
 *   法力够 → 挑一门放得出来的、品阶最高的攻术
 *   法力不继 → 动手
 */
function pickMove(s, rng) {
  const pool = (s.moves && s.moves.length) ? s.moves : [];
  const guards = pool.filter((m) => m.kind === 'guard');
  const attacks = pool.filter((m) => m.kind !== 'guard');

  /* 运功是"这一拍放弃出手"换一口气：只有真没油了才用，不能每回合都结盾（会白挨打） */
  if (guards.length && s.means === 'mana') {
    const canCast = attacks.some((m) => s.mana >= castCost(s, m) * 1.05);
    if (!canCast && s.mana < s.manaMax * 0.5) return guards[0];
  }

  if (s.means === 'mana') {
    const affordable = attacks.filter((m) => s.mana >= castCost(s, m) * 1.05);
    if (affordable.length) {
      /* 品阶高的优先，但留一点随机，免得每场都一模一样 */
      affordable.sort((a, b) => (b.rank - a.rank) || (b.lvl - a.lvl));
      const top = affordable.slice(0, Math.min(2, affordable.length));
      return top[Math.min(top.length - 1, Math.floor(rng() * top.length))];
    }
  }

  if (attacks.length) return attacks[Math.min(attacks.length - 1, Math.floor(rng() * attacks.length))];
  return { name: DEFAULT_MOVE[s.means], kind: 'attack', power: 0, mult: 1, rank: 0, lvl: 0 };
}

/** 回合结束时回气：法力与灵力各回一点，修士不该"打两下就没油" */
function breathe(s) {
  const rate = num(B().manaRegen, 0.05);
  if (s.manaMax > 0) s.mana = Math.min(s.manaMax, s.mana + s.manaMax * rate);
  if (s.spiritMax > 0) s.spirit = Math.min(s.spiritMax, s.spirit + s.spiritMax * rate);
}

/**
 * 打一场。
 * @param {object} state
 * @param {object} params { scale, kindName, match:'spar'|'death' }
 * @param {object} ctx    { rng, rules }
 */
function resolve(state, params, ctx) {
  const rng = (ctx && ctx.rng) || Math.random;
  const cfg = B();
  const maxRounds = Math.max(4, num(cfg.timeout, 12));
  const match = params && params.match === 'spar' ? 'spar' : 'death';
  const line = num(cfg.dangerLine, 0.1);

  const me = stats(state, 'player');
  const foe = makeEnemy(me, params);

  const frames = [];
  const push = (f) => {
    f.me = snap(me);
    f.foe = snap(foe);
    frames.push(f);
  };

  push({
    t: 'start',
    round: 0,
    text: match === 'spar'
      ? `${me.name}与${foe.name}相对而立。这是切磋，点到为止；谁到了危险线，谁就认输。`
      : `${me.name}与${foe.name}相对而立。这一场不分胜负，只分生死。`
  });

  let rounds = 0;
  let over = null;
  let usedPill = false;
  let usedTalisman = false;

  /* 战前先甩一张符（r34）：符箓出手快，第一拍之前就先炸一次。
     打高阶对手时这是"低阶修士唯一的翻盘手"，所以有就自动用。 */
  const talismanId = Object.keys(state.items || {}).find((id) => {
    const it = (require('../repository/config').get('items') || []).find((x) => x.id === id);
    return it && it.kind === '符箓' && Number(state.items[id]) > 0;
  });
  if (talismanId) {
    const it = (require('../repository/config').get('items') || []).find((x) => x.id === talismanId);
    state.items[talismanId] = Number(state.items[talismanId]) - 1;
    if (state.items[talismanId] <= 0) delete state.items[talismanId];
    const dmg = Math.max(8, num((it.talisman || {}).power, 40)) * (0.85 + rng() * 0.3);
    const absorbed = absorbShield(foe, dmg, dmg * 0.5);
    foe.hp = Math.max(0, foe.hp - (dmg - absorbed));
    usedTalisman = true;
    push({
      t: 'talisman',
      round: 0,
      side: 'me',
      text: `${me.name}先甩出一张${it.name}——火光炸开，${foe.name}掉了 ${Math.round(dmg - absorbed)} 点血。`
    });
  }

  const step = (who, other, side) => {
    const move = pickMove(who, rng);
    const r = strike(who, other, move, rng);
    const whoName = side === 'me' ? '你' : foe.name;
    const otherName = side === 'me' ? foe.name : '你';

    let text;
    if (r.dodged) {
      text = `${whoName}${VERB[r.means]}「${r.move.name}」，${otherName}侧身让开了。`;
    } else if (r.guard) {
      text = `${whoName}运起「${r.move.name}」，身前撑起一层护盾。`;
    } else {
      const gname = r.move.grade ? `（${r.move.grade}）` : '';
      /* r39：分清"没用"与"打折"——玩家要知道这门术法是不是该换代了 */
      let weak = '';
      if (r.fitWhy === 'cross_tier') weak = '，这东西对上了大阶，完全使不出来';
      else if (r.fitWhy === 'out_of_range') weak = '，阶品差得太远，一点都打不进去';
      else if (r.fitWhy === 'diluted') weak = '，阶品差着一品，威力只剩一成';
      else if (num(r.gRatio) < 0.5) weak = '，品阶差着一截，只擦破一点皮';
      text = `${whoName}${VERB[r.means]}「${r.move.name}」${gname}，${otherName}${dmgText(r.seg)}${weak}。`;
    }

    push({
      t: r.dodged ? 'dodge' : r.guard ? 'guard' : 'hit',
      round: rounds,
      side,
      move: r.move.name,
      grade: r.move.grade || '',
      seg: r.seg,
      text
    });
    return r;
  };

  while (rounds < maxRounds && !over) {
    rounds += 1;

    step(me, foe, 'me');
    if (!alive(foe)) { over = 'win'; break; }
    if (match === 'spar' && danger(foe, line)) { over = 'win'; break; }

    step(foe, me, 'foe');

    /* 自动服一枚回春丹（有就吃，不弹窗） */
    if (!usedPill && me.hp > 0 && me.hp / me.hpMax < 0.3 && num((state.items || {})['item.huichun']) > 0) {
      state.items['item.huichun'] -= 1;
      me.hp = Math.min(me.hpMax, me.hp + 30);
      usedPill = true;
      push({ t: 'pill', round: rounds, side: 'me', text: '你咬开一枚回春丹，血止住了些。' });
    }

    if (!alive(me)) { over = 'lose'; break; }
    if (match === 'spar' && danger(me, line)) { over = 'yield'; break; }

    /* 认输（r34）：还有一口气、但已经明显打不过了，收手 */
    const yieldAt = num(params && params.surrenderAt != null ? params.surrenderAt : (match === 'spar' ? 0.15 : 0));
    if (yieldAt > 0 && me.hp > 0 && me.hp / me.hpMax < yieldAt) { over = 'yield'; break; }

    breathe(me);
    breathe(foe);
  }

  const yielded = over === 'yield';
  const win = over === 'win' ? true
    : (over === 'lose' || yielded) ? false
      : me.hp / me.hpMax >= foe.hp / foe.hpMax;

  let dead = match === 'death' && !alive(me);
  const ratio = me.hp / me.hpMax;

  /* 死斗里血条见底还有一次"转身就跑"（需求/14 C.逃跑）：成不成看身法 */
  let fled = false;
  if (dead) {
    const mode = params && params.flee;
    const p = mode === 'always' ? 1
      : mode === 'never' ? 0
        : Math.min(0.6, num(cfg.fleeBase, 0.25) + num(me.dodge) * 0.5);
    if (rng() < p) {
      fled = true;
      dead = false;
      me.hp = 1;
      push({ t: 'flee', round: rounds, side: 'me', text: '你弃了刀，转身就跑——居然跑掉了。' });
    }
  }

  const injury = match === 'death' && (fled || (!dead && !win && rng() < num(cfg.injuryRate, 0.25)));

  /* 战斗计数（r34）：天赋 T1–T5 的计数器从这里长出来 */
  state.tally = state.tally || { fights: 0, wins: 0, nearDeath: 0, fled: 0 };
  state.tally.fights += 1;
  if (win) state.tally.wins += 1;
  if (fled) state.tally.fled += 1;
  if (me.hp / me.hpMax < 0.2) state.tally.nearDeath += 1;

  let endText;
  if (match === 'spar') {
    endText = win
      ? `${foe.name}退了一步，抱拳认输。切磋到此为止。`
      : (yielded
        ? `你看了一眼自己的血，收了手：「不打了。」${foe.name}也收了势。`
        : `你退了一步，认输。${foe.name}收了手。`);
  } else if (dead) {
    endText = `你倒下了。${foe.name}没有再看你一眼。`;
  } else if (fled) {
    endText = `你从死人堆里爬出来，一路跑回城里。这条命是捡回来的。`;
  } else if (win) {
    endText = ratio > 0.5
      ? `${foe.name}倒下了，没有再站起来。你伤得不重。`
      : `${foe.name}倒下了。你站着的腿在抖，血一路滴到脚边。`;
  } else {
    endText = `你没打赢。${foe.name}收了刀，留了你一条命。`;
  }

  push({ t: 'end', round: rounds, ok: win, death: dead, text: endText });

  const meEnd = snap(me);
  const foeEnd = snap(foe);

  return {
    ok: win,
    outcome: dead ? 'dead' : fled ? 'fled' : yielded ? 'yield' : win ? 'win' : 'lose',
    fled,
    yielded,
    usedTalisman,
    match,
    kind: match,
    why: 'battle',
    rounds,
    hp: meEnd.hp,
    hpMax: meEnd.hpMax,
    enemy: foe.name,
    injury,
    death: dead,
    usedPill,
    me: meEnd,
    foe: foeEnd,
    meDodge: Math.round(me.dodge * 100) / 100,
    foeDodge: Math.round(foe.dodge * 100) / 100,
    frames,
    report: frames.map((f) => f.text)
  };
}

module.exports = {
  stats, resolve, strike, makeEnemy, suppressMul, profileOf, castCost,
  levelsOf, meansOf, rankOf,
  DAO_RANK: { body: 1, qi: 2, spirit: 3, heart: 4 }, DAO_CN, DEFAULT_MOVE
};
