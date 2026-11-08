/* ── 数据层入口（前端侧）─────────────────────────────────────
   阶段一：直接读 /seed/*.json（静启用）
   阶段二：后端起来后自动改走 /api/*，前端代码不用改
   ────────────────────────────────────────────────────────── */
(function () {
  const cache = new Map();

  async function getJSON(url) {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return res.json();
  }

  /** 先问后端，后端没有就退回静态种子。两阶段同一份调用。 */
  async function load(name) {
    if (cache.has(name)) return cache.get(name);
    let value;
    try {
      value = await getJSON(`/api/${name}`);
    } catch {
      value = await getJSON(`/seed/${name}.json`);
    }
    cache.set(name, value);
    return value;
  }

  async function me() {
    try {
      const res = await fetch('/api/me', { headers: { accept: 'application/json' } });
      if (!res.ok) return { viewer: 'guest' };
      return await res.json();
    } catch {
      return { viewer: 'guest' };
    }
  }

  window.DY = window.DY || {};
  window.DY.data = { load, getJSON, me, cache };
})();
