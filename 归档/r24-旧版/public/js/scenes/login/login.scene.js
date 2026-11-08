'use strict';

import { Session } from '../../autoload/session.js';
import { toast } from '../../autoload/toast.js';

const form = document.getElementById('loginForm');
const error = document.getElementById('loginError');
const already = document.getElementById('alreadyLogged');
const alreadyText = document.getElementById('alreadyText');
const alreadyAdmin = document.getElementById('alreadyAdmin');

function nextPath() {
  const next = new URLSearchParams(location.search).get('next') || '/';
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}

(async () => {
  const user = await Session.load();
  if (user) {
    already.hidden = false;
    alreadyText.textContent = `你已登录为 ${user.username}${user.role === 'sysadmin' ? '（管理员）' : ''}。`;
    alreadyAdmin.hidden = user.role !== 'sysadmin';
    form.hidden = true;
  }
})();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.hidden = true;
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  try {
    const user = await Session.login(username, password);
    toast(`欢迎，${user.username}。`);
    let next = nextPath();
    if (next.startsWith('/admin') && user.role !== 'sysadmin') next = '/';
    setTimeout(() => location.replace(next), 300);
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
  }
});
