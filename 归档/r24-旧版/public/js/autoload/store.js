'use strict';

import { emit } from './bus.js';

const KEY = 'dayao.run';

let state = null;

export const Store = {
  setState(next) {
    state = next;
    if (next?.id) localStorage.setItem(KEY, next.id);
    emit('state:changed', next);
  },
  getState: () => state,
  getRunId() {
    const fromUrl = new URLSearchParams(location.search).get('run');
    if (fromUrl && /^[0-9a-f-]{36}$/.test(fromUrl)) return fromUrl;
    const saved = localStorage.getItem(KEY);
    return saved && /^[0-9a-f-]{36}$/.test(saved) ? saved : null;
  },
  clear() {
    state = null;
    localStorage.removeItem(KEY);
  },
  /** ViewModel：View 的唯一输入 */
  viewModel() {
    if (!state) return null;
    return {
      id: state.id,
      name: state.name,
      age: state.age,
      turn: state.turn,
      calendar: state.calendar,
      phase: state.phase,
      rev: state.rev,
      education: state.education,
      identity: state.identity,
      fate: state.fate,
      talents: state.talents,
      realms: state.realms,
      activeRealm: state.activeRealm,
      inventory: state.inventory,
      skills: state.skills,
      actions: state.actions,
      event: state.event,
      result: state.result,
      battle: state.battle,
      ending: state.ending,
      pendingEnding: state.pendingEnding,
      journal: state.journal,
      admin: state.admin || null
    };
  }
};
