'use strict';

const { createState } = require('../src/model/state/create.state');
const turn = require('../src/model/systems/turn.system');
const helper = require('../src/model/systems/view.helper');
const combat = require('../src/model/systems/combat.system');
const action = require('../src/model/systems/action.system');

function runOne(index, style = 'random') {
  const s = createState(`试炼${index}`);
  s.currentEventId = 'n_first_day';
  s.phase = 'event';
  let guard = 0;
  while (s.phase !== 'ended' && guard < 600) {
    guard += 1;
    if (s.phase === 'event') {
      const ev = helper.currentEvent(s);
      if (!ev) break;
      const visible = helper.visibleChoices(s, ev);
      const usable = visible.filter((c) => helper.choiceState(s, c).available);

      // 有时优先修炼
      if (style === 'grind' && Math.random() < 0.55) {
        const opts = action.cultivateOptions(s).filter((o) => o.available && !o.stub);
        if (opts.length) {
          const opt = opts[Math.floor(Math.random() * opts.length)];
          action.cultivate(s, opt.id, 1);
          continue;
        }
      }

      const pick = usable.length ? usable[Math.floor(Math.random() * usable.length)] : visible[0];
      turn.choose(s, pick ? pick.id : 'skip');
    } else if (s.phase === 'result') {
      turn.continueRun(s);
    } else if (s.phase === 'battle') {
      if (s.battle.over) combat.finishBattle(s);
      else {
        const acts = combat.actionList(s).filter((a) => a.available);
        combat.performAction(s, acts[Math.floor(Math.random() * acts.length)].id);
      }
    } else break;
  }
  return s;
}

function summarize(style, count = 30) {
  const endings = new Map();
  const realms = { body: 0, qi: 0, spirit: 0, heart: 0 };
  let fails = 0;
  let totalAge = 0;
  for (let i = 1; i <= count; i += 1) {
    const s = runOne(i, style);
    if (s.phase !== 'ended') {
      fails += 1;
      continue;
    }
    totalAge += s.age;
    const title = s.ending?.title || '无结局';
    endings.set(title, (endings.get(title) || 0) + 1);
    for (const key of Object.keys(realms)) {
      const r = s.realms[key];
      if (r?.unlocked) realms[key] += 1;
    }
  }
  console.log(`\n[${style}] ${count} 世，失败 ${fails}，均寿 ${Math.round(totalAge / (count - fails))}`);
  console.log('  结局：', [...endings.entries()].map(([k, v]) => `${k}×${v}`).join('  '));
  console.log('  解锁：', Object.entries(realms).map(([k, v]) => `${k}:${v}`).join('  '));
}

summarize('random');
summarize('grind');
