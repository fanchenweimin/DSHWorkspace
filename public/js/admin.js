/* ── 配置页：表格 / 表单，不再是整块 JSON ─────────────────────
   中文名、列宽、只读范围全部由 schema.json 驱动：
     · 左栏分组、文件中文名   ← schema.files[*].group / label
     · 列头中文名、列宽       ← schema.fields[*].label / width
     · 哪些格子锁死           ← schema.files[*].readonlyPaths（点分 + * 通配）
     · 每个文件的说明         ← schema.hints[*]
   算子（eq / gte / add…）的中文释义从 ops.json 取，和校验用的是同一份。
   ──────────────────────────────────────────────────────────── */
(function () {
  const $ = (id) => document.getElementById(id);

  let SCHEMA = { fields: {}, files: {}, hints: {}, ops: {} };
  let files = [];        // [{name, overridden}]
  let cur = null;        // { name, baseline, api, view, readonly, readonlyPaths }
  let dirty = 0;
  let armed = null;

  const toast = (msg, bad) => {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('bad', !!bad);
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2200);
  };

  const setTip = (text, cls) => {
    $('tip').textContent = text;
    $('tip').className = 'tip' + (cls ? ' ' + cls : '');
  };

  const fileMeta = (name) => (SCHEMA.files || {})[name] || {};
  const fileLabel = (name) => fileMeta(name).label || name;
  const fileReadonly = (name) => !!fileMeta(name).readonly;
  const filePaths = (name) => fileMeta(name).readonlyPaths || [];

  /* ── 左栏 ── */
  function groups() {
    const out = [];
    for (const [name, meta] of Object.entries(SCHEMA.files || {})) {
      const g = meta.group || '其他';
      let hit = out.find((x) => x.title === g);
      if (!hit) { hit = { title: g, files: [] }; out.push(hit); }
      hit.files.push(name);
    }
    /* 磁盘上有、schema 里漏了的，兜到最后一组，别让人以为文件丢了 */
    const known = new Set(Object.keys(SCHEMA.files || {}));
    const rest = files.map((f) => f.name).filter((n) => !known.has(n));
    if (rest.length) {
      const last = out.find((x) => x.title === '其他');
      if (last) last.files.push(...rest);
      else out.push({ title: '其他', files: rest });
    }
    return out;
  }

  function paintNav() {
    const html = groups().map((g) => {
      const items = g.files
        .map((n) => files.find((f) => f.name === n) || { name: n })
        .map((f) => {
          const ro = fileReadonly(f.name);
          const cls = [
            'nav-item',
            cur && cur.name === f.name ? 'is-on' : '',
            f.overridden ? 'is-over' : '',
            ro ? 'is-ro' : ''
          ].filter(Boolean).join(' ');
          return `<button class="${cls}" data-name="${f.name}">
            <span>${fileLabel(f.name)}</span><span class="fn">${f.name}${ro ? ' · 只读' : ''}</span>
          </button>`;
        }).join('');
      return items ? `<div class="nav-group">${g.title}</div>${items}` : '';
    }).join('');
    $('nav').innerHTML = html;
  }

  /* ── 字典 ── */
  async function loadSchema() {
    const res = await fetch('/api/schema');
    if (!res.ok) return false;
    SCHEMA = await res.json();
    SCHEMA.fields = SCHEMA.fields || {};
    SCHEMA.files = SCHEMA.files || {};
    SCHEMA.hints = SCHEMA.hints || {};

    /* 算子中文释义：和校验器读的是同一份 ops.json */
    try {
      const ops = await (await fetch('/api/config/ops')).json();
      const map = {};
      for (const group of ['conditions', 'effects']) {
        for (const o of (ops.data && ops.data[group]) || []) {
          if (o && o.op) map[o.op] = { desc: o.desc || '', args: o.args || '' };
        }
      }
      SCHEMA.ops = map;
    } catch (err) {
      SCHEMA.ops = {};
    }

    window.DYForm.setSchema(SCHEMA);
    return true;
  }

  async function loadIndex() {
    const res = await fetch('/api/config');
    if (!res.ok) {
      $('nav').innerHTML = '<div class="nav-group">读不到配置（需要 sysadmin）</div>';
      return;
    }
    files = await res.json();
    paintNav();
  }

  /* ── 脏标记 ── */
  function setDirty(n) {
    dirty = n;
    $('btnSave').disabled = !n || (cur && cur.readonly);
    if (n) {
      $('fileMeta').textContent = `改动 ${n} 处，未保存`;
      $('fileMeta').style.color = 'var(--seal)';
    } else {
      $('fileMeta').style.color = '';
    }
  }

  function metaText(name, overridden, readonly) {
    const locked = filePaths(name).length;
    const bits = [];
    if (readonly) bits.push('整份只读');
    else if (locked) bits.push(`${locked} 类格子锁死（程序算的 / 程序调用的）`);
    bits.push(overridden ? '已有一层覆盖（保存的是这一层）' : '磁盘原值，还没有覆盖层');
    return bits.join(' · ');
  }

  /* ── 渲染 ── */
  function renderForm(data) {
    const host = $('formHost');
    host.hidden = false;
    $('raw').hidden = true;
    host.innerHTML = '';
    cur.api = window.DYForm.render(host, data, {
      readonly: cur.readonly,
      readonlyPaths: cur.readonlyPaths
    });
    window.DYForm.bind(host, cur.api, (n) => setDirty(n));
    setDirty(window.DYForm.diffCount(cur.baseline, cur.api.value()));
  }

  function switchView(view) {
    if (!cur || view === cur.view) return;
    const host = $('formHost');
    const raw = $('raw');

    if (view === 'raw') {
      raw.value = JSON.stringify(cur.api.value(), null, 2);
      raw.hidden = false;
      host.hidden = true;
      if (cur.readonly || cur.readonlyPaths.length) {
        raw.readOnly = true;
        setTip('源码视图：只读。有锁死的格子时，整份源码也不让改——免得绕开限制把地图改歪。');
      }
    } else {
      let data;
      try {
        data = JSON.parse(raw.value);
      } catch (err) {
        setTip('源码里有 JSON 错误，先改好再回表单：' + err.message, 'bad');
        return;
      }
      renderForm(data);
    }
    cur.view = view;
    for (const b of $('seg').querySelectorAll('button')) b.classList.toggle('is-on', b.dataset.view === view);
  }

  async function open(name) {
    if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
    const res = await fetch(`/api/config/${name}`);
    if (!res.ok) { toast('读不到这份配置', true); return; }
    const payload = await res.json();

    cur = {
      name,
      baseline: payload.data,
      api: null,
      view: 'form',
      readonly: fileReadonly(name),
      readonlyPaths: filePaths(name)
    };
    dirty = 0;
    armed = null;

    $('fileName').textContent = fileLabel(name);
    $('fileName').dataset.file = name;
    setDirty(0);
    $('fileMeta').textContent = `${name}.json · ${metaText(name, payload.overridden, cur.readonly)}`;
    $('btnSave').disabled = cur.readonly;
    $('btnRevert').disabled = cur.readonly;
    $('btnReset').disabled = !payload.overridden || cur.readonly;

    $('seg').querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b.dataset.view === 'form'));
    $('raw').readOnly = false;
    renderForm(payload.data);

    const hint = (SCHEMA.hints || {})[name] || '';
    if (cur.readonly) {
      setTip(`只读视图：${hint || '这份文件由程序维护，改动要发版。'}`);
    } else if (hint) {
      setTip(hint);
    } else {
      setTip('直接改格子即可。改完点保存，写进数据库覆盖层，刷新即生效；「还原」丢覆盖层，回到磁盘原值。');
    }
    paintNav();
  }

  /* ── 事件 ── */
  $('nav').addEventListener('click', (e) => {
    const b = e.target.closest('.nav-item');
    if (b) open(b.dataset.name);
  });

  $('seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) switchView(b.dataset.view);
  });

  $('btnSave').addEventListener('click', async () => {
    if (!cur || cur.readonly) return;
    let value;
    if (cur.view === 'raw') {
      try { value = JSON.parse($('raw').value); }
      catch (err) { setTip('JSON 语法错误：' + err.message, 'bad'); return; }
    } else {
      value = cur.api.value();
    }
    const res = await fetch(`/api/config/${cur.name}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value)
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setTip('保存失败：' + (d.error || res.status), 'bad');
      return;
    }
    await loadIndex();
    await open(cur.name);
    setTip('已保存。刷新页面即生效。', 'ok');
    toast('已保存');
  });

  /* 放弃 / 还原 都是两段式，不弹 confirm */
  function arm(btn, then) {
    if (armed !== btn.id) {
      armed = btn.id;
      const old = btn.textContent;
      btn.textContent = '再点一次';
      setTimeout(() => {
        if (armed === btn.id) { armed = null; btn.textContent = old; }
      }, 3000);
      return;
    }
    armed = null;
    btn.textContent = btn.id === 'btnRevert' ? '放弃' : '还原';
    then();
  }

  $('btnRevert').addEventListener('click', (e) => {
    arm(e.currentTarget, () => {
      if (!cur) return;
      renderForm(cur.baseline);
      setDirty(0);
      $('fileMeta').textContent = `${cur.name}.json · ${metaText(cur.name, false, cur.readonly)}`;
      setTip('已放弃未保存的改动。');
    });
  });

  $('btnReset').addEventListener('click', (e) => {
    arm(e.currentTarget, async () => {
      if (!cur) return;
      const res = await fetch(`/api/config/${cur.name}`, { method: 'DELETE' });
      if (!res.ok) { toast('还原失败', true); return; }
      await open(cur.name);
      await loadIndex();
      toast('已还原为磁盘原值');
    });
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (!dirty) return;
      $('btnSave').click();
    }
  });

  $('logout').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    location.href = '/';
  });

  (async () => {
    const ok = await loadSchema();
    if (!ok) {
      $('nav').innerHTML = '<div class="nav-group">读不到配置字典（需要 sysadmin）</div>';
      return;
    }
    await loadIndex();
    const want = location.hash.slice(1);
    const hit = files.find((f) => f.name === want)
      || files.find((f) => f.name === 'world')
      || files[0];
    if (hit) open(hit.name);
  })();
})();
