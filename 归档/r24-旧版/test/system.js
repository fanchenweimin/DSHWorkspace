'use strict';

/*
 * 系统测试：状态机、八类事件、门槛/破境、16 岁判定、经济循环、战斗压制、权限分层。
 * 运行：node test/system.js
 */

const assert = require('node:assert');

const { createState } = require('../src/model/state/create.state');
const turn = require('../src/model/systems/turn.system');
const realm = require('../src/model/systems/realm.system');
const eventSystem = require('../src/model/systems/event.system');
const condition = require('../src/model/systems/condition.system');
const helper = require('../src/model/systems/view.helper');
const action = require('../src/model/systems/action.system');
const combat = require('../src/model/systems/combat.system');
const economy = require('../src/model/systems/economy.system');
const serializer = require('../src/controller/serializer/state.view');
const { FATES } = require('../src/seed/fates.seed');
const { TALENTS } = require('../src/seed/talents.seed');
const { IDENTITIES, soulMass, gainFromSoulMass } = require('../src/seed/identities.seed');

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

function group(title) {
  console.log(`\n${title}`);
}

function quietCtx() {
  return { changes: [], notes: [], change() {}, note() {} };
}

/* ─── 开局状态 ─── */
group('开局状态');

test('七岁开局，蒙学，只有锻体开启', () => {
  const s = createState('测试');
  assert.strictEqual(s.age, 7);
  assert.strictEqual(s.education.stage, '蒙学');
  assert.ok(s.realms.body.unlocked);
  assert.ok(!s.realms.qi.unlocked);
  assert.ok(!s.realms.spirit.unlocked);
  assert.ok(!s.realms.heart.unlocked);
});

test('一人一个命格，2–3 个天赋', () => {
  for (let i = 0; i < 20; i += 1) {
    const s = createState(`测${i}`);
    assert.ok(FATES.some((f) => f.key === s.fate), '命格必须来自命格表');
    assert.ok(s.talents.length >= 2 && s.talents.length <= 3, '天赋应为 2–3 个');
    assert.strictEqual(new Set(s.talents).size, s.talents.length, '天赋不能重复');
  }
});

test('命格表 28 个，天赋表 100 个', () => {
  assert.strictEqual(FATES.length, 28);
  assert.strictEqual(TALENTS.length, 100);
});

test('初始有蒙学功法与拳脚', () => {
  const s = createState('测试');
  assert.strictEqual(s.methods.body, 'body_school');
  assert.deepStrictEqual(s.arts.body, ['fist_school']);
});

/* ─── 学制与 16 岁判定 ─── */
group('学制与太学判定');

test('11 岁自动升入府学', () => {
  const s = createState('测试');
  s.age = 11;
  realm.applyMilestones(s, quietCtx());
  assert.strictEqual(s.education.stage, '府学');
});

test('16 岁判定：没破胎就肄业', () => {
  const s = createState('测试');
  s.age = 16;
  s.education.stage = '府学';
  s.education.examScore = 80;
  s.hidden.aptitude = 95;
  s.hidden.insight = 95;
  s.realms.qi.unlocked = false;
  realm.decideAdmission(s, quietCtx());
  assert.strictEqual(s.education.stage, '肄业');
  assert.strictEqual(s.education.admission, 'none');
});

test('16 岁判定：破胎 + 大考 + 资质悟性达标 = 直招', () => {
  const s = createState('测试');
  s.age = 16;
  s.education.stage = '府学';
  s.education.examScore = 80;
  s.hidden.aptitude = 95;
  s.hidden.insight = 95;
  s.realms.qi.unlocked = true;
  s.realms.qi.stageIndex = 1;
  realm.decideAdmission(s, quietCtx());
  assert.strictEqual(s.education.stage, '太学');
  assert.strictEqual(s.education.admission, 'direct');
});

test('16 岁判定：破胎 + 大考过，但资质悟性不够 = 特招', () => {
  const s = createState('测试');
  s.age = 16;
  s.education.stage = '府学';
  s.education.examScore = 80;
  s.hidden.aptitude = 60;
  s.hidden.insight = 60;
  s.realms.qi.unlocked = true;
  s.realms.qi.stageIndex = 1;
  realm.decideAdmission(s, quietCtx());
  assert.strictEqual(s.education.stage, '太学');
  assert.strictEqual(s.education.admission, 'special');
});

test('16 岁判定：破胎但大考没过 = 肄业', () => {
  const s = createState('测试');
  s.age = 16;
  s.education.stage = '府学';
  s.education.examScore = 40;
  s.realms.qi.unlocked = true;
  s.realms.qi.stageIndex = 1;
  realm.decideAdmission(s, quietCtx());
  assert.strictEqual(s.education.stage, '肄业');
});

/* ─── 感气 ─── */
group('感气（进府学不等于能感气）');

test('感气可能连续失败多年', () => {
  const s = createState('测试');
  s.age = 12;
  s.education.stage = '府学';
  s.hidden.insight = 12;
  s.hidden.luck = 25;
  s.realms.qi.unlocked = false;
  const ctx = quietCtx();
  for (let i = 0; i < 6; i += 1) {
    realm.trySenseQi(s, ctx);
    if (s.education.qiSensed) break;
  }
  // 低悟性低气运，6 年仍未感应到是可能的
  assert.ok(s.education.qiYears >= 1, '应记录失败年数');
});

test('感气成功后解锁炼气并发功法', () => {
  const s = createState('测试');
  s.age = 12;
  s.education.stage = '府学';
  s.hidden.insight = 100;
  s.hidden.luck = 95;
  s.hidden.caps.insight = 100;
  s.realms.qi.unlocked = false;
  const ctx = quietCtx();
  for (let i = 0; i < 10 && !s.education.qiSensed; i += 1) {
    realm.trySenseQi(s, ctx);
  }
  assert.strictEqual(s.education.qiSensed, true);
  assert.ok(s.realms.qi.unlocked);
  assert.ok(s.methods.qi, '应自动学会府学引气篇');
});

/* ─── 年满 15 大考 ─── */
group('大考');

test('大考只在 15 岁府学出现，考完不直接决定入学', () => {
  const s = createState('测试');
  s.age = 15;
  s.education.stage = '府学';
  s.education.lastExamAge = null;
  turn.nextTurn(s);
  assert.strictEqual(s.currentEventId, 'n_exam');

  const event = helper.currentEvent(s);
  const choices = helper.visibleChoices(s, event);
  assert.ok(choices.length > 0);
  turn.choose(s, choices[0].id);
  assert.strictEqual(s.phase, 'result');
  assert.ok(s.education.examScore != null, '应记录成绩');
  // 关键：入学由 16 岁判定，不由大考直接给太学
  assert.notStrictEqual(s.education.admission, 'direct', '15 岁不应直接直招');
  assert.ok(
    s.education.admission === null || s.education.admission === 'none' || s.education.admission === 'special',
    `15 岁不应直接定直招，实际 ${s.education.admission}`
  );
});

/* ─── 八类事件 ─── */
group('八类事件');

test('事件库至少包含 8 种 kind 中的 5 种槽位类', () => {
  const kinds = new Set();
  for (const ev of eventSystem.byKind('ambient')) kinds.add('ambient');
  for (const ev of eventSystem.byKind('normal')) kinds.add('normal');
  for (const ev of eventSystem.byKind('encounter')) kinds.add('encounter');
  for (const ev of eventSystem.byKind('threshold')) kinds.add('threshold');
  for (const ev of eventSystem.byKind('forced')) kinds.add('forced');
  assert.ok(kinds.size >= 5, '至少五类槽位事件');
  assert.ok(eventSystem.BUILT.BREAKTHROUGH.kind === 'breakthrough', '破境是独立第 8 类');
});

test('门槛事件走正常概率（权重不高于普通事件最大值）', () => {
  const thresholds = eventSystem.byKind('threshold');
  const normals = eventSystem.byKind('normal');
  const maxNormal = Math.max(...normals.map((e) => e.weight || 10));
  for (const t of thresholds) {
    assert.ok((t.weight || 10) <= maxNormal, `门槛事件 ${t.id} 权重不应超过普通事件`);
  }
});

test('修为满会抽出破境事件（条件必出）', () => {
  const s = createState('测试');
  s.age = 20;
  s.realms.body.prof = 100;
  s.realms.body.blocked = true;
  const drawn = eventSystem.drawNext(s);
  assert.strictEqual(drawn.kind, 'breakthrough');
  assert.strictEqual(drawn.event.id, 'sys_breakthrough');
});

test('破境事件有冲关、寻机缘、暂缓等选项', () => {
  const s = createState('测试');
  s.age = 20;
  s.realms.body.stageIndex = 1;
  s.realms.body.prof = 100;
  s.realms.body.blocked = true;
  s.currentEventId = 'sys_breakthrough';
  s.eventKind = 'breakthrough';
  const event = helper.currentEvent(s);
  const ids = helper.visibleChoices(s, event).map((c) => c.id);
  assert.ok(ids.includes('bt_defer'), '必须有暂缓选项');
  assert.ok(ids.some((id) => id.includes('body')), '必须有锻体相关选项');
});

test('大考事件 special = exam', () => {
  const exam = eventSystem.get('n_exam');
  assert.strictEqual(exam.special, 'exam');
});

/* ─── 门槛与破境分离 ─── */
group('门槛事件 vs 破境事件');

test('修心门槛链三步都在 threshold 类里', () => {
  const ids = eventSystem.byKind('threshold').map((e) => e.id);
  assert.ok(ids.includes('t_life_chain'));
  assert.ok(ids.includes('t_awakening'));
  assert.ok(ids.includes('t_awakening_complete'));
});

test('修心需要心性 ≥90 + 生死 + 大彻大悟', () => {
  const s = createState('测试');
  s.age = 30;
  s.hidden.heart = 95;
  s.hidden.caps.heart = 100;
  s.flags.life_and_death = true;
  s.flags.great_awakening = true;
  realm.checkUnlocks(s, quietCtx());
  assert.ok(s.realms.heart.unlocked);
  assert.ok(s.flags.heart_open);
});

test('心性不到 90 就开不了修心', () => {
  const s = createState('测试');
  s.age = 30;
  s.hidden.heart = 85;
  s.hidden.caps.heart = 100;
  s.flags.life_and_death = true;
  s.flags.great_awakening = true;
  realm.checkUnlocks(s, quietCtx());
  assert.ok(!s.realms.heart.unlocked);
});

test('心性高但本性恶，也能开修心（两个字段互不干涉）', () => {
  const s = createState('测试');
  s.age = 30;
  s.hidden.heart = 95;
  s.hidden.caps.heart = 100;
  s.hidden.nature = 5; // 大恶
  s.flags.life_and_death = true;
  s.flags.great_awakening = true;
  realm.checkUnlocks(s, quietCtx());
  assert.ok(s.realms.heart.unlocked, '本性恶不影响修心');
});

/* ─── 世界认可资格 ─── */
group('世界认可资格');

test('没有第四重修为圆满时不能追认可', () => {
  const s = createState('测试');
  s.realms.body.stageIndex = 2;
  assert.ok(!realm.canSeekRecognition(s));
});

test('第四重修为圆满才能追认可', () => {
  const s = createState('测试');
  s.realms.body.stageIndex = 4;
  s.realms.body.prof = 100;
  assert.ok(realm.canSeekRecognition(s));
});

test('灌顶过的人永久失去认可资格', () => {
  const s = createState('测试');
  s.realms.body.stageIndex = 4;
  s.realms.body.prof = 100;
  s.borrowed.body = { count: 1 };
  assert.ok(!realm.canSeekRecognition(s));
});

/* ─── 养灵只认认知 ─── */
group('养灵');

test('养灵静修不加修为', () => {
  const s = createState('测试');
  s.age = 40;
  s.realms.spirit.unlocked = true;
  s.activeRealm = 'spirit';
  s.realms.spirit.prof = 0;
  const before = s.realms.spirit.prof;
  action.cultivate(s, 'cult_spirit');
  assert.strictEqual(s.realms.spirit.prof, before, '养宁静修不应涨修为');
});

test('养灵认知事件才涨修为', () => {
  const s = createState('测试');
  s.realms.spirit.unlocked = true;
  s.activeRealm = 'spirit';
  const before = s.realms.spirit.prof;
  const ctx = quietCtx();
  require('../src/model/systems/effect.system').applyEffects(s, { cognition: 2 }, ctx);
  assert.ok(s.realms.spirit.prof > before);
});

/* ─── 身份与灵量 ─── */
group('身份与灵量');

test('城主灵量约 150 万，增益约 ×4.1', () => {
  const mass = soulMass(IDENTITIES.lord);
  assert.ok(mass > 1_000_000, `城主灵量应超过百万，实际 ${mass}`);
  const gain = gainFromSoulMass(mass);
  assert.ok(gain > 4 && gain < 4.3, `城主增益应约 4.1，实际 ${gain}`);
});

test('宗门弟子灵量为 0，增益为 1', () => {
  const mass = soulMass(IDENTITIES.disciple);
  assert.strictEqual(mass, 0);
  assert.strictEqual(gainFromSoulMass(0), 1);
});

test('散修增益显著低于城主', () => {
  const rogue = gainFromSoulMass(soulMass(IDENTITIES.rogue));
  const lord = gainFromSoulMass(soulMass(IDENTITIES.lord));
  assert.ok(lord - rogue > 2.5);
});

test('城主 + 将军不叠加（增量 < 1%）', () => {
  const lordMass = soulMass(IDENTITIES.lord);
  const generalMass = soulMass(IDENTITIES.general);
  const merged = gainFromSoulMass(lordMass + generalMass);
  const alone = gainFromSoulMass(lordMass);
  assert.ok((merged - alone) / alone < 0.01);
});

/* ─── 经济循环 ─── */
group('经济循环');

test('年度结算会收税、扣生计', () => {
  const s = createState('测试');
  s.age = 20;
  s.identity.base = 'citizen';
  s.flags.family = '孤儿'; // 无家世供给，净额必为支出
  s.items.money = 100000;
  const before = s.items.money;
  const result = economy.settleYear(s);
  assert.ok(s.items.money < before, '无家世供给时应净支出');
  assert.ok(result.changes.length > 0);
});

test('交不起税会记欠税标记', () => {
  const s = createState('测试');
  s.age = 20;
  s.identity.base = 'citizen';
  s.flags.family = '孤儿'; // 无家世供给
  s.items.money = 0;
  s.flags.owedTax = false;
  economy.settleYear(s);
  assert.strictEqual(s.flags.owedTax, true);
});

test('百艺修炼要材料，材料不足会拒绝', () => {
  const s = createState('测试');
  s.skills.alchemy = 1;
  s.items.money = 0;
  delete s.items.herb;
  const check = economy.canAffordCraft(s, 'alchemy', 1);
  assert.strictEqual(check.ok, false);
});

test('城主府招募按品阶分期', () => {
  const low = economy.patronage(1);
  const high = economy.patronage(5);
  assert.ok(high.settle > low.settle);
  assert.ok(high.salary > low.salary);
});

/* ─── 战斗压制 ─── */
group('战斗压制');

test('炼气感气 vs 锻体体魄：强压', () => {
  const s = createState('测试');
  s.realms.qi.unlocked = true;
  s.realms.qi.stageIndex = 0;
  s.activeRealm = 'qi';
  const gap = combat.computeGap(s, {
    realmKey: 'body', stageIndex: 0, prof: s.realms.qi.prof
  });
  assert.strictEqual(gap.key, 'press');
});

test('炼气感气 vs 锻体调息：只是略优（压制力下降）', () => {
  const s = createState('测试');
  s.realms.qi.unlocked = true;
  s.realms.qi.stageIndex = 0;
  s.realms.qi.prof = 0;
  s.activeRealm = 'qi';
  const gap = combat.computeGap(s, { realmKey: 'body', stageIndex: 2, prof: 0 });
  assert.strictEqual(gap.key, 'edge');
});

test('极境对常境：极境压制', () => {
  const s = createState('测试');
  s.realms.body.stageIndex = 5;
  s.activeRealm = 'body';
  const gap = combat.computeGap(s, { realmKey: 'spirit', stageIndex: 0, prof: 0 });
  assert.strictEqual(gap.key, 'extreme');
});

test('常境对极境：被极境压制', () => {
  const s = createState('测试');
  s.realms.body.stageIndex = 1;
  s.activeRealm = 'body';
  const gap = combat.computeGap(s, { realmKey: 'spirit', stageIndex: 5, prof: 0 });
  assert.strictEqual(gap.key, 'doomed');
});

test('没有兵器术时只有凡俗劈砍', () => {
  const s = createState('测试');
  s.items.iron_sword = 1;
  s.equipment.weapon = 'iron_sword';
  s.battle = {
    opponent: { name: 'x', basePower: 3, realmKey: 'body', stageIndex: 0 },
    gap: { out: 1, incoming: 1 },
    round: 1,
    intent: 'attack',
    playerHp: 100,
    enemyHp: 100,
    buff: 0,
    artCooldown: 0,
    qi: 20,
    log: []
  };
  const list = combat.actionList(s);
  const weapon = list.find((a) => a.id === 'weapon');
  assert.ok(weapon.name.includes('凡俗劈砍'), '无剑术时只出凡俗劈砍');
});

test('学了剑术就用剑招', () => {
  const s = createState('测试');
  s.items.iron_sword = 1;
  s.equipment.weapon = 'iron_sword';
  s.arts.body = ['fist_school', 'sword_basic'];
  s.battle = {
    opponent: { name: 'x', basePower: 3, realmKey: 'body', stageIndex: 0 },
    gap: { out: 1, incoming: 1 },
    round: 1,
    intent: 'attack',
    playerHp: 100,
    enemyHp: 100,
    buff: 0,
    artCooldown: 0,
    qi: 20,
    log: []
  };
  const weapon = combat.actionList(s).find((a) => a.id === 'weapon');
  assert.ok(!weapon.name.includes('凡俗劈砍'));
});

/* ─── 权限分层 ─── */
group('权限分层');

test('访客视图不含 changes / tags / hidden', () => {
  const s = createState('测试');
  turn.nextTurn(s);
  const guest = serializer.serializeState(s, 'guest');
  const json = JSON.stringify(guest);
  assert.ok(!json.includes('changes'), '访客不应看到 changes');
  assert.ok(!json.includes('aptitude'), '访客不应看到资质数值');
  assert.ok(!json.includes('lifespan'), '访客不应看到寿命');
  assert.ok(!guest.admin, '访客不应有 admin 块');
});

test('管理员视图含隐藏属性与寿命', () => {
  const s = createState('测试');
  turn.nextTurn(s);
  const admin = serializer.serializeState(s, 'sysadmin');
  assert.ok(admin.admin, '管理员应有 admin 块');
  assert.ok(typeof admin.admin.lifespan === 'number');
  assert.ok(typeof admin.admin.hidden.aptitude === 'number');
});

test('时长对所有人可见', () => {
  const s = createState('测试');
  turn.nextTurn(s);
  const guest = serializer.serializeState(s, 'guest');
  if (guest.event?.choices?.length) {
    for (const c of guest.event.choices) {
      assert.ok(typeof c.years === 'number', '访客也应看到时长');
    }
  }
});

test('user 与 guest 权限相同', () => {
  const s = createState('测试');
  turn.nextTurn(s);
  const guest = serializer.serializeState(s, 'guest');
  const user = serializer.serializeState(s, 'user');
  assert.deepStrictEqual(Object.keys(guest).sort(), Object.keys(user).sort());
});

/* ─── 汇总 ─── */
console.log(`\n${'─'.repeat(46)}`);
if (failures.length === 0) {
  console.log(`✓ 系统测试全部通过（${passed} 项）`);
  process.exit(0);
} else {
  console.log(`✗ ${failures.length} 项失败，${passed} 项通过`);
  for (const f of failures) {
    console.log(`\n[${f.name}]`);
    console.log(f.error.stack.split('\n').slice(0, 4).join('\n'));
  }
  process.exit(1);
}
