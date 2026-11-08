'use strict';

/*
 * API 集成测试：需要服务已启动（默认 http://127.0.0.1:8787）。
 * 运行：node test/api.js
 */

const assert = require('node:assert');

const BASE = process.env.BASE || 'http://127.0.0.1:8787';

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  ✗ ${name}`);
    console.log(`      ${error.message}`);
  }
}

function group(t) {
  console.log(`\n${t}`);
}

async function call(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body, headers: res.headers };
}

const post = (path, payload, headers) =>
  call(path, { method: 'POST', body: JSON.stringify(payload || {}), headers });
const put = (path, payload, headers) =>
  call(path, { method: 'PUT', body: JSON.stringify(payload || {}), headers });
const del = (path, headers) => call(path, { method: 'DELETE', headers });

(async () => {
  group('服务与静态资源');

  await test('健康检查', async () => {
    const r = await call('/api/health');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, true);
  });

  await test('首页可访问', async () => {
    const res = await fetch(BASE + '/');
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('大曜问仙录'));
  });

  await test('游戏页与前端模块可访问', async () => {
    for (const path of ['/game.html', '/login.html', '/admin.html', '/js/main.js', '/styles/app.css']) {
      const res = await fetch(BASE + path);
      assert.strictEqual(res.status, 200, `${path} 应可访问`);
    }
  });

  group('开局与状态');

  let state = null;

  await test('访客可以开一局', async () => {
    const r = await post('/api/runs', { name: 'API测试' });
    assert.strictEqual(r.status, 201);
    state = r.body.state;
    assert.ok(state.id);
    assert.strictEqual(state.age, 7);
    assert.ok(state.fate, '应有命格');
    assert.ok(state.talents.length >= 2 && state.talents.length <= 3, '应有 2–3 个天赋');
    assert.strictEqual(state.realms.length, 1, '开局只显示锻体');
  });

  await test('访客视图不含隐藏信息', async () => {
    const json = JSON.stringify(state);
    assert.ok(!json.includes('"hidden"'), '不应含 hidden');
    assert.ok(!json.includes('lifespan'), '不应含寿命');
    assert.ok(!json.includes('"changes"'), '不应含数值变化');
    assert.ok(!state.admin, '不应有 admin 块');
    assert.ok(!json.includes('"tags"'), '不应含效果标签');
  });

  await test('时长对访客可见', async () => {
    if (state.event?.choices?.length) {
      for (const c of state.event.choices) {
        assert.strictEqual(typeof c.years, 'number');
      }
    }
  });

  await test('可以推进一回合', async () => {
    let current = state;
    if (current.event?.choices?.length) {
      const choice = current.event.choices.find((c) => c.available) || current.event.choices[0];
      const r = await post(`/api/runs/${current.id}/choose`, { rev: current.rev, choiceId: choice.id });
      assert.strictEqual(r.status, 200);
      current = r.body.state;
    }
    const r2 = await post(`/api/runs/${current.id}/next`, { rev: current.rev });
    assert.strictEqual(r2.status, 200);
    state = r2.body.state;
    assert.ok(state.rev > current.rev, 'rev 应递增');
  });

  await test('rev 过期会拒绝', async () => {
    const r = await post(`/api/runs/${state.id}/next`, { rev: 0 });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.error.code, 'STALE');
  });

  await test('不存在的存档返回 404', async () => {
    const r = await call('/api/runs/00000000-0000-0000-0000-000000000000');
    assert.strictEqual(r.status, 404);
  });

  group('登录与权限');

  let cookie = null;

  await test('访客访问隐藏信息被拒', async () => {
    const r = await call(`/api/runs/${state.id}/hidden`);
    assert.strictEqual(r.status, 403);
  });

  await test('sysadmin 可以登录', async () => {
    const r = await post('/api/auth/login', { username: 'sysadmin', password: 'sysadmin' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.user.role, 'sysadmin');
    cookie = r.headers.get('set-cookie');
    assert.ok(cookie, '应下发 Cookie');
  });

  await test('user 账号可以登录', async () => {
    const r = await post('/api/auth/login', { username: 'user', password: 'useradmin' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.user.role, 'user');
  });

  await test('错误密码被拒', async () => {
    const r = await post('/api/auth/login', { username: 'sysadmin', password: 'wrong' });
    assert.strictEqual(r.status, 401);
  });

  await test('sysadmin 能看隐藏信息', async () => {
    const r = await call(`/api/runs/${state.id}/hidden`, { headers: { cookie } });
    assert.strictEqual(r.status, 200);
    const h = r.body.hidden;
    assert.ok(typeof h.lifespan === 'number');
    assert.ok(typeof h.hidden.aptitude === 'number');
    assert.ok(h.hidden.heart != null);
    assert.ok(h.hidden.nature != null);
    assert.ok(h.soulMass >= 0);
    assert.ok(h.spiritMultiplier >= 1);
  });

  await test('sysadmin 视图含效果标签与数值', async () => {
    const r = await call(`/api/runs/${state.id}`, { headers: { cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.state.admin, '应有 admin 块');
    if (r.body.state.event?.choices?.length) {
      assert.ok(Array.isArray(r.body.state.event.choices[0].tags), '应有 tags');
    }
  });

  await test('user 不能访问隐藏信息', async () => {
    const login = await post('/api/auth/login', { username: 'user', password: 'useradmin' });
    const userCookie = login.headers.get('set-cookie');
    const r = await call(`/api/runs/${state.id}/hidden`, { headers: { cookie: userCookie } });
    assert.strictEqual(r.status, 403);
  });

  group('管理端');

  await test('未登录不能读配置', async () => {
    const r = await call('/api/admin/config');
    assert.strictEqual(r.status, 403);
  });

  await test('sysadmin 可以读配置', async () => {
    const r = await call('/api/admin/config', { headers: { cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.config.realms.length >= 4);
    assert.ok(Array.isArray(r.body.events));
  });

  await test('配置包含 4 个大境界与多层事件', async () => {
    const r = await call('/api/admin/config', { headers: { cookie } });
    const names = r.body.config.realms.map((x) => x.name);
    assert.deepStrictEqual(names, ['锻体', '炼气', '养灵', '修心']);
    const kinds = new Set(r.body.events.map((e) => e.kind));
    for (const k of ['ambient', 'normal', 'encounter', 'threshold', 'forced']) {
      assert.ok(kinds.has(k), `应包含 ${k} 类事件`);
    }
  });

  await test('保存配置后版本递增', async () => {
    const before = await call('/api/admin/config', { headers: { cookie } });
    const cfg = JSON.parse(JSON.stringify(before.body.config));
    cfg.thresholds.directAptitude = 70;
    const r = await put('/api/admin/config', { config: cfg }, { cookie });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.config.version > before.body.config.version);
    assert.strictEqual(r.body.config.thresholds.directAptitude, 70);
  });

  await test('恢复默认配置', async () => {
    const r = await post('/api/admin/config/reset', {}, { cookie });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.config.thresholds.directAptitude, 80);
  });

  await test('事件库可以读取', async () => {
    const r = await call('/api/admin/events', { headers: { cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.events.length >= 40);
  });

  await test('静态资源库可读（命格 28 / 天赋 100）', async () => {
    const r = await call('/api/admin/library', { headers: { cookie } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.fates.length, 28);
    assert.strictEqual(r.body.talents.length, 100);
    assert.ok(r.body.identities.length >= 10);
  });

  await test('内置事件不能删除', async () => {
    const r = await del('/api/admin/events/amb_quiet_year', { cookie });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error.code, 'BUILTIN_LOCKED');
  });

  await test('可以停用/启用事件', async () => {
    const off = await post('/api/admin/events/toggle', { id: 'amb_quiet_year', enabled: false }, { cookie });
    assert.strictEqual(off.status, 200);
    assert.strictEqual(off.body.event.enabled, false);
    const on = await post('/api/admin/events/toggle', { id: 'amb_quiet_year', enabled: true }, { cookie });
    assert.strictEqual(on.body.event.enabled, true);
  });

  group('常驻行动');

  await test('可以修炼一年', async () => {
    const fresh = await post('/api/runs', { name: '修炼测试' });
    let s = fresh.body.state;
    const beforeAge = s.age;
    const opt = s.actions.cultivate.find((o) => o.available && !o.seclusion);
    assert.ok(opt, '应有可用修炼项');
    const r = await post(`/api/runs/${s.id}/act`, { rev: s.rev, kind: 'cultivate', optionId: opt.id, years: 1 });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.state.age > beforeAge, '年龄应增长');
  });

  await test('委托列表非空', async () => {
    const fresh = await post('/api/runs', { name: '委托测试' });
    const s = fresh.body.state;
    assert.ok(Array.isArray(s.actions.commissions));
    assert.ok(s.actions.commissions.length > 0);
  });

  console.log(`\n${'─'.repeat(46)}`);
  if (failures.length === 0) {
    console.log(`✓ API 测试全部通过（${passed} 项）`);
    process.exit(0);
  } else {
    console.log(`✗ ${failures.length} 项失败，${passed} 项通过`);
    for (const f of failures) {
      console.log(`\n[${f.name}]`);
      console.log(f.error.stack.split('\n').slice(0, 4).join('\n'));
    }
    process.exit(1);
  }
})();
