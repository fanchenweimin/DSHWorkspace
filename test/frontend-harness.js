'use strict';

/**
 * r39.2：把"前端渲染不许抛异常"做成常驻测试。
 *
 * 起因：`renderCommissions` 里写了个未定义的 `state.comOffer`，
 * render() 在它那儿抛错，**后面所有块（包括主事件卡）全没渲染**，
 * 页面上只剩一句"读不到手牌: state is not defined"。
 *
 * 静态检查抓不到这种错，必须**真跑一遍 render()**。
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

/** 造一份和 /api/hand 一样的 payload */
function payloadFor(age) {
  const demo = require(path.join(ROOT, 'src/model/state/demo'));
  const opening = require(path.join(ROOT, 'src/model/systems/opening'));
  const hand = require(path.join(ROOT, 'src/model/systems/hand'));
  const turn = require(path.join(ROOT, 'src/model/systems/turn'));
  const commission = require(path.join(ROOT, 'src/model/systems/commission'));
  const { publicState } = require(path.join(ROOT, 'src/controller/game'));
  const { cropState, cropEvent } = require(path.join(ROOT, 'src/controller/serialize'));

  const st = demo.initial('沈砚', { rng: () => 0.5 });
  opening.apply(st, { rng: () => 0.5 });
  if (age && age !== st.clock.age) {
    st.clock.age = age;
    st.education.stage = age < 10 ? 'meng' : age < 16 ? 'fu' : 'tai';
  }

  const table = hand.table(st);
  return {
    state: cropState(publicState(st), 'user'),
    main: table.main ? cropEvent(table.main, 'user') : null,
    events: (table.events || []).map((e) => cropEvent(e, 'user')),
    breaks: table.breaks,
    train: table.train,
    arts: table.arts,
    spells: table.spells,
    spellPractice: table.spellPractice || [],
    spellLearn: table.spellLearn || [],
    artAge: table.artAge,
    actions: table.actions,
    commissions: commission.available(st),
    market: turn.marketOf(st),
    bag: [],
    locked: table.locked,
    canWait: table.canWait
  };
}

/** 在 DOM 桩里真跑 render() */
function runRender(payload) {
  let code = fs.readFileSync(path.join(ROOT, 'public', 'js', 'game.js'), 'utf8');
  code = code.replace(/^\s*\(function\s*\(\s*\)\s*\{/m, '');
  code = code.replace(/\}\)\s*\(\s*\)\s*;?\s*$/m, '');
  code = code.replace(/^\s*let S = null;\s*$/m, '');
  code = code.replace(/^\s*let DATA = null;\s*$/m, '');
  code = code.replace(/^\s*boot\(\);\s*$/m, '');
  code += '\n;__expose({ render });';

  const nodes = new Map();
  const mk = (id) => {
    if (!nodes.has(id)) {
      nodes.set(id, {
        id, innerHTML: '', textContent: '', hidden: false, disabled: false,
        dataset: {}, style: {},
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {},
        querySelector: () => ({ textContent: '', innerHTML: '', style: {} }),
        querySelectorAll: () => [],
        closest: () => null,
        scrollTop: 0, scrollHeight: 0
      });
    }
    return nodes.get(id);
  };

  const sandbox = {
    document: {
      getElementById: mk,
      querySelector: () => ({ addEventListener() {}, innerHTML: '' }),
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => mk('x' + Math.random())
    },
    location: { href: '', search: '' },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    setTimeout, clearTimeout, console,
    JSON, Math, Date, Number, String, Object, Array, RegExp, Error,
    parseInt, parseFloat, isNaN,
    S: payload.state,
    DATA: payload,
    __expose(o) { sandbox.__fn = o; }
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'game.js' });
  sandbox.__fn.render();
  return mk;
}

module.exports = { payloadFor, runRender };
