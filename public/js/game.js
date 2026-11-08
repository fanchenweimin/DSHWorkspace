/* ── 游戏页（r30 重排）───────────────────────────────────────
   中间从上到下：今年的事 → 修为 → 法术 → 百艺 → 营生 → 坊市。
   左边：人物 / 四道 / 法术 / 百艺 / 囊中·钱。右边：纪事 / 局势。

   两条界面规矩（这一轮定死）：
     · 事件块：**上面是描述，下面是选项**，整个选项块都能点。
     · **禁用 / 未开启的东西直接不画**——画出来的一定能点。
   ────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const DAO = [
    ['body', '锻体', '内力'],
    ['qi', '炼气', '法力'],
    ['spirit', '养灵', '灵力'],
    ['heart', '修心', '道心']
  ];
  const TIERS = {
    body: ['体魄', '脏腑', '调息', '朝元', '金身', '临虚'],
    qi: ['感气', '破胎', '驭凡', '法相', '合一', '化朽'],
    spirit: ['开视', '启灵', '真域', '神游', '浑然', '回春'],
    heart: ['不惑', '天命', '耳顺', '从心而欲']
  };
  const NATURE = {
    瓶颈: '关卡', 主线: '主线', 机缘: '机缘',
    灾祸: '灾祸', 身份: '身份', 战事: '战事'
  };
  const WAR = { peace: '平时', warning: '预警', city: '城战', nation: '国战' };
  const ZONE = { city: '长明城', wild: '荒郊', battle: '阵前' };
  const DIGIT = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

  const cnYear = (n) => String(n).split('').map((d) => DIGIT[Number(d)] || d).join('');
  const monthsText = (n) => (n === 0 ? '顷刻' : `${n || 1} 月`);
  const pct = (a, b) => (!b ? 0 : Math.max(0, Math.min(100, (a / b) * 100)));

  let S = null;
  let DATA = null;
  let busy = false;
  let armed = null;
  let playQueue = [];

  /* ── 左栏：人物 ───────────────────────────────────────── */
  function renderChar() {
    $('age').textContent = S.clock.age;
    $('stage').textContent = S.stage;
    $('identity').textContent = S.identity.name;
    $('era').textContent = `大曜历${cnYear(S.clock.year)}年`;
    $('charName').textContent = S.name;
    $('charSub').textContent = `${S.stage} · ${S.identity.name} · ${S.clock.age} 岁`;

    $('paths').innerHTML = DAO.map(([dao, name, barName]) => {
      const p = S.path[dao];
      const lv = p.level || 0;
      const max = p.barMax || 0;
      const full = max > 0 && p.bar >= max - 0.001;
      const label = lv === 0 ? `→ ${p.nextTitle || '—'}` : (TIERS[dao][lv - 1] || '—');

      let meta;
      if (p.top) meta = '这一道已经到顶';
      else if (lv === 0) meta = '还没进这一品';
      else if (full) meta = p.nextTitle ? `修为已满 · 只差「${p.nextTitle}」` : '修为已满';
      else meta = `${Math.round(p.bar)} / ${max || '—'}`;

      const bar = max > 0
        ? `<div class="pbar ${dao === 'heart' ? 'is-heart' : ''} ${full ? 'is-full' : ''}"><i style="width:${pct(p.bar, max)}%"></i></div>`
        : '<div class="pbar is-empty"><i></i></div>';

      return `<div class="path">
        <div class="path-top">
          <span class="path-name">${name}<em>${barName}</em></span>
          <span class="path-lv ${lv === 0 ? 'is-zero' : ''}">${esc(label)}</span>
        </div>
        ${bar}
        <div class="path-meta">${esc(meta)}</div>
      </div>`;
    }).join('');

    $('attrs').innerHTML = [
      ['资质', S.attr.aptitude], ['悟性', S.attr.insight],
      ['心性', S.attr.heart], ['气运', S.luck]
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  }

  /* ── 左栏：法术 / 百艺的进度 ──────────────────────────────
     一行一条：名字 · 阶 · 细条 · 数字。学到十几门也只是十几行，
     不再"名字一行、条一行、注释一行"地往下拖。 */
  function trackRow(title, lv, ratio, num, tip) {
    return `<div class="track" title="${esc(tip || '')}">
      <span class="track-name">${esc(title)}</span>
      <span class="track-lv">${esc(lv)}</span>
      <span class="track-bar"><i style="width:${ratio}%"></i></span>
      <span class="track-num">${esc(num)}</span>
    </div>`;
  }

  function renderSpellTracks() {
    const host = $('spellTracks');
    const known = (DATA.spells || []).filter((s) => s.known);
    $('spellCount').textContent = known.length ? `${known.length} 门` : '无';
    if (!known.length) { host.innerHTML = '<p class="track-empty">还没学过术法。</p>'; return; }
    host.innerHTML = known.map((s) => trackRow(
      s.name,
      `${s.jie} 阶 · ${s.tier} · ${s.lvlName}`,
      s.need ? pct(s.exp, s.need) : 100,
      s.need ? `${Math.round(s.exp)}/${s.need}` : '圆满',
      `${s.tier} · ${s.desc || ''}${s.usable ? '' : '（入门还放不出来）'}`
    )).join('');
  }

  function renderArtTracks() {
    const host = $('artTracks');
    const learned = (DATA.arts || []).filter((a) => a.learned);
    $('artCount').textContent = learned.length ? `${learned.length} 门` : '无';
    if (!learned.length) { host.innerHTML = '<p class="track-empty">还没有学过手艺。</p>'; return; }
    host.innerHTML = learned.map((a) => trackRow(
      a.name,
      a.lvlName,
      a.need ? pct(a.exp, a.need) : 100,
      a.need ? `${Math.round(a.exp)}/${a.need}` : '到顶',
      `${a.talent}天赋 · 月入 ${a.income} 文`
    )).join('');
  }

  /* ── 左栏：囊中 + 钱 ─────────────────────────────────── */
  function renderBag() {
    const host = $('bag');
    const bag = DATA.bag || [];
    if (!bag.length) { host.innerHTML = '<p class="bag-empty">空的。</p>'; }
    else {
      host.innerHTML = bag.map((it) => `
        <button class="bag-item ${it.use ? 'is-use' : ''}" data-kind="use" data-id="${esc(it.id)}"
          data-card="bag:${esc(it.id)}" title="${esc(it.effect || it.kind)}"
          ${it.use ? '' : 'disabled'}>
          <span class="bi-name">${esc(it.name)}</span>
          <span class="bi-n">×${it.n}</span>
          ${it.effect ? `<span class="bi-fx">${esc(it.effect)}</span>` : ''}
        </button>`).join('');
    }

    $('bagCount').textContent = bag.length ? `${bag.length} 件` : '空';

    const m = S.money;
    $('purse').innerHTML =
      `<div><span>铜</span><b>${m.copper}</b></div>
       <div><span>银</span><b>${m.silver}</b></div>
       <div><span>金</span><b>${m.gold}</b></div>`;
  }

  /* ── 中栏：时间 ───────────────────────────────────────── */
  function renderTime() {
    const used = S.monthsUsed;
    $('left').textContent = S.monthsLeft;
    $('ticks').innerHTML = Array.from({ length: 12 }, (_, i) => {
      const f = Math.max(0, Math.min(1, used - i));
      return `<div class="tick"><i class="${f > 0 && f < 1 ? 'hot' : ''}" style="width:${f * 100}%"></i></div>`;
    }).join('');
  }

  function renderHint() {
    const el = $('hint');
    if (S.dead) {
      el.className = 'hint is-lock';
      el.textContent = `你活到了 ${S.clock.age} 岁。`;
      return;
    }
    if (DATA.locked) {
      el.className = 'hint is-lock';
      el.textContent = '手头有非处理不可的事。做完之前，别的路都不通。';
      return;
    }
    if (S.monthsLeft <= 0) {
      el.className = 'hint';
      el.textContent = '这一年过完了。';
      return;
    }
    el.className = 'hint is-quiet';
    el.textContent = `还余 ${S.monthsLeft} 个月。`;
  }

  /* ── 一、今年的事 ─────────────────────────────────────── */
  function renderMain() {
    const host = $('mainCards');
    const e = DATA.main;

    if (S.dead) {
      $('mainMeta').textContent = '';
      host.innerHTML = '<p class="empty">此生已尽。换个活法，点右上角「重开」。</p>';
      return;
    }
    if (!e) {
      $('mainMeta').textContent = '今年没有大事';
      host.innerHTML = '<p class="empty">今年的大事已经过去了。往下挑一件事做，或者把年过完。</p>';
      return;
    }

    $('mainMeta').textContent = `${NATURE[e.nature] || '事'} · ${monthsText(e.months != null ? e.months : 1)}`;

    const choices = (e.choices && e.choices.length)
      ? e.choices
      : [{ id: '_', label: '知道了', months: e.months }];

    /*
     * 时间不够的选项**置灰不隐藏**（r34）：
     * 用户原话"明明只有 1 个月了，也能点"——现在点了也没用，不如灰着写清楚。
     * 跨年的事（城战/国战 `span`）例外：它本来就要用到明年。
     */
    let usable = 0;
    const opts = choices.map((c) => {
      const m = c.months != null ? c.months : (e.months != null ? e.months : 1);
      const span = !!e.span;
      const over = m > S.monthsLeft && !span;
      if (!over) usable += 1;
      const price = c.cost ? ` · ${c.cost} 文` : '';
      const spanNote = m > S.monthsLeft && span ? ' · 跨年' : '';
      const meta = over
        ? `${monthsText(m)} · 只剩 ${S.monthsLeft} 月`
        : `${monthsText(m)}${spanNote}`;
      return `<button class="ev-opt ${over ? 'is-lock' : ''} ${spanNote ? 'is-span' : ''}" data-kind="event" data-id="${esc(e.id)}"
        data-choice="${esc(c.id)}" data-card="ev:${esc(e.id)}" ${busy || over ? 'disabled' : ''}>
        <span class="eo-label">${esc(c.label)}</span>
        <span class="eo-meta">${esc(meta)}${esc(price)}</span>
      </button>`;
    }).join('');

    /* 一个选项都放不下（强制事件 + 月份不够）：必须留一条活路 */
    const stuck = usable === 0 && S.monthsLeft > 0;
    const waitBtn = stuck
      ? `<button class="ev-opt is-wait" data-kind="wait" data-card="__wait" ${busy ? 'disabled' : ''}>
           <span class="eo-label">今年等不到了</span>
           <span class="eo-meta">把剩下的 ${S.monthsLeft} 月过掉</span>
         </button>`
      : '';

    host.innerHTML = `<article class="ev ${e.forced ? 'is-forced' : ''}" data-card="ev:${esc(e.id)}">
      <div class="ev-head">
        <span class="ev-name">${esc(e.title)}</span>
        <span class="ev-badge ${e.forced ? 'is-forced' : ''}">${esc(e.forced ? '非处理不可' : (NATURE[e.nature] || '事'))}</span>
      </div>
      ${e.desc || e.hint ? `<p class="ev-desc">${esc(e.desc || e.hint)}</p>` : ''}
      <div class="ev-opts">${opts || ''}${waitBtn}</div>
    </article>`;
  }

  /* ── 二、修为（修炼 / 突破 合成一处） ─────────────────── */
  function renderCult() {
    const host = $('cultRow');
    const rows = [];

    for (const [dao, name] of DAO) {
      const br = (DATA.breaks || []).find((b) => b.dao === dao);
      const tr = (DATA.train || []).find((t) => t.dao === dao);
      const key = `dao:${dao}`;

      /* 概率瓶颈 + 修为满 → 突破（+ 求学） */
      if (br && br.gateOk && br.ready) {
        rows.push(`<button class="chip chip-do" data-kind="break" data-dao="${esc(dao)}"
          data-tier="${br.tier}" data-mode="try" data-card="${esc(key)}" ${busy || S.monthsLeft <= 0 ? 'disabled' : ''}>
          <span class="chip-name">${esc(name)} · 突破</span>
          <span class="chip-meta">冲「${esc(br.title)}」· ${monthsText(br.months)}</span>
          <span class="chip-bar is-full"><i style="width:100%"></i></span>
        </button>`);

        if (br.study) {
          const cost = br.study.cost ? `${br.study.cost} 文` : '不花钱';
          rows.push(`<button class="chip chip-sub" data-kind="break" data-dao="${esc(dao)}"
            data-tier="${br.tier}" data-mode="study" data-card="${esc(key)}" ${busy ? 'disabled' : ''}>
            <span class="chip-name">${esc(br.study.label)}</span>
            <span class="chip-meta">${monthsText(br.study.months)} · ${esc(cost)}</span>
          </button>`);
        }
        continue;
      }

      /* 修为没满 → 修炼 */
      if (tr) {
        rows.push(`<button class="chip" data-kind="train" data-dao="${esc(dao)}" data-id="${esc(tr.id)}"
          data-card="${esc(key)}" ${busy || S.monthsLeft <= 0 ? 'disabled' : ''}>
          <span class="chip-name">${esc(tr.name)}</span>
          <span class="chip-meta">${esc(tr.sub)} · ${monthsText(tr.months)}</span>
          <span class="chip-bar"><i style="width:${pct(tr.bar, tr.barMax)}%"></i></span>
        </button>`);
      }
      /* 门槛没过的概率瓶颈：不画（左栏已经说明为什么卡着） */
    }

    const show = !S.dead && !DATA.locked && rows.length > 0;
    $('bandCult').hidden = !show;
    host.innerHTML = show ? rows.join('') : '';
  }

  /* ── 三、法术 ─────────────────────────────────────────── */
  function renderSpells() {
    const host = $('spellRow');
    const list = [];

    for (const s of DATA.spells || []) {
      /* 阶必须写在品阶前面（r34）：一个"黄下"看不出是 1 阶还是 2 阶 */
      const gname = `${s.jie} 阶 · ${s.tier}`;
      const months = s.months || 3;
      const over = months > S.monthsLeft;
      const base = busy || S.monthsLeft <= 0;

      if (s.known) {
        if (!s.need) continue;                   /* 到圆满就不画（没得练了） */
        const note = s.usable
          ? (s.effLabel ? ` · 现为 ${s.effLabel}` : '')
          : ' · 入门放不出来';
        /* 练法术可以练到一半（剩几个月就练几个月），只有"一点月都没有"才灰 */
        const part = over ? ` · 今年只剩 ${S.monthsLeft} 月，先练这些` : '';
        list.push(`<button class="chip" data-kind="spell" data-id="${esc(s.id)}"
          data-card="sp:${esc(s.id)}" ${base ? 'disabled' : ''}
          title="${esc(s.desc || '')}">
          <span class="chip-name">${esc(s.name)}<em>${esc(gname)} · ${esc(s.lvlName)}</em></span>
          <span class="chip-meta">练满一档 ${monthsText(months)}${esc(note)}${esc(part)}</span>
          <span class="chip-bar"><i style="width:${pct(s.exp, s.need)}%"></i></span>
        </button>`);
        continue;
      }

      /* 没学的：把"去哪学、要什么"写清楚；条件不够就灰着说明原因 */
      const locked = !!s.locked;
      const poor = locked || !s.sourceOk;
      const why = locked ? s.lockHint : (s.sourceOk ? '' : s.sourceWhy);
      const foot = locked ? s.lockHint : `${s.sourceLabel} · ${monthsText(months)}${why ? ' · ' + why : ''}`;
      list.push(`<button class="chip chip-buy ${poor ? 'is-lock' : ''}" data-kind="learnSpell" data-id="${esc(s.id)}"
        data-card="sp:${esc(s.id)}" ${base || poor || over ? 'disabled' : ''}
        title="${esc(s.desc || '')}">
        <span class="chip-name">学 ${esc(s.name)}<em>${esc(gname)}</em></span>
        <span class="chip-meta">${esc(foot)}</span>
      </button>`);
    }

    const show = !S.dead && !DATA.locked && list.length > 0;
    $('bandSpell').hidden = !show;
    host.innerHTML = show ? list.join('') : '';
  }

  /* ── 四、百艺 ─────────────────────────────────────────── */
  /* ── 四、百艺 ─────────────────────────────────────────── */
  function renderArts() {
    const host = $('artRow');
    const openAge = DATA.artAge || 14;
    const tooYoung = S.clock.age < openAge;
    const list = [];

    for (const a of DATA.arts || []) {
      const months = a.months || 3;
      const over = months > S.monthsLeft;
      const base = busy || S.monthsLeft <= 0;

      if (a.learned) {
        if (a.blocked) continue;                 /* 到天赋上限就不画（没得点了） */
        const part = over ? ` · 今年只剩 ${S.monthsLeft} 月` : '';
        list.push(`<button class="chip chip-art" data-kind="art" data-id="${esc(a.id)}"
          data-card="art:${esc(a.id)}" ${base ? 'disabled' : ''}
          title="${esc(a.sub || '')}">
          <span class="chip-name">${esc(a.name)}<em>${esc(a.lvlName)}</em></span>
          <span class="chip-meta">月入 ${a.income} 文 · 升一档 ${monthsText(months)}${a.product ? ` · 出${esc(a.product)}` : ''}${esc(part)}</span>
          <span class="chip-bar"><i style="width:${pct(a.exp, a.need)}%"></i></span>
        </button>`);
        continue;
      }

      /*
       * 没学过的：**门槛没到也画出来**，灰着并在下面写明"要先到哪一品"（r34）。
       * 用户原话："百艺的门槛条件是啥，咋一个两个都点不上去"——
       * 看不到门、也不知道为什么，才是最糟的。
       */
      const locked = !!a.locked;
      const cost = a.learnCost || 0;
      const poor = cost > (S.money.copper + S.money.silver * 100 + S.money.gold * 10000);
      const foot = locked ? a.lockHint : `${cost ? cost + ' 文' : '第一门不要钱'} · ${monthsText(months)}`;
      list.push(`<button class="chip chip-buy chip-art ${locked || poor ? 'is-lock' : ''}" data-kind="learnArt" data-id="${esc(a.id)}"
        data-card="art:${esc(a.id)}" ${base || locked || over ? 'disabled' : ''}
        title="${esc(a.lockHint || a.sub || '')}">
        <span class="chip-name">求学 · ${esc(a.name)}</span>
        <span class="chip-meta">${esc(foot)}</span>
      </button>`);
    }

    const show = !S.dead && !DATA.locked && (list.length > 0 || tooYoung);
    $('bandArt').hidden = !show;
    $('bandArt').querySelector('.band-h em').textContent =
      tooYoung ? `${openAge} 岁以后才谈得上手艺` : '学过的才练得动 · 灰的是门槛没到';
    if (!show) { host.innerHTML = ''; return; }

    host.innerHTML = list.join('')
      + (tooYoung ? `<p class="empty">${esc(S.clock.age)} 岁还太早。等 ${openAge} 岁，手上有了功夫，才谈得上学一门艺。</p>` : '');
  }

  /* ── 五、营生 ─────────────────────────────────────────── */
  /* ── 五、营生 ─────────────────────────────────────────── */
  function renderActs() {
    const host = $('actRow');
    const list = [];

    for (const a of DATA.actions || []) {
      if (a.rest) {
        if (S.monthsLeft <= 0) continue;
        list.push(`<button class="chip chip-wait" data-kind="action" data-id="${esc(a.id)}"
          data-card="act:${esc(a.id)}" ${busy ? 'disabled' : ''}>
          <span class="chip-name">${esc(a.name)}</span>
          <span class="chip-meta">剩 ${S.monthsLeft} 月，一把过完</span>
        </button>`);
        continue;
      }
      if (a.months > S.monthsLeft) continue;     /* 放不下：不画 */
      const meta = a.market
        ? (DATA.market && DATA.market.length ? '货架开着，去挑东西' : a.sub)
        : (a.sub || monthsText(a.months));
      list.push(`<button class="chip" data-kind="action" data-id="${esc(a.id)}"
        data-card="act:${esc(a.id)}" ${busy ? 'disabled' : ''}>
        <span class="chip-name">${esc(a.name)}</span>
        <span class="chip-meta">${esc(meta)} · ${monthsText(a.months)}</span>
      </button>`);
    }

    const show = !S.dead && !DATA.locked && list.length > 0;
    $('bandAct').hidden = !show;
    host.innerHTML = show ? list.join('') : '';
  }

  /* ── 六、坊市（买 + 卖） ──────────────────────────────── */
  function renderMarket() {
    const buyHost = $('marketRow');
    const sellHost = $('sellRow');
    const open = !S.dead && !DATA.locked && DATA.market && DATA.market.length > 0;
    $('bandMarket').hidden = !open;
    if (!open) { buyHost.innerHTML = ''; sellHost.innerHTML = ''; $('sellHead').hidden = true; return; }

    const buy = (DATA.market || []).filter((it) => it.afford);
    buyHost.innerHTML = buy.map((it) => `
      <button class="chip chip-shop" data-kind="buy" data-id="${esc(it.id)}"
        data-card="shop:${esc(it.id)}" title="${esc(it.effect || it.kind)}" ${busy ? 'disabled' : ''}>
        <span class="chip-name">${esc(it.name)}</span>
        <span class="chip-meta">${esc(it.price)}</span>
        ${it.effect ? `<span class="chip-fx">${esc(it.effect)}</span>` : ''}
      </button>`).join('') || '<p class="empty">摊子上没有你买得起的东西。</p>';

    const sellable = (DATA.bag || []).filter((it) => it.sellPrice > 0);
    $('sellHead').hidden = sellable.length === 0;
    sellHost.innerHTML = sellable.map((it) => `
      <button class="chip chip-shop chip-sell" data-kind="sell" data-id="${esc(it.id)}"
        data-card="sell:${esc(it.id)}" ${busy ? 'disabled' : ''}>
        <span class="chip-name">卖 ${esc(it.name)}</span>
        <span class="chip-meta">+${it.sellPrice} 文 · 还有 ${it.n}</span>
      </button>`).join('');
  }

  /* ── 右栏 ─────────────────────────────────────────────── */
  function renderLog() {
    const html = (S.log || []).map((line) => {
      if (/^—/.test(line)) return `<div class="log-year">${esc(line.replace(/—/g, '').trim())}</div>`;
      return `<div class="log-item">${esc(line)}</div>`;
    }).join('');
    const el = $('log');
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  }

  function renderSituation() {
    $('situation').innerHTML =
      `<div><span>所在</span><b>${esc(ZONE[S.zone] || '路上')}</b></div>
       <div><span>局势</span><b>${WAR[S.war] || S.war}</b></div>
       <div><span>声望</span><b>${S.reputation}</b></div>
       <div><span>军功</span><b>${S.merit.war}</b></div>
       <div><span>寿元</span><b>${S.lifespan}</b></div>
       ${S.injury ? '<div><span>身体</span><b class="is-bad">带伤 · 修得慢</b></div>' : ''}`;
  }

  function render() {
    renderChar();
    renderSpellTracks();
    renderArtTracks();
    renderBag();
    renderTime();
    renderHint();
    renderMain();
    renderCult();
    renderSpells();
    renderArts();
    renderActs();
    renderMarket();
    renderLog();
    renderSituation();
  }

  /* ── 战斗：独立一屏，尺寸固定，内容滚动，血条跟着跳 ────── */
  let battleTimer = null;
  let battleState = null;      /* { b, frames, i } */

  function barRow(label, cur, max, cls) {
    const live = max > 0 ? pct(cur, max) : 0;
    return `<div class="fb-row">
      <span class="fb-k">${label}</span>
      <span class="fb-bar ${cls}"><i style="width:${live}%"></i></span>
      <em class="fb-n">${cur}/${max}</em>
    </div>`;
  }

  function renderBoard(me, foe, b) {
    if (!me || !foe) return;
    const dd = (d) => (d && d > 0 ? `闪避 ${Math.round(d * 100)}%` : '');

    $('bfMe').innerHTML = `<div class="fb-name">${esc(S.name)}<em>${esc(dd(b.meDodge))}</em></div>
      ${barRow('血', me.hp, me.hpMax, 'is-hp')}
      ${me.shieldMax ? barRow('法力盾', me.shield, me.shieldMax, 'is-shield') : ''}
      ${me.manaMax ? barRow('法力', me.mana, me.manaMax, 'is-mana') : ''}
      ${barRow('精神', me.mind, me.mindMax, 'is-mind')}
      ${barRow('神志', me.will, me.willMax, 'is-will')}`;

    $('bfFoe').innerHTML = `<div class="fb-name">${esc(b.enemy || '对手')}<em>${esc(dd(b.foeDodge))}</em></div>
      ${barRow('血', foe.hp, foe.hpMax, 'is-hp')}
      ${foe.shieldMax ? barRow('法力盾', foe.shield, foe.shieldMax, 'is-shield') : ''}
      ${foe.manaMax ? barRow('法力', foe.mana, foe.manaMax, 'is-mana') : ''}
      ${barRow('精神', foe.mind, foe.mindMax, 'is-mind')}
      ${barRow('神志', foe.will, foe.willMax, 'is-will')}`;
  }

  function lineEl(f) {
    const cls = ['bb-line'];
    if (f.side === 'me') cls.push('is-me');
    if (f.side === 'foe') cls.push('is-foe');
    if (f.t === 'end') cls.push('is-end');
    if (f.t === 'start') cls.push('is-start');
    if (f.t === 'guard' || f.t === 'pill') cls.push('is-quiet');
    const move = f.move ? `<em class="bl-move">${esc(f.move)}</em>` : '';
    return `<div class="${cls.join(' ')}">${move}<span>${esc(f.text)}</span></div>`;
  }

  function applyFrame(f, b) {
    if (f.me && f.foe) renderBoard(f.me, f.foe, b);
    if (f.round) {
      $('bbRound').textContent = `第 ${f.round} 回合`;
    }
    if (f.t === 'end') {
      const el = $('bbResult');
      el.textContent = b.death
        ? '这一世到此为止。'
        : b.match === 'spar'
          ? (b.ok ? '赢了这一场切磋' : '输了这一场切磋')
          : (b.ok ? '你活下来了' : '你没打赢');
      el.className = b.death ? 'is-dead' : (b.ok ? 'is-win' : 'is-lose');
    }
    const host = $('bbLines');
    host.insertAdjacentHTML('beforeend', lineEl(f));
    host.scrollTop = host.scrollHeight;
  }

  function playBattles(list) {
    if (!list || !list.length) return;
    const b = list[0];
    const frames = (b.frames && b.frames.length)
      ? b.frames
      : [{ t: 'start', text: '（这一场没有留下记录）', me: b.me, foe: b.foe }];

    $('battleMask').hidden = false;
    $('bbTitle').textContent = b.match === 'spar' ? '切磋' : '死斗';
    $('bbSub').textContent = `${b.enemy || '对手'}`;
    $('bbLines').innerHTML = '';
    $('bbResult').textContent = '';
    $('bbResult').className = '';
    $('bbClose').hidden = true;
    $('bbSkip').hidden = false;
    $('bbRound').textContent = '未交手';

    renderBoard(frames[0].me || b.me, frames[0].foe || b.foe, b);

    battleState = { b, frames, i: 0 };
    clearInterval(battleTimer);
    battleTimer = setInterval(stepBattle, 430);
    stepBattle();
  }

  function stepBattle() {
    if (!battleState) return;
    const { b, frames } = battleState;
    if (battleState.i >= frames.length) {
      clearInterval(battleTimer);
      $('bbClose').hidden = false;
      $('bbSkip').hidden = true;
      return;
    }
    const f = frames[battleState.i];
    battleState.i += 1;
    applyFrame(f, b);
  }

  function skipBattle() {
    clearInterval(battleTimer);
    if (!battleState) return;
    const { b, frames } = battleState;
    while (battleState.i < frames.length) {
      applyFrame(frames[battleState.i], b);
      battleState.i += 1;
    }
    $('bbClose').hidden = false;
    $('bbSkip').hidden = true;
  }

  function closeBattle() {
    clearInterval(battleTimer);
    $('battleMask').hidden = true;
    const next = playQueue.shift();
    if (next) setTimeout(() => playBattles([next]), 80);
  }

  /* ── 点一下：只发一次请求 ─────────────────────────────── */
  function why(key, text) {
    const host = document.querySelector(`[data-card="${CSS.escape(key)}"]`);
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'c-why';
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  async function act(payload, cardKey) {
    if (busy) return;
    busy = true;
    document.querySelectorAll('[data-kind], .bag-item').forEach((b) => { b.disabled = true; });

    let data = null;
    try {
      const res = await fetch('/api/act', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      data = await res.json();
      if (data.empty) { location.href = '/'; return; }
      DATA = data;
      S = data.state;
    } catch (err) {
      busy = false;
      render();
      why(cardKey, '没连上服务。');
      return;
    }

    busy = false;
    render();

    if (data.result && !data.result.ok) {
      why(cardKey, data.result.reason || '这一步走不通。');
      return;
    }

    const battles = (data.result && data.result.battles) || [];
    if (battles.length) {
      playQueue = battles.slice(1);
      playBattles([battles[0]]);
    }
  }

  /* ── 重开：两段式 ─────────────────────────────────────── */
  function wireNew() {
    const btn = $('btnNew');
    const label = btn.textContent;
    btn.addEventListener('click', async () => {
      if (armed !== 'new') {
        armed = 'new';
        btn.textContent = '再点一次';
        setTimeout(() => { if (armed === 'new') { armed = null; btn.textContent = label; } }, 3000);
        return;
      }
      armed = null;
      btn.textContent = label;
      const data = await (await fetch('/api/new', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      })).json();
      DATA = data;
      S = data.state;
      render();
    });
  }

  /* ── 事件委托 ─────────────────────────────────────────── */
  function onClick(ev) {
    const el = ev.target.closest('[data-kind]');
    if (!el || el.disabled) return;

    const kind = el.dataset.kind;
    const key = el.dataset.card || '';
    const id = el.dataset.id;

    if (kind === 'event') act({ kind: 'event', id, choice: el.dataset.choice }, key);
    else if (kind === 'break') {
      act({ kind: 'break', dao: el.dataset.dao, tier: Number(el.dataset.tier), mode: el.dataset.mode }, key);
    } else if (kind === 'train') act({ kind: 'train', dao: el.dataset.dao, id }, key);
    else if (kind === 'art') act({ kind: 'art', id }, key);
    else if (kind === 'learnArt') act({ kind: 'learnArt', id }, key);
    else if (kind === 'spell') act({ kind: 'spell', id }, key);
    else if (kind === 'learnSpell') act({ kind: 'learnSpell', id }, key);
    else if (kind === 'use') act({ kind: 'use', id }, key);
    else if (kind === 'buy') act({ kind: 'buy', id }, key);
    else if (kind === 'sell') act({ kind: 'sell', id }, key);
    else if (kind === 'wait') act({ kind: 'wait' }, key);
    else if (kind === 'action') act({ kind: 'action', id }, key);
  }

  function wire() {
    document.querySelector('.stage').addEventListener('click', onClick);
    $('bag').addEventListener('click', onClick);
    $('bbClose').addEventListener('click', closeBattle);
    $('bbSkip').addEventListener('click', skipBattle);
    wireNew();
  }

  async function boot() {
    try {
      const res = await fetch('/api/hand');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      DATA = await res.json();
      if (DATA.empty) { location.href = '/'; return; }
      S = DATA.state;
      render();
      wire();

      const me = await (await fetch('/api/me')).json().catch(() => ({ viewer: 'guest' }));
      $('who').innerHTML = me.viewer === 'guest'
        ? '<a href="/login.html">登录</a>'
        : `${esc(me.name)}${me.viewer === 'sysadmin' ? ' · <a href="/admin.html">配置</a>' : ''}`;
    } catch (err) {
      console.error(err);
      $('mainCards').innerHTML = `<p class="empty">读不到手牌：${esc(err.message)}<br />请先启动服务（node start.js）。</p>`;
    }
  }

  boot();
})();
