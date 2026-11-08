'use strict';

import { Store } from '../../autoload/store.js';
import { Session } from '../../autoload/session.js';
import { GameController } from '../../controller/game.controller.js';
import { api } from '../../autoload/api.js';
import { toast, escapeHtml } from '../../autoload/toast.js';

const nameInput = document.getElementById('nameInput');
const startForm = document.getElementById('startForm');
const continueCard = document.getElementById('continueCard');
const continueName = document.getElementById('continueName');
const continueMeta = document.getElementById('continueMeta');
const continueButton = document.getElementById('continueButton');
const guestActions = document.getElementById('guestActions');
const userActions = document.getElementById('userActions');
const userName = document.getElementById('userName');
const adminLink = document.getElementById('adminLink');
const logoutButton = document.getElementById('logoutButton');

function renderAccount() {
  const user = Session.get();
  if (!user) {
    guestActions.hidden = false;
    userActions.hidden = true;
    return;
  }
  guestActions.hidden = true;
  userActions.hidden = false;
  userName.textContent = user.username + (user.role === 'sysadmin' ? ' · 管理员' : '');
  adminLink.hidden = user.role !== 'sysadmin';
}

async function renderContinue() {
  const runId = Store.getRunId();
  if (!runId) {
    continueCard.hidden = true;
    return;
  }
  try {
    const res = await fetch(`/api/runs/${runId}`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('gone');
    const data = await res.json();
    const state = data.state;
    continueCard.hidden = false;
    continueName.textContent = state.name;
    continueMeta.textContent = `${state.age}岁 · ${state.education.stage} · ${state.realms.map((r) => `${r.name}·${r.stageName}`).join(' / ')}`;
    continueButton.href = `/game.html?run=${state.id}`;
  } catch {
    continueCard.hidden = true;
    Store.clear();
  }
}

startForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  const state = await GameController.start(name);
  if (state) location.href = `/game.html?run=${state.id}`;
});

logoutButton?.addEventListener('click', async () => {
  await Session.logout();
  renderAccount();
  toast('已退出登录。');
});

(async () => {
  await Session.load();
  renderAccount();
  await renderContinue();
})();
