'use strict';

/**
 * 进行中的一局：内存 + 存档两层。
 *
 *   peek(gid)  内存有就用内存；没有就翻 `saves` 表（重启服务也能续上）
 *   save(gid)  写内存 **并且** 写库（每一步结算后调）
 *   reset(gid) 新开一局，覆盖旧档
 *   drop(gid)  两处一起删
 *
 * 内存那层只是缓存：TTL 到了就丢，下次 peek 再从库里读回来。
 * 所以"服务重启"不再是"这一世没了"。
 */

const demo = require('./demo');
const opening = require('../systems/opening');
const saves = require('../repository/saves');

const TTL_MS = 1000 * 60 * 30;       // 内存缓存半小时；库里的存档不过期
const MAX_GAMES = 400;               // 内存缓存上限，超了丢最旧的

const games = new Map(); // gid -> { state, at }

function sweep() {
  const now = Date.now();
  for (const [gid, g] of games) {
    if (now - g.at > TTL_MS) games.delete(gid);
  }
  if (games.size <= MAX_GAMES) return;
  const old = [...games.entries()].sort((a, b) => a[1].at - b[1].at);
  for (let i = 0; i < old.length - MAX_GAMES; i += 1) games.delete(old[i][0]);
}

/** 有没有局：内存 → 存档；都没有就返回 null（不再偷偷开一局） */
function peek(gid) {
  const g = games.get(gid);
  if (g && Date.now() - g.at <= TTL_MS) {
    g.at = Date.now();
    return g.state;
  }
  if (g) games.delete(gid);

  const loaded = saves.load(gid);
  if (!loaded) return null;
  games.set(gid, { state: loaded.state, at: Date.now() });
  return loaded.state;
}

/** 测试与老接口用：没有就开一局 */
function ensure(gid, name) {
  const got = peek(gid);
  if (got) return got;
  return reset(gid, name);
}

function reset(gid, name) {
  const state = demo.initial(name);
  /* 开局先判一次「入体魄」。没墙就直接站在体魄，有墙就停在门口。 */
  opening.apply(state, {});
  games.set(gid, { state, at: Date.now() });
  saves.save(gid, state);
  saves.trim(300);
  sweep();
  return state;
}

/** 结算完一步就写：内存 + 库 */
function save(gid, state) {
  games.set(gid, { state, at: Date.now() });
  saves.save(gid, state);
}

function drop(gid) {
  games.delete(gid);
  saves.drop(gid);
}

module.exports = { peek, ensure, reset, save, drop };
