'use strict';

const rng = require('../../util/rng');
const { clamp } = require('../../util/text');
const { PROF_MAX, HEART_GATE, naturalChance, fortuneNeed, effortChance } = require('../rules/breakthrough.rule');
const { realmAttribute, adjustHidden, heartDecay } = require('../rules/attribute.rule');
const { LIFESPAN } = require('../../seed/realms.seed');
const { methodById } = require('../../seed/arts.seed');
const training = require('./training.system');

/** 取境界配置 */
function realmCfg(state, key) {
  return state.config.realms.find((r) => r.key === key) || null;
}

function stageCfg(state, key, index) {
  const cfg = realmCfg(state, key);
  if (!cfg) return null;
  return cfg.stages[index] || null;
}

/** 该道的属性值（含 buff） */
function attrOf(state, key) {
  const cfg = realmCfg(state, key);
  const base = realmAttribute(state.hidden, cfg);
  return key === 'qi' ? base + training.insightBuffOf(state) : base;
}

/** 世寿：按境界重设 */
function lifespanFor(state, realmKey, stageIndex) {
  const tier = stageIndex + 1;
  const row = [...LIFESPAN]
    .reverse()
    .find((item) => {
      const itemCfg = realmCfg(state, item.realm);
      if (!itemCfg) return false;
      const itemTier = item.tier;
      // 只匹配当前道或更低道
      if (item.realm === realmKey) return itemTier <= tier;
      return false;
    });
  if (!row) return null;
  return row;
}

function applyLifespan(state, realmKey) {
  const tier = (state.realms[realmKey]?.stageIndex ?? 0) + 1;
  const row = LIFESPAN.find((item) => item.realm === realmKey && item.tier === tier);
  if (!row) return null;
  const target = rng.int(row.min, row.max);
  if (target > state.lifespan) {
    const before = state.lifespan;
    state.lifespan = target;
    return { before, after: target };
  }
  return null;
}

/** 推进一个小境界 */
function advanceRealm(state, key, ctx, viaGate = false) {
  const realm = state.realms[key];
  const cfg = realmCfg(state, key);
  if (!realm || !cfg) return;

  if (realm.stageIndex >= cfg.stages.length - 1) {
    realm.completed = true;
    realm.prof = PROF_MAX;
    ctx?.note?.(`${cfg.name}已至大圆满。`);
    return;
  }

  realm.stageIndex += 1;
  realm.prof = 0;
  realm.blocked = false;
  realm.awaiting = null;

  const target = cfg.stages[realm.stageIndex];
  if (realm.stageIndex >= cfg.stages.length - 1) realm.completed = true;

  const span = applyLifespan(state, key);
  if (span) ctx?.note?.(`寿元大增：${span.before} → ${span.after} 岁。`);

  ctx?.change?.(cfg.name, `晋入 ${target.name}`, key);
  ctx?.note?.(`${viaGate ? '关隘洞开' : '水到渠成'}，你晋入${cfg.name}·${target.name}。`);

  checkUnlocks(state, ctx);
}

/** 解锁判定 */
function checkUnlocks(state, ctx) {
  const t = state.config.thresholds || {};

  // 炼气：需要感气成功
  const qi = state.realms.qi;
  if (qi && !qi.unlocked && state.education.qiSensed) {
    qi.unlocked = true;
    ctx?.note?.('你终于感到了气。炼气之门开启。');
  }

  // 养灵：需要 life_understanding
  const spirit = state.realms.spirit;
  if (spirit && !spirit.unlocked && state.flags.life_understanding) {
    spirit.unlocked = true;
    if (!state.methods.spirit) state.methods.spirit = 'spirit_school';
    if (!state.arts.spirit) state.arts.spirit = ['zhaoshen'];
    ctx?.note?.('你看见了生命更深的一层，养灵之门开启。');
    if (state.education.stage === '肄业' && !state.education.reentry) {
      state.education.stage = '太学';
      state.education.reentry = true;
      state.education.admissionAge = state.age;
      ctx?.note?.('你以养灵之身重回太学，成为一名太学进修。');
    }
  }

  // 修心：心性 ≥ 90 + 生死 + 大彻大悟
  const heart = state.realms.heart;
  if (heart && !heart.unlocked) {
    const gate = t.heartGate ?? HEART_GATE;

    // 大彻大悟会把心性上限推到满，这是入修心的唯一路径
    if (state.flags.great_awakening) {
      state.hidden.caps.heart = Math.max(state.hidden.caps.heart, 100);
    }

    if (
      state.age >= 25 &&
      state.hidden.heart >= gate &&
      state.flags.life_and_death &&
      state.flags.great_awakening
    ) {
      heart.unlocked = true;
      state.flags.heart_open = true;
      if (!state.methods.heart) state.methods.heart = 'heart_renjian';
      if (!state.arts.heart) state.arts.heart = ['zhishui'];
      ctx?.change?.('修心', '门开一线', 'heart');
      ctx?.note?.('心性、经历、生死与人间烟火，一样不缺。修心之门，终于为你开了一线。');
    }
  }
}

/** 是否可以追求世界认可：某道第四重修为圆满 */
function canSeekRecognition(state) {
  if (state.borrowed && Object.keys(state.borrowed).length > 0) return false;
  return state.config.realms.some((cfg) => {
    const realm = state.realms[cfg.key];
    if (!realm?.unlocked) return false;
    return realm.stageIndex >= 3 && realm.prof >= PROF_MAX;
  });
}

/** 第四重：机缘判定 */
function tryEffort(state, key, ctx) {
  const realm = state.realms[key];
  const cfg = realmCfg(state, key);
  const target = stageCfg(state, key, realm.stageIndex + 1);
  if (!target) return false;

  const attr = attrOf(state, key);
  const need = fortuneNeed(cfg.policy, attr);
  const have = state.fortune[key] || 0;
  const borrowed = Boolean(state.borrowed[key]);

  const chance = effortChance({
    attr,
    luck: state.hidden.luck,
    fortune: have,
    fortuneNeed: need,
    insightBuff: key === 'qi' ? training.insightBuffOf(state) * 2 : 0,
    borrowed
  });

  if (chance <= 0) {
    ctx?.note?.(`机缘不足（${have}/${need}），此关不认苦功。`);
    return false;
  }

  if (rng.roll(chance)) {
    advanceRealm(state, key, ctx, true);
    state.fortune[key] = 0;
    return true;
  }

  // 失败：机缘减半
  state.fortune[key] = Math.max(0, Math.floor(have / 2));
  ctx?.note?.('你摸到了门径，却在最后一刻滑开。机缘散去一半。');
  return false;
}

/** 修为满后的推进判定 */
function processProgression(state, ctx) {
  for (const cfg of state.config.realms) {
    const realm = state.realms[cfg.key];
    if (!realm?.unlocked || realm.completed || realm.awaiting || realm.blocked) continue;
    if (realm.prof < PROF_MAX) continue;

    const targetIndex = realm.stageIndex + 1;
    const target = cfg.stages[targetIndex];
    if (!target) {
      realm.completed = true;
      continue;
    }

    const type = target.breakthrough?.type || 'normal';

    if (type === 'world') {
      if (!canSeekRecognition(state)) {
        realm.blocked = true;
        ctx?.note?.(`${cfg.name}·${target.name}是圆满之关。你还没有拿到那份认可。`);
        continue;
      }
      if (!state.worldRecognition) {
        realm.awaiting = 'world';
        ctx?.note?.(`${cfg.name}·${target.name}是圆满之关。修为已满，但世界尚未认可你。`);
        continue;
      }
      advanceRealm(state, cfg.key, ctx, true);
      continue;
    }

    if (type === 'dao') {
      if (!state.trueDao) {
        realm.awaiting = 'dao';
        ctx?.note?.(`${cfg.name}·${target.name}是大圆满之关。修为已满，但你还没有真正悟道。`);
        continue;
      }
      advanceRealm(state, cfg.key, ctx, true);
      continue;
    }

    if (type === 'effort') {
      // 第四重：进入瓶颈，等玩家用破境事件处理
      realm.blocked = true;
      ctx?.note?.(`${cfg.name}·${target.name}是大成之关。药力无用，需自身努力或一场真正的机缘。`);
      continue;
    }

    if (type === 'heart') {
      realm.blocked = true;
      ctx?.note?.(`${cfg.name}·${target.name}是心关。此关不在山里，在人间。`);
      continue;
    }

    // normal：掷骰自然突破
    const chance = naturalChance({
      policy: cfg.policy,
      attr: attrOf(state, cfg.key),
      luck: state.hidden.luck,
      fortune: state.fortune[cfg.key] || 0,
      cognition: state.cognition
    });

    if (rng.roll(chance)) {
      advanceRealm(state, cfg.key, ctx, false);
    } else {
      // 普通关卡不永久阻塞：修为回落一截，可以再修再试
      realm.prof = Math.round(PROF_MAX * 0.55);
      ctx?.note?.(`${cfg.name}·${target.name}前横着一道关。你退回来了，但还能再试。`);
    }
  }
}

/** 世界认可 / 悟道到手后，挂起的自动放行 */
function resolveAwaiting(state, ctx) {
  for (const cfg of state.config.realms) {
    const realm = state.realms[cfg.key];
    if (!realm?.awaiting) continue;
    const ready = realm.awaiting === 'world' ? state.worldRecognition : realm.awaiting === 'dao' ? state.trueDao : false;
    if (!ready) continue;
    realm.awaiting = null;
    realm.blocked = false;
    advanceRealm(state, cfg.key, ctx, true);
  }
}

/** 感气：府学期间每年一次判定 */
function trySenseQi(state, ctx) {
  const edu = state.education;
  if (edu.qiSensed) return null;
  if (edu.stage !== '府学') return null;
  if (!state.realms.qi || state.realms.qi.unlocked) return null;

  edu.qiYears += 1;
  const insight = state.hidden.insight + training.insightBuffOf(state);
  // 先修过《第一缕气》有加成
  const hintBonus = state.flags.qi_sense_hint ? 12 : 0;
  const chance = clamp(
    18 + (insight - 50) * 0.9 + (state.hidden.luck - 55) * 0.15 + edu.qiYears * 4 + hintBonus,
    5,
    88
  );

  if (rng.roll(chance)) {
    edu.qiSensed = true;
    state.realms.qi.unlocked = true;
    if (!state.methods.qi) state.methods.qi = 'qi_school';
    if (!state.arts.qi) state.arts.qi = ['liuyun_zhang'];
    ctx?.change?.('炼气', '感气成功', 'qi');
    ctx?.note?.('某一刻，你终于感觉到了那一缕气。炼气之门开了。');
    return 'success';
  }

  ctx?.note?.(`又一年过去了，你还是没有感觉到气。（第 ${edu.qiYears} 年）`);
  return 'fail';
}

/** 学制里程碑 */
function applyMilestones(state, ctx) {
  const edu = state.education;

  // 11 岁入府学
  if (state.age >= 11 && edu.stage === '蒙学') {
    edu.stage = '府学';
    edu.qiYears = 0;
    ctx?.note?.('蒙学结业。你进入府学。');
  }

  // 15 岁大考（只考，不判入学）
  if (state.age >= 15 && edu.stage === '府学' && edu.lastExamAge == null) {
    // 由事件系统触发，不在这里自动推进
  }

  // 16 岁入学判定
  if (state.age >= 16 && edu.stage === '府学' && edu.examScore != null && edu.admission == null) {
    decideAdmission(state, ctx);
  }

  if (state.age >= 20 && edu.stage === '太学' && !edu.reentry) {
    edu.stage = '卒业';
    ctx?.note?.('太学卒业。你走出学宫，山河便是新的课堂。');
  }
}

/** 16 岁判定入学 */
function decideAdmission(state, ctx) {
  const t = state.config.thresholds || {};
  const adm = state.config.admission || {};
  const edu = state.education;
  const qiBroken = state.realms.qi?.unlocked && state.realms.qi.stageIndex >= 1;
  const examOk = (edu.examScore || 0) >= (adm.examPassScore || 57);
  const aptOk = state.hidden.aptitude > (t.directAptitude || 80);
  const insOk = state.hidden.insight > (t.directInsight || 80);

  if (!qiBroken) {
    edu.stage = '肄业';
    edu.admission = 'none';
    edu.admissionAge = state.age;
    ctx?.note?.('十六岁这年，你仍未踏入炼气·破胎。太学之门没有为你开。');
    return;
  }

  if (examOk && aptOk && insOk) {
    edu.stage = '太学';
    edu.admission = 'direct';
    edu.admissionAge = state.age;
    ctx?.note?.('直招入太学。你被列入城池权力机构的历练名单。');
    return;
  }

  if (examOk) {
    edu.stage = '太学';
    edu.admission = 'special';
    edu.admissionAge = state.age;
    ctx?.note?.('你以特招之名入太学。资源少一些，但门开了。');
    return;
  }

  edu.stage = '肄业';
  edu.admission = 'none';
  edu.admissionAge = state.age;
  ctx?.note?.('大考成绩不够，你没有进太学。');
}

/** 年龄推进（逐年回调） */
function advanceAge(state, years, ctx, onYear) {
  const n = Math.max(0, Math.floor(years || 1));
  for (let i = 0; i < n; i += 1) {
    state.age += 1;
    applyMilestones(state, ctx);

    // 府学期间每年自动感气一次
    if (state.education.stage === '府学' && !state.education.qiSensed) {
      trySenseQi(state, ctx);
    }

    if (onYear) {
      const stop = onYear(state, i + 1);
      if (stop) break;
    }
    if (state.age >= state.lifespan) {
      state.age = state.lifespan;
      state.pendingEnding = state.pendingEnding || { cause: 'old' };
      ctx?.note?.('你已至大限。灯油将尽，回望这一生。');
      break;
    }
  }
  heartDecay(state.hidden, n, Boolean(state.flags.heart_open));
}

module.exports = {
  realmCfg,
  stageCfg,
  attrOf,
  advanceRealm,
  checkUnlocks,
  canSeekRecognition,
  tryEffort,
  trySenseQi,
  processProgression,
  resolveAwaiting,
  applyMilestones,
  decideAdmission,
  advanceAge,
  lifespanFor
};
