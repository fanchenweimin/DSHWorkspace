'use strict';

const rng = require('../../util/rng');
const { clamp } = require('../../util/text');
const money = require('../../util/money');
const helper = require('./view.helper');
const { GameError } = helper;
const condition = require('./condition.system');
const realmSystem = require('./realm.system');
const training = require('./training.system');
const economy = require('./economy.system');
const { PROF_MAX } = require('../rules/breakthrough.rule');

/*
 * 常驻行动：
 *   ④ 修炼 cultivate —— 功法 / 术法 / 兵器 / 百艺 / 闭关
 *   ⑥ 委托 commission —— 按年刷新的任务
 * 不占事件槽位，任何时候都能选。
 */

/** 可修炼的项目 */
function cultivateOptions(state) {
  const options = [];
  const inSchool = ['蒙学', '府学', '太学'].includes(state.education.stage);

  for (const cfg of state.config.realms) {
    const realm = state.realms[cfg.key];
    if (!realm?.unlocked || realm.completed) continue;
    if (cfg.policy === 'opportunity') {
      // 养灵：只能靠认知，静修无效
      options.push({
        id: `cult_${cfg.key}`,
        label: `静修${cfg.name}`,
        hint: '养灵之修不在静坐，坐一年也未必有得。',
        tags: [cfg.name, '无效'],
        years: 1,
        available: true,
        reason: '',
        stub: true
      });
      continue;
    }
    const method = state.methods[cfg.key];
    options.push({
      id: `cult_${cfg.key}`,
      label: method ? `以《${state.methods[cfg.key] ? methodName(state, cfg.key) : '自悟'}》修${cfg.name}` : `自悟${cfg.name}`,
      hint: method ? `主修${cfg.name}，一年可长一截。` : '没有功法，进境极慢。',
      tags: [cfg.name, method ? '功法' : '自悟'],
      years: 1,
      available: true,
      reason: ''
    });
  }

  // 百艺
  const craftTable = [
    { key: 'alchemy', name: '炼丹', needQi: false },
    { key: 'forging', name: '炼器', needQi: false },
    { key: 'talisman', name: '符箓', needQi: true },
    { key: 'formation', name: '阵法', needQi: true }
  ];
  for (const craft of craftTable) {
    const level = state.skills[craft.key] || 0;
    if (craft.needQi && !condition.realmAtLeast(state, 'qi', 2)) continue;
    if (state.education.stage === '蒙学') continue;
    const cost = economy.canAffordCraft(state, craft.key, Math.max(1, level));
    options.push({
      id: `craft_${craft.key}`,
      label: `修炼${craft.name}（当前 ${level} 阶）`,
      hint: cost.ok ? `需 ${money.format(cost.cost.money)} 与材料。` : cost.reason,
      tags: [craft.name],
      years: 1,
      available: cost.ok,
      reason: cost.ok ? '' : cost.reason
    });
  }

  // 闭关
  options.push({
    id: 'cult_seclusion',
    label: '闭关（可指定年限）',
    hint: '一年一年判定，钱花光会被打断。',
    tags: ['闭关'],
    years: 1,
    available: true,
    reason: '',
    seclusion: true
  });

  return options;
}

function methodName(state, realmKey) {
  const { methodById } = require('../../seed/arts.seed');
  return methodById(state.methods[realmKey])?.name || '自悟';
}

/** 执行修炼 */
function cultivate(state, optionId, years) {
  const opts = cultivateOptions(state);
  const opt = opts.find((o) => o.id === optionId);
  if (!opt) throw new GameError('NO_OPTION', '没有这项修炼。', 400);
  if (!opt.available) throw new GameError('NOT_AVAILABLE', opt.reason, 400);

  const c = helper.ctx();

  if (optionId === 'cult_seclusion') {
    return doSeclusion(state, years, c);
  }

  if (optionId.startsWith('craft_')) {
    const skill = optionId.slice('craft_'.length);
    return doCraftTraining(state, skill, c);
  }

  const realmKey = optionId.slice('cult_'.length);
  const cfg = state.config.realms.find((r) => r.key === realmKey);
  if (!cfg) throw new GameError('NO_REALM', '没有这一道。', 400);

  // 养灵：静修无效
  if (cfg.policy === 'opportunity') {
    c.note?.('你坐了一年。什么也没有多出来。养灵不认静坐。');
    realmSystem.advanceAge(state, 1, c);
    return finishTraining(state, c, '静修', 1);
  }

  // 主修切换
  if (state.activeRealm !== realmKey) {
    state.activeRealm = realmKey;
    c.note?.(`你改以${cfg.name}为主修。`);
  }

  training.applyTraining(state, realmKey, 34, c);
  realmSystem.advanceAge(state, 1, c, (s) => {
    const settled = economy.settleYear(s);
    for (const note of settled.notes) c.note?.(note);
    for (const change of settled.changes) c.changes.push(change);
    if (settled.laborTriggered) {
      c.note?.('劳役打断了你的修行。');
      return true;
    }
    return false;
  });

  if (!state.pendingEnding) {
    realmSystem.resolveAwaiting(state, c);
    realmSystem.processProgression(state, c);
  }

  return finishTraining(state, c, `修炼${cfg.name}`, 1);
}

/** 闭关：逐年判定 */
function doSeclusion(state, years, c) {
  const cap = Math.max(1, Math.min(50, state.lifespan - state.age - 1));
  const total = clamp(years || 1, 1, Math.max(1, cap));
  let done = 0;
  let interrupted = false;

  realmSystem.advanceAge(state, total, c, (s, index) => {
    const settled = economy.settleYear(s);
    for (const note of settled.notes) c.note?.(note);
    for (const change of settled.changes) c.changes.push(change);
    if (settled.laborTriggered) {
      c.note?.('第 ' + index + ' 年，劳役找上门来，闭关中断。');
      interrupted = true;
      return true;
    }
    done = index;
    // 每年给一点修为
    for (const cfg of s.config.realms) {
      if (cfg.policy === 'opportunity') continue;
      const realm = s.realms[cfg.key];
      if (!realm?.unlocked || realm.completed) continue;
      training.applyTraining(s, cfg.key, 26, null);
    }
    return false;
  });

  if (!state.pendingEnding) {
    realmSystem.resolveAwaiting(state, c);
    realmSystem.processProgression(state, c);
  }

  const actual = interrupted ? done : total;
  c.note?.(`你闭关 ${actual} 年。`);
  return finishTraining(state, c, '闭关', actual);
}

/** 百艺修炼 */
function doCraftTraining(state, skill, c) {
  const level = state.skills[skill] || 0;
  const tier = state.skillTier[skill] || 1;
  const pay = economy.payCraft(state, skill, Math.max(1, level));
  if (!pay.ok) throw new GameError('NO_MATERIAL', pay.reason, 400);

  const talent = measureTalent(state, skill);
  const attr = skill === 'forging' ? state.hidden.aptitude : state.hidden.insight;
  const chance = clamp(20 + talent * 0.5 + (attr - 50) * 0.6 - level * 6, 8, 90);

  c.change?.('材料', `-${money.format(pay.cost.money)}`, 'money');

  realmSystem.advanceAge(state, 1, c);
  if (rng.roll(chance)) {
    if (level < 5) {
      state.skills[skill] = level + 1;
      c.change?.(skillCn(skill), `晋至 ${level + 1} 阶`, 'skill');
      c.note?.(`你的${skillCn(skill)}又进了一步。`);
    } else {
      c.note?.('已至此道尽头。');
    }
  } else {
    c.note?.(`你在${skillCn(skill)}上摸索了一年，火候总差一点。`);
  }

  return finishTraining(state, c, `修炼${skillCn(skill)}`, 1);
}

/** 百艺天资：从天赋推导 0–10 */
function measureTalent(state, skill) {
  const { TALENTS } = require('../../seed/talents.seed');
  const matched = state.talents
    .map((key) => TALENTS.find((t) => t.key === key))
    .filter((t) => t && t.craft === skill);
  if (!matched.length) return 0;
  return matched.reduce((max, t) => Math.max(max, t.tier), 0) * 3;
}

function skillCn(skill) {
  return { alchemy: '炼丹', forging: '炼器', talisman: '符箓', formation: '阵法' }[skill] || skill;
}

/** 生成结果 */
function finishTraining(state, c, title, years) {
  let text = '一年过去了。';
  if (years > 1) text = `${years} 年过去了。`;
  state.result = {
    title,
    kicker: `景和${12 + state.age - 7}年 · ${state.age}岁`,
    paragraphs: [text],
    changes: c.changes,
    notes: c.notes,
    years
  };
  state.phase = 'result';
  state.currentEventId = null;
  helper.bumpRev(state);
  return state;
}

/* ─────────── ⑥ 委托 ─────────── */

const COMMISSION_TEMPLATES = [
  { id: 'cm_gather', name: '山中采药', years: 1, money: 700, items: { herb: 2 }, risk: 0.15, desc: '药铺收灵草，去城外走一趟。' },
  { id: 'cm_copy', name: '书肆抄经', years: 1, money: 500, study: 2, risk: 0, desc: '替书肆抄几卷旧经。' },
  { id: 'cm_patrol', name: '仙司巡夜', years: 1, money: 900, merit: 1, risk: 0.1, desc: '巡几夜街巷。' },
  { id: 'cm_escort', name: '护送商队', years: 2, money: 1800, risk: 0.3, desc: '过黑风坳，缺个护卫。' },
  { id: 'cm_teach', name: '巷口蒙童', years: 1, money: 600, study: 1, risk: 0, desc: '替坊里蒙童代几天课。' }
];

function commissions(state) {
  const rng2 = rng;
  const count = 3;
  const pool = [...COMMISSION_TEMPLATES];
  const out = [];
  for (let i = 0; i < count && pool.length; i += 1) {
    const index = rng2.int(0, pool.length - 1);
    const tpl = pool.splice(index, 1)[0];
    const years = tpl.years + (state.age > 40 ? 0 : 0);
    out.push({
      id: tpl.id + '_' + i,
      name: tpl.name,
      desc: tpl.desc,
      years,
      money: tpl.money,
      merit: tpl.merit || 0,
      study: tpl.study || 0,
      items: tpl.items || null,
      risk: tpl.risk
    });
  }
  return out;
}

/** 接受委托 */
function takeCommission(state, commissionId) {
  const list = commissions(state);
  const task = list.find((t) => t.id === commissionId) || list[0];
  const c = helper.ctx();

  let success = true;
  if (task.risk > 0) {
    const chance = clamp(60 + (state.hidden.aptitude - 50) * 0.3 + (state.hidden.luck - 55) * 0.3, 20, 92);
    success = rng.roll(chance);
  }

  if (success) {
    if (task.money) {
      state.items.money = (state.items.money || 0) + task.money;
      c.change?.('工钱', `+${money.format(task.money)}`, 'money');
    }
    if (task.merit) {
      state.merit += task.merit;
      c.change?.('记功', `+${task.merit}`, 'merit');
    }
    if (task.study) {
      state.education.study = clamp(state.education.study + task.study, 0, 50);
      c.change?.('课业', `+${task.study}`, 'study');
    }
    if (task.items) {
      for (const [id, count] of Object.entries(task.items)) {
        state.items[id] = (state.items[id] || 0) + count;
      }
      c.note?.('你带回了一些材料。');
    }
    c.note?.('这一趟有惊无险。');
  } else {
    const loss = Math.round(task.money * 0.3);
    state.items.money = Math.max(0, (state.items.money || 0) - loss);
    c.change?.('赔钱', `-${money.format(loss)}`, 'money');
    c.note?.('事情没有办成，还赔了钱。');
  }

  realmSystem.advanceAge(state, task.years, c, (s) => {
    const settled = economy.settleYear(s);
    for (const note of settled.notes) c.note?.(note);
    for (const change of settled.changes) c.changes.push(change);
    if (settled.laborTriggered) return true;
    return false;
  });

  if (!state.pendingEnding) {
    realmSystem.resolveAwaiting(state, c);
    realmSystem.processProgression(state, c);
  }

  return finishTraining(state, c, task.name, task.years);
}

module.exports = {
  cultivateOptions,
  cultivate,
  commissions,
  takeCommission,
  measureTalent
};
