'use strict';

const { sendJSON, readBody } = require('../util/http');
const config = require('../model/repository/config');
const grade2 = require('../model/rules/grade');
const handSys = require('../model/systems/hand');
const turn = require('../model/systems/turn');
const mods = require('../model/rules/mods');
const arts = require('../model/rules/arts');
const realm = require('../model/rules/realm');
const running = require('../model/state/running');
const session = require('../middleware/session');
const { cropEvents, cropEvent, cropState } = require('./serialize');
const { evalWhen } = require('../model/rules/dsl');

const STAGE = {
  meng: '蒙学', fu: '府学', tai: '太学', none: '卒业'
};

const round1 = (v) => Math.round(Number(v) * 10) / 10;

/** 当前身份：按 identities.json 的顺序，取第一个条件成立的 */
function identityOf(state) {
  const list = config.get('identities') || [];
  const ctx = {
    state,
    rules: config.get('rules'),
    conditions: config.get('conditions'),
    args: {}
  };
  for (const id of list) {
    if (evalWhen(id.req || [], ctx)) {
      return { id: id.id, name: id.name, kind: id.kind || '' };
    }
  }
  return { id: 'id.commoner', name: '平民', kind: '民' };
}

/**
 * 玩家能看到的角色卡：品级、进度、钱、身份。藏 flags 与一切内部计数。
 * 左栏要能回答"我为什么卡在这儿"，所以顺手把下一关的门槛与"修为满没满"算出来。
 */
function publicState(state) {
  const rules = config.get('rules');
  const ctx = {
    state,
    rules,
    conditions: config.get('conditions'),
    args: {}
  };

  const path = {};
  for (const dao of ['body', 'qi', 'spirit', 'heart']) {
    const p = state.path[dao];
    const level = Number(p.level) || 0;
    /* r39：`lv` 是层级（门通到第几层），可以**超前于** level。
       界面靠它判断"这道门通了没有"，所以必须发出去。 */
    const lv = Number(p.lv != null ? p.lv : p.level) || 0;
    const tier = level + 1;
    const prof = rules.PROF[dao] || [];
    const cap = realm.barMax(state, dao, rules);
    const gate = (((rules.BREAK_GATE || {})[dao] || {})[String(tier)]) || {};
    const gateOk = evalWhen(gate.when || [], ctx);
    const top = tier > prof.length;

    path[dao] = {
      level,
      lv,
      /* 层级到位 = 只剩"点不点突破"；没到位 = 还要先冲这道门 */
      levelReady: lv >= tier,
      bar: round1(p.bar),
      barMax: cap == null ? null : round1(cap),
      /* 入门关（第 1 品）没有修为条；品内突破要先把修为练满 */
      entry: level === 0 && dao !== 'heart',
      ready: cap == null ? true : Number(p.bar) >= cap - 0.001,
      gateOk,
      gateHint: gateOk ? '' : (gate.hint || ''),
      nextTitle: top ? '' : (((rules.TIERS || {})[dao] || [])[tier - 1] || ''),
      top
    };
  }
  return {
    name: state.name,
    clock: state.clock,
    lifespan: state.lifespan,
    zone: state.zone,
    luck: state.luck,
    attr: {
      aptitude: mods.get(state, 'attr.aptitude.eff'),
      insight: mods.get(state, 'attr.insight.eff'),
      heart: mods.get(state, 'attr.heart.eff')
    },
    reputation: round1(mods.get(state, 'reputation.eff')),
    /* 带伤：不是标记，是一条真的在打折的修饰器（r29） */
    injury: (state.mods || []).some((m) => m.source === 'injury'),
    path,
    money: state.money,
    merit: state.merit,
    stage: STAGE[state.education.stage] || '卒业',
    identity: identityOf(state),
    war: state.war.phase,
    log: state.log.slice(-60),
    monthsUsed: state.monthsUsed,
    monthsLeft: turn.MONTHS_PER_YEAR - state.monthsUsed,
    dead: !!state.dead
  };
}

/** 常驻动作只给玩家该看的字段 */
function cropActions(list) {
  return list.map((a) => ({
    id: a.id,
    name: a.name,
    sub: a.sub || '',
    months: a.months != null ? a.months : 1,
    rest: !!a.restMonths,
    market: a.id === 'act.market'
  }));
}

/** 背包：名字、数量、能不能吃、吃了有什么用、卖能换多少钱（r30 加了半价回收） */
function bagOf(state) {
  const items = config.get('items') || [];
  const bag = state.items || {};
  const C = (config.get('rules') || {}).CURRENCY || { copper: 100, silver: 100 };
  const out = [];
  for (const it of items) {
    const n = Number(bag[it.id]) || 0;
    if (n <= 0) continue;
    const p = it.price || {};
    const full = (Number(p.copper) || 0)
      + (Number(p.silver) || 0) * Number(C.copper)
      + (Number(p.gold) || 0) * Number(C.copper) * Number(C.silver);
    /* 成品要带阶品（r34）：同一个"丹道成品"，1 阶黄下和 2 阶黄中差着价 */
    let name = it.name;
    if (it.kind === '成品' && it.id.indexOf('craft.') === 0) {
      const g = (state.craftGrade || {})[it.id.slice(6)];
      if (g) name = `${it.name}（${grade2.short(g.jie, g.pin)}）`;
    }

    out.push({
      id: it.id,
      no: it.no,
      name,
      kind: it.kind || '杂物',
      n,
      use: it.use !== false,
      effect: it.effect || '',
      sellPrice: full > 0 ? Math.max(1, Math.floor(full * 0.5)) : 0
    });
  }
  return out;
}

/** 选项自己的门槛（`when`）不过，就不往界面上放——画出来的一定点得动 */
function mainFor(state) {
  const main = handSys.table(state).main;
  if (!main || !Array.isArray(main.choices) || !main.choices.length) return main;

  const ctx = {
    state,
    rules: config.get('rules'),
    conditions: config.get('conditions'),
    args: main.args || {}
  };
  const ok = main.choices.filter((c) => !c.when || evalWhen(c.when, ctx));
  /* 全被门槛挡住就原样放行：门是"该不该给人看"，不是"把人困死" */
  return ok.length ? { ...main, choices: ok } : main;
}

function payload(req, gid, state, extra) {
  const viewer = session.viewerOf(req);
  const table = handSys.table(state);
  return {
    /* r35：角色卡也要按 viewer 裁——隐藏属性 / 寿命只给 sysadmin（设计/40 §1.1） */
    state: cropState(publicState(state), viewer),
    main: table.main ? cropEvent(mainFor(state), viewer) : null,
    /* r39：`events` 是 main 的数组形态（老前端按数组读），别再漏掉 */
    events: table.events ? cropEvents(mainFor(state) ? [mainFor(state)] : [], viewer) : [],
    breaks: table.breaks,
    train: table.train,
    arts: table.arts,
    spells: table.spells,
    /* r39：法术分"练"与"学"两份，界面各画一栏 */
    spellPractice: table.spellPractice || [],
    spellLearn: table.spellLearn || [],
    artAge: table.artAge,
    actions: cropActions(table.actions),
    /* r39：委托与百艺挂钩，每门一条线 */
    commissions: require('../model/systems/commission').available(state),
    market: turn.marketOf(state),
    bag: bagOf(state),
    locked: table.locked,
    canWait: table.canWait,
    ...extra
  };
}

/** GET /api/hand —— 今年桌上有什么；没开局就返回 empty */
function current(req, res) {
  const gid = session.gameId(req, res);
  const state = running.peek(gid);
  if (!state) return sendJSON(res, 200, { empty: true });

  /* 抽卡是"读"的时候发生的：抽中了会把 mainId 记进 state。
     这时候顺手存一次，否则"抽了卡但没操作 → 重启 → 卡变了"。 */
  const before = state.turn && state.turn.mainId;
  const body = payload(req, gid, state, {});
  if (state.turn && state.turn.mainId && state.turn.mainId !== before) running.save(gid, state);
  return sendJSON(res, 200, body);
}

/** POST /api/act —— 点一下就走完，不需要二次确认 */
async function act(req, res) {
  const body = await readBody(req);
  const gid = session.gameId(req, res);
  const state = running.peek(gid);
  if (!state) return sendJSON(res, 409, { empty: true, result: { ok: false, reason: '还没开局。' } });

  const result = turn.act(state, {
    kind: body.kind,
    id: body.id,
    choice: body.choice,
    dao: body.dao,
    tier: body.tier,
    mode: body.mode,
    art: body.art          /* r39：委托要用它选是哪门百艺 */
  });

  if (result.ok) running.save(gid, state);
  return sendJSON(res, result.ok ? 200 : 409, payload(req, gid, state, { result }));
}

/** POST /api/new —— 开新局（名字可以不填，有默认名） */
function reset(req, res) {
  const gid = session.gameId(req, res);
  const state = running.reset(gid, '');
  return sendJSON(res, 200, payload(req, gid, state, { result: { ok: true } }));
}

/** POST /api/new 带 body 的版本（要读名字，所以单独一个异步入口） */
async function create(req, res) {
  const body = await readBody(req).catch(() => ({}));
  const gid = session.gameId(req, res);
  const name = body && body.name ? String(body.name).slice(0, 12) : '';
  const state = running.reset(gid, name);
  return sendJSON(res, 200, payload(req, gid, state, { result: { ok: true } }));
}

/**
 * POST /api/save —— 立刻落一次档。
 * 平时每一步结算后都会自动存（`running.save`）；这个接口是给"关页面前手动存一下"
 * 和调试用的，前端在切页时顺手调一次。
 */
function saveNow(req, res) {
  const gid = session.gameId(req, res);
  const state = running.peek(gid);
  if (!state) return sendJSON(res, 404, { ok: false, error: '还没开局' });
  running.save(gid, state);
  return sendJSON(res, 200, { ok: true, at: Date.now(), age: state.clock.age });
}

/** POST /api/forget —— 把这一局（内存 + 存档）一起删掉 */
function forget(req, res) {
  const gid = session.gameId(req, res);
  running.drop(gid);
  return sendJSON(res, 200, { ok: true });
}

/** GET /api/has —— 首页用：有没有存着的一局 */
function has(req, res) {
  const gid = session.gameId(req, res);
  const state = running.peek(gid);
  if (!state) return sendJSON(res, 200, { has: false });
  return sendJSON(res, 200, {
    has: true,
    name: state.name,
    age: state.clock.age,
    year: state.clock.year,
    stage: STAGE[state.education.stage] || '卒业',
    dead: !!state.dead
  });
}

module.exports = { current, act, reset, create, has, saveNow, forget, publicState, identityOf, bagOf };
