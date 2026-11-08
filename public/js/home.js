/* ── 首页：载入世界 → 画地图 → 继续 / 新开 ─────────────────
   三个入口，全在这一屏：写名字、继续这一世、开始新游戏。
   不做顶部菜单栏；确认一律两段式，不弹 confirm。
   ────────────────────────────────────────────────────────── */
(function () {
  const bootEl = document.getElementById('boot');
  const errEl = document.getElementById('bootErr');
  const $ = (id) => document.getElementById(id);

  const go = (url) => { location.href = url; };

  let saved = null;       // { name, age, year, stage, dead }
  let armed = false;

  function paintCta() {
    const btnCont = $('btnContinue');
    const meta = $('contMeta');
    if (saved && !saved.dead) {
      btnCont.hidden = false;
      meta.textContent = `${saved.name} · ${saved.age} 岁 · ${saved.stage}`;
      $('ctaHint').textContent = '点「开始新游戏」会另起一世，旧的那一局就没了';
    } else if (saved && saved.dead) {
      btnCont.hidden = true;
      $('ctaHint').textContent = `${saved.name} 的那一世已经走完了 · 重新开一局吧`;
    } else {
      btnCont.hidden = true;
      $('ctaHint').textContent = '无需登录即可开始';
    }
  }

  function wireCta() {
    $('btnContinue').addEventListener('click', () => go('/game.html'));

    const btn = $('btnStart');
    btn.addEventListener('click', async () => {
      if (saved && !saved.dead && !armed) {
        armed = true;
        btn.dataset.old = btn.innerHTML;
        btn.innerHTML = '会盖掉上一世 · 再点一次';
        setTimeout(() => {
          if (armed) { armed = false; if (btn.dataset.old) btn.innerHTML = btn.dataset.old; }
        }, 3000);
        return;
      }
      armed = false;
      const name = ($('heroName').value || '').trim();
      btn.disabled = true;
      try {
        await fetch('/api/new', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name })
        });
        go('/game.html');
      } catch (e) {
        btn.disabled = false;
        $('ctaHint').textContent = '开不了新局：' + e.message;
      }
    });
  }

  async function boot() {
    try {
      const world = await window.DY.data.load('world');

      window.DY.map.render(document.getElementById('homeMap'), world, {
        onPick: () => {
          /* 点别国只提示，不拦着开局：本作只有大曜可玩 */
        }
      });

      const origin = world.countries.find((c) => c.id === world.origin);
      if (origin) document.title = `大曜问仙录 · ${origin.seat}`;

      /* 有没有存着的一局 */
      try {
        const res = await fetch('/api/has');
        const j = await res.json();
        if (j && j.has) {
          saved = j;
          $('heroName').value = j.dead ? '' : j.name;
        }
      } catch (e) { /* 没服务就先当没有 */ }

      paintCta();
      wireCta();

      /* 右上角：登录状态。没登录时只给一个不显眼的入口，不做菜单栏 */
      const me = await window.DY.data.me();
      const corner = document.getElementById('corner');
      if (me.viewer === 'sysadmin') {
        corner.innerHTML = `<span class="who">${me.name || 'sysadmin'}</span>
          <a href="/admin.html">配置</a>
          <a href="#" id="logout">退出</a>`;
        document.getElementById('logout').addEventListener('click', async (e) => {
          e.preventDefault();
          await fetch('/api/logout', { method: 'POST' });
          location.reload();
        });
      } else if (me.viewer === 'user') {
        corner.innerHTML = `<span class="who">${me.name || 'user'}</span><a href="#" id="logout">退出</a>`;
        document.getElementById('logout').addEventListener('click', async (e) => {
          e.preventDefault();
          await fetch('/api/logout', { method: 'POST' });
          location.reload();
        });
      } else {
        corner.innerHTML = `<a href="/login.html">登录</a>`;
      }

      bootEl.classList.add('gone');
      setTimeout(() => bootEl.remove(), 600);
    } catch (e) {
      console.error(e);
      errEl.hidden = false;
      errEl.textContent =
        `世界数据装载失败：${e.message}\n\n` +
        '请确认服务已启动：\n' +
        '    node start.js\n' +
        '或直接：node src/index.js';
    }
  }

  boot();
})();
