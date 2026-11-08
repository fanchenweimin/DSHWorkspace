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

module.exports = { cropEvent, cropEvents, cropWorld };
