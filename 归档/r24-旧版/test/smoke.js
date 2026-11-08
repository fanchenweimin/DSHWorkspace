'use strict';

/*
 * 冒烟测试：随机走完若干世人生，确保状态机不卡死、结局存在、不泄露隐藏信息。
 * 运行：node test/smoke.js
 */

const assert = require('node:assert');

const { createState } = require('../src/model/state/create.state');
const turn = require('../src/model/systems/turn.system');
const helper = require('../src/model/systems/view.helper');
const combat = require('../src/model/systems/combat.system');
const action = require('../src/model/systems/action.system');
const serializer = require('../src/controller/serializer/state.view');

const LIVES = Number(process.env.LIVES) || 30;
const VERBOSE = process.env.VERBOSE === '1';

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/** 走完一世 */
function runLife(index, style = 'random') {
  const state = createState(`试炼${index}`);
  turn.nextTurn(state); // 抽出第一幕
  let guard = 0;

  while (state.phase !== 'ended' && guard < 700) {
    guard += 1;

    if (state.phase === 'event') {
      const event = helper.currentEvent(state);
      if (!event) throw new Error(`第 ${index} 世：事件 ${state.currentEventId} 找不到`);

      // 有时优先修炼（模拟勤修玩家）
      if (style === 'grind' && Math.random() < 0.5) {
        const options = action.cultivateOptions(state).filter((o) => o.available && !o.stub);
        if (options.length) {
          action.cultivate(state, pick(options).id, 1);
          continue;
        }
      }

      const visible = helper.visibleChoices(state, event);
      if (!visible.length) {
        // 环境事件或无可选项：直接推进
        turn.choose(state, 'skip');
        continue;
      }
      const usable = visible.filter((c) => helper.choiceState(state, c).available);
      const chosen = usable.length ? pick(usable) : visible[0];
      turn.choose(state, chosen.id);
    } else if (state.phase === 'result') {
      turn.continueRun(state);
    } else if (state.phase === 'battle') {
      const battle = state.battle;
      if (battle.over) {
        combat.finishBattle(state);
      } else {
        const actions = combat.actionList(state).filter((a) => a.available);
        assert.ok(actions.length > 0, '战斗没有可用行动');
        combat.performAction(state, pick(actions).id);
      }
    } else {
      throw new Error(`未知阶段：${state.phase}`);
    }

    if (VERBOSE && guard % 20 === 0) {
      const view = serializer.serializeState(state, 'guest');
      console.log(
        `  ${view.age}岁 ${view.education.stage} | ` +
          view.realms.map((r) => `${r.name}·${r.stageName}${r.completed ? '圆满' : ''}`).join(' / ')
      );
    }
  }

  return { state, guard };
}

function main() {
  console.log(`冒烟测试：${LIVES} 世人生\n`);

  const endings = new Map();
  const realmUnlock = { body: 0, qi: 0, spirit: 0, heart: 0 };
  let failures = 0;
  let totalAge = 0;

  for (let i = 1; i <= LIVES; i += 1) {
    const style = i % 2 === 0 ? 'grind' : 'random';
    let result;

    try {
      result = runLife(i, style);
    } catch (error) {
      failures += 1;
      console.error(`✗ 第 ${i} 世异常：${error.message}`);
      if (VERBOSE) console.error(error.stack);
      continue;
    }

    const { state, guard } = result;

    if (state.phase !== 'ended') {
      failures += 1;
      console.error(
        `✗ 第 ${i} 世未结束：age=${state.age} phase=${state.phase} event=${state.currentEventId} guard=${guard}`
      );
      continue;
    }

    if (!state.ending) {
      failures += 1;
      console.error(`✗ 第 ${i} 世结束但没有结局`);
      continue;
    }

    totalAge += state.age;
    const title = state.ending.title || '无结局';
    endings.set(title, (endings.get(title) || 0) + 1);

    for (const key of Object.keys(realmUnlock)) {
      if (state.realms[key]?.unlocked) realmUnlock[key] += 1;
    }

    // 公开视图不得泄露隐藏信息
    const guest = serializer.serializeState(state, 'guest');
    const json = JSON.stringify(guest);
    assert.ok(!json.includes('"hidden"'), '访客视图泄露 hidden');
    assert.ok(!json.includes('lifespan'), '访客视图泄露寿命');
    assert.ok(!json.includes('"changes"'), '访客视图泄露数值变化');
    assert.ok(!/"aptitude":/.test(json), '访客视图泄露资质数值');
  }

  const ok = LIVES - failures;

  console.log(`\n${'─'.repeat(46)}`);
  if (failures > 0) {
    console.log(`✗ ${failures} 世失败，${ok} 世通过`);
    process.exit(1);
  }

  console.log(`✓ 通过 ${LIVES} 世人生模拟`);
  console.log(`  结局分布：${[...endings.entries()].map(([k, v]) => `${k}×${v}`).join('  ')}`);
  console.log(`  平均寿数：${Math.round(totalAge / LIVES)} 岁`);
  console.log(
    `  境界解锁：锻体 ${realmUnlock.body} · 炼气 ${realmUnlock.qi} · 养灵 ${realmUnlock.spirit} · 修心 ${realmUnlock.heart}`
  );

  // 抽样打印一局
  const sample = runLife(99, 'grind').state;
  console.log(`\n  样例：${sample.name}，${sample.age}岁，${sample.ending.title}`);
  console.log(`  ${sample.ending.subtitle}`);
  console.log(
    `  学籍 ${sample.education.stage} · 最终境界 ${sample.config.realms
      .filter((cfg) => sample.realms[cfg.key]?.unlocked)
      .map((cfg) => `${cfg.name}·${cfg.stages[sample.realms[cfg.key].stageIndex].name}`)
      .join(' / ')}`
  );

  process.exit(0);
}

main();
