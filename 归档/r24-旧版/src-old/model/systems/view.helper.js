'use strict';

const rng = require('../../util/rng');
const { clamp } = require('../../util/text');
const money = require('../../util/money');
const { PROF_MAX } = require('../rules/breakthrough.rule');
const rank = require('../rules/rank.rule');
const suppression = require('../rules/suppression.rule');
const condition = require('./condition.system');
const eventSystem = require('./event.system');
const realmSystem = require('./realm.system');
const training = require('./training.system');
const economy = require('./economy.system');
const { applyEffects } = require('./effect.system');
const { byId: itemById } = require('../../seed/items.seed');
const { artById } = require('../../seed/arts.seed');
const { IDENTITIES } = require('../../seed/identities.seed');

class GameError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function ctx() {
  const changes = [];
  const notes = [];
  return {
    changes,
    notes,
    change: (label, value, tone = 'plain') => changes.push({ label, value, tone }),
    note: (text) => notes.push(text)
  };
}

function bumpRev(state) {
  state.rev += 1;
}

/** 当前事件对象（含动态选项） */
function currentEvent(state) {
  if (!state.currentEventId) return null;
  if (state.currentEventId === 'sys_breakthrough') {
    return withDynamicChoices(state, eventSystem.BUILT.BREAKTHROUGH);
  }
  const base = eventSystem.get(state.currentEventId);
  if (base) return withDynamicChoices(state, base);
  return null;
}

/** 破境事件的动态选项 */
function breakthroughChoices(state) {
  const choices = [];
  const blocked = state.config.realms
    .map((cfg) => ({ cfg, realm: state.realms[cfg.key] }))
    .filter(({ cfg, realm }) => realm?.unlocked && !realm.completed && realm.blocked && !realm.awaiting)
    .filter(({ cfg, realm }) => {
      const target = cfg.stages[realm.stageIndex + 1];
      if (!target) return false;
      const type = target.breakthrough?.type;
      return type === 'normal' || type === 'effort' || type === 'heart';
    });

  for (const { cfg, realm } of blocked) {
    const target = cfg.stages[realm.stageIndex + 1];
    const type = target.breakthrough?.type || 'normal';

    if (type === 'effort') {
      const need = require('../rules/breakthrough.rule').fortuneNeed(cfg.policy, realmSystem.attrOf(state, cfg.key));
      const have = state.fortune[cfg.key] || 0;
      choices.push({
        id: `bt_${cfg.key}_fortune`,
        label: `冲${cfg.name}·${target.name}（机缘 ${have}/${need}）`,
        hint: have >= need ? '机缘已足，可以一试。' : '机缘不足，此关不认苦功。',
        tags: [cfg.name, '大成'],
        years: 2,
        special: 'effort',
        realmKey: cfg.key,
        enable: {}
      });
      choices.push({
        id: `bt_${cfg.key}_seek`,
        label: '出门寻找机缘',
        hint: '一年，按属性判定能得多少机缘。',
        tags: [cfg.name, '寻机缘'],
        years: 1,
        special: 'seek',
        realmKey: cfg.key
      });
    } else if (type === 'heart') {
      choices.push({
        id: `bt_${cfg.key}_heart`,
        label: `闯${cfg.name}·${target.name}的心关`,
        hint: '可能跌落，也可能身死。',
        tags: [cfg.name, '心关', '险'],
        years: 2,
        special: 'heart',
        realmKey: cfg.key
      });
    } else {
      const allowPills = target.breakthrough?.allowPills;
      const policy = cfg.policy;
      if (policy === 'pills' && allowPills) {
        choices.push({
          id: `bt_${cfg.key}_pill`,
          label: `服丹冲关（${cfg.name}·${target.name}）`,
          hint: '最直接，也最伤根基。',
          tags: [cfg.name, '丹药'],
          years: 1,
          special: 'pill',
          realmKey: cfg.key,
          enable: { items: { peiyuan_pill: 1 } }
        });
      }
      if (policy === 'treasure') {
        choices.push({
          id: `bt_${cfg.key}_treasure`,
          label: `借宝物冲关（${cfg.name}·${target.name}）`,
          hint: '悟性宝物对气关最有用。',
          tags: [cfg.name, '宝物'],
          years: 1,
          special: 'treasure',
          realmKey: cfg.key,
          enable: { items: { wuxin_incense: 1 } }
        });
      }
      choices.push({
        id: `bt_${cfg.key}_meditate`,
        label: `静坐自省（${cfg.name}·${target.name}）`,
        hint: '不借外物，只看自己。',
        tags: [cfg.name, '自修'],
        years: 2,
        special: 'meditate',
        realmKey: cfg.key
      });
      if (target.breakthrough?.allowEmpower) {
        const cost = 3000 * (cfg.combatRank || 1);
        const times = state.borrowed[cfg.key]?.count || 0;
        choices.push({
          id: `bt_${cfg.key}_empower`,
          label: `请高人灌顶（${cfg.name}·${target.name}）`,
          hint: '成功率减半，且永远失去世界认可资格。',
          tags: [cfg.name, '灌顶', '代价大'],
          years: 1,
          special: 'empower',
          realmKey: cfg.key,
          enable: { money: cost }
        });
      }
    }
  }

  choices.push({
    id: 'bt_defer',
    label: '先不破，压着修为去做别的',
    hint: '修为不会跑。',
    tags: ['暂缓'],
    years: 0,
    special: 'defer'
  });

  return choices;
}

/** 注入动态选项 */
function withDynamicChoices(state, event) {
  if (event.kind === 'breakthrough') {
    return { ...event, choices: breakthroughChoices(state) };
  }
  return event;
}

/** 选项是否出现 */
function visibleChoices(state, event) {
  if (!event) return [];
  const list = event.choices || [];
  return list.filter((choice) => {
    if (!condition.visible(state, choice)) return false;
    if (choice.special === 'craft_choice') {
      const needQi = choice.id === 'craft_talisman' || choice.id === 'craft_formation';
      if (needQi && !condition.realmAtLeast(state, 'qi', 2)) return false;
    }
    return true;
  });
}

/** 选项可用性 */
function choiceState(state, choice) {
  const ok = condition.enabled(state, choice);
  return {
    available: ok,
    reason: ok ? '' : condition.whyDisabled(state, choice.enable)
  };
}

/** 公共事件视图 */
function publicEvent(state, event) {
  if (!event) return null;
  const choices = visibleChoices(state, event).map((choice) => {
    const st = choiceState(state, choice);
    return {
      id: choice.id,
      label: choice.label,
      hint: choice.hint || '',
      tags: choice.tags || [],
      kind: choice.category || null,
      years: choice.years ?? event.years ?? 1,
      available: st.available,
      reason: st.reason,
      evil: Boolean(choice.evil)
    };
  });
  return {
    id: event.id,
    kind: event.kind,
    icon: event.icon,
    title: event.title,
    kicker: event.kicker || '',
    body: event.body,
    years: event.years || 1,
    special: event.special || null,
    choices,
    forcedBy: event.forcedBy || null
  };
}

/** 掷骰判定 */
function evaluateCheck(state, check) {
  if (!check) return { passed: true, chance: 100 };
  const attr = state.hidden[check.stat] ?? 55;
  const chance = clamp(50 + (attr - (check.difficulty || 55)) + (state.hidden.luck - 55) * 0.35, 15, 95);
  return { passed: rng.roll(chance), chance };
}

function branchOf(choice, passed) {
  if (!choice.check) {
    return { effects: choice.effects || {}, text: choice.text || '', battle: choice.battle || null };
  }
  const branch = passed ? choice.success : choice.failure;
  return {
    effects: { ...(choice.effects || {}), ...(branch?.effects || {}) },
    text: branch?.text || choice.text || '',
    battle: branch?.battle || null
  };
}

/** 大考结算 */
function resolveExam(state, choice, c) {
  const bonus = choice.effects?.bonus || 0;
  const edu = state.education;
  const study = edu.study;
  const score =
    state.hidden.aptitude * 0.3 +
    state.hidden.insight * 0.26 +
    state.hidden.heart * 0.12 +
    study * 1.6 +
    (state.merit || 0) * 0.8 +
    (state.flags.leadership ? 6 : 0) +
    rand(-5, 5) +
    bonus;

  edu.examScore = Math.round(score);
  edu.lastExamAge = state.age;
  const pass = edu.examScore >= (state.config.admission?.examPassScore || 57);
  edu.examRank = pass ? (score >= 78 ? '甲等' : score >= 68 ? '乙等' : '丙等') : null;

  if (!pass) {
    // 15 岁只考不判：落榜也留在府学，16 岁再统一判定学籍
    c.note?.('你落榜了。太学大考一生只有一次，不会再有第二次机会。');
  } else {
    c.note?.('你过了大考。可是否入学，要等到十六岁那年，看那时你有没有破胎。');
  }

  return {
    pass,
    paragraphs: pass
      ? [
          '放榜那日，贡院外人山人海。你在榜上找到了自己的名字。',
          `成绩：${edu.examRank}。但太学要的不是一个分数，是一个能扛事的人。`,
          '真正决定你进不进的，是十六岁那年你有没有踏入炼气·破胎。'
        ]
      : [
          '放榜那日，你从榜首看到榜尾，没有找到自己的名字。',
          '大考一生只有一次。你把考篮丢进了护城河。'
        ]
  };
}

function rand(min, max) {
  return rng.int(min, max);
}

module.exports = {
  GameError,
  ctx,
  bumpRev,
  currentEvent,
  withDynamicChoices,
  visibleChoices,
  choiceState,
  publicEvent,
  evaluateCheck,
  branchOf,
  resolveExam,
  breakthroughChoices
};
