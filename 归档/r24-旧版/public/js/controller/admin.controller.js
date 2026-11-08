'use strict';

import { api, post } from '../autoload/api.js';
import { toast } from '../autoload/toast.js';

export const AdminController = {
  async loadConfig() {
    return api('/api/admin/config');
  },
  async saveConfig(config) {
    try {
      const data = await api('/api/admin/config', {
        method: 'PUT',
        body: JSON.stringify({ config })
      });
      toast('配置已保存，只影响之后新开的局。');
      return data.config;
    } catch (error) {
      toast(error.message);
      return null;
    }
  },
  async resetConfig() {
    const data = await api('/api/admin/config/reset', { method: 'POST', body: '{}' });
    toast('已恢复默认配置。');
    return data.config;
  },
  async loadEvents() {
    return api('/api/admin/events');
  },
  async saveEvent(event) {
    try {
      await api('/api/admin/events', { method: 'POST', body: JSON.stringify({ event }) });
      toast('事件已保存。');
      return true;
    } catch (error) {
      toast(error.message);
      return false;
    }
  },
  async toggleEvent(id, enabled) {
    try {
      await api('/api/admin/events/toggle', {
        method: 'POST',
        body: JSON.stringify({ id, enabled })
      });
      return true;
    } catch (error) {
      toast(error.message);
      return false;
    }
  },
  async deleteEvent(id) {
    try {
      await api(`/api/admin/events/${id}`, { method: 'DELETE' });
      toast('事件已删除。');
      return true;
    } catch (error) {
      toast(error.message);
      return false;
    }
  }
};
