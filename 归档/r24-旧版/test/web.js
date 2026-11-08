'use strict';

/*
 * 无依赖浏览器检查：需要 http://127.0.0.1:8787 与 9222 端口的 Chrome。
 * node test/web.js
 */

const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const CDP = process.env.CDP || 'http://127.0.0.1:9222';
const SHOTS = path.join(__dirname, '..', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const targets = await fetch(`${CDP}/json/list`).then((r) => r.json());
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener('message', (message) => {
    const payload = JSON.parse(message.data);
    if (payload.id) {
      const waiter = pending.get(payload.id);
      if (!waiter) return;
      pending.delete(payload.id);
      if (payload.error) waiter.reject(new Error(payload.error.message));
      else waiter.resolve(payload.result);
    } else {
      events.push(payload);
    }
  });
  const send = (method, params = {}) => {
    id += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  return { send, events, close: () => ws.close() };
}

async function main() {
  const cdp = await connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false
  });

  const ev = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result?.value;
  };

  const navigate = async (url) => {
    await cdp.send('Page.navigate', { url });
    await sleep(900);
  };

  const shot = async (name) => {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(result.data, 'base64'));
    console.log(`  ✓ shots/${name}`);
  };

  const waitFor = async (expression, label, timeout = 10000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await ev(expression)) return;
      await sleep(120);
    }
    throw new Error(`timeout: ${label}`);
  };

  console.log('浏览器检查开始…');

  // 首页
  await cdp.send('Network.clearBrowserCookies');
  await navigate(`${BASE}/`);
  await ev("try { localStorage.removeItem('dayao.run'); } catch (e) {} true");
  await navigate(`${BASE}/?fresh=${Date.now()}`);
  await waitFor("document.querySelector('.home-title') !== null", 'home');
  await shot('home-desktop.png');
  cdp.events.length = 0;

  // 新开一局
  await ev(`
    document.getElementById('nameInput').value = '云归';
    document.getElementById('startForm').requestSubmit();
    true;
  `);
  await waitFor("location.pathname === '/game.html'", 'game page');
  await waitFor("document.querySelector('.story-card') !== null", 'story card');
  await sleep(400);
  await shot('game-event-desktop.png');

  const phase1 = await ev("document.querySelector('.story-title')?.textContent");
  console.log('  第一幕：', phase1);

  // 有选项就选第二个
  const hasChoice = await ev("document.querySelectorAll('[data-choice]').length > 0");
  if (hasChoice) {
    await ev("document.querySelectorAll('[data-choice]')[1]?.click(); true");
    await waitFor("document.querySelector('.result-head') !== null || document.querySelector('.story-card') !== null", 'result');
    await sleep(500);
    await shot('game-result-desktop.png');
    console.log('  结果：', await ev("document.querySelector('.story-title')?.textContent"));
  } else {
    await ev("document.querySelector('[data-action=\"next\"]')?.click(); true");
    await sleep(900);
  }

  // 修炼抽屉
  const hasCultivate = await ev("document.querySelector('[data-drawer=\"cultivate\"]') !== null");
  if (hasCultivate) {
    await ev("document.querySelector('[data-drawer=\"cultivate\"]').click(); true");
    await waitFor("document.getElementById('drawerRoot').hidden === false", 'drawer');
    await sleep(300);
    await shot('drawer-cultivate.png');
    await ev("document.querySelector('[data-close-drawer]').click(); true");
  }

  // 登录管理员
  await navigate(`${BASE}/login.html?next=/`);
  await shot('login-desktop.png');
  await ev(`
    document.getElementById('username').value='sysadmin';
    document.getElementById('password').value='sysadmin';
    document.getElementById('loginForm').requestSubmit();
    true;
  `);
  await sleep(1200);

  // 管理页
  await navigate(`${BASE}/admin.html`);
  await waitFor("document.querySelector('.admin-card') !== null", 'admin');
  await sleep(300);
  await shot('admin-realm.png');

  const tabOk = await ev("document.querySelectorAll('.admin-tab').length");
  console.log('  管理页标签数：', tabOk);
  await ev("document.querySelector('[data-tab=\"event\"]').click(); true");
  await sleep(500);
  await shot('admin-event.png');
  await ev("document.querySelector('[data-tab=\"fate\"]').click(); true");
  await sleep(500);
  await shot('admin-fate.png');

  // 管理员视角的游戏页（应显示标签与观己）
  // 登录后重新开一局，确保这局确实归属管理员视角
  await navigate(`${BASE}/`);
  await waitFor("document.querySelector('.home-title') !== null", 'home for admin run');
  await ev("document.getElementById('nameInput').value='管理员'; document.getElementById('startForm').requestSubmit(); true");
  await waitFor("location.pathname === '/game.html'", 'admin game page');
  await waitFor("document.querySelector('.story-card') !== null", 'admin game card');
  await waitFor("document.querySelector('#account')?.innerText.includes('管理员')", 'admin account');
  await sleep(400);
  await shot('game-admin.png');

  const runId = await ev("localStorage.getItem('dayao.run')");
  const hasHidden = await ev("document.querySelector('[data-drawer=\"hidden\"]') !== null");
  console.log('  管理员有观己按钮：', hasHidden);
  if (hasHidden) {
    await ev("document.querySelector('[data-drawer=\"hidden\"]').click(); true");
    await waitFor("document.getElementById('drawerRoot').hidden === false", 'hidden drawer');
    await sleep(350);
    await shot('game-hidden-drawer.png');
    await ev("document.querySelector('[data-close-drawer]').click(); true");
  }

  // 手机
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  await navigate(`${BASE}/`);
  await waitFor("document.querySelector('.home-title') !== null", 'mobile home');
  await shot('home-mobile.png');
  if (runId) {
    await navigate(`${BASE}/game.html?run=${runId}`);
    await waitFor("document.querySelector('.story-card') !== null", 'mobile game');
    await sleep(300);
    await shot('game-mobile.png');
  }

  const errors = cdp.events.filter(
    (e) =>
      e.method === 'Runtime.exceptionThrown' ||
      (e.method === 'Log.entryAdded' && e.params?.entry?.level === 'error')
  );
  console.log(errors.length ? `  ! ${errors.length} 个浏览器错误` : '  ✓ 无浏览器错误');
  if (errors.length) {
    console.log(JSON.stringify(errors.slice(0, 4), null, 2).slice(0, 1500));
  }

  cdp.close();
  console.log('浏览器检查完成。');
}

main().catch((error) => {
  console.error(error);
  setTimeout(() => process.exit(1), 100);
});
