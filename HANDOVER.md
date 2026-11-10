# 交接文档（r40 · 2026-11-10）

> 给下一个窗口的接手人。**先读这一份，再读 `PROGRESS.md`，然后才是 `docs/`。**
> 这一份只讲三件事：现在是什么样、怎么改、还差什么。

---

## 1. 一句话与怎么跑

**大曜仙录** —— 一个「一个人，一辈子」的修仙文字模拟。原生 JS，前后端一把梭，**没有框架、没有打包、没有构建**。

```bash
cd /c/Work/DSHWorkspace
node start.js            # 或双击 start-game.cmd
# → http://127.0.0.1:8787
node test/smoke.js       # 83 项离线断言，改完必跑
```

- 首页：姓名 + 继续这一世 + 开始新游戏（`/`）
- 游戏页：左人物 / 中六块 / 右纪事（`/game.html`）
- 配置页：`/admin.html`，账号 `sysadmin / sysadmin`（服务端拦截非 sysadmin）
- 数据库：`data/dayao.db`（sqlite，`node:sqlite` 内置模块，**不需要装依赖**）
- 想清档：`POST /api/forget`，或停服务删 `data/`

> 巡检**必须带 `--noproxy '*'`**：本机代理会把 127.0.0.1 也劫走，回 502，看着像服务挂了。

---

## 2. 分层（改代码前先认清自己在哪一层）

```
src/seed/*.json          数据层（17 份）：世界、规则、事件、条件组、宏、模板、术法、物品…
src/model/repository/    读数据：seed（按 mtime 失效）/ config（覆盖层优先）/ db / saves
src/model/rules/         公式层（纯函数，好测）
  dsl.js                 when 求值 + $arg 绑定
  mods.js                ★ 路径寻址 + 修饰器管线（永久/临时、四层顺序、钱进位）
  realm.js               ★ 境界：月修为 / 出墙率 / 破境判定 / 修为条上限
  grade.js               ★ 阶 + 品（黄下1…天6）、影响等级 L=阶+品、够不够得着
  time.js                ★ 耗时 = base × 品阶系数 × ref / 属性分
  spells.js              ★ 术法：四档熟练、有效阶品、来源、升档月数
  arts.js                ★ 百艺：阶品、产物低一品、天赋上限、升档月数
  battle.js              ★ 战斗：查表数值 + 三血条 + 法力盾 + 闪避 + 逐帧战报
src/model/systems/       业务层（会写 state）
  opening.js             开局入品（十岁判一次体魄的门）
  hand.js                ★ 五块手牌 + 法术行 + 坊市货架
  draw.js                事件抽取（四步入池 / 优先批 / 权重）
  effects.js             ★ do 的执行器（add/money/mod/flag/if/call/judge…）
  turn.js                ★ 回合结算：查月 → 扣钱 → 耗月/纪事 → 跑效果 → 翻年 → 寿元
  calendar.js            战事日历（phaseFor / sync / due）
src/controller/          裁剪层（唯一决定"玩家能看到什么"的地方）
src/middleware/session.js 会话（落 sessions 表）
public/                  表现层（原生 ES，无框架）
  js/game.js             ★ 六块渲染 + 战斗一屏 + 点一下发一次请求
  js/form.js             配置页的通用渲染器（schema 驱动）
```

**改数值 → 只动 `src/seed/*.json`。**
**改规则 → 动 `src/model/rules/`，并在 `test/smoke.js` 加一条断言。**
**改"玩家看得到什么" → 只动 `src/controller/` 与 `public/js/`，别在 rules 里裁剪。**

---

## 3. 状态形状（`state`，整份进 `saves` 表）

```js
{
  name, clock: { age, year, month }, lifespan, zone: 'city', luck,
  attr: { aptitude, insight, heart },       // 每项 { base }，.eff 由 mods 现算
  path: {                                    // 四道
    body|qi|spirit|heart: {
      level,        // 0 = 还没入品；1..6 = 第几品
      bar,          // 修为条；上限 = PROF[level-1]（level 0 没有条）
      attempts, fail, wall: { [tier]: bool }, study: { [tier]: bool }
    }
  },
  spells: { 'spell.luohan': { lvl, exp } },  // lvl 0 入门 / 1 小成 / 2 大成 / 3 圆满
  arts:   { alchemy: { lvl, exp, talent, learned } },
  craftGrade: { alchemy: { jie, pin } },     // 产出来的成品的阶品
  items:  { 'item.huichun': 2, 'craft.alchemy': 1 },
  money:  { copper, silver, gold },          // 100 铜 = 1 银，100 银 = 1 金
  merit:  { war, craft, office }, reputation: { base },
  education: { stage: 'meng|fu|tai', graduated },
  flags:  { market: { open }, office: { army }, city_lost: {...}, city_hurt: {...} },
  mods:   [ { target, op, value, duration, source } ],
  turn:   { mainId, mainDone, breakthroughUsed },   // 一年一件大事 / 一年一破
  tally:  { fights, wins, nearDeath, fled },        // 战斗计数（天赋 T1–T5 的口子）
  monthsUsed, handled: [], pending: [], war: { phase }, log: []
}
```

**存档策略**：整份 JSON 存 `saves` 表 + `VERSION`。改 state 结构就把 `repository/saves.js#VERSION` +1，旧档直接丢（开发期不写迁移）。

---

## 4. 几条不能破的不变量

| 编号 | 内容 | 守在哪 |
| --- | --- | --- |
| I3 / I25 | **层级只能由破境判定写**，`add` 不许改 `path.*.level` | `effects.js` 的 `DAO_LEVEL` 正则直接抛错 |
| I4 | 道心只由心关推进，不吃月修为 | `realm.monthsToFull` 返回 Infinity；`train` 拒绝 heart |
| I15 | 强制事件封住常驻（含营生、修炼、百艺），**但必须留一条活路** | `hand.table` 的 `locked` 分支 + `renderMain` 的 `stuck` 分支 |
| I18 | 修为条上限只问 `realm.barMax`，别处不许另写一套 | `effects.barCap` 转调 realm |
| — | **读接口不许写状态** | `spells.powerOf` 先 `know()` 再读，别调 `stateOf` |
| — | **画出来的一定点得动** | 服务端 `controller.mainFor` 按 `when` 裁；前端置灰要写原因 |

---

## 5. 现在能玩到什么（r40）

- **开局**：四属性（资质/悟性/心性/气运）**每次随机**；**命格与天赋也随机**（`talents.json` 的 `mods[]` 直接进面板）；十岁入蒙学；那年先判一次体魄的门——没墙直接站上体魄，有墙停在门口（**没有进度条**）。
- **一年一件大事**：办完 `turn.mainDone` 置位，跨年才清。
- **年初链**（顺序写死，I7）：**寿元 → 气运漂移 → 心性衰减 → 心魔 → 战事**。
- **修为**：一条格里按状态切换「修炼 / 突破」；修满就只能突破；**品内真实境界一年只破一次，入门不算**。
- **两种瓶颈**：概率瓶颈**一次点击完成判定与真实进品**；事件瓶颈（品 5/6、养灵、修心）先办事件通 `lv`，再手动点真实突破。
  - **失败累积上限 0.10**：失败 10 次与 50 次一样（`需求/11` §3.0.1）。
  - **灌顶** +0.5，基本保送，一次性（`rules.ENLIGHTEN`）。
- **层级 ≠ 境界**：`lv`（门通到第几层）与 `level`（站在第几品）是两个字段。
  - 概率动作内部先更新 `lv`、再更新 `level`，玩家只点一次；事件动作只更新 `lv`，真实突破由玩家另点。
  - 事件瓶颈「能突破但不突破」是合法状态；品内真实突破无论走哪条流程都受年度名额限制。
- **炼气先学后修**：11 岁府学炼气学习强制事件完成后才开放；事件不直接进品，且没有锻体·脏腑门槛。
- **心性三条线**（r35 新增）：
  - ① 定时衰减：未入修心且 **心性 > 60** 才扣；**≤ 60 停**——熬时间到不了心魔。
  - ② 事件：可 −15 … +15，**能扣到 0**（`evt.heart.crime` −8、`evt.heart.betray` −12）。
  - ③ 心关失败：修为 −10×基数 + **30% 心性 −1**。
- **心魔**：心性 **0–39** 每年掷一次，**存活与心性成正比**（39 → 0.1、**0 → 0 必死**）；
  活下来：心性 −5、当前品修为清零；死：这一世结束。只找入道者（锻体 ≥ 3 或 炼气 ≥ 2）。
- **修心**：门是**一次性**的；**心性 < 90 时任何一品的突破判定都必然失败**；失败扣修为+可能扣心性。
- **术法**：四档（入门不能战 / 小成 / 大成 / 圆满，0 / 0.85 / 1.0 / 1.15）；品级**只有黄级分上中下**（黄下1·黄中2·黄上3·玄4·地5·天6）；
  **四条来源**——学堂 / 坊市（顶格黄上）/ 城主府（军衔+军功）/ **奇遇事件**（地·天只走这条）。
- **百艺**：14 岁开；第一门免费、其余 120 文求学；门槛没到的**灰着写明原因**；练一档出一件成品（阶品比人低一品）进囊中。
- **坊市**：逛一次开门（1 月），买 / 卖（半价），跨年收摊。
- **战斗**：独立一屏（720×620 定死，中间自己滚）；血/法力盾/法力/精神/神志五条 + 闪避；逐帧播；**死斗会死**（`state.dead`，之后「此生已尽」），切磋 10% 危险线叫停；血条见底还有一次逃跑；有符箓先甩一张。
- **战事日历**：312 预警 → 313 城战 → 城破成链（⚠️ 链在"一年一件大事"下会断，见 `设计/92` F9；**跨年 r35 暂缓**）。
- **权限**：隐藏属性 / 寿命 / 气运 / 命格天赋只给 sysadmin；**已入品修为 `bar/barMax` 对玩家可见**，否则左栏会 NaN（`serialize.cropState`）。
- **存档 / 会话**：落库，重启不丢，连今年桌上的牌都不变。

---

## 6. 还差什么（按建议顺序，落点都写好了）

> **大前提**：当前所有数字都是**占位**。下一轮的主题是**统一重推数值**（见 `PROGRESS.md` §0）。
> 在那之前，别逐个调数字——改一个就会把别的锚点带歪。

| # | 事项 | 落点 | 备注 |
| --- | --- | --- | --- |
| **0** | **数值统一重推** | `src/seed/*.json` | 逻辑链已通，等重推。**这是下一轮的主题** |
| 1 | **防御数值** | `rules.BATTLE` / `spells.json#shield` / `suppressMul` | 逻辑全接好，数值是草稿。用户明确"后面统一调" |
| 2 | **加载期校验** | 新 `src/model/repository/validate.js` | 校验 17 份种子的引用（事件→模板/条件组/宏、arts.req、spells.req），启动时跑一遍，坏了直接报 |
| 3 | **术法阶位系数与相性** | `spells.gainOf` | 现在既没阶位系数也没相性（`设计/92` C6） |
| 4 | **百艺月入重排** | `arts.json#income` | 与 `需求/13` §3.3 差 10–40 倍（`设计/92` D3） |
| 5 | **求学的「每年 2 次」** | `hand.js` / `macros.json` | `teachCap` 0.06/0.12 现在吃不到，只能 +0.03（`设计/92` B8） |
| 6 | **寿元 = 下限 + 掷骰 + extraLife** | `realm.lifespanOf` | 现在只取区间上界（`设计/92` B7） |
| 7 | **灵脉 / spiritCoef** | `realm.js` | 还是兜底 1.0 |
| 8 | **跨年 pending** | `turn.js` | **r35 明确暂缓**；缺口见 `设计/92` F1 |
| 9 | **`chance`/`judge` 条件恒真、`between`/`in` 未实现** | `dsl.js` | 当前数据层没用到，但迟早会踩（`设计/92` F5/F6） |
| 10 | **配置页表单增删行** | `public/js/form.js` + `public/js/admin.js` | 现在只能改值 |
| 11 | **地图 hover / 转世** | `public/js/map.js`、新 `systems/reincarnate.js` | 首页地图只显示，无交互 |
| 12 | **战斗天赋 T1–T5** | `state.tally` | 计数器已有，缺"到阈值给天赋" |
| 13 | **品 5/6 的真实硬条件** | `rules.BREAK_GATE` + `evt.gate.*` | 现在是"事件办完就进" |
| 14 | **灌顶的社会关系入口** | 新 `systems/relation.js` | `需求/11` §7.4 需要"谁来给你灌"（师承/宗门/人情），`identities.json` 有身份但没有关系层 |

> **r35 已经做掉的**（不再列在上面）：权限裁剪（`serialize.cropState`）、命格/天赋落地、
> 年度链（寿元→气运→心性→心魔）、心魔与心性三线、修心一次性门、失败累积上限 0.1、
> `force` 吃一年一次、`q=0` 不占名额、玄阶出坊市、法术第四条来源（奇遇）。

---

## 7. 踩过的坑（照着躲）

1. **`flag` 算子两种写法都要认**：`{id:'flag.x', value:true}` 与裸串 `'flag.x'`。写成 `{flag:'flag.x'}` 会静默写进 `flags.undefined`。
2. **`effects.runList` 每跑完一条要查 `state.dead`**：否则人死了还在加军功、写"你从缺口里爬出来"。
3. **强制卡放不下会死锁**：营生整块被 I15 藏起来，"把这一年过完"也在营生里。活路必须挂在主事件卡自己身上。
4. **"看一眼就改状态"**：`publicList` 里调 `stateOf` 会把没学的术法建成"已学"= 白送。读接口先判 `know()`。
5. **线性公式代替查表**：`hp = 90 + 品×55` 把"资质好"和"血厚"混成一件事，且和文档对不上。数值一律查 `BATTLE.tables`。
6. **越阶对手没有那一层的家底**：`rank+1` 但 `tier` 没跟上 → "rank 2 但法力 0"的怪人，两边互相"没能破防"到超时。
7. **死斗 + 固定日历 = 每局死在同一处**：城战固定 313 年，六局模拟全部 14 岁阵亡。**固定剧本要检查它落在玩家几岁**（已加 16/18 岁门）。
8. **"熟练"不是连续数值**：四档有语义，入门不能战。别写成 0~1。
9. **`PROF[level]` vs `PROF[level-1]`**：前者会给"未入门"长出一条进度条，且每品修为提前用掉一格。是 `level-1`（站在本品练满才破下一品）。
10. **Python 改 JSON 别手写片段**：`true` 会 NameError，文件改一半没落盘。一律 `json.load` / `json.dump`。
11. **同名变量撞了**：`const entry` 在 `realm.js` 已存在，新加的改 `isEntry`；测试里 `const opening = require(...)` 会把顶层 `opening()` 辅助函数盖掉。

---

## 8. 文档优先级与同步规则

1. **`docs/需求/` + `docs/设计/`** —— 第一权威。
2. **`归档/*.md`** —— docs 里找不到、或不知道怎么改时回这里翻。迁移时确实丢过东西（「修为总量」的定义只在 `归档/境界系统总纲.md`，是 r28 修 `barMax` 的依据）。
3. ~~`.tmp/*.md.bak2`~~ —— **2026-11-08 已清理**。原有草稿里还有效的冲突项已收进 `docs/设计/92-待修清单.md`；`.tmp/` 现只剩 `cdp.js`（本文件 §9 引用的无头 Chrome 脚本）。

**接手时按这个顺序读**：`HANDOVER.md`（本文件）→ `PROGRESS.md` → **`docs/设计/92-待修清单.md`** → `docs/`。

> **`设计/92` 是 2026-11-08 新加的**：它把「代码与文档到底差在哪」逐条列了出来
> （`文件:行` + 严重度 + 该改哪里），共 60 余条，其中「高」约 25 条。
> **改代码之前先看它**，能省掉一轮"读完全部文档才发现口径对不上"。
>
> **`需求/99` 是"还没定"的那些**：心魔成活率方向、心性地板、修心门、灌顶、属性上限。
> 这几条不定，改代码就是猜。

**改完代码必须同步**：需求（口径）→ 设计（实现状态）→ `PROGRESS.md`（这一轮改了什么 / 实测 / 新踩的坑）→ `README.md` + `docs/README.md`（版本与索引）。
`docs/设计/*` 每份开头都有一块「实现状态（rXX 核对）」，**✅ / 🟡 / ⬜ / ⏸ 不要乱标**——标了 ✅ 就得真的跑过。
**`设计/92` 里修好的条目，在该行追加 `✅ 修于 rXX`，不要删行。**

---

## 9. 怎么验（别只看"应该能"）

```bash
# ① 断言
node test/smoke.js                     # 期望 73 通过 / 0 失败

# ② 页面与接口
for p in / /game.html /login.html /admin.html /api/health /api/hand /api/has; do
  printf "%-14s %s\n" "$p" "$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' http://127.0.0.1:8787$p)"
done
# 期望：/admin.html → 302，其余 200

# ③ 真跑一局（无头 Chrome + CDP，脚本在 .tmp/cdp.js）
node .tmp/cdp.js "http://127.0.0.1:8787/game.html" .tmp/x.png \
  "fetch('/api/new',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})" \
  "(async()=>{ /* 点事件、点修炼、读 DOM，返回 JSON */ })()"
```

模拟一局最快的方式：`hand.table` + `turn.act` 循环（见下方骨架），**每步都必须 `r.ok`，卡住就打印 reason**。

```js
const s = demo.initial('测'); opening.apply(s, { rng: Math.random });
for (let i = 0; i < 4000 && !s.dead; i += 1) {
  const t = hand.table(s); let moved = false;
  /* 强制事件 → 突破 → 修炼 → 主事件 → 兜底闲居 */
  if (!moved) { const r = turn.act(s, { kind: 'action', id: 'act.idle' }); if (!r.ok) break; }
}
```

---

## 10. 下一步建议（三条）

1. **统一防御数值**：先把 `shield` / `def` / `suppressMul` / `grade.reach` 四处的量级对齐，跑 20 场模拟看回合数分布（目标 6–12 回合），再调表。
2. **写加载期校验**：17 份种子的交叉引用一旦写错（事件引了不存在的模板、arts.req 写了 `body: 9`），现在只会在运行到那一刻炸。启动时校验一遍，比事后查便宜得多。
3. **把「术法来源」铺到内容层**：现在只有 10 门术法、三条来源。按 `需求/12` 补到 30 门左右，让"学堂 / 坊市 / 城主府"三线各有各的货，玩家才有得选。

---

*最后更新：r36（2026-11-09）。这一轮改了什么见 `PROGRESS.md` §1.1。*
