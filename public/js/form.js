/* ── form.js：把 JSON 变成表格 / 表单 ─────────────────────────
   规则：
   · 对象 → 分组（fieldset）
   · 对象数组 → 表格（标量列用输入框，复杂列用小 JSON 框）
   · 标量数组 → 一行小输入框
   · 字符串较长 → 多行
   · 中文名、列宽、只读路径全部来自 schema.json（DYForm.setSchema 注入）
     —— 代码里不再写死中文表，加一个字段只改 schema.json

   不增删行（结构变动请切「源码」视图），只改值，避免手滑把表改坏。

   r27 两件事：
   1. 只读从"整份文件"细化到"某几条路径"。地图轮廓、国界坐标、主键 no、
      英文名 id 这类是程序算出来 / 程序调用的，人改了只会把东西改坏，
      所以格子直接锁死，但仍然显示出来给人看。
   2. 路径一律用**段数组**，不用点分字符串——配置里的键本身就带点
      （`cond.break_ready`、`macro.break.attempt`），点分会把键拆碎。
   ──────────────────────────────────────────────────────────── */
(function () {
  /* 兜底中文名：schema 里没写时才用（新字段优先补 schema.json） */
  const FALLBACK_LABEL = {
    id: '英文名', no: '主键', name: '中文名', title: '中文名', sub: '一句话',
    desc: '说明', note: '备注', args: '参数', when: '条件', do: '效果',
    choices: '选项', months: '月数', cost: '花费', label: '文字'
  };

  let SCHEMA = { fields: {}, files: {}, hints: {}, ops: {} };
  let BASE_RO = false;        // 整份只读
  let PATS = [];              // 当前文件的只读路径（段数组，* 匹配一层）

  const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isObjArray = (arr) => Array.isArray(arr) && arr.length > 0 && arr.every(isObj);

  const fieldOf = (k) => (SCHEMA.fields || {})[k] || {};
  const labelOf = (k) => fieldOf(k).label || FALLBACK_LABEL[k] || k;
  const widthOf = (k) => fieldOf(k).width || 96;
  const editOf = (k) => fieldOf(k).edit !== false;
  const opNote = (k) => (SCHEMA.ops || {})[k] || null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    ));
  }

  /* 路径 → data-path。用 JSON 数组，键里带点也不会被拆错 */
  const attr = (segs) => esc(JSON.stringify(segs));

  /* ── 只读判定（按段数组比，* 只吃一层） ── */
  function hit(pat, segs) {
    const q = String(pat).split('.');
    if (q.length !== segs.length) return false;
    return q.every((x, i) => x === '*' || x === segs[i]);
  }

  /** 这一格本身能不能改 */
  function lockedPath(segs) {
    if (BASE_RO) return true;
    return PATS.some((p) => hit(p, segs));
  }

  /** 底下（更深处）有没有锁——有的话整块只能是只读 JSON */
  function lockedInside(segs) {
    if (BASE_RO) return true;
    return PATS.some((p) => {
      const q = String(p).split('.');
      if (q.length <= segs.length) return false;
      return segs.every((x, i) => q[i] === '*' || q[i] === x);
    });
  }

  function setByPath(root, segs, value) {
    let cur = root;
    for (let i = 0; i < segs.length - 1; i += 1) {
      if (cur == null) return;
      cur = cur[segs[i]];
    }
    if (cur != null) cur[segs[segs.length - 1]] = value;
  }

  function getPath(root, segs) {
    return (segs || []).reduce((a, k) => (a == null ? a : a[k]), root);
  }

  /* 叶子数不同的统计：只用来显示"改了 N 处" */
  function diffCount(a, b) {
    if (a === b) return 0;
    if (isObj(a) && isObj(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      let n = 0;
      for (const k of keys) n += diffCount(a[k], b[k]);
      return n;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return 1;
      let n = 0;
      for (let i = 0; i < a.length; i += 1) n += diffCount(a[i], b[i]);
      return n;
    }
    return 1;
  }

  /** 中文名 + 英文名一起显示：程序认英文，人看中文 */
  function dualLabel(k, cls) {
    const cn = labelOf(k);
    const same = String(cn) === String(k);
    return `<span class="${cls}-cn">${esc(cn)}</span>${same ? ''
      : `<em class="${cls}-en" title="程序里叫这个">${esc(k)}</em>`}`;
  }

  /* ── 单元格 ── */
  function cell(v, segs, readonly, key) {
    const ro = readonly || lockedPath(segs) || editOf(key) !== true;
    const p = attr(segs);

    if (isScalar(v)) {
      if (typeof v === 'boolean') {
        return `<input type="checkbox" class="fcell-check" data-path="${p}" data-type="boolean" ${v ? 'checked' : ''} ${ro ? 'disabled' : ''} />`;
      }
      const type = typeof v === 'number' ? 'number' : 'text';
      const long = typeof v === 'string' && v.length > 46;
      if (long && !ro) {
        return `<textarea class="fcell-text" rows="2" data-path="${p}" data-type="string">${esc(v)}</textarea>`;
      }
      if (long && ro) return `<span class="fcell-ro wrap">${esc(v)}</span>`;
      const val = v === null ? '' : v;
      return `<input class="fcell-input ${ro ? 'is-ro' : ''}" type="${type}" value="${esc(val)}" data-path="${p}"
        data-type="${type}" ${ro ? 'disabled' : ''} ${key === 'id' ? 'data-k="1"' : ''} />`;
    }

    /* 短标量数组（DSL 参数）→ 逐个输入框，别让人读 JSON */
    if (Array.isArray(v) && v.length <= 4 && v.every(isScalar)) return chips(v, segs, ro);

    /* 复杂字段：小 JSON 框。里面有锁住的格子就整块只读 */
    const json = JSON.stringify(v);
    if (ro || lockedInside(segs)) {
      return `<code class="fcell-ro j">${esc(json.length > 90 ? json.slice(0, 90) + '…' : json)}</code>`;
    }
    return `<textarea class="fcell-json" rows="2" spellcheck="false" data-path="${p}" data-json="1">${esc(json)}</textarea>`;
  }

  /* ── DSL 数组（每项只有一个算子键）→ 算子 / 参数 两列 ── */
  function dslTable(arr, segs, readonly) {
    const rows = arr.map((o, i) => {
      const k = Object.keys(o)[0];
      const note = opNote(k);
      return `<tr>
        <th class="fidx">${i + 1}</th>
        <td data-k="op" style="min-width:132px">
          <span class="op">${esc(k)}</span>
          ${note ? `<em class="op-cn" title="${esc(note.args || '')}">${esc(note.desc || '')}</em>` : ''}
        </td>
        <td data-k="arg" style="min-width:340px">${cell(o[k], [...segs, i, k], readonly, k)}</td>
      </tr>`;
    }).join('');
    return `<div class="ft-wrap"><table class="ft">
      <thead><tr><th class="fidx">#</th><th style="min-width:132px">算子</th><th style="min-width:340px">参数</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  /* ── 对象数组 → 表格 ── */
  function table(arr, segs, readonly) {
    if (arr.every((o) => Object.keys(o).length === 1)) return dslTable(arr, segs, readonly);
    const keys = [];
    for (const row of arr) for (const k of Object.keys(row)) if (!keys.includes(k)) keys.push(k);

    const head = keys.map((k) => `<th>${dualLabel(k, 'th')}</th>`).join('');
    const body = arr.map((row, i) => {
      const tds = keys.map((k) => {
        if (!(k in row)) return '<td class="fcell-empty">—</td>';
        const wide = !isScalar(row[k]) ? 'is-wide' : '';
        const w = widthOf(k) + (wide ? 90 : 0);
        return `<td data-k="${esc(k)}" class="${wide}" style="min-width:${w}px">${cell(row[k], [...segs, i, k], readonly, k)}</td>`;
      }).join('');
      return `<tr><th class="fidx">${i + 1}</th>${tds}</tr>`;
    }).join('');

    return `<div class="ft-wrap"><table class="ft">
      <thead><tr><th class="fidx">#</th>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
  }

  /* ── 标量数组 → 一行输入 ── */
  function chips(arr, segs, readonly) {
    return `<div class="fchips">${arr.map((v, i) => {
      const p = attr([...segs, i]);
      const ro = readonly || lockedPath([...segs, i]);
      if (isScalar(v)) {
        const isNum = typeof v === 'number' || arr.some((x) => typeof x === 'number');
        if (ro) return `<span class="chip-ro">${esc(v === null ? '—' : v)}</span>`;
        return `<input class="fchip" type="${isNum ? 'number' : 'text'}" value="${esc(v === null ? '' : v)}"
          data-path="${p}" data-type="${isNum ? 'number' : 'string'}" />`;
      }
      if (ro) return `<code class="chip-ro j">${esc(JSON.stringify(v))}</code>`;
      return `<textarea class="fcell-json" rows="2" spellcheck="false" data-path="${p}" data-json="1">${esc(JSON.stringify(v))}</textarea>`;
    }).join('')}</div>`;
  }

  /* ── 任意值 ── */
  function block(v, segs, readonly, depth) {
    if (isObjArray(v)) return table(v, segs, readonly);
    if (Array.isArray(v)) {
      if (!v.length) return '<p class="fempty">（空）</p>';
      return chips(v, segs, readonly);
    }
    if (isObj(v)) {
      const keys = Object.keys(v).filter((k) => !k.startsWith('_'));
      if (!keys.length) return '<p class="fempty">（空）</p>';
      const rows = keys.map((k) => {
        const child = v[k];
        const childSegs = [...segs, k];
        const id = `f_${childSegs.map((x) => String(x).replace(/\W/g, '_')).join('_')}`;
        const lock = readonly || lockedPath(childSegs);

        if (isScalar(child)) {
          return `<div class="frow">
            <label for="${id}" class="${lock ? 'is-ro' : ''}">${dualLabel(k, 'lbl')}</label>
            <div class="fval">${cell(child, childSegs, readonly, k)}</div>
          </div>`;
        }
        const open = depth < 1 ? 'open' : '';
        const count = Array.isArray(child) ? child.length + ' 条' : Object.keys(child).length + ' 项';
        /* 条件组 / 宏 / 模板的键是 id（`cond.break_ready` 这种），自带一句中文 desc。
           摘要里先给人话，再把 id 用小字跟在后面——两者都要，缺一个就对不上。 */
        const human = (!Array.isArray(child) && (child.title || child.name || child.desc)) || '';
        const head = human
          ? `<span class="lbl-cn">${esc(human)}</span><em class="lbl-en" title="程序里叫这个">${esc(k)}</em>`
          : dualLabel(k, 'lbl');
        return `<details class="fgroup" ${open}>
          <summary>${head}<span class="fcount">${count}${lock ? ' · 只读' : ''}</span></summary>
          ${block(child, childSegs, lock, depth + 1)}
        </details>`;
      }).join('');
      return `<div class="fobj">${rows}</div>`;
    }
    return cell(v, segs, readonly, '');
  }

  /* ── 入口 ── */
  function setSchema(schema) {
    SCHEMA = schema || {};
    SCHEMA.fields = SCHEMA.fields || {};
    SCHEMA.files = SCHEMA.files || {};
    SCHEMA.ops = SCHEMA.ops || {};
  }

  /**
   * @param {HTMLElement} root
   * @param {any} doc         要编辑的那份 JSON
   * @param {{readonly?:boolean, readonlyPaths?:string[]}} opts
   */
  function render(root, doc, opts) {
    const o = opts || {};
    BASE_RO = !!o.readonly;
    PATS = Array.isArray(o.readonlyPaths) ? o.readonlyPaths : [];
    const data = JSON.parse(JSON.stringify(doc));
    root.innerHTML = block(data, [], BASE_RO, -1);
    root.classList.toggle('is-readonly', BASE_RO);
    root.querySelectorAll('details.fgroup').forEach((d) => { d.open = true; });

    return {
      doc: data,
      readonly: BASE_RO,
      diff: () => diffCount(doc, data),
      value: () => data
    };
  }

  /* 输入 → 写回 */
  function bind(root, api, onChange) {
    const flush = () => onChange && onChange(api.diff());
    const segsOf = (el) => {
      try {
        const v = JSON.parse(el.dataset.path);
        return Array.isArray(v) ? v : null;
      } catch (err) {
        return null;
      }
    };

    root.addEventListener('input', (e) => {
      const el = e.target.closest('[data-path]');
      if (!el || el.dataset.json || el.disabled) return;
      if (el.type === 'checkbox') return;
      const segs = segsOf(el);
      if (!segs) return;
      const type = el.dataset.type;
      let v;
      if (type === 'number') v = el.value === '' ? null : Number(el.value);
      else v = el.value;
      setByPath(api.doc, segs, v);
      el.classList.remove('is-bad');
      flush();
    });

    root.addEventListener('change', (e) => {
      const el = e.target.closest('[data-path]');
      if (!el || el.disabled) return;
      const segs = segsOf(el);
      if (!segs) return;
      if (el.type === 'checkbox') {
        setByPath(api.doc, segs, el.checked);
        flush();
        return;
      }
      if (el.dataset.json) {
        try {
          const v = JSON.parse(el.value);
          setByPath(api.doc, segs, v);
          el.classList.remove('is-bad');
          flush();
        } catch (err) {
          el.classList.add('is-bad');
          el.title = 'JSON 写错了：' + err.message;
        }
      }
    });
  }

  window.DYForm = { render, bind, setSchema, labelOf, diffCount, getPath, lockedPath };
})();
