/* ── 地图：一块大陆，中间断天山脉，七国环绕，国界只用一条线 ── */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (n, attrs) => {
    const e = document.createElementNS(NS, n);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    return e;
  };

  /** 山纹：三道折线，像手绘 */
  function mountain(x, y, s) {
    return `M ${x - 9 * s} ${y + 7 * s} L ${x} ${y - 7 * s} L ${x + 9 * s} ${y + 7 * s}`
      + ` M ${x - 4 * s} ${y + 7 * s} L ${x} ${y + 1 * s}`
      + ` M ${x + 4 * s} ${y + 7 * s} L ${x} ${y + 1 * s}`;
  }

  const MOUNTAINS = [
    [438, 276, 1], [472, 268, 1.1], [508, 266, 1], [544, 272, .95], [574, 284, .85],
    [418, 306, .9], [592, 310, .85],
    [416, 340, .85], [590, 344, .8],
    [444, 384, .95], [482, 392, 1], [520, 390, .95], [558, 382, .9]
  ];

  function render(stage, world, opts) {
    const svg = document.getElementById('mapSvg');
    svg.innerHTML = '';

    /* ── defs ── */
    const defs = el('defs');

    const grain = el('filter', { id: 'paperGrain', x: '-8%', y: '-8%', width: '116%', height: '116%' });
    grain.appendChild(el('feTurbulence', { type: 'fractalNoise', baseFrequency: '.9', numOctaves: 2, result: 'n' }));
    grain.appendChild(el('feDisplacementMap', { in: 'SourceGraphic', in2: 'n', scale: 2.4, xChannelSelector: 'R', yChannelSelector: 'G' }));
    defs.appendChild(grain);

    const pg = el('linearGradient', { id: 'plateauFill', x1: '0', y1: '0', x2: '0', y2: '1' });
    pg.appendChild(el('stop', { offset: '0%', 'stop-color': '#e9eeea' }));
    pg.appendChild(el('stop', { offset: '100%', 'stop-color': '#d7e0da' }));
    defs.appendChild(pg);

    const clip = el('clipPath', { id: 'clipLand' });
    clip.appendChild(el('path', { d: world.land }));
    defs.appendChild(clip);

    svg.appendChild(defs);

    /* ── 陆地 ── */
    svg.appendChild(el('path', { d: world.land, class: 'land' }));
    svg.appendChild(el('path', { d: world.land, class: 'shore', transform: 'translate(0,3)' }));

    /* ── 大曜高亮：夹在两条国界之间的一块淡金，裁在陆地内 ── */
    const g0 = el('g', { 'clip-path': 'url(#clipLand)' });
    g0.appendChild(el('path', {
      class: 'hl-dayao',
      d: 'M 580 268 Q 720 220 872 192 L 990 250 L 990 480 L 912 450 Q 760 418 600 380 Q 588 322 580 268 Z'
    }));
    svg.appendChild(g0);

    /* ── 断天山脉 ── */
    const pl = el('g', { class: 'plateau-group', 'data-id': world.plateau.id });
    pl.appendChild(el('path', { d: world.plateau.path, class: 'plateau' }));
    const mt = el('path', { class: 'mt', d: MOUNTAINS.map(([x, y, s]) => mountain(x, y, s)).join(' ') });
    pl.appendChild(mt);
    const pn = el('text', { x: world.plateau.label[0], y: world.plateau.label[1], class: 'pl-name' });
    pn.textContent = world.plateau.name;
    pl.appendChild(pn);
    const ps = el('text', { x: world.plateau.subLabel[0], y: world.plateau.subLabel[1], class: 'pl-sub' });
    ps.textContent = world.plateau.sub;
    pl.appendChild(ps);
    svg.appendChild(pl);

    /* ── 国界：一条线一道界 ── */
    const bg = el('g', { class: 'borders' });
    for (const b of world.borders) bg.appendChild(el('path', { d: b.d, class: 'border' }));
    svg.appendChild(bg);

    /* ── 七国 ── */
    const cg = el('g', { class: 'countries' });
    for (const c of world.countries) {
      const g = el('g', { class: 'country', 'data-id': c.id, 'data-kind': 'country' });

      if (c.id === world.origin) {
        /* 本国四城，按 side 决定字放左边还是右边 */
        for (const city of c.cities) {
          const [x, y] = city.at;
          const isCap = city.kind === '都城';
          if (city.start) {
            g.appendChild(el('circle', { cx: x, cy: y, r: 10, class: 'city-halo' }));
          }
          const dot = el('circle', { cx: x, cy: y, r: isCap ? 4.6 : 3.4, class: 'city-dot' + (isCap ? ' is-capital' : '') + (city.start ? ' is-start' : '') });
          g.appendChild(dot);
          const t = el('text', {
            x: x + (city.side >= 0 ? 10 : -10),
            y: y + 4.5,
            class: 'pname' + (isCap ? ' is-capital' : '') + (city.start ? ' is-origin-city' : ''),
            'text-anchor': city.side >= 0 ? 'start' : 'end'
          });
          t.textContent = city.name;
          g.appendChild(t);
        }
      } else {
        const cap = c.cities && c.cities[0];
        if (cap) g.appendChild(el('circle', { cx: cap.at[0], cy: cap.at[1], r: 3.4, class: 'city-dot' }));
      }

      const name = el('text', {
        x: c.label[0],
        y: c.label[1],
        class: 'cname' + (c.id === world.origin ? ' is-origin' : '')
      });
      name.textContent = c.name;
      g.appendChild(name);

      const sub = el('text', { x: c.label[0], y: c.label[1] + 17, class: 'csub' });
      sub.textContent = `${c.compass} · ${c.seat}`;
      g.appendChild(sub);

      cg.appendChild(g);
    }
    svg.appendChild(cg);

    /* ── 海名 ── */
    for (const s of world.seas || []) {
      const t = el('text', { x: s.label[0], y: s.label[1], class: 'sea-name' });
      t.textContent = s.name;
      svg.appendChild(t);
    }

    wireTip(svg, world, opts);
  }

  /* ── 悬停题签：只写风物，不写数值 ── */
  function wireTip(svg, world, opts) {
    const tip = document.getElementById('mapTip');
    const tn = document.getElementById('tipName');
    const ts = document.getElementById('tipSub');
    const tf = document.getElementById('tipFlavor');
    if (!tip) return;

    const byId = new Map(world.countries.map((c) => [c.id, c]));

    svg.addEventListener('pointermove', (e) => {
      const g = e.target.closest('.country, .plateau-group');
      if (!g) { tip.hidden = true; return; }
      const id = g.dataset.id;
      if (id === world.plateau.id) {
        tn.textContent = world.plateau.name;
        ts.textContent = world.plateau.sub;
        tf.textContent = world.plateau.note;
      } else {
        const c = byId.get(id);
        if (!c) { tip.hidden = true; return; }
        tn.textContent = c.name;
        ts.textContent = `${c.compass} · ${c.seat}`;
        tf.textContent = c.flavor;
      }
      tip.hidden = false;
      tip.style.left = e.clientX + 'px';
      tip.style.top = e.clientY + 'px';
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; });

    if (opts && opts.onPick) {
      svg.addEventListener('click', (e) => {
        const g = e.target.closest('.country');
        if (g && byId.has(g.dataset.id)) opts.onPick(byId.get(g.dataset.id));
      });
    }
  }

  window.DY = window.DY || {};
  window.DY.map = { render };
})();
