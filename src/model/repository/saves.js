'use strict';

/**
 * 存档（r29）：一局一份，键是浏览器的 `dayao_gid`。
 *
 * 为什么整份存、不做字段挑选：
 *   `wall`（墙） / `study`（求学叠了几次） / `arts`（百艺阶与 exp） /
 *   `mods`（吃完的药） / `pending`（排定的事件） / `turn.mainId`（今年那张卡） /
 *   `flags.market`（坊市还开着没）——**漏存任何一个都能读档刷数值**，
 *   所以这里就是 `JSON.stringify(state)`，一个字段都不挑。
 *
 * 版本号：state 结构改了就 +1；旧档读不上来直接丢（开发期不留迁移脚本），
 * 但**不会把库弄坏**——下一次进游戏就是新开一局。
 */

const db = require('./db');

const VERSION = 1;

/**
 * @param {string} gid
 * @returns {{state:object, updatedAt:number}|null}
 */
function load(gid) {
  const row = db.saveGet(gid);
  if (!row) return null;
  let pack;
  try {
    pack = JSON.parse(row.state);
  } catch {
    return null;
  }
  if (!pack || pack.v !== VERSION || !pack.state) return null;
  return { state: pack.state, updatedAt: row.updated_at };
}

function save(gid, state) {
  db.savePut(gid, JSON.stringify({ v: VERSION, at: Date.now(), state }));
}

function drop(gid) {
  db.saveDrop(gid);
}

/** 只留最近 n 份（开发期防手滑） */
function trim(keep) {
  db.saveTrim(keep);
}

module.exports = { load, save, drop, trim, VERSION };
