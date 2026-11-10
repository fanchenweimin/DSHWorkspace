'use strict';

/**
 * 按 viewer 裁剪 —— 唯一允许决定"玩家能看到什么"的地方。
 * 铁律：裁剪发生在服务端。前端隐藏 DOM 不算数。
 */

const SECRET_FIELDS = [
  'weight', 'priority', 'judge', 'quota', 'luckBias', 'chain', 'ttl',
  /* 下面这些是"给策划看的"，玩家看到就等于剧透或看到内部编号 */
  'source', 'template', 'args', 'window', 'fromCalendar', 'order', 'duty', 'maxMonths'
];

function cropEvent(ev, viewer) {
  if (viewer === 'sysadmin') return ev;

  const out = {};
  for (const [k, v] of Object.entries(ev)) {
    if (SECRET_FIELDS.includes(k)) continue;
    if (k === 'when' || k === 'do') continue;
    out[k] = v;
  }

  if (Array.isArray(ev.choices)) {
    out.choices = ev.choices.map((c) => {
      const choice = { id: c.id, label: c.label, hint: c.hint };
      if (c.months != null) choice.months = c.months;
      /* 事件里明码标价的，价格照给；没写价格的一律只说"不够" */
      if (c.openPrice) choice.cost = c.cost;
      if (c.lockReason) choice.lockReason = c.lockReason;
      return choice;
    });
  }
  return out;
}

function cropEvents(list, viewer) {
  return (list || []).map((e) => cropEvent(e, viewer));
}

function cropWorld(world) {
  /* 世界是公开信息：去掉内部注释即可，地名与风物都该被玩家看到 */
  const { _note, ...rest } = world;
  return rest;
}

/**
 * 角色卡的裁剪（r35，设计/40 §1.1）。
 *
 * **隐藏属性 / 寿命 / 观己 → 只有 sysadmin 能看。**
 * 玩家只看到：名字、年龄、四道的**品名与能不能点**、囊中、纪事。
 * 看不到：资质/悟性/心性/气运的数值、寿元、修为条的具体数、内部计数。
 *
 * 注意：这不是"前端藏 DOM"——**这些字段根本不会出现在发给浏览器的 JSON 里**。
 */
const VIEWER_MAP = { sysadmin: 'sysadmin', user: 'user', guest: 'user' };

function cropState(state, viewer) {
  if (!state) return state;
  const v = VIEWER_MAP[String(viewer || 'guest')] || 'user';
  if (v === 'sysadmin') return state;

  const out = { ...state };

  /* ① 隐藏属性：只留"有没有"，不留数值 */
  delete out.attr;

  /* ② 寿命：玩家只知道"还活着"，不知道能活到几岁 */
  delete out.lifespan;

  /* ③ 气运 */
  delete out.luck;

  /* ④ 先天标签的**具体内容**也不给（命格名会剧透出身） */
  delete out.fate;
  delete out.talents;

  /* ⑤ 四道的修为条数值：只给"满没满"与下一个品名 */
  if (out.path && typeof out.path === 'object') {
    const p = {};
    for (const [dao, row] of Object.entries(out.path)) {
      if (!row || typeof row !== 'object') { p[dao] = row; continue; }
      const r = { ...row };
      delete r.bar;
      delete r.barMax;
      /* ready 是布尔，留着——它是"修为满了没有"，不是数值 */
      p[dao] = r;
    }
    out.path = p;
  }

  /* ⑥ monthsUsed 要留：界面靠它画"这一年还剩几个月"的刻度。
     它不是隐藏属性，是游戏节奏本身。 */
  out.monthsUsed = state.monthsUsed;

  return out;
}

module.exports = { cropEvent, cropEvents, cropWorld, cropState, VIEWER_MAP };
