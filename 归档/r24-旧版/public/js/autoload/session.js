'use strict';

import { api } from './api.js';

let user = null;

export const Session = {
  async load() {
    try {
      const data = await api('/api/auth/me');
      user = data.user;
    } catch {
      user = null;
    }
    return user;
  },
  get: () => user,
  isAdmin: () => user?.role === 'sysadmin',
  async login(username, password) {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    user = data.user;
    return user;
  },
  async logout() {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
    user = null;
  }
};
