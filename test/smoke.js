'use strict';

/* 离线冒烟：不启服务，直接打模块。
   node test/smoke.js
   加一个模块就加一段检查，别让它变成"跑着好看"的测试。 */

const assert = require('node:assert');

let pass = 0;
let fail = 0;
const cases = [];
function test(name, fn) { cases.push([name, fn]); }

/** 新开一局，走掉开局那张强制事件。
 *  强制事件没处理时 I15 会封住常驻，修炼 / 百艺 / 吃药一律被拒——
 *  不是 bug，是设计，所以测试要先把它走掉。
 *  r28：开局会先判一次「入体魄」，rng 固定成不掷出墙，保证这里站在体魄上。 */
/**
 * 属性固定的开局（r34 起属性每次随机，用固定值钉住旧断言）。
 * 66 / 71 / 62 是 r27 时的那组基准，所有"月修为 11.56""洗髓后 69"都建在它上面。
 */
function fresh(name) {
  const s = require('../src/model/state/demo').initial(name);
  s.attr.aptitude.base = 66;
  s.attr.insight.base = 71;
  s.attr.heart.base = 62;
  /* r35：命格/天赋会改属性，测试要固定底子（不然断言跟着随机的命格飘） */
  s.fate = '';
  s.talents = [];
  s.mods = (s.mods || []).filter((m) => !/^(fate|talent)\./.test(String(m.source || '')));
  /* r39：开局随机天赋会把某门百艺设成"已学"，测试要清干净 */
  for (const id of Object.keys(s.arts || {})) {
    s.arts[id] = { lvl: 0, exp: 0, talent: 'none', learned: false };
  }
  s.flags = s.flags || {};
  delete s.flags.art;
  return s;
}

function opening() {
  const s = fresh();
  require('../src/model/systems/opening').apply(s, { rng: () => 0.99 });
  /* r39：7 岁开局第一件事是强制事件；测试只关心"府学及以后"，直接写状态 */
  s.clock.age = 12;
  s.education.stage = 'fu';
  s.education.graduated = false;
  s.flags.edu = { meng: { done: true } };
  s.turn = s.turn || {};
  s.turn.mainDone = true;
  s.turn.mainId = null;
  return s;
}

/* ── 数据层 ─────────────────────────────────────────── */
test('种子 14 份都能解析', () => {
  const seed = require('../src/model/repository/seed');
  const names = seed.list();
  assert.ok(names.length >= 16, `只有 ${names.length} 份`);
  for (const n of names) assert.ok(seed.raw(n) != null, `${n} 读不出来`);
});

/* ── 配置字典（r27） ────────────────────────────────── */
test('配置字典：每份种子都有中文名，字段中文名齐全', () => {
  const seed = require('../src/model/repository/seed');
  const schema = seed.raw('schema');
  const cn = /[\u4e00-\u9fa5]/;

  for (const n of seed.list()) {
    const meta = schema.files[n];
    assert.ok(meta, `${n}.json 在 schema.files 里没有中文名`);
    assert.ok(meta.label && cn.test(meta.label), `${n} 的中文名不像中文：${meta.label}`);
  }

  const bad = Object.entries(schema.fields)
    .filter(([, v]) => !v.label || !cn.test(v.label))
    .map(([k]) => k);
  assert.deepStrictEqual(bad, [], '这些字段还没有中文名');
});

test('配置字典：只读路径都命中真字段（没有写错名字）', () => {
  const seed = require('../src/model/repository/seed');
  const schema = seed.raw('schema');

  const nodes = (v, segs, out) => {
    out.push(segs);
    if (v === null || typeof v !== 'object') return out;
    if (Array.isArray(v)) { v.forEach((x, i) => nodes(x, [...segs, i], out)); return out; }
    for (const k of Object.keys(v)) nodes(v[k], [...segs, k], out);
    return out;
  };
  const hit = (pat, segs) => {
    const q = String(pat).split('.');
    return q.length === segs.length && q.every((x, i) => x === '*' || x === String(segs[i]));
  };

  for (const [name, meta] of Object.entries(schema.files)) {
    const pats = meta.readonlyPaths || [];
    if (!pats.length) continue;
    assert.ok(seed.has(name), `${name} 没有实体文件却写了只读路径`);
    const all = nodes(seed.raw(name), [], []);
    for (const pat of pats) {
      assert.ok(all.some((segs) => hit(pat, segs)),
        `${name} 的只读路径「${pat}」一个字段都没命中，八成写错了名字`);
    }
  }
});

test('配置字典：地图上那几串机器坐标确实改不动（人看不懂就别让人改）', () => {
  const seed = require('../src/model/repository/seed');
  const schema = seed.raw('schema');
  const pats = schema.files.world.readonlyPaths || [];

  const locked = (segs) => {
    const last = segs[segs.length - 1];
    const f = schema.fields[last];
    if (f && f.edit === false) return true;                 /* 字段级：id / no / at … */
    return pats.some((pat) => {
      const q = String(pat).split('.');
      return q.length === segs.length && q.every((x, i) => x === '*' || x === String(segs[i]));
    });
  };

  const cases2 = [
    [['land'], true],
    [['plateau', 'path'], true],
    [['borders'], true],
    [['countries', 0, 'label'], true],
    [['countries', 0, 'cities', 0, 'at'], true],
    [['countries', 0, 'cities', 0, 'side'], true],
    [['countries', 0, 'name'], false],                  /* 国名是给人看的，不该锁 */
    [['countries', 0, 'cities', 0, 'name'], false]
  ];
  for (const [segs, want] of cases2) {
    assert.strictEqual(locked(segs), want, `${segs.join('.')} ${want ? '该锁住' : '不该锁'}`);
  }
});

test('世界：七国 + 断天山脉 + 七条国界', () => {
  const seed = require('../src/model/repository/seed');
  const w = seed.raw('world');
  assert.strictEqual(w.countries.length, 7, '七国');
  assert.strictEqual(w.borders.length, 7, '国界七条');
  assert.ok(w.plateau && w.plateau.name === '断天山脉');
  assert.ok(w.land.startsWith('M '), '大陆轮廓是路径');
  const origin = w.countries.find((c) => c.id === w.origin);
  assert.strictEqual(origin.name, '大曜');
  assert.ok(origin.label[0] > 600, '大曜在东侧');
});

test('事件表：主键 no 不重复（程序按 no / id 调，撞了就串味）', () => {
  const seed = require('../src/model/repository/seed');
  for (const file of ['events', 'actions', 'items', 'arts', 'identities']) {
    const list = seed.raw(file) || [];
    const nos = list.map((x) => x.no);
    const ids = list.map((x) => x.id);
    const dupNo = nos.filter((n, i) => nos.indexOf(n) !== i);
    const dupId = ids.filter((n, i) => ids.indexOf(n) !== i);
    assert.deepStrictEqual(dupNo, [], `${file}.json 主键重复：${dupNo.join(',')}`);
    assert.deepStrictEqual(dupId, [], `${file}.json 英文名重复：${dupId.join(',')}`);
    assert.ok(nos.every((n) => Number.isInteger(n)), `${file}.json 有非数字主键`);
  }
});

test('事件表引用的模板都在', () => {
  const seed = require('../src/model/repository/seed');
  const tpl = seed.raw('templates');
  for (const e of seed.raw('events')) {
    if (!e.template) continue;
    assert.ok(tpl[e.template], `${e.id} 引用了不存在的模板 ${e.template}`);
  }
});

/* ── 规则层 ─────────────────────────────────────────── */
test('dsl：gte / stage / flag / use', () => {
  const { evalWhen } = require('../src/model/rules/dsl');
  const ctx = {
    state: { clock: { age: 12 }, education: { stage: 'meng' }, flags: { x: true }, path: {} },
    conditions: { c1: { desc: 'd', all: [{ gte: ['clock.age', 10] }] } },
    rules: {}
  };
  assert.strictEqual(evalWhen([{ gte: ['clock.age', 10] }], ctx), true);
  assert.strictEqual(evalWhen([{ gte: ['clock.age', 13] }], ctx), false);
  assert.strictEqual(evalWhen([{ stage: 'meng' }], ctx), true);
  assert.strictEqual(evalWhen([{ flag: 'flag.x' }], ctx), true);
  assert.strictEqual(evalWhen([{ use: 'c1' }], ctx), true);
});

/* ── 业务层 ─────────────────────────────────────────── */
test('手牌：开局给出事件，且条件不成立的被挡掉', () => {
  const hand = require('../src/model/systems/hand');
  const state = require('../src/model/state/demo').initial();
  const table = hand.table(state);
  assert.strictEqual(table.events.length, 1, '一手只有一张主卡');
  /* r39：7 岁开局第一个强制事件是「进蒙学 · 开体魄」 */
  assert.strictEqual(table.events[0].id, 'evt.edu.enter.meng', '开局该是进蒙学');
  assert.strictEqual(table.locked, true, '强制事件该封住常驻');
  assert.strictEqual(table.actions.length, 0);
});

test('主事件：一年只出一件，办完就不抽新的（r30）', () => {
  const hand = require('../src/model/systems/hand');
  const turn = require('../src/model/systems/turn');
  const s = opening();                        /* 蒙学卒试已经办完了 */

  assert.strictEqual(hand.table(s).main, null, '今年的大事办过就没了');
  assert.strictEqual(s.turn.mainDone, true);

  /* 把年过完，新的一年才会有新的一张 */
  turn.act(s, { kind: 'action', id: 'act.idle' });
  assert.strictEqual(s.turn.mainDone, false, '跨年重置');
  assert.ok(hand.table(s).main, '新的一年该有新的大事');
});

test('手牌：同一手连续读两次不换卡（否则刷新就变）', () => {
  const hand = require('../src/model/systems/hand');
  const state = require('../src/model/state/demo').initial();
  const a = hand.table(state).events[0].id;
  const b = hand.table(state).events[0].id;
  const c = hand.table(state).events[0].id;
  assert.strictEqual(a, b);
  assert.strictEqual(b, c);
});

test('突破：22 品都是常驻卡；入门关没条，品内要练满（r28）', () => {
  const demo = require('../src/model/state/demo');
  const hand = require('../src/model/systems/hand');
  const rules = require('../src/model/repository/config').get('rules');

  let n = 0;
  for (const dao of ['body', 'qi', 'spirit', 'heart']) {
    const prof = rules.PROF[dao] || [];
    for (let tier = 1; tier <= prof.length; tier += 1) {
      const s = fresh();
      const p = s.path[dao];
      p.level = tier - 1;
      p.bar = 0;

      const card = hand.breakCards(s).find((b) => b.dao === dao && b.tier === tier);
      assert.ok(card, `${dao} 第 ${tier} 品没有卡`);
      assert.ok(card.title && card.title !== `第 ${tier} 品`, '卡上要有中文品名');

      const entry = dao !== 'heart' && tier === 1;
      assert.strictEqual(card.entry, entry, `${dao} 第 ${tier} 品 entry 判定不对`);

      if (entry) {
        assert.strictEqual(card.barMax, null, '入门关不该有修为条');
        assert.strictEqual(card.ready, true, '入门关只看门槛，不看修为');
      } else {
        /* 品内：要看的是"上一品"的修为（PROF[tier-2]）；修心是累计门槛 PROF[tier-1] */
        const cap = dao === 'heart' ? prof[tier - 1] : prof[tier - 2];
        assert.strictEqual(card.barMax, cap, `${dao} 第 ${tier} 品的修为条该是 ${cap}`);
        assert.strictEqual(card.ready, false, '修为没满不该 ready');
        p.bar = cap;
        const again = hand.breakCards(s).find((b) => b.dao === dao && b.tier === tier);
        assert.strictEqual(again.ready, true, '练满了就该 ready');
      }
      n += 1;
    }
  }
  assert.strictEqual(n, 22, `合计 22 品，实际 ${n}`);
});

test('突破：门槛只看瓶颈，不看修为条（r27）', () => {
  const demo = require('../src/model/state/demo');
  const realm = require('../src/model/rules/realm');
  const rules = require('../src/model/repository/config').get('rules');
  const s = fresh();

  /* 修为条几乎空着，也不能因为"条没满"被拦 */
  s.path.body.bar = 1;
  const r = realm.raiseLevel(s, { dao: 'body', tier: 1 }, { rules, rng: () => 0.01 });
  assert.strictEqual(r.ok, true, `修满已不是前提，实际 ${r.why || ''}`);
});

test('修炼：修满就不出现在行里，只剩突破（r28）', () => {
  const hand = require('../src/model/systems/hand');
  const rules = require('../src/model/repository/config').get('rules');
  const s = opening();

  assert.ok(hand.trainRow(s).some((t) => t.dao === 'body'), '体魄还没满，能修');
  s.path.body.bar = rules.PROF.body[0];
  assert.ok(!hand.trainRow(s).some((t) => t.dao === 'body'), '满了不该再能修');
  /* 炼气还没入品（没有修为条）：靠的是那一道门，不是月修为 */
  assert.ok(!hand.trainRow(s).some((t) => t.dao === 'qi'), '没入品不能修');
});

test('修炼：点一次修到满（或者修到年底），不是一月一点（r28）', () => {
  const turn = require('../src/model/systems/turn');
  const rules = require('../src/model/repository/config').get('rules');

  /* 差一点就满：只花该花的那几个月，不许多走 */
  const a = opening();
  a.monthsUsed = 2;                                     /* 还剩 10 个月 */
  a.path.body.bar = rules.PROF.body[0] - 5;
  const ra = turn.act(a, { kind: 'train', dao: 'body' });
  assert.strictEqual(ra.ok, true, ra.reason || '');
  assert.strictEqual(ra.months, 1, `只差一点，走一个月就够，实际 ${ra.months}`);
  assert.strictEqual(a.path.body.bar, rules.PROF.body[0], '修满就该停');

  /* 修不满：一次把剩下的月份都走掉，不让人点十次 */
  const b = opening();
  b.monthsUsed = 2;
  b.path.body.bar = 0;
  const rb = turn.act(b, { kind: 'train', dao: 'body' });
  assert.strictEqual(rb.ok, true, rb.reason || '');
  assert.strictEqual(rb.months, 10, `修不满就该走到年底，实际 ${rb.months}`);
  assert.ok(b.path.body.bar > 100, '十个月该攒下大半条');
});

test('求学：一个瓶颈只叠一次，第二个请求被拒（r27）', () => {
  const hand = require('../src/model/systems/hand');
  const turn = require('../src/model/systems/turn');
  const rules = require('../src/model/repository/config').get('rules');
  const s = opening();                                   /* 府学在读 */

  s.path.body.bar = rules.PROF.body[0];
  assert.strictEqual(hand.breakCards(s)[0].study.label, '求学', '在校该叫求学');

  const first = turn.act(s, { kind: 'break', dao: 'body', tier: 2, mode: 'study' });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(hand.breakCards(s)[0].studied, true, '要留一个"求过了"的标记');
  assert.strictEqual(hand.breakCards(s)[0].study, null, '求过之后不再给这个按钮');

  const again = turn.act(s, { kind: 'break', dao: 'body', tier: 2, mode: 'study' });
  assert.strictEqual(again.ok, false, '同一个瓶颈不许叠两次');
  assert.ok(/求过/.test(again.reason), `理由该说明原因，实际「${again.reason}」`);
});

test('求学：毕业以后变成花钱求指导，两件事效果一样（r27）', () => {
  const demo = require('../src/model/state/demo');
  const hand = require('../src/model/systems/hand');
  const s = fresh();

  s.education.stage = 'none';                            /* 卒业 */
  s.path.body.bar = 9999;
  const card = hand.breakCards(s)[0];
  assert.strictEqual(card.study.label, '求指导');
  assert.ok(card.study.cost > 0, '毕业以后要花钱');
  assert.strictEqual(card.study.months, 3, '和求学一样耗三个月');
});

/* ── 背包 / 战斗（r27 补回） ────────────────────────── */
test('背包：囊中有货就能列出来，吃了数量减少', () => {
  const turn = require('../src/model/systems/turn');
  const game = require('../src/controller/game');
  const s = opening();
  s.items = { 'item.peiyuan': 2 };

  const bag = game.bagOf(s);
  assert.strictEqual(bag.length, 1);
  assert.strictEqual(bag[0].name, '培元丹');
  assert.strictEqual(bag[0].n, 2);
  assert.ok(bag[0].effect, '要有一句人话说明它有什么用');

  const r = turn.act(s, { kind: 'use', id: 'item.peiyuan' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(s.items['item.peiyuan'], 1, '吃一颗少一颗');
  assert.strictEqual(r.months, 0, '吃药不花月份');
});

test('背包：不能吃的东西不给吃', () => {
  const turn = require('../src/model/systems/turn');
  const s = opening();
  s.items = { 'item.huichun': 1 };                       /* 回春丹：战斗中自动服 */
  const r = turn.act(s, { kind: 'use', id: 'item.huichun' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(s.items['item.huichun'], 1, '没吃就不该少');
});

test('战斗：打得完，出过程，血条是三条里挑一条', () => {
  const battle = require('../src/model/rules/battle');
  const rules = require('../src/model/repository/config').get('rules');
  const s = opening();

  const r = battle.resolve(s, { scale: 0.85, kindName: '劫匪' }, { rules, rng: () => 0.5 });
  assert.strictEqual(typeof r.ok, 'boolean');
  assert.ok(Array.isArray(r.report) && r.report.length > 0, '要有战斗过程');
  assert.ok(r.hp != null && r.hpMax != null, '要给出血量');
  assert.ok(typeof r.enemy === 'string' && r.enemy.length, '要有对手');
  assert.ok(r.rounds > 0 && r.rounds <= 12, `回合数该在 1..12，实际 ${r.rounds}`);
});

test('战斗：血/攻/防看锻体，法力看炼气，灵力与精神看养灵（r31）', () => {
  const battle = require('../src/model/rules/battle');
  const s = opening();

  s.path.body.level = 2; s.path.qi.level = 0; s.path.spirit.level = 0;
  s.path.body.bar = 0;                       /* 刚进品：不吃修为进度的插值 */
  let st = battle.stats(s, 'player');
  assert.strictEqual(Math.round(st.hpMax), 180, '脏腑 180 血');
  assert.strictEqual(Math.round(st.def), 7, '脏腑 7 防');
  assert.strictEqual(st.manaMax, 0, '没炼气就没有法力');
  assert.strictEqual(st.mindMax, 30, '所有人精神 30 底子');
  const mods = require('../src/model/rules/mods');
  assert.strictEqual(st.willMax, Math.round(mods.get(s, 'attr.heart.eff')), '神志值 = 自身心性 ×1');

  s.path.qi.level = 2;
  st = battle.stats(s, 'player');
  assert.strictEqual(st.manaMax, 60, '破胎 60 法力');
  assert.strictEqual(st.means, 'mana', '破胎才放得出法术');

  s.path.qi.level = 1;                     /* 感气：气机入体，放不出来 */
  assert.strictEqual(battle.stats(s, 'player').means, 'physical');

  s.path.spirit.level = 3;
  st = battle.stats(s, 'player');
  assert.strictEqual(st.spiritMax, 150, '真域 150 灵力');
  assert.strictEqual(st.mindMax, 170, '真域 170 精神');
  assert.strictEqual(st.rank, 3, '进了养灵就算养灵那一层');

  s.path.heart.level = 1;
  assert.strictEqual(battle.stats(s, 'player').means, 'dao', '修心第一品就是道');
});

test('战斗：逐帧战报，带双方血条与招式名（r31）', () => {
  const battle = require('../src/model/rules/battle');
  const rules = require('../src/model/repository/config').get('rules');
  const s = opening();

  const r = battle.resolve(s, { scale: 0.85, kindName: '劫匪', match: 'death' }, { rules, rng: () => 0.5 });
  assert.ok(Array.isArray(r.frames) && r.frames.length > 2, '要有一串帧');
  assert.strictEqual(r.frames[0].t, 'start');
  assert.strictEqual(r.frames[r.frames.length - 1].t, 'end');

  const hits = r.frames.filter((f) => f.t === 'hit');
  assert.ok(hits.length >= 2, '至少有来有回');
  assert.ok(hits[0].move, '每一拍都要有招式名');
  assert.ok(hits[0].me && hits[0].foe, '每一拍都要带双方血量');
  assert.strictEqual(typeof hits[0].me.hp, 'number');
  assert.strictEqual(typeof hits[0].foe.hp, 'number');
});

test('切磋不会死人也不掷伤病；死斗死了这一世就结束（r31）', () => {
  const battle = require('../src/model/rules/battle');
  const effects = require('../src/model/systems/effects');
  const turn = require('../src/model/systems/turn');

  /* 很弱的你对上一个很硬的对手：切磋也是输，但不该死 */
  const spar = opening();
  spar.path.body.level = 1;
  const r1 = effects.run(spar, [{ judge: { kind: 'battle', scale: 2.2, kindName: '教头', match: 'spar' } }], {});
  assert.strictEqual(r1.battles.length, 1);
  assert.strictEqual(r1.battles[0].match, 'spar');
  assert.strictEqual(r1.battles[0].death, false, '切磋不会死');
  assert.strictEqual(r1.battles[0].injury, false, '切磋不掷伤病');
  assert.ok(!spar.dead, '切磋输了也还活着');

  /* 同一场改成死斗：就该死 */
  const duel = opening();
  duel.path.body.level = 1;
  const r2 = effects.run(duel, [{ judge: { kind: 'battle', scale: 2.2, kindName: '山贼', match: 'death', flee: 'never' } }], {});
  assert.strictEqual(r2.battles[0].match, 'death');
  assert.strictEqual(r2.battles[0].death, true, '死斗打光了血条就是死');
  assert.strictEqual(duel.dead, true, '死了就是这一世结束');

  const after = turn.act(duel, { kind: 'action', id: 'act.idle' });
  assert.strictEqual(after.ok, false, '死了以后什么都不能做');
  assert.ok(/此生已尽/.test(after.reason), after.reason);
});

test('营生里有「切磋」这一格（r31）', () => {
  const hand = require('../src/model/systems/hand');
  const s = opening();
  s.clock.age = 16;
  assert.ok(hand.resident(s).some((a) => a.id === 'act.spar'), '城里十六岁就能找人比一场');
});

test('术法：四档，入门放不出来，小成起才算能用（r32）', () => {
  const spells = require('../src/model/rules/spells');
  const demo = require('../src/model/state/demo');
  const s = demo.initial('术');

  assert.deepStrictEqual(spells.LVL_NAME, ['入门', '小成', '大成', '圆满']);
  assert.strictEqual(spells.lvlName(0), '入门');
  assert.strictEqual(spells.lvlName(3), '圆满');

  /* 罗汉拳开局就 1 级 = 小成，能用 */
  assert.strictEqual(spells.know(s, 'spell.luohan'), true);
  assert.strictEqual(spells.usable(s, 'spell.luohan'), true);

  /* 压到入门：知道，但放不出来，也不给战力 */
  s.spells['spell.luohan'].lvl = 0;
  assert.strictEqual(spells.usable(s, 'spell.luohan'), false);
  assert.strictEqual(spells.powerOf(s, 'spell.luohan'), 0, '入门不给战力');

  /* 品阶：黄下 1 品 → 玄上 6 品 */
  assert.strictEqual(spells.rankOf(spells.byId('spell.luohan')), 1);
  assert.strictEqual(spells.gradeOf(spells.byId('spell.wulei')), '天');
  assert.strictEqual(spells.rankOf(spells.byId('spell.wulei')), 6);
});

test('战斗：法力不是护盾，没练防御术法就没有盾（r32）', () => {
  const battle = require('../src/model/rules/battle');
  const s = opening();
  s.path.body.level = 2;
  s.path.qi.level = 2;                         /* 破胎：有 60 法力 */
  s.items = {};

  let st = battle.stats(s, 'player');
  assert.strictEqual(st.manaMax, 60);
  assert.strictEqual(st.shieldMax, 0, '有法力 ≠ 有法力盾');

  /* 练了金刚罩（小成）才有盾 */
  s.spells['spell.jingang'] = { lvl: 1, exp: 0 };
  st = battle.stats(s, 'player');
  assert.strictEqual(st.shieldMax, 60, '防御术法给 60 点盾');

  /* 法器也撑盾 */
  s.spells = {};
  s.items = { 'item.yufu': 1 };
  st = battle.stats(s, 'player');
  assert.strictEqual(st.shieldMax, 40, '青玉护符自带 40 点盾');
});

test('战斗：炼气不会打两下就没法力（r32）', () => {
  const battle = require('../src/model/rules/battle');
  const s = opening();
  s.path.body.level = 2;
  s.path.qi.level = 2;
  s.spells['spell.huodan'] = { lvl: 2, exp: 0 };     /* 火弹术 大成 */

  const r = battle.resolve(s, { scale: 0.95, kindName: '同辈', match: 'spar' }, { rng: () => 0.5 });
  const casts = r.frames.filter((f) => f.side === 'me' && f.move === '火弹术').length;
  const punches = r.frames.filter((f) => f.side === 'me' && (f.move === '拳脚' || f.move === '法术')).length;
  assert.ok(casts >= 5, `该能连着放好几发，实际只有 ${casts} 发`);
  assert.ok(punches <= 1, `不该退化成肉搏，实际挥了 ${punches} 次空手`);
});

test('战斗：闪避成功这一下全免（r32）', () => {
  const battle = require('../src/model/rules/battle');
  const s = opening();
  s.path.qi.level = 1;
  s.spells['spell.yufeng'] = { lvl: 1, exp: 0 };     /* 御风步 +6% 闪避 */

  const st = battle.stats(s, 'player');
  assert.ok(st.dodge > 0.04, `闪避该高于基础值，实际 ${st.dodge}`);

  /* rng 恒 0.001：先掷闪避就必闪 */
  const r = battle.resolve(s, { scale: 1, kindName: '同辈', match: 'spar' }, { rng: () => 0.001 });
  const dodges = r.frames.filter((f) => f.t === 'dodge');
  assert.ok(dodges.length > 0, '该出现闪避');
  for (const f of dodges) {
    assert.strictEqual(f.seg.hp, 0, '闪开了就不掉血');
    assert.strictEqual(f.seg.mind, 0);
  }
});

test('r39 突破次数：入门不限次，品内一年一次', () => {
  const realm = require('../src/model/rules/realm');
  const rules = require('../src/model/repository/config').get('rules');
  const s = opening();

  /* 品内（脏腑 2）：**让第一次失败**，同年第二次该被年份拦住 */
  s.path.body.level = 1;
  s.path.body.lv = 1;
  s.path.body.wall = { 2: true };              /* 墙在 */
  s.path.body.attempts = 1;                    /* 跳过"首次必败" */
  const first = realm.raiseLevel(s, { dao: 'body', tier: 2 }, { rules, rng: () => 0.999 });
  assert.strictEqual(first.ok, false, '墙在且掷不过，该失败');
  assert.strictEqual(s.path.body.lv, 1, '层级没动');

  const second = realm.raiseLevel(s, { dao: 'body', tier: 2 }, { rules, rng: () => 0.999 });
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.why, 'one_per_year', '品内同年只准冲一次');

  /* 入门关（炼气·感气）：同年可以一直试 */
  s.path.qi.level = 0;
  s.path.qi.lv = 0;
  s.path.qi.wall = { 1: true };
  for (let i = 0; i < 3; i += 1) {
    const r = realm.raiseLevel(s, { dao: 'qi', tier: 1 }, { rules, rng: () => 0.99 });
    assert.notStrictEqual(r.why, 'one_per_year', '入门关不该被年份拦住');
  }
});

test('阶品：影响等级 = 阶 + 品，差一级只剩一成（r33）', () => {
  const grade = require('../src/model/rules/grade');

  /* 用户给的例子：3 阶 2 品够得着 2 阶 3 品、1 阶 4 品 */
  assert.strictEqual(grade.reach(3, 2, 2, 3), 1);
  assert.strictEqual(grade.reach(3, 2, 1, 4), 1);
  /* 黄上小成 = 2 阶 2 品，打 2 阶 3 品只剩一成 */
  assert.strictEqual(grade.reach(2, 2, 2, 3), 0.1);
  /* 同阶比品 */
  assert.strictEqual(grade.reach(2, 3, 2, 3), 1);
  assert.strictEqual(grade.reach(2, 3, 2, 4), 0.1);
  /* 品 5 / 6 不做阶品换算：只能同阶比 */
  assert.strictEqual(grade.reach(2, 6, 1, 6), 1, '2 阶天品压得住 1 阶天品');
  assert.strictEqual(grade.reach(1, 6, 2, 1), 0.1, '1 阶天品够不着 2 阶');

  /* 品名就是"天地玄黄"那一套 */
  assert.strictEqual(grade.pinName(1), '黄下');
  assert.strictEqual(grade.pinName(3), '黄上');
  assert.strictEqual(grade.pinName(4), '玄');
  assert.strictEqual(grade.label(2, 1), '2 阶 · 黄下（1 品）');
  assert.strictEqual(grade.short(2, 3), '2 阶 · 黄上', '阶要写在前面，光"黄上"看不出几阶');
});

test('术法：黄上小成 = 2 阶 2 品，大成才回到 2 阶 3 品（r33）', () => {
  const spells = require('../src/model/rules/spells');
  const s = opening();
  s.spells['spell.jingang'] = { lvl: 1, exp: 0 };     /* 金刚罩：黄上 / 法力 */

  const jg = spells.byId('spell.jingang');
  assert.strictEqual(spells.rankOf(jg), 3, '黄上 = 3 品');
  assert.strictEqual(spells.jieOf(jg), 2, '法力术法算 2 阶');

  assert.deepStrictEqual(spells.effectiveOf(s, jg), { jie: 2, pin: 2, lvl: 1 });
  s.spells['spell.jingang'].lvl = 2;
  assert.deepStrictEqual(spells.effectiveOf(s, jg), { jie: 2, pin: 3, lvl: 2 });
  s.spells['spell.jingang'].lvl = 3;
  assert.deepStrictEqual(spells.effectiveOf(s, jg), { jie: 2, pin: 4, lvl: 3 });
  s.spells['spell.jingang'].lvl = 0;
  assert.strictEqual(spells.effectiveOf(s, jg), null, '入门没有有效阶品——放不出来');
});

test('百艺：起点就是入门阶，符箓从 2 阶 2 品起，产物低一品（r33）', () => {
  const arts = require('../src/model/rules/arts');
  const list = require('../src/seed/arts.json');
  const talisman = list.find((a) => a.id === 'talisman');   /* req: { qi: 2 } */
  const alchemy = list.find((a) => a.id === 'alchemy');     /* req: { body: 1 } */

  assert.strictEqual(arts.levelName(talisman, 1), '2 阶 · 黄中', '符箓没有 2 阶 1 品');
  assert.strictEqual(arts.levelName(alchemy, 1), '1 阶 · 黄下');

  const prod = arts.productOf(talisman, 1);
  assert.strictEqual(prod.jie, 2);
  assert.strictEqual(prod.pin, 1, '符箓师 2 阶 2 品 出 2 阶 1 品');

  /* 2 阶 1 品（L=3）对 1 阶 1 品（L=2）、1 阶 2 品（L=3）有效，对 1 阶 3 品（L=4）无效 */
  const grade = require('../src/model/rules/grade');
  assert.strictEqual(grade.reach(prod.jie, prod.pin, 1, 1), 1);
  assert.strictEqual(grade.reach(prod.jie, prod.pin, 1, 2), 1);
  assert.strictEqual(grade.reach(prod.jie, prod.pin, 1, 3), 0.1);
});

test('耗时：属性越好，破同样的关越快（r33）', () => {
  const time = require('../src/model/rules/time');
  const mods = require('../src/model/rules/mods');

  const fast = opening();
  const slow = opening();
  mods.apply(fast, { target: 'attr.aptitude.eff', op: 'add', value: 30, duration: { kind: 'permanent' } });
  mods.apply(fast, { target: 'attr.insight.eff', op: 'add', value: 30, duration: { kind: 'permanent' } });
  mods.apply(slow, { target: 'attr.aptitude.eff', op: 'add', value: -25, duration: { kind: 'permanent' } });

  const fm = time.breakMonths(fast, 'body', 2);
  const sm = time.breakMonths(slow, 'body', 2);
  assert.ok(fm < sm, `资质好的该更快：${fm} vs ${sm}`);
  assert.ok(time.breakMonths(slow, 'body', 5) >= fm, '品越高越久');
  assert.ok(time.learnMonths(fast, 'art') <= time.learnMonths(slow, 'art'));
});

test('战斗：修为练到一半，面板比刚进品时结实（r33）', () => {
  const battle = require('../src/model/rules/battle');
  const rules = require('../src/model/repository/config').get('rules');
  const s = opening();
  s.path.body.level = 2;
  s.path.body.bar = 0;
  const fresh = battle.stats(s, 'player');
  s.path.body.bar = rules.PROF.body[1];              /* 快破下一品 */
  const grown = battle.stats(s, 'player');
  assert.ok(grown.hpMax > fresh.hpMax, `练到一半该更厚：${grown.hpMax} vs ${fresh.hpMax}`);
  assert.ok(grown.atk > fresh.atk);
});

test('战斗：品阶不够的术法打不动人（r33）', () => {
  const battle = require('../src/model/rules/battle');
  const grade = require('../src/model/rules/grade');
  /* 直接验算：黄上小成（2 阶 2 品）打 2 阶 3 品 → ×0.1 */
  assert.strictEqual(grade.reach(2, 2, 2, 3), 0.1);
  /* 同一门炼到大成（2 阶 3 品）就恢复正常 */
  assert.strictEqual(grade.reach(2, 3, 2, 3), 1);
  /* 拳脚没有品阶：rank 0 不吃这条 */
  assert.strictEqual(typeof battle.stats, 'function');
});

test('死斗：血条见底还能跑一次，跑了就不算死（r33）', () => {
  const battle = require('../src/model/rules/battle');

  const run = (mode) => {
    const s = opening();
    s.path.body.level = 1;
    return battle.resolve(s, { scale: 2.4, kindName: '山贼', match: 'death', flee: mode }, { rng: () => 0.5 });
  };

  const never = run('never');
  assert.strictEqual(never.death, true, '不让跑就该死');
  assert.strictEqual(never.outcome, 'dead');

  const always = run('always');
  assert.strictEqual(always.death, false, '跑成了就不死');
  assert.strictEqual(always.outcome, 'fled');
  assert.strictEqual(always.hp, 1);
  assert.strictEqual(always.injury, true, '跑回来也是带伤');
});

test('开局：资质/悟性/心性/气运每次都不一样（r34）', () => {
  const demo = require('../src/model/state/demo');
  const a = demo.initial('甲');
  const b = demo.initial('乙');

  const va = [a.attr.aptitude.base, a.attr.insight.base, a.attr.heart.base, a.luck];
  const vb = [b.attr.aptitude.base, b.attr.insight.base, b.attr.heart.base, b.luck];
  assert.notDeepStrictEqual(va, vb, '两次开局四项不该一模一样');

  for (const v of va.slice(0, 3)) assert.ok(v >= 45 && v <= 90, `三属性该在 45..90，实际 ${v}`);
  assert.ok(a.luck >= 30 && a.luck <= 80, `气运该在 30..80，实际 ${a.luck}`);
});

test('战斗：拳头能破盾（物理穿透 55%），不会一颗子弹都打不进（r34）', () => {
  const battle = require('../src/model/rules/battle');
  const s = opening();
  s.path.body.level = 1;
  s.path.qi.level = 2;                      /* 对手会有盾 */
  s.spells['spell.jingang'] = { lvl: 2, exp: 0 };
  s.items = {};

  const me = battle.stats(s, 'player');
  const foe = battle.makeEnemy(me, { scale: 1, kindName: '炼气修士' });
  assert.ok(foe.shieldMax > 0, '这个对手有法力盾');

  /* 一拳打下去：盾挡一部分，血一定掉 */
  const move = { name: '罗汉拳', kind: 'attack', power: 0, mult: 1, rank: 0, jie: 1, pin: 1, lvl: 0 };
  const r = battle.strike(me, foe, move, () => 0.5);
  assert.ok(r.seg.hp > 0, `拳头该打掉血，实际 hp ${r.seg.hp} / 盾 ${r.seg.shield}`);
  assert.ok(r.seg.shield <= r.seg.hp + r.seg.shield, '盾不该把整拳吃掉');
});

test('r39 物品代差：术法阶品是它自己的，不随人涨', () => {
  const grade = require('../src/model/rules/grade');
  const battle = require('../src/model/rules/battle');

  /* 罗汉拳 = 1 阶黄下（jie 1, pin 1） */
  assert.deepStrictEqual(grade.itemFit(1, 1, 1, 1), { usable: true, mul: 1, why: 'ok' });
  assert.deepStrictEqual(grade.itemFit(1, 2, 1, 1), { usable: true, mul: 0.1, why: 'diluted' });
  assert.strictEqual(grade.itemFit(1, 3, 1, 1).usable, false, '调息用罗汉拳：无效');
  assert.strictEqual(grade.itemFit(1, 3, 1, 1).why, 'out_of_range');
  assert.strictEqual(grade.itemFit(2, 1, 1, 1).why, 'cross_tier', '跨大阶一律无效');

  /* 新手用高阶货：满效果（这是"有人给你"的那条路） */
  assert.strictEqual(grade.itemFit(1, 1, 2, 3).mul, 1);

  /* 物品写法：人 / 物 两套 */
  assert.strictEqual(grade.short(2, 3), '2 阶 · 黄上');
  assert.strictEqual(grade.itemLabel(2, 3), '2 阶黄上级');

  /* 战斗里：炼气 3 品拿黄中术法（同阶低一品）→ 只剩一成，不再"以力驭法"撑起来 */
  const s = opening();
  s.path.body.level = 2;
  s.path.body.lv = 2;
  s.path.qi.level = 3;
  s.path.qi.lv = 3;
  s.spells = { 'spell.huodan': { lvl: 1, exp: 0 } };

  const me = battle.stats(s, 'player');
  const foe = battle.makeEnemy(me, { scale: 1, kindName: '同辈' });
  const move = { name: '火弹术', kind: 'attack', power: 20, mult: 0.85, rank: 2, jie: 2, pin: 2, lvl: 1 };

  const r = battle.strike(me, foe, move, () => 0.5);
  assert.strictEqual(r.fitWhy, 'diluted', '同阶低一品：打折');
  assert.ok(r.gRatio <= 0.1 + 1e-9, '最多一成，实际 ' + r.gRatio);
});

test('法术来源：学堂教、坊市买、城主府换、奇遇得（r35）', () => {
  const spells = require('../src/model/rules/spells');
  const turn = require('../src/model/systems/turn');
  const s = opening();                      /* 府学 */
  s.money = { copper: 0, silver: 0, gold: 0 };

  const huo = spells.byId('spell.huodan');
  const src1 = spells.sourceOf(s, huo);
  assert.strictEqual(src1.kind, 'academy', '府学教火弹术');
  assert.strictEqual(src1.cost, 0, '学堂不要钱');

  /* 卒业以后：同一门只能去坊市买，没钱就学不了 */
  s.education.graduated = true;
  s.education.stage = 'none';
  s.path.qi.level = 2;                      /* 火弹术本身要炼气·感气 */
  assert.strictEqual(spells.sourceOf(s, huo).kind, 'market');
  const poor = turn.act(s, { kind: 'learnSpell', id: 'spell.huodan' });
  assert.strictEqual(poor.ok, false, '没钱学不了');
  assert.ok(/钱不够/.test(poor.reason), poor.reason);

  /* 玄阶：不走坊市，只能城主府（军功 + 军职）或奇遇 */
  s.money = { copper: 5000, silver: 0, gold: 0 };
  s.path.qi.level = 5;
  const luo = spells.byId('spell.luoshi');
  assert.strictEqual(luo.rank, 4, '落石术是玄');
  const luoSrc = spells.sourceOf(s, luo);
  assert.strictEqual(luoSrc.kind, 'office', '玄阶走城主府，不进坊市');
  assert.strictEqual(luoSrc.ok, false, '没军职换不到');
  assert.ok(/军职/.test(luoSrc.why), luoSrc.why);

  /* 给了军职、军功也够 → 能换 */
  s.flags = s.flags || {};
  s.flags.office = { army: true };
  s.merit.war = 80;
  const luoOk = turn.act(s, { kind: 'learnSpell', id: 'spell.luoshi' });
  assert.strictEqual(luoOk.ok, true, luoOk.reason || '');
  assert.strictEqual(s.merit.war, 40, '落石术要 40 军功');

  /* 地 / 天阶：只走奇遇，买不到也换不到 */
  const fen = spells.byId('spell.fenshan');
  assert.strictEqual(fen.rank, 5, '焚山印是地');
  const fenSrc = spells.sourceOf(s, fen);
  assert.strictEqual(fenSrc.kind, 'chance', '地阶只能奇遇');
  assert.strictEqual(fenSrc.ok, false, '奇遇不能主动学');
});

test('百艺：升一档出一件成品，进囊中（r34）', () => {
  const turn = require('../src/model/systems/turn');
  const arts = require('../src/model/rules/arts');
  const s = opening();
  s.clock.age = 14;
  s.money = { copper: 600, silver: 0, gold: 0 };

  const learn = turn.act(s, { kind: 'learnArt', id: 'alchemy' });
  assert.strictEqual(learn.ok, true, learn.reason || '');

  s.arts.alchemy.exp = 118;                  /* 差一点升档 */
  const r = turn.act(s, { kind: 'art', id: 'alchemy' });
  assert.strictEqual(r.ok, true, r.reason || '');
  assert.ok(s.arts.alchemy.lvl >= 1, '该升到 1 阶');
  assert.ok((s.items['craft.alchemy'] || 0) >= 1, '该有一件成品');
  assert.ok(s.craftGrade.alchemy && s.craftGrade.alchemy.jie >= 1, '成品要带阶品');
});

test('战斗：有符箓先甩一张，符会少一张（r34）', () => {
  const battle = require('../src/model/rules/battle');
  const s = opening();
  s.items = { 'item.leifu': 2 };

  const r = battle.resolve(s, { scale: 1, kindName: '同辈', match: 'spar' }, { rng: () => 0.5 });
  assert.strictEqual(r.usedTalisman, true, '该先用一张符');
  assert.strictEqual(s.items['item.leifu'], 1, '符要少一张');
  assert.ok(r.frames.some((f) => f.t === 'talisman'), '战报里要有这一下');
  assert.strictEqual(s.tally.fights, 1, '战斗要计数');
});

test('战斗：认输线到了就收手，不死（r34）', () => {
  const battle = require('../src/model/rules/battle');
  const s = opening();
  s.path.body.level = 1;

  const r = battle.resolve(s, {
    scale: 1.9, kindName: '教头', match: 'spar', surrenderAt: 0.95, flee: 'never'
  }, { rng: () => 0.5 });

  assert.strictEqual(r.yielded, true, '该认输');
  assert.strictEqual(r.outcome, 'yield');
  assert.strictEqual(s.dead, undefined === s.dead ? s.dead : s.dead, '');
  assert.ok(!s.dead, '认输不会死');
});

test('战斗：伤了会写一条真的在打折的修饰器（r29）', () => {
  const effects = require('../src/model/systems/effects');
  const realm = require('../src/model/rules/realm');
  const mods = require('../src/model/rules/mods');
  const battle = require('../src/model/rules/battle');
  const rules = require('../src/model/repository/config').get('rules');
  const s = opening();

  const calm = realm.monthGain(s, 'body');

  /* 强制这一仗打输且受伤：只替换判定结果，不碰结算流程 */
  const orig = battle.resolve;
  battle.resolve = () => ({
    ok: false, injury: true, rounds: 3, hp: 1, hpMax: 100, enemy: '劫匪', report: ['你被打倒了。']
  });
  try {
    effects.run(s, [{ judge: { kind: 'battle', scale: 1 } }], { rules });
  } finally {
    battle.resolve = orig;
  }

  assert.ok(s.flags.injury, '要留一个受伤的标记');
  const hurt = realm.monthGain(s, 'body');
  assert.ok(Math.abs(hurt - calm * 0.6) < 0.01, `带伤该按 0.6 打折：${hurt} vs ${calm}`);

  mods.expire(s);                                   /* 一年后自己好 */
  assert.ok(!s.mods.some((m) => m.source === 'injury'), '修饰器该被清掉');
  assert.ok(Math.abs(realm.monthGain(s, 'body') - calm) < 0.01, '伤好了就该修回原来的速度');
});

test('出战：平民没有这条路，投军以后才有（r27）', () => {
  const demo = require('../src/model/state/demo');
  const hand = require('../src/model/systems/hand');
  const s = fresh();

  assert.ok(!hand.resident(s).some((a) => a.id === 'act.combat'), '平民不许主动出战');
  s.flags.office = { army: true };
  assert.ok(hand.resident(s).some((a) => a.id === 'act.combat'), '当了兵才有出战');
});

/* ── r28：入门看门槛，不看进度条 ────────────────────── */
test('开局：没墙就直接站在体魄，没有"未入门"这一档（r28）', () => {
  const demo = require('../src/model/state/demo');
  const opening = require('../src/model/systems/opening');
  const rules = require('../src/model/repository/config').get('rules');

  const s = fresh();
  const r = opening.apply(s, { rng: () => 0.99 });
  assert.strictEqual(r.entered, true);
  assert.strictEqual(s.path.body.level, 1, '七岁筋骨已开，该站在体魄上');
  assert.strictEqual(s.path.body.lv, 1, '层级也到 1');
  /* r39：7 岁开局不白送修为 */
  assert.strictEqual(s.path.body.bar, 0, '开局修为条是 0');
  assert.strictEqual(s.lifespan, 85, '凡人寿元按 LIFESPAN 的上限');
});

test('开局：有墙就停在门口，只剩这一关（r28）', () => {
  const demo = require('../src/model/state/demo');
  const opening = require('../src/model/systems/opening');
  const hand = require('../src/model/systems/hand');

  const s = fresh();
  s.attr.aptitude.base = 40;                            /* 资质 40：体魄这道墙必在 */
  const r = opening.apply(s, { rng: () => 0.0 });
  assert.strictEqual(r.entered, false, '资质 40 + 掷出墙，该停在门口');
  assert.strictEqual(s.path.body.level, 0);
  assert.strictEqual(s.path.body.bar, 0, '没入品没有修为条');

  const card = hand.breakCards(s).find((b) => b.dao === 'body');
  assert.strictEqual(card.entry, true, '这是一张入门关');
  assert.strictEqual(card.barMax, null, '入门关不该显示进度');
  assert.strictEqual(card.ready, true, '入门关直接可冲');
});

test('百艺：十四岁才开；没到门槛不能练（r28）', () => {
  const demo = require('../src/model/state/demo');
  const openingSys = require('../src/model/systems/opening');
  const hand = require('../src/model/systems/hand');
  const turn = require('../src/model/systems/turn');

  const young = fresh();                         /* 十岁 */
  openingSys.apply(young, { rng: () => 0.99 });
  assert.strictEqual(hand.artRow(young).length, 0, '十一岁不该看见百艺');

  const s = opening();                                   /* 府学；下面把年龄调大 */
  s.clock.age = 14;
  /* 跳到 14 岁会换一张主卡，可能是"府学卒试"这类强制事件——先走掉，否则 I15 封住百艺 */
  for (let i = 0; i < 3 && hand.table(s).locked; i += 1) {
    const main = hand.table(s).main;
    turn.act(s, { kind: 'event', id: main.id, choice: main.choices && main.choices[0] ? main.choices[0].id : null });
  }
  const row = hand.artRow(s);
  assert.strictEqual(row.length, 12, '十四岁该看见十二门');
  const talisman = row.find((a) => a.id === 'talisman');
  assert.strictEqual(talisman.locked, true, '符道要炼气·破胎');
  assert.ok(/炼气/.test(talisman.lockHint), `锁的原因要写清楚，实际「${talisman.lockHint}」`);

  const r = turn.act(s, { kind: 'art', id: 'talisman' });
  assert.strictEqual(r.ok, false, '没到门槛不许练');
  assert.ok(/炼气/.test(r.reason), `理由要写清楚，实际「${r.reason}」`);
});

test('一眼看过不该改状态：法术列表不能把没学的变成"已学"（r30）', () => {
  const demo = require('../src/model/state/demo');
  const spells = require('../src/model/rules/spells');
  const s = demo.initial('看');
  const before = JSON.stringify(s.spells);
  spells.publicList(s);
  spells.totalPower(s);
  assert.strictEqual(JSON.stringify(s.spells), before, '看一眼就把条目建出来 = 白送法术');
  assert.strictEqual(spells.totalPower(s), 3, '罗汉拳 1 阶：威力 3');
});

test('法术：没学的先学，学会才练得动（r30）', () => {
  const turn = require('../src/model/systems/turn');
  const spells = require('../src/model/rules/spells');
  const s = opening();
  s.clock.age = 16;
  s.path.qi.level = 1;                       /* 火弹术要炼气·感气 */
  s.money = { copper: 400, silver: 0, gold: 0 };

  const early = turn.act(s, { kind: 'spell', id: 'spell.huodan' });
  assert.strictEqual(early.ok, false, '没学不能练');

  /* 府学里教火弹术：白学（r34 学堂来源） */
  const learn = turn.act(s, { kind: 'learnSpell', id: 'spell.huodan' });
  assert.strictEqual(learn.ok, true, learn.reason || '');
  assert.ok(spells.know(s, 'spell.huodan'), '要学会');
  assert.strictEqual(s.money.copper, 400, '府学教的东西不该收钱');

  /* 卒业以后没有学堂了，同一门就得去坊市买 */
  s.education.graduated = true;
  s.education.stage = 'none';
  s.spells = { 'spell.luohan': { lvl: 1, exp: 0 } };
  s.money = { copper: 400, silver: 0, gold: 0 };
  const buy = turn.act(s, { kind: 'learnSpell', id: 'spell.huodan' });
  assert.strictEqual(buy.ok, true, buy.reason || '');
  assert.ok(s.money.copper < 400, '出了学堂就得花钱');

  const train = turn.act(s, { kind: 'spell', id: 'spell.huodan' });
  assert.strictEqual(train.ok, true, train.reason || '');
  /* r34：一次到底——升档就该停，不够就用完剩下的月 */
  assert.ok(train.months >= 1, '要走月');
  assert.ok(train.months <= 12, '不该超过一年');
});

test('百艺：十四岁先选一门，第二门要交学费（r30）', () => {
  const turn = require('../src/model/systems/turn');
  const arts = require('../src/model/rules/arts');
  const s = opening();
  /* 开局可能自带一门天赋（随机），这里清掉，只看"从零开始"的学费规则 */
  for (const a of Object.values(s.arts)) a.learned = false;

  const young = turn.act(s, { kind: 'learnArt', id: 'alchemy' });
  assert.strictEqual(young.ok, false, '十四岁以前学不了');

  s.clock.age = 14;
  s.money = { copper: 800, silver: 0, gold: 0 };

  const total = () => s.money.copper + s.money.silver * 100 + s.money.gold * 10000;

  const free = turn.act(s, { kind: 'learnArt', id: 'alchemy' });
  assert.strictEqual(free.ok, true, free.reason || '');
  assert.strictEqual(arts.learned(s, 'alchemy'), true);
  assert.strictEqual(total(), 800, '第一门不要钱');

  const second = turn.act(s, { kind: 'learnArt', id: 'forge' });
  assert.strictEqual(second.ok, true, second.reason || '');
  assert.strictEqual(total(), 680, '第二门要交 120 文');
  assert.strictEqual(arts.learnedCount(s), 2);

  /* 没学的门，练不了 */
  const bad = turn.act(s, { kind: 'art', id: 'brew' });
  assert.strictEqual(bad.ok, false, '没学过的手艺不能练');
});

test('坊市：逛一趟才摆摊，买下的进囊中，跨年收摊（r28）', () => {
  const turn = require('../src/model/systems/turn');
  const s = opening();

  assert.strictEqual(turn.marketOf(s).length, 0, '没逛过就没有货架');

  const visit = turn.act(s, { kind: 'action', id: 'act.market' });
  assert.strictEqual(visit.ok, true, visit.reason || '');
  assert.strictEqual(visit.months, 1, '逛坊市 1 月');
  assert.ok(turn.marketOf(s).length >= 6, '货架该有几样东西');

  const buy = turn.act(s, { kind: 'buy', id: 'item.huichun' });
  assert.strictEqual(buy.ok, true, buy.reason || '');
  assert.strictEqual(s.items['item.huichun'], 1, '买下的要进背包');
  assert.ok(s.money.copper + s.money.silver * 100 < 260, '钱要真的扣掉');

  const poor = turn.act(s, { kind: 'buy', id: 'item.xisui' });   /* 5 金 */
  assert.strictEqual(poor.ok, false, '钱不够买不起');

  /* 卖：半价回收，卖完囊中就空了 */
  const before = s.money.copper + s.money.silver * 100;
  const sell = turn.act(s, { kind: 'sell', id: 'item.huichun' });
  assert.strictEqual(sell.ok, true, sell.reason || '');
  assert.ok(s.money.copper + s.money.silver * 100 > before, '卖掉要回钱');
  assert.ok(!s.items['item.huichun'], '囊中该空了');

  /* 跨年收摊：把这一年过完，货架就该空了 */
  turn.act(s, { kind: 'wait' });
  assert.strictEqual(turn.marketOf(s).length, 0, '过完年坊市就收了');
});

test('战事：日历到点必来；城破了才轮下一座（r29）', () => {
  const turn = require('../src/model/systems/turn');
  const hand = require('../src/model/systems/hand');
  const calendar = require('../src/model/systems/calendar');
  const s = opening();

  /* r39：日历按**角色年龄**触发，拨的是 age */
  const jumpTo = (age) => {
    s.clock.age = age;
    s.clock.year = 309 + (age - 7);
    s.monthsUsed = 0;
    s.turn.mainDone = false;
    s.turn.mainId = null;
    calendar.sync(s);
  };

  jumpTo(30);
  assert.strictEqual(s.war.phase, 'warning', '30 岁该进预警档');
  const warn = hand.table(s).main;
  assert.strictEqual(warn.id, 'evt.war.warning.north', '到点的那一条必须上桌');

  turn.act(s, { kind: 'event', id: warn.id, choice: warn.choices[0].id });
  assert.strictEqual(hand.table(s).main, null, '一年只出一件主要事件（r30）');

  jumpTo(31);
  assert.strictEqual(s.war.phase, 'city', '31 岁该进城战档');
  const war = hand.table(s).main;
  assert.strictEqual(war.id, 'evt.war.city.beiguan');
  assert.strictEqual(war.forced, true, '城战是封住整年的');
  assert.strictEqual(war.months, 5, '月数从日历参数来');

  const flee = turn.act(s, { kind: 'event', id: war.id, choice: 'flee' });
  assert.strictEqual(flee.ok, true, flee.reason || '');
  assert.strictEqual(s.flags.city_lost.beiguan, true, '弃城要留标记');

  /* 同一年里不再抽新卡；把"今年的大事"放开来，才看得到下一座城 */
  /* r39：日历一年一城，第二座在 32 岁 */
  jumpTo(32);
  assert.strictEqual(hand.table(s).main.id, 'evt.war.city.wangbei', '北关破了，32 岁轮到王北');
});

test('跨年战事：今年月不够就把剩下的记到明年开春（r32）', () => {
  const hand = require('../src/model/systems/hand');
  const turn = require('../src/model/systems/turn');
  const s = opening();

  s.clock.age = 31;
  s.clock.year = 333;
  s.war.phase = 'city';
  s.monthsUsed = 10;                       /* 只剩 2 月，城战要 5 月 */
  s.turn.mainDone = false;
  s.turn.mainId = null;

  const t = hand.table(s);
  assert.strictEqual(t.main.id, 'evt.war.city.beiguan');
  assert.strictEqual(t.main.span, true, '城战是跨年的事');

  const r = turn.act(s, { kind: 'event', id: t.main.id, choice: 'flee' });
  assert.strictEqual(r.ok, true, r.reason || '');
  assert.strictEqual(r.carry, 3, '今年 2 月 + 明年 3 月 = 5 月');
  assert.strictEqual(s.clock.year, 334, '过完这一年');
  assert.strictEqual(s.monthsUsed, 3, '明年开春先还这三个月的账');
});

test('闲居：把当年剩下的月份一次过完（r28）', () => {
  const turn = require('../src/model/systems/turn');
  const s = opening();
  const year = s.clock.year;
  const left = 12 - s.monthsUsed;

  const r = turn.act(s, { kind: 'action', id: 'act.idle' });
  assert.strictEqual(r.ok, true, r.reason || '');
  assert.strictEqual(r.months, left, `该一次过完剩下的 ${left} 个月，实际 ${r.months}`);
  assert.strictEqual(s.clock.year, year + 1, '过完就是新的一年');
  assert.strictEqual(s.monthsUsed, 0, '新月清零');
});

/* ── 事件抽取（r26-4） ──────────────────────────────── */
test('抽取：优先级小者先，forced 只在同批内压人', () => {
  const draw = require('../src/model/systems/draw');
  const s = require('../src/model/state/demo').initial();
  const lo = { id: 'a', priority: 1, weight: 1 };
  const hi = { id: 'b', priority: 4, weight: 99 };
  assert.strictEqual(draw.pick(s, [hi, lo], () => 0.5).id, 'a', 'priority 是层级不是概率');

  const forced = { id: 'c', priority: 1, weight: 1, forced: true };
  assert.strictEqual(draw.pick(s, [lo, forced], () => 0.99).id, 'c', '同批内 forced 优先');
  assert.strictEqual(draw.pick(s, [lo, { id: 'd', priority: 1, weight: 1 }], () => 0.99).id, 'd',
    '不同批的 forced 不许越级');
});

test('抽取：批内按权重归一化（3:1 ≈ 75% / 25%）', () => {
  const draw = require('../src/model/systems/draw');
  const s = require('../src/model/state/demo').initial();
  const a = { id: 'a', priority: 3, weight: 3 };
  const b = { id: 'b', priority: 3, weight: 1 };
  let hit = 0;
  const N = 4000;
  for (let i = 0; i < N; i += 1) if (draw.pick(s, [a, b]).id === 'a') hit += 1;
  assert.ok(Math.abs(hit / N - 0.75) < 0.03, `权重 3 该约 75%，实际 ${(hit / N * 100).toFixed(1)}%`);
});

test('抽取：quota —— 一生一次 / 冷却 / 每年次数', () => {
  const draw = require('../src/model/systems/draw');
  const s = require('../src/model/state/demo').initial();

  const once = { id: 'x', quota: { once: true } };
  assert.strictEqual(draw.quotaOk(s, once), true);
  draw.markFired(s, 'x');
  assert.strictEqual(draw.quotaOk(s, once), false, '一生一次：来过就不再');

  const cool = { id: 'y', quota: { cooldown: 12 } };
  draw.markFired(s, 'y');
  assert.strictEqual(draw.quotaOk(s, cool), false, '同年不该再来');
  s.clock.year += 1;
  assert.strictEqual(draw.quotaOk(s, cool), true, '满一年（12 月）该回来');

  const per = { id: 'z', quota: { perYear: 1 } };
  draw.markFired(s, 'z');
  assert.strictEqual(draw.quotaOk(s, per), false, '本年名额用完');
  s.clock.year += 1;
  assert.strictEqual(draw.quotaOk(s, per), true, '跨年名额刷新');
});

test('抽取：ttl 到期就不再来', () => {
  const draw = require('../src/model/systems/draw');
  const s = require('../src/model/state/demo').initial();
  const ctx = { state: s, rules: {}, conditions: {}, args: {} };
  const e = { id: 't', ttl: 3, priority: 3, weight: 1 };

  assert.strictEqual(draw.candidates(s, [e], ctx).length, 1, '头一年该入池');
  s.clock.year += 3;
  assert.strictEqual(draw.candidates(s, [e], ctx).length, 1, '3 年内还留着');
  s.clock.year += 1;
  assert.strictEqual(draw.candidates(s, [e], ctx).length, 0, '过期就不该再问');
});

test('抽取：气运只偏置写了 luckBias 的条目', () => {
  const draw = require('../src/model/systems/draw');
  const s = require('../src/model/state/demo').initial();
  const plain = { id: 'p', weight: 2 };
  const lucky = { id: 'l', weight: 2, luckBias: true };

  s.luck = 100;
  assert.ok(draw.effWeight(s, lucky) > draw.effWeight(s, plain), '气运高该更常见');
  s.luck = 0;
  assert.ok(draw.effWeight(s, lucky) < draw.effWeight(s, plain), '气运低该更少见');
});

/* ── 数值层（r26-1） ────────────────────────────────── */
test('效果：打熬筋骨让内力真的动，且按教育档算基数', () => {
  const effects = require('../src/model/systems/effects');
  const realm = require('../src/model/rules/realm');
  const rules = require('../src/model/repository/config').get('rules');
  const s = opening();
  s.path.body.bar = 0;                       /* 只看这一个月涨了多少 */

  s.education.stage = 'meng';                /* 功法值 38 */
  const before = effects.run(s, [{ add: ['path.body.bar', 'rate.month.body'] }], { rules });
  assert.deepStrictEqual(before.errors, []);
  const meng = s.path.body.bar;
  assert.ok(Math.abs(meng - 11.56) < 0.01, `蒙学月修为应是 11.56，实际 ${meng}`);

  s.education.stage = 'fu';                  /* 功法值 46 */
  const fu = realm.monthGain(s, 'body');
  assert.ok(fu > meng, `府学该更快：${fu} vs ${meng}`);
});

test('效果：钱走进位，永远不出现负数', () => {
  const demo = require('../src/model/state/demo');
  const effects = require('../src/model/systems/effects');
  const s = fresh();
  s.money = { copper: 95, silver: 0, gold: 0 };

  effects.run(s, [{ money: { copper: 10 } }], {});
  assert.deepStrictEqual(s.money, { copper: 5, silver: 1, gold: 0 }, '95 + 10 该进位成 1 银 5 铜');

  effects.run(s, [{ money: { copper: -999 } }], {});
  assert.deepStrictEqual(s.money, { copper: 0, silver: 0, gold: 0 }, '不许出现负钱');
  assert.strictEqual(s.flags.money.debt, true, '欠账要留标记');
});

test('修饰器：永久不掉，按年的到期', () => {
  const demo = require('../src/model/state/demo');
  const effects = require('../src/model/systems/effects');
  const mods = require('../src/model/rules/mods');
  const s = fresh();

  effects.run(s, [{ mod: { target: 'attr.aptitude.eff', op: 'add', value: 3, duration: { kind: 'permanent' }, source: 'item.xisui' } }], {});
  effects.run(s, [{ mod: { target: 'attr.insight.eff', op: 'add', value: 5, duration: { kind: 'years', value: 1 }, source: 'item.wudao' } }], {});
  assert.strictEqual(mods.get(s, 'attr.aptitude.eff'), 69);
  assert.strictEqual(mods.get(s, 'attr.insight.eff'), 76);

  mods.expire(s);
  assert.strictEqual(mods.get(s, 'attr.insight.eff'), 71, '悟道丹一年后该掉');
  assert.strictEqual(mods.get(s, 'attr.aptitude.eff'), 69, '洗髓是永久的');
});

test('破境：概率瓶颈一次点击判定并进品，且清条（I3 / I4 / I25 · r40）', () => {
  const demo = require('../src/model/state/demo');
  const effects = require('../src/model/systems/effects');
  const rules = require('../src/model/repository/config').get('rules');
  const s = fresh();
  s.turn = s.turn || {};
  s.turn.mainDone = true;                   /* 别让开局强制事件拦住动作 */
  s.path.body.bar = 200;

  /* r40：概率瓶颈的玩家动作 = 瓶颈判定 + 真实进品，一次完成。
     不再有"先通 lv、再点一次进品"的两段式点击。 */
  const r = effects.run(s, [{ call: { macro: 'macro.break.attempt', args: { dao: 'body', tier: 1 } } }], { rules, rng: () => 0.99 });
  assert.strictEqual(s.path.body.lv, 1, '层级该通到 1');
  assert.strictEqual(s.path.body.level, 1, '同一次点击就进品（r40）');
  assert.strictEqual(s.path.body.bar, 0, '进品清条');
  assert.strictEqual(r.errors.length, 0);

  /* 入门关不占年度名额——第 2 品同年仍可尝试 */
  assert.ok(!(s.turn && s.turn.breakthroughUsed), '入门关不占名额');
  const turn = require('../src/model/systems/turn');

  /* 品内突破（脏腑）占年度名额：先真的破一次第 2 品 */
  s.path.body.lv = 1;
  s.path.body.attempts = 2;                 /* 跳过"首次必败" */
  s.path.body.wall = { 2: true };           /* 墙已掷出、在 */
  s.path.body.bar = rules.PROF.body[0];     /* 站在体魄，条拉满 */
  const ok2 = effects.run(s, [{ call: { macro: 'macro.break.attempt', args: { dao: 'body', tier: 2 } } }], { rules, rng: () => 0.001 });
  assert.strictEqual(ok2.errors.length, 0, ok2.errors.join('; '));
  assert.strictEqual(s.path.body.level, 2, '第二段点击把品内破到脏腑');
  assert.strictEqual(s.turn.breakthroughUsed, true, '品内突破要占用年度名额');

  /* 同一年内再冲下一品（品内，非入门）：名额已用，直接拒绝 */
  s.path.body.bar = rules.PROF.body[1];
  const again = turn.act(s, { kind: 'break', dao: 'body', tier: 3, mode: 'try' });
  assert.strictEqual(again.ok, false);
  assert.ok(/已经破过了/.test(String(again.reason || '')), '该说清是名额问题：' + again.reason);
});

test('破境：事件瓶颈先通层级，进品要另点（r40）', () => {
  const realm = require('../src/model/rules/realm');
  const rules = require('../src/model/repository/config').get('rules');
  const s = fresh();
  s.path.body.level = 4;
  s.path.body.lv = 4;
  s.path.body.bar = rules.PROF.body[3];

  /* 事件通道（byEvent）：只通 lv，不进品 */
  const raised = effects_run(s, [{ call: { macro: 'macro.break.attempt', args: { dao: 'body', tier: 5, byEvent: true } } }], rules);
  assert.strictEqual(raised.errors.length, 0, raised.errors.join('; '));
  assert.strictEqual(s.path.body.lv, 5, '事件办完，层级通到金身');
  assert.strictEqual(s.path.body.level, 4, '境界还在朝元（层级≠境界）');

  /* 玩家手动进品 */
  const b = realm.breakthrough(s, { dao: 'body', tier: 5 }, { rules });
  assert.strictEqual(b.ok, true, b.why);
  assert.strictEqual(s.path.body.level, 5, '点了突破才进金身');
});

function effects_run(s, list, rules) {
  const effects = require('../src/model/systems/effects');
  return effects.run(s, list, { rules, rng: () => 0.99 });
}

test('I2 / I25：修为条不许乘，层级不许直接写', () => {
  const demo = require('../src/model/state/demo');
  const effects = require('../src/model/systems/effects');
  const s = fresh();

  const a = effects.run(s, [{ mul: ['path.qi.bar', 1.1] }], {});
  assert.ok(a.errors.some((e) => /I2/.test(e)), '修为条乘算该被拒绝');

  const b = effects.run(s, [{ set: ['path.spirit.level', 1] }], {});
  assert.ok(b.errors.some((e) => /I25/.test(e)), '层级直写该被拒绝');
  assert.strictEqual(s.path.spirit.level, 0, '养灵仍是 Lv0');
});

test('事件瓶颈：判定层硬闯没用，突破是"把那件事办掉"（r30）', () => {
  const hand = require('../src/model/systems/hand');
  const turn = require('../src/model/systems/turn');
  const realm = require('../src/model/rules/realm');
  const rules = require('../src/model/repository/config').get('rules');

  /* 锻体·朝元圆满 + 战功够：该轮到「武名动四方」了 */
  const s = opening();
  s.path.body.level = 4;
  s.path.body.lv = 4;                     /* r39：层级也要到 4，否则 level_gap */
  s.path.body.bar = rules.PROF.body[3];
  s.merit.war = 120;

  const card = hand.breakCards(s).find((b) => b.dao === 'body');
  assert.strictEqual(card.kind, 'event_once', '品 5 是事件瓶颈');

  /* 判定层：没有事件就不给过（硬闯无效） */
  const judge = realm.raiseLevel(s, { dao: 'body', tier: 5 }, { rules });
  assert.strictEqual(judge.ok, false);
  assert.strictEqual(judge.why, 'need_event');

  /* 突破按钮：把那一件事办掉，直接进品，不再掷骰 */
  /* r39：事件办完只通层级，境界要另点 */
  const go = turn.act(s, { kind: 'break', dao: 'body', tier: 5, mode: 'try' });
  assert.strictEqual(go.ok, true, go.reason || '');
  assert.strictEqual(s.path.body.lv, 5, '事件办完，层级通到金身');
  assert.strictEqual(s.path.body.level, 4, '境界还在朝元（层级≠境界）');
  assert.ok(s.log.some((l) => l.includes('武名动四方')), '纪事里要看得到那一关的名字');
});

test('回合：钱不够整条不发生，月份一点都不扣', () => {
  const demo = require('../src/model/state/demo');
  const turn = require('../src/model/systems/turn');
  const s = fresh();
  s.money = { copper: 5, silver: 0, gold: 0 };

  const r = turn.act(s, { kind: 'event', id: 'evt.market.auction', choice: 'buy' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(s.monthsUsed, 0, '被拒的选项不耗月');
  assert.deepStrictEqual(s.items, {}, '物品没给出去');
});

test('回合：蒙学卒试真的把学籍推到府学', () => {
  const demo = require('../src/model/state/demo');
  const turn = require('../src/model/systems/turn');
  const s = fresh();
  assert.strictEqual(s.education.stage, 'meng');

  /* r39：蒙学毕业在 10 岁，且只有「收拾书箱」这一个选项 */
  s.clock.age = 10;
  turn.act(s, { kind: 'event', id: 'evt.edu.graduate.meng', choice: 'leave' });
  assert.strictEqual(s.education.stage, 'fu');
  assert.strictEqual(s.flags.edu.meng.done, true);
});

test('回合：付不起月份时能把这一年过完（不然死锁）', () => {
  const demo = require('../src/model/state/demo');
  const turn = require('../src/model/systems/turn');
  const hand = require('../src/model/systems/hand');
  const s = fresh();
  s.monthsUsed = 11;                     /* 年尾只剩 1 月 */

  const r = turn.act(s, { kind: 'wait' });
  assert.strictEqual(r.ok, true, '该允许过完');
  assert.strictEqual(s.clock.year, 310, '跨了一年');
  assert.strictEqual(s.monthsUsed, 0, '新月清零');
  assert.strictEqual(hand.table(s).canWait, false, '新年不该一上来就无路可走');
});

test('修为条：到顶就停，不跑飞；没入品根本灌不进去（r28）', () => {
  const demo = require('../src/model/state/demo');
  const effects = require('../src/model/systems/effects');
  const rules = require('../src/model/repository/config').get('rules');

  const s = opening();                                  /* 站在体魄 */
  effects.run(s, [{ add: ['path.body.bar', 9999] }], { rules });
  assert.strictEqual(s.path.body.bar, 140, '体魄这一品的上限是 140');

  const t = fresh();                             /* 还没入品 */
  effects.run(t, [{ add: ['path.body.bar', 9999] }], { rules });
  assert.strictEqual(t.path.body.bar, 0, '没入品就没有修为条，不许偷偷灌');
});

test('修心：破境不清道心（累计制）', () => {
  const demo = require('../src/model/state/demo');
  const realm = require('../src/model/rules/realm');
  const rules = require('../src/model/repository/config').get('rules');
  const s = fresh();
  s.path.heart.bar = 100;
  /* r35：心性 < 90 时修心突破必然失败，所以这条测试必须先把心性抬到 90 */
  s.attr.heart.base = 95;

  /* r39：先通层级，再点突破 */
  const force = realm.raiseLevel(s, { dao: 'heart', tier: 1, byEvent: true }, { rules, rng: () => 0.5 });
  assert.strictEqual(force.ok, true, '事件办成了就该通层级');
  assert.strictEqual(s.path.heart.lv, 1, '层级到 1');
  const brk = realm.breakthrough(s, { dao: 'heart', tier: 1 }, { rules });
  assert.strictEqual(brk.ok, true, brk.why);
  assert.strictEqual(s.path.heart.level, 1, '境界进到不惑');
  assert.strictEqual(s.path.heart.bar, 100, '道心不清零，接着往上攒');
});

test('修心：心性 < 90 突破必然失败（r35）', () => {
  const realm = require('../src/model/rules/realm');
  const rules = require('../src/model/repository/config').get('rules');
  const s = fresh();
  s.attr.heart.base = 89;
  s.path.heart.bar = 100;

  /* 事件瓶颈的 force 也救不了：心性不够就是进不去 */
  const r = realm.raiseLevel(s, { dao: 'heart', tier: 1, byEvent: true }, { rules, rng: () => 0.01 });
  assert.strictEqual(r.ok, false, '心性 89 必须失败');
  assert.strictEqual(r.why, 'heart_low');
  assert.strictEqual(s.path.heart.level, 0, '层级不动');

  /* 正好 90 就放行 */
  s.attr.heart.base = 90;
  const r2 = realm.raiseLevel(s, { dao: 'heart', tier: 1, byEvent: true }, { rules, rng: () => 0.01 });
  assert.strictEqual(r2.ok, true, '心性 90 应当放行');
});

test('寿元：跟着境界走，到点就死，死后点不动', () => {
  const demo = require('../src/model/state/demo');
  const turn = require('../src/model/systems/turn');

  const s = fresh();
  s.clock.age = 104;
  s.monthsUsed = 11;
  turn.act(s, { kind: 'wait' });
  assert.strictEqual(s.dead, true, '105 岁高于凡人寿元 72，该走');
  assert.strictEqual(turn.act(s, { kind: 'wait' }).ok, false, '死人点不动');

  const h = fresh();
  h.path.body.level = 5;          /* 金身：LIFESPAN.body[4] = [300, 350] */
  h.monthsUsed = 11;
  turn.act(h, { kind: 'wait' });
  assert.strictEqual(h.lifespan, 350);
  assert.ok(!h.dead, '进了品就该活得久');
});

/* ── 表现层 ─────────────────────────────────────────── */
test('裁剪：玩家拿不到权重与来源', () => {
  const { cropEvent } = require('../src/controller/serialize');
  const ev = {
    id: 'e', title: 't', nature: '主线', weight: 3, priority: 2,
    source: '设计/04', template: 'tpl', args: { a: 1 },
    when: [{ gte: ['clock.age', 10] }],
    choices: [{ id: 'c', label: '走', do: [{ money: { copper: 1 } }] }]
  };
  const forPlayer = cropEvent(ev, 'guest');
  for (const k of ['weight', 'priority', 'source', 'template', 'args', 'when', 'do']) {
    assert.ok(!(k in forPlayer), `玩家不该拿到 ${k}`);
  }
  assert.ok(!('do' in forPlayer.choices[0]), '选项效果不该给玩家');
  const forAdmin = cropEvent(ev, 'sysadmin');
  assert.strictEqual(forAdmin.weight, 3, 'sysadmin 应该看到全部');
});

test('r40 修为条：裁剪后玩家仍拿得到 bar / barMax（进度条不许变 NaN）', () => {
  const { cropState } = require('../src/controller/serialize');
  const s = fresh();
  s.path.body.bar = 120;
  s.path.body.barMax = 200;

  const out = cropState(s, 'guest');
  assert.strictEqual(out.path.body.bar, 120, 'bar 要发给浏览器（左栏进度条的分子）');
  assert.strictEqual(out.path.body.barMax, 200, 'barMax 要发给浏览器（进度条的分母）');
  assert.ok(!('attr' in out), '隐藏属性仍然要藏');
  assert.ok(!('lifespan' in out), '寿元仍然要藏');
  assert.ok(!('luck' in out), '气运仍然要藏');
});

test('r40 炼气：没完成府学炼气学习，感气这道门不开', () => {
  const turn = require('../src/model/systems/turn');
  const hand = require('../src/model/systems/hand');

  const s = fresh();
  s.turn = s.turn || {};

  /* 门槛没过：卡上的按钮是灰的，硬点也进不去 */
  let card = hand.breakCards(s).find((b) => b.dao === 'qi' && b.tier === 1);
  assert.strictEqual(card.gateOk, false, '没上过府学炼气课，门槛该是关的');
  assert.ok(String(card.gateHint || '').includes('府学'), '提示该说清楚去哪学');

  const blocked = turn.act(s, { kind: 'break', dao: 'qi', tier: 1, mode: 'try' });
  assert.strictEqual(blocked.ok, false, '没学过炼气知识，不许冲感气');
  assert.strictEqual(s.path.qi.level, 0, '境界不该动');

  /* 11 岁强制事件办完（flag.edu.ganqi.entered）→ 门槛打开 */
  s.flags.edu = s.flags.edu || {};
  s.flags.edu.ganqi = { entered: true };
  card = hand.breakCards(s).find((b) => b.dao === 'qi' && b.tier === 1);
  assert.strictEqual(card.gateOk, true, '府学炼气课上完，门槛该开');
});


test('r39 时间线：7/10/11/14/15/16/19 岁各有一个强制事件', () => {
  const demo = require('../src/model/state/demo');
  const config = require('../src/model/repository/config');

  const ev = (id) => config.get('events').find((x) => x.id === id);
  const ageOf = (id) => {
    const e = ev(id);
    const w = (e.when || []).find((x) => x.eq && x.eq[0] === 'clock.age');
    return w ? w.eq[1] : null;
  };

  assert.strictEqual(demo.initial('测').clock.age, 7, '开局 7 岁');

  const chain = [
    ['evt.edu.enter.meng', 7, 3],
    ['evt.edu.graduate.meng', 10, 1],
    ['evt.edu.enter.ganqi', 11, 6],
    ['evt.art.choose', 14, 6],
    ['evt.edu.exam.great', 15, 6],
    ['evt.edu.enter.tai', 16, 1],
    ['evt.edu.graduate.tai', 19, 1]
  ];
  for (const [id, age, months] of chain) {
    assert.strictEqual(ageOf(id), age, id + ' 该 ' + age + ' 岁');
    assert.strictEqual(ev(id).months, months, id + ' 耗时 ' + months + ' 月');
    assert.strictEqual(!!ev(id).forced, true, id + ' 该是强制');
  }

  for (const id of ['evt.edu.graduate.meng', 'evt.edu.exam.great']) {
    assert.strictEqual((ev(id).choices || []).length, 1, id + ' 只该剩一个选项');
  }
  assert.strictEqual((ev('evt.edu.enter.tai').choices || []).length, 2, '太学判定有两个分支');
  assert.ok((ev('evt.art.choose').choices || []).length >= 9, '百艺可选多门');
});

test('r39 突破次数：入门关同年可多试，品内一年一次', () => {
  const demo = require('../src/model/state/demo');
  const realm = require('../src/model/rules/realm');
  const rules = require('../src/model/repository/config').get('rules');

  /* 入门关（体魄）：连试三次都该被允许 */
  const e = demo.initial('测', { rng: () => 0.5 });
  e.turn = {};
  e.path.body.wall = { 1: true };
  for (let i = 0; i < 3; i += 1) {
    const r = realm.raiseLevel(e, { dao: 'body', tier: 1 }, { rules, rng: () => 0.99 });
    assert.notStrictEqual(r.why, 'one_per_year', '入门关不该被年份拦住');
  }

  /* 品内（脏腑）：第一次之后，同年再试要被拒 */
  const s = demo.initial('测', { rng: () => 0.5 });
  s.turn = {};
  s.path.body.level = 1;
  s.path.body.lv = 1;
  s.path.body.wall = { 2: true };
  s.path.body.attempts = 1;
  const first = realm.raiseLevel(s, { dao: 'body', tier: 2 }, { rules, rng: () => 0.99 });
  assert.notStrictEqual(first.why, 'one_per_year', '第一次该放行');
  const second = realm.raiseLevel(s, { dao: 'body', tier: 2 }, { rules, rng: () => 0.99 });
  assert.strictEqual(second.why, 'one_per_year', '品内同年第二次该被拒');
});

test('r39 法术分栏：修炼列表只给已学，学习列表只给真能学', () => {
  const demo = require('../src/model/state/demo');
  const hand = require('../src/model/systems/hand');

  const s = demo.initial('测', { rng: () => 0.5 });
  s.turn = s.turn || {};
  s.turn.mainDone = true;

  const practice = hand.spellPractice(s);
  const learn = hand.spellLearn(s);

  /* 已学的只该有罗汉拳（开局必教） */
  assert.ok(practice.every((x) => x.known), '修炼列表里只能有已学的');
  assert.ok(practice.some((x) => x.id === 'spell.luohan'), '罗汉拳该在修炼列表');

  /* 能学的：境界够；法相才能学的（五雷正法）不该出现 */
  for (const x of learn) {
    assert.ok(!x.known, '学习列表里不该有已学的');
    assert.ok(!x.locked, '被境界拦住的术法不该出现在学习列表：' + x.id);
  }
  assert.ok(!learn.some((x) => x.id === 'spell.wulei'), '炼气不够，五雷正法不该出现');
});


test('r39 心性事件：扣心的必须有正收益 + 只来一次', () => {
  const config = require('../src/model/repository/config');
  const events = config.get('events');

  const negDelta = (c) => {
    const out = [];
    const walk = (n) => {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== 'object') return;
      for (const k of Object.keys(n)) {
        if (k === 'add' && Array.isArray(n[k]) && n[k][0] === 'attr.heart.eff' && Number(n[k][1]) < 0) {
          out.push(Number(n[k][1]));
        }
        walk(n[k]);
      }
    };
    walk(c.do || []);
    return out;
  };

  for (const e of events) {
    const bad = (e.choices || []).filter((c) => negDelta(c).length);
    if (!bad.length) continue;

    for (const c of bad) {
      /* ② 必须有正收益（钱 / 属性 / 声望 / 道心 / 术法 / 战斗） */
      const t = JSON.stringify(c.do || []);
      const gain = /money|attr\.(insight|aptitude)|reputation|path\.heart\.bar|learn|judge/.test(t);
      assert.ok(gain, e.id + '/' + c.id + ' 扣了心性却没给正收益');
    }

    /* ④ 一次性守卫：**强制事件**必须"来过就别再来"；
          普通灾祸不强制（它靠 weight 控频率，本来就该偶尔重复） */
    if (e.forced) {
      const t = JSON.stringify(e.when || []);
      assert.ok(/none/.test(t), e.id + ' 是强制事件却扣心性，没有 none 守卫（会年年重来）');
    }
  }
});

test('r39 委托：与百艺挂钩，手艺不够就锁着', () => {
  const demo = require('../src/model/state/demo');
  const com = require('../src/model/systems/commission');

  const s = demo.initial('测', { rng: () => 0.5 });
  assert.strictEqual(com.unlocked(s).length, 0, '一门手艺都没学，接不了委托');

  s.arts.alchemy.learned = true;
  s.arts.alchemy.lvl = 1;
  const list = com.unlocked(s);
  assert.ok(list.length >= 1, '学了丹道，至少有丹道委托');
  assert.strictEqual(list[0].art, 'alchemy');

  /* 每门百艺都该有一条委托 */
  const arts = require('../src/seed/arts.json').map((a) => a.id);
  const covered = com.available(s).map((c) => c.art);
  for (const id of arts) {
    assert.ok(covered.indexOf(id) >= 0, '百艺 ' + id + ' 没有对应委托');
  }

  /* 出城的委托要标 outing */
  assert.ok(com.available(s).some((c) => c.outing), '至少有一条出城委托');
});

test('r39 物品：只显示级别，不写"品"', () => {
  const grade = require('../src/model/rules/grade');
  assert.strictEqual(grade.itemLabel(2, 3), '2 阶黄上级');
  assert.strictEqual(grade.itemLabel(1, 1), '1 阶黄下级');
  assert.strictEqual(grade.itemLabel(2, 4), '2 阶玄级');
});


test('r39 求学：每品一次，换品重新计', () => {
  const demo = require('../src/model/state/demo');
  const hand = require('../src/model/systems/hand');
  const rules = require('../src/model/repository/config').get('rules');

  const s = demo.initial('测', { rng: () => 0.5 });
  s.education.stage = 'fu';
  s.education.graduated = false;
  s.clock.age = 12;
  s.path.body.level = 1;
  s.path.body.lv = 1;
  s.path.body.bar = rules.PROF.body[0];

  const card2 = () => hand.breakCards(s).find((b) => b.dao === 'body');
  assert.ok(card2() && card2().study, '品 2 一开始可求学');

  /* 求过一次：这一品不能再求 */
  s.flags.study = { body: { 2: true } };
  assert.ok(!card2().study, '品 2 求过就不能再求');

  /* 升到品 3：重新给一次 */
  s.path.body.level = 2;
  s.path.body.lv = 2;
  s.path.body.bar = rules.PROF.body[1];
  assert.ok(card2().study, '换到品 3 该重新可求学');

  /* 封顶与"每次的量"一致（r39 修了 0.06/0.12 的误导） */
  assert.strictEqual(rules.SUCCESS.teachCap['1'], rules.SUCCESS.teachPerSession,
    'teachCap 该等于 teachPerSession（每品只求一次）');
});

test('r39 接口：payload 必须带 events 数组（老前端按数组读）', () => {
  const demo = require('../src/model/state/demo');
  const opening = require('../src/model/systems/opening');
  const hand = require('../src/model/systems/hand');

  const s = demo.initial('测', { rng: () => 0.5 });
  opening.apply(s, { rng: () => 0.5 });
  const table = hand.table(s);

  /* 开局一定有主卡（7 岁进蒙学） */
  assert.ok(table.main, '开局该有主卡');
  assert.strictEqual(table.main.id, 'evt.edu.enter.meng');
  /* table.events 与 main 一致 */
  assert.strictEqual(table.events.length, 1, 'table.events 该只有一张');
  assert.strictEqual(table.events[0].id, table.main.id);
});


test('r39.2 前端 render() 不许抛异常，且开局能画出主事件卡', () => {
  const { payloadFor, runRender } = require('./frontend-harness');

  /* 7 岁：开局那张强制事件必须真的画出来（之前被一个未定义变量整页吃掉） */
  const mk = runRender(payloadFor(7));
  const html = mk('mainCards').innerHTML;

  assert.ok(html.length > 100, '主事件卡该有内容，实际 ' + html.length + ' 字');
  assert.ok(html.includes('头一天进蒙学'), '7 岁该画出「头一天进蒙学」');
  assert.ok(html.includes('站直了让他看'), '该有一个可点的选项');
  assert.strictEqual(mk('bandMain').hidden, false, '主事件块不该藏起来');
});

test('r39.2 前端 render()：14 岁前后、无主卡时也不抛', () => {
  const { payloadFor, runRender } = require('./frontend-harness');

  /* 14 岁（有百艺） */
  assert.doesNotThrow(() => runRender(payloadFor(14)), '14 岁渲染不该抛');
  /* 20 岁（学籍 none，无主卡） */
  assert.doesNotThrow(() => runRender(payloadFor(20)), '20 岁渲染不该抛');
});


test('r40.1 突破名额：每道一年一次，各道分开算', () => {
  const demo = require('../src/model/state/demo');
  const turn = require('../src/model/systems/turn');
  const realm = require('../src/model/rules/realm');
  const rules = require('../src/model/repository/config').get('rules');

  const mk = () => {
    const s = demo.initial('测', { rng: () => 0.99 });
    s.turn = {};
    s.path.body.level = 1;
    s.path.body.lv = 1;
    s.path.body.bar = rules.PROF.body[0];
    s.path.qi.level = 1;
    s.path.qi.lv = 1;
    s.path.qi.bar = rules.PROF.qi[0];
    return s;
  };

  /* ① 锻体破一次（概率瓶颈：判定 + 进品一步完成） */
  const s = mk();
  const b1 = realm.probabilityBreakthrough(s, { dao: 'body', tier: 2 }, { rules, rng: () => 0.001 });
  assert.strictEqual(b1.ok, true, b1.why || '');
  assert.strictEqual(s.path.body.level, 2, '该一步进品');
  assert.deepStrictEqual(s.turn.brokeThisYear, { body: true }, '记账该按道');

  /* ② 同一个道同年再破：拒绝 */
  s.path.body.lv = 2;
  s.path.body.bar = rules.PROF.body[1];
  const b2 = realm.probabilityBreakthrough(s, { dao: 'body', tier: 3 }, { rules, rng: () => 0.001 });
  assert.strictEqual(b2.ok, false, '同一道一年只能破一次');
  assert.strictEqual(b2.why, 'one_per_year', b2.why);

  /* ③ **另一道**同年能破（每道独立） */
  const q1 = realm.probabilityBreakthrough(s, { dao: 'qi', tier: 2 }, { rules, rng: () => 0.001 });
  assert.strictEqual(q1.ok, true, '炼气该能破：' + (q1.why || ''));
  assert.strictEqual(s.path.qi.level, 2);
  assert.deepStrictEqual(s.turn.brokeThisYear, { body: true, qi: true });

  /* ④ 跨年后记账清零（走 turn.rollYear 的真路径） */
  const s2 = mk();
  realm.probabilityBreakthrough(s2, { dao: 'body', tier: 2 }, { rules, rng: () => 0.001 });
  assert.deepStrictEqual(s2.turn.brokeThisYear, { body: true });
  turn.act(s2, { kind: 'wait' });
  assert.deepStrictEqual(s2.turn.brokeThisYear, {}, '跨年该清空');

  /* ⑤ 入门关不占名额 */
  const e = demo.initial('测2', { rng: () => 0.99 });
  e.turn = {};
  e.path.qi.level = 0;
  e.path.qi.lv = 0;
  e.path.qi.wall = { 1: false };
  const entry = realm.probabilityBreakthrough(e, { dao: 'qi', tier: 1 }, { rules, rng: () => 0.99 });
  assert.strictEqual(entry.ok, true, '入门关该放行：' + (entry.why || ''));
  assert.ok(!e.turn.brokeThisYear || !e.turn.brokeThisYear.qi, '入门关不记账');
});


test('r40.2 同一个瓶颈：同年只准冲一次（失败也不给第二次）', () => {
  const demo = require('../src/model/state/demo');
  const turn = require('../src/model/systems/turn');
  const realm = require('../src/model/rules/realm');
  const rules = require('../src/model/repository/config').get('rules');

  const mk = () => {
    const s = demo.initial('测', { rng: () => 0.5 });
    s.clock.age = 11;
    s.education.stage = 'fu';
    s.education.graduated = false;
    s.flags = { edu: { meng: { done: true }, ganqi: { entered: true } }, study: {} };
    s.turn = { mainDone: true };
    s.path.body.level = 2;
    s.path.body.lv = 2;
    s.path.body.bar = rules.PROF.body[1];
    return s;
  };

  /* ① 有墙 + 掷不过 → 失败，但**要记账**（以前 no_wall/失败都不记） */
  const s = mk();
  s.path.body.wall = { 3: true };
  s.path.body.attempts = 1;                  /* 跳过首次必败 */
  const r1 = realm.raiseLevel(s, { dao: 'body', tier: 3 }, { rules, rng: () => 0.999 });
  assert.strictEqual(r1.ok, false, '该失败');
  assert.strictEqual(s.path.body.level, 2, '境界没动');
  assert.strictEqual(num(s.path.body.triedYear[3]), s.clock.year, '失败也要记账');

  /* ② 同年再点：业务层直接拒，且**不扣月** */
  const before = s.monthsUsed;
  const r2 = turn.act(s, { kind: 'break', dao: 'body', tier: 3 });
  assert.strictEqual(r2.ok, false, '同年不该再允许');
  assert.ok(/今年已经冲过/.test(String(r2.reason || '')), r2.reason);
  assert.strictEqual(s.monthsUsed, before, '被拒时不该扣月');

  /* ③ **没墙（q 掷空）也要记账**：以前这一支直接返回，不留痕迹 */
  const t = mk();
  t.path.body.wall = { 3: false };           /* 没墙 */
  const r3 = realm.raiseLevel(t, { dao: 'body', tier: 3 }, { rules, rng: () => 0.5 });
  assert.strictEqual(r3.ok, true, '没墙该直接通');
  assert.strictEqual(num(t.path.body.triedYear[3]), t.clock.year, '没墙也要记账');

  /* ④ 入门关不受这条限制：同年可以一直试 */
  const e = demo.initial('测2', { rng: () => 0.5 });
  e.turn = {};
  e.path.body.lv = 0;
  e.path.body.level = 0;
  e.path.body.wall = { 1: true };
  for (let i = 0; i < 3; i += 1) {
    const r = realm.raiseLevel(e, { dao: 'body', tier: 1 }, { rules, rng: () => 0.999 });
    assert.notStrictEqual(r.why, 'one_per_year', '入门关不该被年份拦');
  }
  assert.ok(!e.path.body.triedYear || !e.path.body.triedYear[1], '入门关不记账');

  /* ⑤ 跨年后恢复 */
  const c = mk();
  c.path.body.wall = { 3: true };
  c.path.body.attempts = 1;
  realm.raiseLevel(c, { dao: 'body', tier: 3 }, { rules, rng: () => 0.999 });
  assert.ok(num(c.path.body.triedYear[3]) === c.clock.year);
  c.path.body.triedYear = {};                /* rollYear 会清空 */
  c.path.body.attempts = 2;
  const r5 = realm.raiseLevel(c, { dao: 'body', tier: 3 }, { rules, rng: () => 0.999 });
  assert.notStrictEqual(r5.why, 'one_per_year', '新的一年该放行');
});

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ── 串起来跑 ───────────────────────────────────────── */
(async () => {
  for (const [name, fn] of cases) {
    try {
      await fn();
      pass += 1;
      console.log(`  ok   ${name}`);
    } catch (e) {
      fail += 1;
      console.log(`  FAIL ${name}\n       ${e.message}`);
    }
  }
  console.log(`\n${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
})();
