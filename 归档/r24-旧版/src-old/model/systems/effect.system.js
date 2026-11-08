'use strict';

const money = require('../../util/money');
const { clamp } = require('../../util/text');
const { adjustHidden, raiseCap } = require('../rules/attribute.rule');
const rng = require('../../util/rng');
const training = require('./training.system');
const { byId: itemById } = require('../../seed/items.seed');
const { methodById, artById } = require('../../seed/arts.seed');

/**
 * 应用 effects。
 * ctx = { changes: [], notes: [], change(label, value, tone), note(text) }
 */
function applyEffects(state, effects, ctx) {
  if (!effects) return;

  if (effects.focus && state.realms[effects.focus]?.unlocked) {
    state.activeRealm = effects.focus;
  }

  // 修为
  if (effects.prof) {
    for (const [key, base] of Object.entries(effects.prof)) {
      training.applyTraining(state, key, base, ctx);
    }
  }

  // 认知（养灵专用）
  if (effects.cognition) {
    state.cognition += effects.cognition;
    training.applyCognition(state, effects.cognition * 3, ctx);
    ctx?.note?.('你对生命的理解更深了一层。');
  }

  // 机缘
  if (effects.fortune) {
    for (const [key, amount] of Object.entries(effects.fortune)) {
      state.fortune[key] = Math.max(0, (state.fortune[key] || 0) + amount);
      if (amount > 0) ctx?.change?.('机缘', `+${amount}`, 'fortune');
    }
  }

  // 课业
  if (effects.study) {
    state.education.study = clamp(state.education.study + effects.study, 0, 50);
    ctx?.change?.('课业', `+${effects.study}`, 'study');
  }

  // 钱
  if (effects.money) {
    state.items.money = Math.max(0, (state.items.money || 0) + effects.money);
    ctx?.change?.('钱', `${effects.money > 0 ? '+' : '-'}${money.format(Math.abs(effects.money))}`, 'money');
  }

  // 物品
  if (effects.items) {
    for (const [id, count] of Object.entries(effects.items)) {
      if (count > 0) {
        state.items[id] = (state.items[id] || 0) + count;
        ctx?.change?.(itemById(id)?.name || id, `+${count}`, 'item');
      } else {
        const take = Math.min(state.items[id] || 0, -count);
        state.items[id] = Math.max(0, (state.items[id] || 0) - take);
        if (state.items[id] === 0) delete state.items[id];
        ctx?.change?.(itemById(id)?.name || id, `-${take}`, 'item');
      }
    }
  }

  // 装备
  if (effects.equip && itemById(effects.equip)?.type === 'weapon') {
    state.equipment.weapon = effects.equip;
  }

  // 百艺
  if (effects.skill) {
    for (const [key, amount] of Object.entries(effects.skill)) {
      const max = 5;
      const before = state.skills[key] || 0;
      state.skills[key] = clamp(before + amount, 0, max);
      if (state.skills[key] !== before) {
        ctx?.change?.(key, `晋至 ${state.skills[key]} 阶`, 'skill');
      }
    }
  }

  // 功法 / 术法
  if (effects.learnMethod) {
    const method = methodById(effects.learnMethod);
    if (method) {
      const current = methodById(state.methods[method.realm]);
      if (!current || method.grade.rank * 10 + method.grade.tier >= current.grade.rank * 10 + current.grade.tier) {
        state.methods[method.realm] = method.id;
        state.mastery[method.id] = state.mastery[method.id] || 10;
        ctx?.change?.('功法', `《${method.name}》`, 'method');
      }
    }
  }

  if (effects.learnArt) {
    const art = artById(effects.learnArt);
    if (art) {
      if (!state.arts[art.realm]) state.arts[art.realm] = [];
      if (!state.arts[art.realm].includes(art.id)) {
        state.arts[art.realm].push(art.id);
        ctx?.change?.('术法', `《${art.name}》`, 'art');
      }
    }
  }

  // 上限必须先于属性变化，否则「大彻大悟拓开上限」会被旧上限卡住
  if (effects.raiseCap) {
    for (const [key, amount] of Object.entries(effects.raiseCap)) {
      if (amount === 'max') {
        // 直接封顶：大彻大悟这类「脱胎换骨」的场合用
        state.hidden.caps[key] = 100;
      } else {
        raiseCap(state.hidden, key, amount);
      }
      ctx?.change?.(key === 'heart' ? '心性' : key === 'insight' ? '悟性' : '根骨', '上限有拓', 'hidden');
    }
  }

  // 隐藏属性
  if (effects.hidden) {
    for (const [key, delta] of Object.entries(effects.hidden)) {
      const actual = adjustHidden(state.hidden, key, delta);
      const labels = { aptitude: '根骨', insight: '悟性', heart: '心性', nature: '本性', luck: '气运' };
      if (actual !== 0) ctx?.change?.(labels[key] || key, actual > 0 ? '微有精进' : '略受挫损', 'hidden');
    }
  }

  // 气运
  if (effects.luck) {
    adjustHidden(state.hidden, 'luck', effects.luck);
    ctx?.change?.('气运', effects.luck > 0 ? '风向微转' : '逆风拂面', 'luck');
  }

  // 悟性/心性 buff（宝物）
  if (effects.insightBuff) {
    state.hidden.insightBuff = { value: effects.insightBuff, untilAge: state.age + (effects.buffYears || 3) };
    ctx?.change?.('悟性', `+${effects.insightBuff}（${effects.buffYears || 3}年）`, 'buff');
  }
  if (effects.heartBuff) {
    state.hidden.heartBuff = { value: effects.heartBuff, untilAge: state.age + (effects.buffYears || 3) };
    ctx?.change?.('心性', `+${effects.heartBuff}（${effects.buffYears || 3}年）`, 'buff');
  }

  // 记功 / 声望
  if (effects.merit) {
    state.merit = Math.max(0, state.merit + effects.merit);
    ctx?.change?.('记功', `+${effects.merit}`, 'merit');
  }
  if (effects.reputation) {
    state.reputation = clamp(state.reputation + effects.reputation, -50, 100);
    ctx?.change?.('声望', effects.reputation > 0 ? `+${effects.reputation}` : `${effects.reputation}`, 'reputation');
  }

  // flags
  if (effects.flags) {
    for (const [key, value] of Object.entries(effects.flags)) state.flags[key] = value;
  }

  // 世界认可（带资格校验）
  if (effects.worldRecognition && !state.worldRecognition) {
    if (!require('./realm.system').canSeekRecognition(state)) {
      state.merit += 5;
      ctx?.note?.('这一份认可太重，你现在的境界还承不住。它化为了一点记功。');
      ctx?.change?.('记功', '+5', 'merit');
    } else {
      state.worldRecognition = true;
      ctx?.note?.('世界认可了你。你的名字已经不只属于你自己。');
      ctx?.change?.('世界认可', '已获得', 'recognition');
    }
  }

  // 悟道
  if (effects.trueDao && !state.trueDao) {
    state.trueDao = true;
    ctx?.note?.('你真正看见了道。');
    ctx?.change?.('悟道', '已得', 'dao');
  }

  // 寿元
  if (effects.lifespan) {
    state.lifespan = Math.max(state.age + 1, state.lifespan + effects.lifespan);
  }

  // 强行结束
  if (effects.ending) {
    state.pendingEnding = { cause: effects.ending };
  }
}

module.exports = { applyEffects };
