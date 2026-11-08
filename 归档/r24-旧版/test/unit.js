'use strict';

/*
 * 单元测试：纯函数规则层。
 * 运行：node test/unit.js
 */

const assert = require('node:assert');

const rank = require('../src/model/rules/rank.rule');
const suppression = require('../src/model/rules/suppression.rule');
const layer = require('../src/model/rules/layer.rule');
const attribute = require('../src/model/rules/attribute.rule');
const breakthrough = require('../src/model/rules/breakthrough.rule');
const economy = require('../src/model/rules/economy.rule');

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

/* ─── x 阶 x 品 ─── */
group('x 阶 x 品');

test('锻体第三重 = 1 阶 3 品（调息）', () => {
  const r = rank.rank('body', 2);
  assert.strictEqual(r.rank, 1);
  assert.strictEqual(r.tier, 3);
});

test('炼气法相 = 2 阶 4 品', () => {
  const r = rank.rank('qi', 3);
  assert.strictEqual(r.rank, 2);
  assert.strictEqual(r.tier, 4);
});

test('养灵神游 = 3 阶 4 品', () => {
  const r = rank.rank('spirit', 3);
  assert.strictEqual(r.rank, 3);
  assert.strictEqual(r.tier, 4);
});

test('极境恰好 7 个', () => {
  assert.strictEqual(rank.countExtreme(), 7);
  assert.ok(rank.isExtreme('body', 5));
  assert.ok(rank.isExtreme('qi', 5));
  assert.ok(rank.isExtreme('spirit', 5));
  assert.ok(rank.isExtreme('heart', 0));
  assert.ok(rank.isExtreme('heart', 3));
  assert.ok(!rank.isExtreme('body', 4));
  assert.ok(!rank.isExtreme('heart', -1));
});

test('compare 比较两个 rank', () => {
  assert.strictEqual(rank.compare(rank.rank('body', 0), rank.rank('body', 1)), -1);
  assert.strictEqual(rank.compare(rank.rank('qi', 0), rank.rank('body', 5)), 1);
});

/* ─── 境界压制 ─── */
group('境界压制');

test('高一大境界同小境界 = 强压（D=6）', () => {
  const d = suppression.gap({
    atkRank: 2, atkTier: 1, atkProf: 50,
    defRank: 1, defTier: 1, defProf: 50
  });
  assert.strictEqual(d, 6);
  assert.strictEqual(suppression.tierOf(d).key, 'press');
});

test('高一大境界但低两重 → 压制下降到略优', () => {
  const d = suppression.gap({
    atkRank: 2, atkTier: 1, atkProf: 0,
    defRank: 1, defTier: 3, defProf: 0
  });
  assert.strictEqual(d, 4);
  assert.strictEqual(suppression.tierOf(d).key, 'edge');
});

test('持平时倍率为 1', () => {
  const t = suppression.tierOf(0);
  assert.strictEqual(t.key, 'even');
  assert.strictEqual(t.out, 1);
  assert.strictEqual(t.incoming, 1);
});

test('极境对常境基本必胜（输出 > 3 倍、受伤 < 0.3 倍）', () => {
  assert.ok(suppression.EXTREME_OUT >= 3);
  assert.ok(suppression.EXTREME_IN <= 0.3);
  assert.ok(suppression.EXTREME_FLUKE > 0);
  assert.ok(suppression.EXTREME_FLUKE < 0.001);
});

test('极境内部：修心手段更多，胜率更高', () => {
  const heart最强 = suppression.breadthOf('heart', 3);
  const body最弱 = suppression.breadthOf('body', 5);
  assert.ok(heart最强 > body最弱);
  const win = suppression.extremeWinRate(heart最强, body最弱);
  assert.ok(win > 70, `修心对锻体的胜率应 > 70，实际 ${win}`);
  const even = suppression.extremeWinRate(10, 10);
  assert.strictEqual(even, 50);
});

/* ─── 手段代差 ─── */
group('手段代差');

test('法力高于肉身，灵力高于法力，道意最高', () => {
  assert.ok(layer.rank('mana') > layer.rank('physical'));
  assert.ok(layer.rank('spirit') > layer.rank('mana'));
  assert.ok(layer.rank('dao') > layer.rank('spirit'));
});

test('高 layer 穿透低 layer', () => {
  assert.ok(layer.pierces('mana', 'physical'));
  assert.ok(layer.pierces('spirit', 'mana'));
  assert.ok(!layer.pierces('physical', 'mana'));
  assert.ok(!layer.pierces('mana', 'mana'));
});

/* ─── 属性与系数 ─── */
group('属性与修炼系数');

test('资质越高，锻体系数越大', () => {
  const low = attribute.attrCoef(40, 'body');
  const high = attribute.attrCoef(90, 'body');
  assert.ok(high > low);
  assert.ok(high / low > 1.4, '高低资质应有明显差距');
});

test('锻体系数跨度最大，修心最平', () => {
  const bodySpan = attribute.attrCoef(95, 'body') - attribute.attrCoef(30, 'body');
  const heartSpan = attribute.attrCoef(95, 'heart') - attribute.attrCoef(30, 'heart');
  assert.ok(bodySpan > heartSpan);
});

test('心性衰减：开修心前 3 年 -1，开后 6 年 -1', () => {
  const hidden = { heart: 60, heartDecay: 0 };
  attribute.heartDecay(hidden, 3, false);
  assert.strictEqual(hidden.heart, 59);

  const hidden2 = { heart: 60, heartDecay: 0 };
  attribute.heartDecay(hidden2, 6, true);
  assert.strictEqual(hidden2.heart, 59);
});

test('心性门槛是 90', () => {
  assert.strictEqual(breakthrough.HEART_GATE, 90);
});

/* ─── 破境 ─── */
group('破境规则');

test('第四重所需机缘随属性递减', () => {
  assert.strictEqual(breakthrough.fortuneNeed('pills', 90), 1);
  assert.strictEqual(breakthrough.fortuneNeed('pills', 70), 2);
  assert.strictEqual(breakthrough.fortuneNeed('pills', 50), 3);
  assert.strictEqual(breakthrough.fortuneNeed('pills', 40), 4);
});

test('养灵固定要 3 点机缘，不吃属性减免', () => {
  assert.strictEqual(breakthrough.fortuneNeed('opportunity', 95), 3);
  assert.strictEqual(breakthrough.fortuneNeed('opportunity', 30), 3);
});

test('机缘不足时第四重成功率为 0', () => {
  const chance = breakthrough.effortChance({
    attr: 80, luck: 55, fortune: 0, fortuneNeed: 2
  });
  assert.strictEqual(chance, 0);
});

test('灌顶每次递减：0.5 / 0.35 / 0.25 / 0.15', () => {
  assert.strictEqual(breakthrough.empowerFactor(0), 0.5);
  assert.strictEqual(breakthrough.empowerFactor(1), 0.35);
  assert.strictEqual(breakthrough.empowerFactor(2), 0.25);
  assert.strictEqual(breakthrough.empowerFactor(3), 0.15);
  assert.strictEqual(breakthrough.empowerFactor(9), 0.15);
});

test('跨大境界灌顶固定 0.001%', () => {
  assert.strictEqual(breakthrough.empowerCrossChance(), 0.001);
});

test('炼气前三重自然突破不吃普通丹药（政策分流）', () => {
  const withPills = breakthrough.naturalChance({ policy: 'pills', attr: 70, luck: 55 });
  const treasure = breakthrough.naturalChance({ policy: 'treasure', attr: 70, luck: 55 });
  // 丹药政策下基础值更高，说明药力参与；宝物政策不吃药
  assert.ok(withPills > treasure);
});

/* ─── 经济 ─── */
group('经济规则');

test('赔偿 = 资产 × 1%~10%', () => {
  const low = economy.compensation(100000, 0.01);
  const high = economy.compensation(100000, 0.1);
  assert.strictEqual(low, 1000);
  assert.strictEqual(high, 10000);
});

test('赔偿比例被夹在 1%~10%', () => {
  assert.strictEqual(economy.compensation(100000, 0), 1000);
  assert.strictEqual(economy.compensation(100000, 1), 10000);
});

test('白打工最多 5 年', () => {
  const plan = economy.debtPlan(999999, 100);
  assert.strictEqual(plan.years, 5);
  assert.strictEqual(plan.covered, false);
});

test('声望 < 0 时物价上涨，≥80 时下降', () => {
  assert.ok(economy.reputationEffects(-10).marketMultiplier > 1);
  assert.ok(economy.reputationEffects(90).marketMultiplier < 1);
  assert.strictEqual(economy.reputationEffects(50).marketMultiplier, 1);
});

test('家世供给随年龄递减', () => {
  const young = economy.familySupply('大族', 10);
  const adult = economy.familySupply('大族', 20);
  const elder = economy.familySupply('大族', 30);
  assert.ok(young > adult);
  assert.ok(adult > elder);
});

test('百艺成本按品阶翻倍（2 阶 ×5，3 阶 ×25）', () => {
  const t1 = economy.craftCost('alchemy', 1);
  const t2 = economy.craftCost('alchemy', 2);
  const t3 = economy.craftCost('alchemy', 3);
  assert.strictEqual(t2.money, t1.money * 5);
  assert.strictEqual(t3.money, t1.money * 25);
});

/* ─── 汇总 ─── */
console.log(`\n${'─'.repeat(46)}`);
if (failures.length === 0) {
  console.log(`✓ 单元测试全部通过（${passed} 项）`);
  process.exit(0);
} else {
  console.log(`✗ ${failures.length} 项失败，${passed} 项通过`);
  process.exit(1);
}
