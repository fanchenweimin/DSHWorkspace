'use strict';

import { Store } from './autoload/store.js';
import { Session } from './autoload/session.js';
import { GameController } from './controller/game.controller.js';
import { render, bind, cache } from './scenes/game/game.scene.js';
import { toast } from './autoload/toast.js';

async function boot() {
  await Session.load();
  bind();

  const runId = Store.getRunId();
  if (!runId) {
    toast('没有找到存档，回首页开一局。');
    setTimeout(() => location.replace('/'), 900);
    return;
  }

  const state = await GameController.reload();
  if (!state) {
    toast('读不到存档，回首页重新开始。');
    setTimeout(() => location.replace('/'), 900);
    return;
  }

  render();
}

boot();
