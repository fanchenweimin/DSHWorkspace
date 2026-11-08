'use strict';

import { Session } from '../../autoload/session.js';
import { toast, escapeHtml } from '../../autoload/toast.js';
import { AdminController } from '../../controller/admin.controller.js';
import { api } from '../../autoload/api.js';

const panel = document.getElementById('panel');
const adminUser = document.getElementById('adminUser');
const logoutButton = document.getElementById('logoutButton');

let config = null;
let events = [];
let library = { fates: [], talents: [] };

const ATTR_LABELS = { aptitude: '资质', insight: '悟性', heart: '心性', aptitude_insight: '资质+悟性' };
const POLICY_LABELS = { pills: '丹药可用', treasure: '法宝/宝地', opportunity: '只认认知', heart: '心关' };
const TYPE_LABELS = { normal: '入门', effort: '大成', world: '圆满', dao: '大圆满', heart: '心关' };

/* ─── 境界配置 ─── */
function renderRealmTab() {
  const realmsHtml = config.realms
    .map((realm, ri) => {
      const stages = realm.stages
        .map(
          (stage, si) => `
        <div class="admin-row">
          <span style="width:22px;color:var(--faint)">${si + 1}</span>
          <input style="flex:1;min-width:90px" data-r="${ri}" data-s="${si}" data-sf="name" value="${escapeHtml(stage.name)}" placeholder="小境界名">
          <select data-r="${ri}" data-s="${si}" data-sf="type">
            ${Object.entries(TYPE_LABELS)
              .map(([k, v]) => `<option value="${k}" ${k === stage.breakthrough.type ? 'selected' : ''}>${v}</option>`)
              .join('')}
          </select>
          <input type="number" style="width:62px" data-r="${ri}" data-s="${si}" data-sf="difficulty" value="${stage.breakthrough.difficulty}" title="难度">
          <label class="chip"><input type="checkbox" data-r="${ri}" data-s="${si}" data-sf="allowPills" ${stage.breakthrough.allowPills ? 'checked' : ''}> 丹</label>
          <label class="chip"><input type="checkbox" data-r="${ri}" data-s="${si}" data-sf="allowEmpower" ${stage.breakthrough.allowEmpower ? 'checked' : ''}> 顶</label>
        </div>`
        )
        .join('');

      return `
      <section class="admin-card">
        <h3>${escapeHtml(realm.name)} <span class="chip">${escapeHtml(realm.key)}</span></h3>
        <div class="admin-grid">
          <div class="admin-field"><label>名称</label><input data-r="${ri}" data-f="name" value="${escapeHtml(realm.name)}"></div>
          <div class="admin-field"><label>印字</label><input data-r="${ri}" data-f="seal" value="${escapeHtml(realm.seal)}" maxlength="2"></div>
          <div class="admin-field"><label>属性</label>
            <select data-r="${ri}" data-f="attribute">
              ${Object.entries(ATTR_LABELS)
                .map(([k, v]) => `<option value="${k}" ${k === realm.attribute ? 'selected' : ''}>${v}</option>`)
                .join('')}
            </select>
          </div>
          <div class="admin-field"><label>破境政策</label>
            <select data-r="${ri}" data-f="policy">
              ${Object.entries(POLICY_LABELS)
                .map(([k, v]) => `<option value="${k}" ${k === realm.policy ? 'selected' : ''}>${v}</option>`)
                .join('')}
            </select>
          </div>
          <div class="admin-field"><label>战斗阶</label><input type="number" data-r="${ri}" data-f="combatRank" value="${realm.combatRank}" min="1" max="4"></div>
          <div class="admin-field"><label>压制权重</label><input type="number" data-r="${ri}" data-f="suppressionWeight" value="${realm.suppressionWeight}" min="1" max="10"></div>
        </div>
        <div class="admin-field"><label>说明</label><textarea data-r="${ri}" data-f="description">${escapeHtml(realm.description)}</textarea></div>
        ${stages}
      </section>`;
    })
    .join('');

  panel.innerHTML = `
    <div class="admin-card">
      <h3>全局阈值</h3>
      <p style="color:var(--muted);font-size:0.76rem">这些数值直接决定玩法：改小了，更多人能直招。</p>
      <div class="admin-grid">
        <div class="admin-field"><label>直招资质阈值</label><input type="number" data-g="directAptitude" value="${config.thresholds.directAptitude}"></div>
        <div class="admin-field"><label>直招悟性阈值</label><input type="number" data-g="directInsight" value="${config.thresholds.directInsight}"></div>
        <div class="admin-field"><label>修心心性门槛</label><input type="number" data-g="heartGate" value="${config.thresholds.heartGate}"></div>
        <div class="admin-field"><label>大考及格分</label><input type="number" data-a="examPassScore" value="${config.admission.examPassScore}"></div>
        <div class="admin-field"><label>特招下限</label><input type="number" data-a="specialQuotaMin" value="${config.admission.specialQuotaMin}"></div>
        <div class="admin-field"><label>特招上限</label><input type="number" data-a="specialQuotaMax" value="${config.admission.specialQuotaMax}"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button type="button" class="btn btn-primary" id="saveConfig">保存配置</button>
        <button type="button" class="btn" id="resetConfig">恢复默认</button>
      </div>
    </div>
    ${realmsHtml}`;

  panel.querySelector('#saveConfig').addEventListener('click', saveRealmConfig);
  panel.querySelector('#resetConfig').addEventListener('click', async () => {
    config = await AdminController.resetConfig();
    renderRealmTab();
  });
}

function collectConfig() {
  const next = JSON.parse(JSON.stringify(config));
  panel.querySelectorAll('[data-r]').forEach((el) => {
    const ri = Number(el.dataset.r);
    const realm = next.realms[ri];
    if (el.dataset.s != null) {
      const stage = realm.stages[Number(el.dataset.s)];
      const field = el.dataset.sf;
      if (field === 'name') stage.name = el.value;
      else if (field === 'type') stage.breakthrough.type = el.value;
      else if (field === 'difficulty') stage.breakthrough.difficulty = Number(el.value) || 50;
      else if (field === 'allowPills') stage.breakthrough.allowPills = el.checked;
      else if (field === 'allowEmpower') stage.breakthrough.allowEmpower = el.checked;
    } else {
      const field = el.dataset.f;
      if (field === 'combatRank' || field === 'suppressionWeight') realm[field] = Number(el.value) || 1;
      else realm[field] = el.value;
    }
  });
  panel.querySelectorAll('[data-g]').forEach((el) => {
    next.thresholds[el.dataset.g] = Number(el.value);
  });
  panel.querySelectorAll('[data-a]').forEach((el) => {
    next.admission[el.dataset.a] = Number(el.value);
  });
  return next;
}

async function saveRealmConfig() {
  const saved = await AdminController.saveConfig(collectConfig());
  if (saved) {
    config = saved;
    renderRealmTab();
  }
}

/* ─── 事件配置 ─── */
function renderEventTab() {
  const kinds = {};
  for (const e of events) kinds[e.kind] = (kinds[e.kind] || 0) + 1;

  panel.innerHTML = `
    <div class="admin-card">
      <h3>事件库 <span class="chip">共 ${events.length} 条</span></h3>
      <p style="color:var(--muted);font-size:0.78rem">
        ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(' · ')}
      </p>
      <p style="color:var(--muted);font-size:0.78rem">内置事件可改正文与数值，不可改 id；自定义事件可删。</p>
    </div>
    ${events
      .map(
        (e) => `
      <div class="admin-card">
        <div class="admin-row">
          <span class="chip">${escapeHtml(e.kind)}</span>
          <strong style="flex:1">${escapeHtml(e.event.title || e.id)}</strong>
          <label class="chip"><input type="checkbox" data-toggle="${escapeHtml(e.id)}" ${e.enabled ? 'checked' : ''}> 启用</label>
          <button type="button" class="btn btn-small btn-ghost" data-expand="${escapeHtml(e.id)}">编辑</button>
          ${e.source === 'builtin' ? '' : `<button type="button" class="btn btn-small btn-danger" data-del="${escapeHtml(e.id)}">删除</button>`}
        </div>
        <div id="edit-${escapeHtml(e.id)}" hidden>
          <div class="admin-field"><label>标题</label><input data-e="${escapeHtml(e.id)}" data-ef="title" value="${escapeHtml(e.event.title || '')}"></div>
          <div class="admin-field"><label>正文</label><textarea data-e="${escapeHtml(e.id)}" data-ef="body" style="min-height:90px">${escapeHtml(e.event.body || '')}</textarea></div>
          <div class="admin-grid">
            <div class="admin-field"><label>年限</label><input type="number" data-e="${escapeHtml(e.id)}" data-ef="years" value="${e.event.years || 1}"></div>
            <div class="admin-field"><label>权重</label><input type="number" data-e="${escapeHtml(e.id)}" data-ef="weight" value="${e.event.weight || 10}"></div>
          </div>
          <button type="button" class="btn btn-small btn-primary" data-save="${escapeHtml(e.id)}">保存这一条</button>
        </div>
      </div>`
      )
      .join('')}`;

  panel.querySelectorAll('[data-expand]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const box = panel.querySelector(`#edit-${btn.dataset.expand}`);
      box.hidden = !box.hidden;
    });
  });

  panel.querySelectorAll('[data-toggle]').forEach((box) => {
    box.addEventListener('change', async () => {
      await AdminController.toggleEvent(box.dataset.toggle, box.checked);
    });
  });

  panel.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (await AdminController.deleteEvent(btn.dataset.del)) {
        events = (await AdminController.loadEvents()).events;
        renderEventTab();
      }
    });
  });

  panel.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.save;
      const target = events.find((e) => e.id === id);
      const next = JSON.parse(JSON.stringify(target.event));
      panel.querySelectorAll(`[data-e="${id}"]`).forEach((el) => {
        const field = el.dataset.ef;
        if (field === 'years' || field === 'weight') next[field] = Number(el.value) || 1;
        else next[field] = el.value;
      });
      if (await AdminController.saveEvent(next)) {
        events = (await AdminController.loadEvents()).events;
        renderEventTab();
      }
    });
  });
}

/* ─── 命格天赋 ─── */
function renderFateTab() {
  panel.innerHTML = `
    <div class="admin-card">
      <h3>命格 <span class="chip">${library.fates.length} 个</span></h3>
      <p style="color:var(--muted);font-size:0.78rem">一人一个，先天决定。玩家视图里只显示名字与描述。</p>
      <div class="option-list">
        ${library.fates
          .map(
            (f) => `
          <div class="option-row">
            <div><strong>${escapeHtml(f.name)}</strong><small>${escapeHtml(f.tag)} · ${escapeHtml(f.desc)}</small></div>
            <span class="chip">${escapeHtml(Object.entries(f.hidden || {}).map(([k, v]) => `${k}${v > 0 ? '+' : ''}${v}`).join(' ') || '无加成')}</span>
          </div>`
          )
          .join('')}
      </div>
    </div>
    <div class="admin-card">
      <h3>天赋 <span class="chip">${library.talents.length} 个</span></h3>
      <p style="color:var(--muted);font-size:0.78rem">一人随机 2–3 个。百艺天赋决定能走多远。</p>
      <div class="option-list">
        ${library.talents
          .map(
            (t) => `
          <div class="option-row">
            <div><strong>${escapeHtml(t.name)}</strong><small>${escapeHtml(t.cat)}${t.craft ? ' · ' + t.craft : ''} · ${escapeHtml(t.desc)}</small></div>
            ${t.tier ? `<span class="chip">${t.tier} 级</span>` : ''}
          </div>`
          )
          .join('')}
      </div>
    </div>`;
}

/* ─── 主流程 ─── */
async function show(tab) {
  document.querySelectorAll('.admin-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  if (tab === 'realm') renderRealmTab();
  else if (tab === 'event') renderEventTab();
  else renderFateTab();
}

(async () => {
  const user = await Session.load();
  if (!user || user.role !== 'sysadmin') {
    location.replace('/login.html?next=/admin.html');
    return;
  }
  adminUser.textContent = `${user.username} · 管理员`;

  const data = await AdminController.loadConfig();
  config = data.config;
  events = data.events;

  try {
    library = await api('/api/admin/library');
  } catch {
    library = { fates: [], talents: [] };
  }

  document.getElementById('tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) show(tab.dataset.tab);
  });

  logoutButton.addEventListener('click', async () => {
    await Session.logout();
    location.replace('/');
  });

  show('realm');
})();
