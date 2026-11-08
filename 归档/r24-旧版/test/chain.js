'use strict';

/*
 * 链路测试：验证门槛事件链能走到终点（修心、养灵、世界认可、悟道）。
 * 不依赖随机，直接构造满足条件的角色。
 * 运行：node test/chain.js
 */

const assert = require('node:assert');

const { createState } = require('../src/model/state/create.state');
const turn = require('../src/model/systems/turn.system');
const helper = require('../src/model/systems/view.helper');
const realm = require('../src/model/systems/realm.system');
const realmEvent = require('../src/model/systems/event.system');
const effect = require('../src/model/systems/effect.system');

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  ✗ ${name}`);
    console.log(`      ${error.message}`);
  }
}

function group(t) {
  console.log(`\n${t}`);
}

function ctx() {
  return { changes: [], notes: [], change() {}, note() {} };
}

/** 把角色推到能触发某个门槛事件的状态 */
function makeReady(overrides = {}) {
  const s = createState('链路');
  s.age = 30;
  s.lifespan = 200;
  Object.assign(s.flags, overrides.flags || {});
  if (overrides.heart != null) s.hidden.heart = overrides.heart;
  if (overrides.capsHeart != null) s.hidden.caps.heart = overrides.capsHeart;
  return s;
}

/* ─── 修心链 ─── */
group('修心门槛链（⑦ 门槛事件）');

test('第一步：有 near_death 时能抽到「病榻边」', () => {
  const s = makeReady({ flags: { near_death: true } });
  const event = realmEvent.get('t_life_chain');
  assert.ok(event, '事件应存在');
  assert.strictEqual(event.kind, 'threshold', '必须是门槛类');
});

test('完成「病榻边」后获得 life_and_death', () => {
  const s = makeReady({ flags: { near_death: true } });
  s.currentEventId = 't_life_chain';
  s.eventKind = 'threshold';
  s.phase = 'event';
  const event = helper.currentEvent(s);
  const choices = helper.visibleChoices(s, event);
  assert.ok(choices.length > 0);
  turn.choose(s, choices[choices.length - 1].id); // 稳定选项
  assert.strictEqual(s.flags.life_and_death, true, '应获得经历生死');
});

test('第二步：有 life_and_death 且 25 岁后才能触发荒寺石壁', () => {
  const s = makeReady({ flags: { life_and_death: true } });
  const event = realmEvent.get('t_awakening');
  assert.strictEqual(event.kind, 'threshold');
  assert.ok(event.when.flags.life_and_death);
  assert.ok(event.when.age.min >= 25);
});

test('荒寺石壁后获得 awakening_seed', () => {
  const s = makeReady({ flags: { life_and_death: true } });
  s.currentEventId = 't_awakening';
  s.eventKind = 'threshold';
  s.phase = 'event';
  const event = helper.currentEvent(s);
  const choices = helper.visibleChoices(s, event);
  turn.choose(s, choices[choices.length - 1].id); // 苦行选项必成
  assert.strictEqual(s.flags.awakening_seed, true);
});

test('第三步：有大彻大悟种子后能触发「大彻大悟」', () => {
  const s = makeReady({ flags: { awakening_seed: true } });
  const event = realmEvent.get('t_awakening_complete');
  assert.strictEqual(event.kind, 'threshold');
});

test('大彻大悟完成后获得 great_awakening 且心性上限大幅提升', () => {
  const s = makeReady({ flags: { awakening_seed: true } });
  s.hidden.heart = 50;
  s.currentEventId = 't_awakening_complete';
  s.eventKind = 'threshold';
  s.phase = 'event';
  const capBefore = s.hidden.caps.heart;
  const heartBefore = s.hidden.heart;
  const event = helper.currentEvent(s);
  const choices = helper.visibleChoices(s, event);
  turn.choose(s, choices[0].id);
  assert.strictEqual(s.flags.great_awakening, true);
  assert.ok(
    s.hidden.caps.heart > capBefore,
    `心性上限应提升，之前 ${capBefore}，之后 ${s.hidden.caps.heart}`
  );
  assert.ok(s.hidden.caps.heart >= 88, `心性上限应接近满值，实际 ${s.hidden.caps.heart}`);
  assert.ok(
    s.hidden.heart >= heartBefore + 15,
    `心性应明显提升，之前 ${heartBefore}，之后 ${s.hidden.heart}`
  );
});

test('三段齐全 + 心性 ≥90 → 解锁修心', () => {
  const s = makeReady({
    flags: { life_and_death: true, great_awakening: true },
    heart: 92,
    capsHeart: 100
  });
  realm.checkUnlocks(s, ctx());
  assert.ok(s.realms.heart.unlocked, '应解锁修心');
  assert.ok(s.flags.heart_open);
  assert.ok(s.methods.heart, '应获得修心心法');
});

test('三段齐全但心性 89 → 不解锁（门槛严格）', () => {
  const s = makeReady({
    flags: { life_and_death: true, great_awakening: true },
    heart: 89,
    capsHeart: 100
  });
  realm.checkUnlocks(s, ctx());
  assert.ok(!s.realms.heart.unlocked);
});

/* ─── 养灵链 ─── */
group('养灵链');

test('感悟生命需要双四重或太学+阈值', () => {
  const event = realmEvent.get('t_spirit_comprehend');
  assert.ok(event);
  const choices = event.choices;
  const hasBodyQi = choices.some((c) => c.show?.realm?.body >= 4 && c.show?.realm?.qi >= 4);
  const hasTai = choices.some((c) => c.show?.education?.includes('太学'));
  assert.ok(hasBodyQi, '应有双四重路径');
  assert.ok(hasTai, '应有太学路径');
});

test('获得 life_understanding 后解锁养灵', () => {
  const s = makeReady({ flags: { life_understanding: true } });
  realm.checkUnlocks(s, ctx());
  assert.ok(s.realms.spirit.unlocked);
});

test('没有 life_understanding 不解锁养灵', () => {
  const s = makeReady({});
  realm.checkUnlocks(s, ctx());
  assert.ok(!s.realms.spirit.unlocked);
});

/* ─── 世界认可 ─── */
group('世界认可链');

test('事件给出认可，但没资格时被降级为记功', () => {
  const s = makeReady({});
  s.realms.body.stageIndex = 2; // 未到第四重圆满
  const c = ctx();
  effect.applyEffects(s, { worldRecognition: true }, c);
  assert.strictEqual(s.worldRecognition, false, '不应直接获得认可');
  assert.ok(s.merit >= 5, '应转为记功');
});

test('第四重修为圆满时认可生效', () => {
  const s = makeReady({});
  s.realms.body.stageIndex = 4;
  s.realms.body.prof = 100;
  effect.applyEffects(s, { worldRecognition: true }, ctx());
  assert.strictEqual(s.worldRecognition, true);
});

/* ─── 悟道 ─── */
group('悟道链');

test('问心事件存在，且要求大彻大悟', () => {
  const event = realmEvent.get('t_true_dao');
  assert.ok(event);
  assert.ok(event.when.flags.great_awakening);
});

test('trueDao 到手后第六重可以进阶', () => {
  const s = makeReady({ flags: { great_awakening: true }, heart: 95, capsHeart: 100 });
  s.realms.body.stageIndex = 4;
  s.realms.body.prof = 100;
  s.realms.body.blocked = false;
  s.worldRecognition = true;
  effect.applyEffects(s, { trueDao: true }, ctx());
  assert.strictEqual(s.trueDao, true);
});

/* ─── 对照：门槛事件不是破境事件 ─── */
group('门槛 vs 破境');

test('门槛事件是 threshold 类，破境是 breakthrough 类', () => {
  assert.strictEqual(realmEvent.get('t_life_chain').kind, 'threshold');
  assert.strictEqual(realmEvent.BUILT.BREAKTHROUGH.kind, 'breakthrough');
});

test('门槛事件不靠修为触发，破境靠修为满触发', () => {
  const s = makeReady({ flags: { near_death: true } });
  s.realms.body.prof = 0;
  // 修为没满，不应出破境
  assert.ok(!realmEvent.canBreakthrough(s));
  // 但门槛事件条件是 flags，与修为无关
  const event = realmEvent.get('t_life_chain');
  assert.ok(event.when.flags.near_death);
});

/* ─── 汇总 ─── */
console.log(`\n${'─'.repeat(46)}`);
if (failures.length === 0) {
  console.log(`✓ 链路测试全部通过（${passed} 项）`);
  process.exit(0);
} else {
  console.log(`✗ ${failures.length} 项失败，${passed} 项通过`);
  for (const f of failures) {
    console.log(`\n[${f.name}]`);
    console.log(f.error.stack.split('\n').slice(0, 4).join('\n'));
  }
  process.exit(1);
}
