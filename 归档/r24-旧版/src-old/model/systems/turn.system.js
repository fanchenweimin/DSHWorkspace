'use strict';

const rng = require('../../util/rng');
const { clamp } = require('../../util/text');
const money = require('../../util/money');
const helper = require('./view.helper');
const { GameError } = helper;
const eventSystem = require('./event.system');
const realmSystem = require('./realm.system');
const training = require('./training.system');
const economy = require('./economy.system');
const combat = require('./combat.system');
const { applyEffects } = require('./effect.system');
const { PROF_MAX, empowerFactor, empowerCrossChance } = require('../rules/breakthrough.rule');
const rank = require('../rules/rank.rule');

/** 开始一个事件 */
function beginEvent(state, event) {
  state.currentEventId = event.id;
  state.eventKind = event.kind;
  state.phase = 'event';
  state.result = null;
  state.battle = null;
  eventSystem.markSeen(state, event);
  return state;
}

/** 抽下一幕 */
function nextTurn(state) {
  if (state.pendingEnding) {
    state.phase = 'result';
    return state;
  }

  // 寿元
  if (state.age >= state.lifespan) {
    state.pendingEnding = state.pendingEnding || { cause: 'old' };
    state.phase = 'result';
    return state;
  }

  // 学制里程碑
  const c = helper.ctx();
  realmSystem.applyMilestones(state, c);

  // 大考：15 岁且府学且未考
  if (state.age >= 15 && state.education.stage === '府学' && state.education.lastExamAge == null) {
    const exam = eventSystem.get('n_exam');
    if (exam) return beginEvent(state, exam);
  }

  const drawn = eventSystem.drawNext(state);
  if (!drawn) {
    state.phase = 'result';
    state.pendingEnding = state.pendingEnding || { cause: 'drift' };
    return state;
  }
  return beginEvent(state, drawn.event);
}

/** 选择 */
function choose(state, choiceId) {
  if (state.phase !== 'event') throw new GameError('NOT_CHOOSING', '此刻不在抉择之中。', 409);
  const event = helper.currentEvent(state);
  if (!event) throw new GameError('NO_EVENT', '事件已经散去了。', 500);

  const choices = helper.visibleChoices(state, event);

  // ambient：无选项，直接结算
  if (event.kind === 'ambient' || !choices.length) {
    return resolveAmbient(state, event, choiceId);
  }

  const choice = choices.find((item) => item.id === choiceId);
  if (!choice) throw new GameError('NO_CHOICE', '没有这个选择。', 400);

  const st = helper.choiceState(state, choice);
  if (!st.available) throw new GameError('NOT_AVAILABLE', st.reason, 400);

  // 破境类（带 realmKey 的才算；defer 走普通结算）
  if (choice.special && choice.special !== 'defer' && choice.realmKey) {
    return resolveBreakthroughChoice(state, choice);
  }

  // 大考
  if (progressExam(state, choice)) return state;

  // 百艺选择
  if (event.special === 'craft_choice') {
    return resolveCraftChoice(state, event, choice);
  }

  // 普通事件
  const c = helper.ctx();
  const check = helper.evaluateCheck(state, choice.check);
  const branch = helper.branchOf(choice, check.passed);
  const hasExplicitTime = Object.prototype.hasOwnProperty.call(choice, 'years');
  const years = hasExplicitTime ? choice.years : (event.years || 1);

  // 战斗分支
  if (branch.battle) {
    return combat.startBattle(state, branch.battle, event, choice, years, branch.text, c);
  }

  applyEffects(state, branch.effects, c);

  // 大考特殊
  let extra = null;
  if (choice.id === 'exam_full' || choice.id === 'exam_steady') {
    extra = helper.resolveExam(state, choice, c);
  }

  // 逐年推进
  advanceYears(state, years, c, event, choice);

  if (!state.pendingEnding) {
    realmSystem.resolveAwaiting(state, c);
    realmSystem.processProgression(state, c);
  }

  makeResult(state, {
    title: event.title,
    kicker: event.kicker || '',
    paragraphs: [branch.text, ...(extra?.paragraphs || [])].filter(Boolean),
    changes: c.changes,
    notes: c.notes,
    years,
    isBreakthrough: state.phase === 'bottleneck'
  });

  journal(state, event, choice, branch.text);
  state.phase = 'result';
  helper.bumpRev(state);
  return state;
}

/** 环境事件：无选项，直接展示并推进 */
function resolveAmbient(state, event) {
  const c = helper.ctx();
  const years = event.years || 1;
  advanceYears(state, years, c, event, null);
  if (!state.pendingEnding) {
    realmSystem.resolveAwaiting(state, c);
    realmSystem.processProgression(state, c);
  }
  makeResult(state, {
    title: event.title,
    kicker: `景和${12 + state.age - 7}年 · ${state.age}岁`,
    paragraphs: [event.body],
    changes: c.changes,
    notes: c.notes,
    years
  });
  journal(state, event, null, event.body);
  state.phase = 'result';
  helper.bumpRev(state);
  return state;
}

/** 逐年推进 + 年度结算 */
function advanceYears(state, years, c, event, choice) {
  if (years <= 0) return;
  realmSystem.advanceAge(
    state,
    years,
    c,
    (s, index) => {
      const settled = economy.settleYear(s);
      for (const note of settled.notes) c.note?.(note);
      for (const change of settled.changes) c.changes.push(change);
      if (settled.laborTriggered) {
        c.note?.('你被拉去服劳役，这一年的修行中断了。');
        s.flags.laborYear = s.age;
        return true;
      }
      return false;
    }
  );
}

/** 大考推进 */
function progressExam(state, choice) {
  if (choice.id !== 'exam_full' && choice.id !== 'exam_steady') return false;
  const c = helper.ctx();
  const extra = helper.resolveExam(state, choice, c);
  const years = choice.years || 1;
  realmSystem.advanceAge(state, years, c);
  if (!state.pendingEnding) {
    realmSystem.processProgression(state, c);
  }
  makeResult(state, {
    title: extra.pass ? '金榜题名' : '名落孙山',
    kicker: `景和${12 + state.age - 7}年 · ${state.age}岁`,
    paragraphs: extra.paragraphs,
    changes: c.changes,
    notes: c.notes,
    years
  });
  journal(state, { title: '太学大考' }, choice, extra.pass ? '你过了大考。' : '你落榜了。');
  state.phase = 'result';
  helper.bumpRev(state);
  return true;
}

/** 百艺选择 */
function resolveCraftChoice(state, event, choice) {
  const c = helper.ctx();
  const skill = choice.skill;
  state.education.craftChosen = true;
  state.education.craft = skill;
  state.skills[skill] = Math.max(1, state.skills[skill] || 0);
  c.note?.(`${skillName(skill)}入门。`);
  c.change?.(skillName(skill), '一阶初阶', 'skill');

  realmSystem.advanceAge(state, choice.years || 1, c);
  makeResult(state, {
    title: `百艺入门 · ${skillName(skill)}`,
    kicker: `景和${12 + state.age - 7}年 · ${state.age}岁`,
    paragraphs: [choice.text || '你在案前坐下。', '从今天起，你至少有一门可以换饭吃的手艺。'],
    changes: c.changes,
    notes: c.notes,
    years: choice.years || 1
  });
  journal(state, event, choice, `你入了${skillName(skill)}的门。`);
  state.phase = 'result';
  helper.bumpRev(state);
  return state;
}

function skillName(skill) {
  return { alchemy: '炼丹', forging: '炼器', talisman: '符箓', formation: '阵法' }[skill] || skill;
}

/** 破境选项结算 */
function resolveBreakthroughChoice(state, choice) {
  const c = helper.ctx();
  const realmKey = choice.realmKey;
  const cfg = state.config.realms.find((r) => r.key === realmKey);
  const realm = state.realms[realmKey];
  if (!cfg || !realm) throw new GameError('NO_REALM', '境界不存在。', 400);
  const target = cfg.stages[realm.stageIndex + 1];
  if (!target) throw new GameError('NO_STAGE', '已至大圆满。', 400);

  const special = choice.special;

  if (special === 'defer') {
    makeResult(state, {
      title: '压着修为',
      kicker: `景和${12 + state.age - 7}年`,
      paragraphs: ['你把那股要冲出来的东西按了回去。修为不会跑，机会不一定等人。'],
      changes: [],
      notes: [],
      years: 0
    });
    state.phase = 'result';
    helper.bumpRev(state);
    return state;
  }

  if (special === 'seek') {
    const attr = realmSystem.attrOf(state, realmKey);
    const chance = clamp(30 + (attr - 50) * 0.9 + (state.hidden.luck - 55) * 0.3, 15, 90);
    const got = rng.roll(chance) ? 1 : 0;
    if (got) {
      state.fortune[realmKey] = (state.fortune[realmKey] || 0) + 1;
      c.change?.('机缘', '+1', 'fortune');
      c.note?.('你在山里走了很久，终于等到了一场雨。');
    } else {
      c.note?.('你走了一年，什么也没遇见。');
    }
    realmSystem.advanceAge(state, 1, c);
    makeResult(state, {
      title: '寻机缘',
      kicker: `景和${12 + state.age - 7}年 · ${state.age}岁`,
      paragraphs: [got ? '你在山道上遇见一个卖茶的老人，他随口说了一句话，你忽然明白了一点什么。' : '你在山里走了一年，除了几场雨，什么也没有。'],
      changes: c.changes,
      notes: c.notes,
      years: 1
    });
    state.phase = 'result';
    helper.bumpRev(state);
    return state;
  }

  if (special === 'heart') {
    return resolveHeart(state, cfg, target, c);
  }

  if (special === 'empower') {
    return resolveEmpower(state, cfg, target, c);
  }

  // 消耗型
  let bonus = 0;
  if (special === 'pill') {
    state.items.peiyuan_pill = Math.max(0, (state.items.peiyuan_pill || 0) - 1);
    if (state.items.peiyuan_pill === 0) delete state.items.peiyuan_pill;
    c.change?.('培元丹', '-1', 'item');
    bonus = 8;
  } else if (special === 'treasure') {
    state.items.wuxin_incense = Math.max(0, (state.items.wuxin_incense || 0) - 1);
    if (state.items.wuxin_incense === 0) delete state.items.wuxin_incense;
    c.change?.('悟心香', '-1', 'item');
    bonus = 6;
  }

  // 判定
  const attr = realmSystem.attrOf(state, realmKey);
  const fortuneNeedValue = require('../rules/breakthrough.rule').fortuneNeed(cfg.policy, attr);
  const have = state.fortune[realmKey] || 0;
  const policy = cfg.policy;

  let chance;
  if (policy === 'opportunity') {
    chance = clamp(12 + state.cognition * 6 + (attr - 50) * 0.4 + have * 4, 5, 88);
  } else if (policy === 'treasure') {
    chance = clamp(28 + (attr - 50) * 0.9 + have * 4 + bonus * 2, 8, 92);
  } else {
    chance = clamp(35 + (attr - 50) * 1.1 + have * 3 + bonus, 10, 94);
  }

  realmSystem.advanceAge(state, choice.years || 1, c);

  if (rng.roll(chance)) {
    realmSystem.advanceRealm(state, realmKey, c, true);
    state.fortune[realmKey] = 0;
    makeResult(state, {
      title: '破境',
      kicker: `景和${12 + state.age - 7}年 · ${state.age}岁`,
      paragraphs: ['那一线关隘终于松开。你睁眼时，天地比先前清楚了一层。'],
      changes: c.changes,
      notes: c.notes,
      years: choice.years || 1
    });
    journal(state, { title: `${cfg.name}破境` }, choice, `${cfg.name}破境。`);
  } else {
    realm.blocked = true;
    realm.prof = PROF_MAX;
    c.note?.('你摸到了门径，可还差最后一口气。');
    makeResult(state, {
      title: '仍差一线',
      kicker: `景和${12 + state.age - 7}年 · ${state.age}岁`,
      paragraphs: [choice.hint || '你几次觉得那层关隘已经薄如窗纸，伸手去推，却始终推不破。'],
      changes: c.changes,
      notes: c.notes,
      years: choice.years || 1
    });
    journal(state, { title: `${cfg.name}瓶颈` }, choice, '尝试破境，仍差一线。');
  }

  if (!state.pendingEnding) realmSystem.processProgression(state, c);
  state.phase = 'result';
  helper.bumpRev(state);
  return state;
}

/** 心关：可能跌落或身死 */
function resolveHeart(state, cfg, target, c) {
  const heart = state.hidden.heart;
  const difficulty = target.breakthrough?.difficulty || 60;
  const chance = clamp(30 + (heart - difficulty) * 1.4, 8, 88);

  realmSystem.advanceAge(state, 2, c);

  const roll = rng.next() * 100;
  if (roll < chance) {
    realmSystem.advanceRealm(state, cfg.key, c, true);
    makeResult(state, {
      title: '心关开',
      kicker: `景和${12 + state.age - 7}年 · ${state.age}岁`,
      paragraphs: ['你坐在那里，忽然听见心里有什么东西落下。不是变强，是变清楚。'],
      changes: c.changes,
      notes: c.notes,
      years: 2
    });
  } else if (roll < chance + 10) {
    // 跌落
    const realm = state.realms[cfg.key];
    if (realm.stageIndex > 0) {
      realm.stageIndex -= 1;
      realm.prof = 0;
      realm.blocked = false;
      c.note?.('你退回来了。不是退回原处，是退到更下面。');
    }
    state.hidden.heart = Math.max(10, state.hidden.heart - 6);
    c.change?.('心性', '重挫', 'hidden');
    makeResult(state, {
      title: '跌落',
      kicker: `景和${12 + state.age - 7}年 · ${state.age}岁`,
      paragraphs: ['你以为自己想通了。坐到第三天，你发现自己根本没有。'],
      changes: c.changes,
      notes: c.notes,
      years: 2
    });
  } else if (roll < chance + 13) {
    state.pendingEnding = { cause: 'heartDeviation' };
    makeResult(state, {
      title: '走火入魔',
      kicker: `景和${12 + state.age - 7}年 · ${state.age}岁`,
      paragraphs: ['那一念怎么也想不通。你在山里坐到第七天，忽然笑起来，然后就没有停过。'],
      changes: c.changes,
      notes: c.notes,
      years: 2
    });
  } else {
    c.note?.('你什么也没想通，只是又老了两岁。');
    makeResult(state, {
      title: '白坐',
      kicker: `景和${12 + state.age - 7}年 · ${state.age}岁`,
      paragraphs: ['两年过去了。你还是你。'],
      changes: c.changes,
      notes: c.notes,
      years: 2
    });
  }

  state.phase = 'result';
  helper.bumpRev(state);
  return state;
}

/** 灌顶 */
function resolveEmpower(state, cfg, target, c) {
  const record = state.borrowed[cfg.key] || { count: 0 };
  const times = record.count;
  const factor = empowerFactor(times);

  // 费用
  const cost = 3000 * (cfg.combatRank || 1);
  if ((state.items.money || 0) < cost) throw new GameError('NO_MONEY', '钱不够。', 400);
  state.items.money -= cost;
  c.change?.('灌顶费用', `-${money.format(cost)}`, 'money');

  // 代价
  state.hidden.heart = Math.max(10, state.hidden.heart - 6);
  c.change?.('心性', '自认走了捷径', 'hidden');
  record.count = times + 1;
  state.borrowed[cfg.key] = record;

  // 基础成功率（正常的一半）
  const attr = realmSystem.attrOf(state, cfg.key);
  const normal = clamp(35 + (attr - 50) * 1.0, 15, 92);
  const chance = normal * factor;

  realmSystem.advanceAge(state, 1, c);

  if (rng.rollRaw(chance)) {
    realmSystem.advanceRealm(state, cfg.key, c, true);
    c.note?.('高人一掌按在你后心。那道关忽然开了——但你也知道，这不是你自己的。');
    makeResult(state, {
      title: '灌顶破关',
      kicker: `景和${12 + state.age - 7}年 · ${state.age}岁`,
      paragraphs: ['你过了。代价是你再也不可能拿到世界的认可。'],
      changes: c.changes,
      notes: c.notes,
      years: 1
    });
  } else {
    c.note?.('高人摇了摇头：“你的底子，接不住。”');
    makeResult(state, {
      title: '灌顶失败',
      kicker: `景和${12 + state.age - 7}年 · ${state.age}岁`,
      paragraphs: ['钱花了，人情欠了，关还是那道关。'],
      changes: c.changes,
      notes: c.notes,
      years: 1
    });
  }

  state.phase = 'result';
  helper.bumpRev(state);
  return state;
}

/** 生成结果 */
function makeResult(state, data) {
  state.result = {
    title: data.title || '岁月有痕',
    kicker: data.kicker || `景和${12 + state.age - 7}年 · ${state.age}岁`,
    paragraphs: (data.paragraphs || []).filter(Boolean),
    changes: data.changes || [],
    notes: data.notes || [],
    years: data.years || 0
  };
}

function journal(state, event, choice, text) {
  state.journal.push({
    age: state.age,
    title: event.title || '一幕',
    text: String(text || '').slice(0, 200)
  });
  if (state.journal.length > 200) state.journal.shift();
}

/** 继续 */
function continueRun(state) {
  if (state.phase === 'ended') return state;
  if (state.phase === 'battle') throw new GameError('IN_BATTLE', '斗法尚未结束。', 409);

  // 环境事件（默认事件）没有选项，玩家点「继续」应当直接结算这一幕
  if (state.phase === 'event') {
    const event = helper.currentEvent(state);
    const isAmbient = event && (event.kind === 'ambient' || !helper.visibleChoices(state, event).length);
    if (!isAmbient) throw new GameError('NOT_CONTINUING', '此刻不能继续。', 409);
    resolveAmbient(state, event);
    helper.bumpRev(state);
    return state;
  }

  if (state.phase !== 'result') throw new GameError('NOT_CONTINUING', '此刻不能继续。', 409);

  if (state.pendingEnding) {
    buildEnding(state, state.pendingEnding);
    state.phase = 'ended';
    helper.bumpRev(state);
    return state;
  }

  state.turn += 1;
  nextTurn(state);
  helper.bumpRev(state);
  return state;
}

/** 结局 */
function buildEnding(state, cause) {
  const completed = state.config.realms.filter((cfg) => state.realms[cfg.key]?.completed);
  let title = '人间一客';
  let subtitle = '你来过，修过，也认真活过。';

  if (cause.cause === 'battle') {
    title = '战死';
    subtitle = `你死在${cause.opponent || '一场斗法'}手里。大道之争，寸步不让。`;
  } else if (cause.cause === 'deviation') {
    title = '走火入魔';
    subtitle = '没有功法护持的修行，终究在某一处气机上走岔了。';
  } else if (cause.cause === 'heartDeviation') {
    title = '坐化';
    subtitle = '心关没有开，人先没了。';
  } else if (cause.cause === 'abandon') {
    title = '归隐';
    subtitle = '你在半途收起了行囊，回身走进人间。';
  } else if (completed.length === state.config.realms.length && completed.length > 0) {
    title = '四道同辉';
    subtitle = '四道并修，皆至大圆满。大曜史册上，从此多了你的名字。';
  } else if (state.realms.body?.completed) {
    title = '人间武仙';
    subtitle = '肉身成圣，山河为骨。';
  } else if (state.realms.qi?.completed) {
    title = '一气长生';
    subtitle = '气贯长虹，天地皆可吐纳。';
  } else if (state.realms.spirit?.completed) {
    title = '神游太虚';
    subtitle = '灵台无尘，神游八极。';
  } else if (state.realms.heart?.completed) {
    title = '从心而欲';
    subtitle = '不逾矩，不违心，不负此生。';
  } else if (state.worldRecognition) {
    title = '大曜柱石';
    subtitle = '未曾飞升，但许多人因你活了下来。';
  } else if (state.flags.founder) {
    title = '听雨庐主';
    subtitle = '你没能走到最高处，却为后来人留了一盏灯。';
  } else {
    let top = null;
    for (const cfg of state.config.realms) {
      const realm = state.realms[cfg.key];
      if (!realm?.unlocked) continue;
      const score = realm.stageIndex + (realm.completed ? 10 : 0);
      if (!top || score > top.score) top = { cfg, realm, score };
    }
    if (top) {
      title = `${top.cfg.name}有缺`;
      subtitle = `你走到了${top.cfg.name}·${top.cfg.stages[top.realm.stageIndex].name}，差一步，便是一生。`;
    }
  }

  state.ending = { title, subtitle, age: state.age, cause: cause.cause || 'unknown' };
}

/** 中止 */
function abandonRun(state) {
  if (state.phase === 'ended') return state;
  state.pendingEnding = { cause: 'abandon' };
  buildEnding(state, state.pendingEnding);
  state.phase = 'ended';
  helper.bumpRev(state);
  return state;
}

/** 切换主修 */
function focusRealm(state, key) {
  const realm = state.realms[key];
  if (!realm?.unlocked) throw new GameError('REALM_LOCKED', '此道尚未开启。', 400);
  if (realm.completed) throw new GameError('REALM_COMPLETE', '此道已至大圆满。', 400);
  if (!['event', 'result'].includes(state.phase)) throw new GameError('NOT_NOW', '此刻不能换主修。', 409);
  state.activeRealm = key;
  helper.bumpRev(state);
  return state;
}

module.exports = {
  beginEvent,
  nextTurn,
  choose,
  continueRun,
  buildEnding,
  abandonRun,
  focusRealm,
  makeResult,
  journal,
  advanceYears,
  resolveBreakthroughChoice
};
