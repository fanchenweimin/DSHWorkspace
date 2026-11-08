'use strict';

import { post } from '../autoload/api.js';
import { Store } from '../autoload/store.js';
import { emit } from '../autoload/bus.js';
import { toast } from '../autoload/toast.js';

/** 统一的写操作：请求 → 更新 Store → 广播 */
async function send(action, body) {
  const state = Store.getState();
  if (!state) return null;
  try {
    const data = await post(`/api/runs/${state.id}/${action}`, { rev: state.rev, ...body });
    Store.setState(data.state);
    return data.state;
  } catch (error) {
    toast(error.message);
    if (error.code === 'STALE') emit('run:reload');
    return null;
  }
}

export const GameController = {
  choose: (choiceId) => send('choose', { choiceId }),
  next: () => send('next', {}),
  battle: (actionId) => send('battle', { actionId }),
  focus: (realmKey) => send('focus', { realmKey }),
  cultivate: (optionId, years) => send('act', { kind: 'cultivate', optionId, years }),
  commission: (commissionId) => send('act', { kind: 'commission', commissionId }),
  abandon: () => send('abandon', {}),

  async reload() {
    const id = Store.getRunId();
    if (!id) return null;
    try {
      const data = await (await fetch(`/api/runs/${id}`, { credentials: 'same-origin' })).json();
      Store.setState(data.state);
      return data.state;
    } catch {
      toast('读不到存档。');
      return null;
    }
  },

  async start(name) {
    try {
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || '开不了局。');
      Store.setState(data.state);
      return data.state;
    } catch (error) {
      toast(error.message);
      return null;
    }
  }
};
