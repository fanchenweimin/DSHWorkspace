# 开发进度与断点（r35 · 逻辑重建中）

> **这是续作用的唯一入口。** 新开一轮对话时：先读这一份 → 再看 `设计/92-实现差异台账.md` → 最后回 `docs/`。
>
> **本文件只记「做到哪一步了」。**
> - 代码与文档**差在哪** → `docs/设计/92-实现差异台账.md`（逐条带 `文件:行`）
> - 需求**要什么** → `docs/需求/`
> - 怎么**接手** → `HANDOVER.md`

---

## ⚠️ 0. 当前阶段：先把逻辑理清，数值全部重推

**这一轮（r35）只做一件事：把机制之间的因果关系理顺。**

所以：

1. **现在不要纠结具体数字**。`rules.json` 里那些成功率、修为总量、寿元区间、丹药加成、
   月修为系数——**全部视为占位值**，不是调好的平衡。
2. **逻辑定稿之后，会统一重新推导数值**（沿用 `设计/15` 的蒙特卡洛 + 三锚点那套方法）。
   在那之前，**任何"这个数是不是太高/太低"的问题都先搁置**。
3. **写代码时的判据是"链路通不通"，不是"数值好不好"**：
   一问「这个机制有没有被触发过」，二问「它触发时改的是不是它该改的地方」。
4. **改数值请只改 `src/seed/*.json`**，别把数字写进 `src/model/**`。
   这一轮会把散落在代码里的硬编码（`failCap`、`0.55`、`25%` 伤病、护盾 1:1…）
   逐步收回到配置里，**为后面的"重推数值"做准备**。

> 一句话：**这一轮做骨架和语义，下一轮做数字。**

---

## 0.1 四条规矩（每次续做前先确认）

1. **顺序**：需求（`docs/需求/`）→ 设计（`docs/设计/`）→ 前端 → 后端 → 数据库。**倒着来一律作废重做。**
2. **冲突**：代码与 `docs/` 不一致时，**以 `docs/` 为最终版**，改代码 + 更新本文件。
   **新描述与旧描述冲突时，以新的为准。**
3. **启动/停止不许改**：`node src/index.js` / `node start.js` / `node stop.js`，端口 **8787**，pid 在 `data/server.pid`。
4. **玩家页不弹二次窗**：点一下就结算，结果只进纪事栏。新增交互先问"这能不能内联"。

> **`归档/` 不用天天看。** 它只在用户**明确指出**时才去查——
> 平时一律以 `docs/` 现行为准，不要拿归档里的旧口径去质疑 `docs`。

---

## 0.2 r35 这一轮定下来的口径（已写进 docs）

| # | 结论 | 落在 |
| --- | --- | --- |
| 1 | **心魔**：心性 **0–39 触发**，存活率**与心性成正比**，**0 → 0**、**39 → 0.1** | `需求/01` §3、`设计/02` §8 |
| 2 | **心性衰减是定时任务**：未入修心且 **心性 > 60** 才递减；**≤ 60 停止** | `需求/01` §3、`设计/02` §8 |
| 3 | **事件可以改心性**（此前漏写）——正常人不会遇心魔，但做了某些事就会 | `需求/01` §3.2、`需求/20` §11 |
| 4 | **问心关失败也扣心性**（此前漏写） | `需求/11` §6、`需求/01` §3.2 |
| 5 | **修心的门是一次性的**：入门判定一次，之后不再重判（代码现在的实现是错的） | `需求/11` §6 |
| 6 | **心性 ≥ 90 是"突破判定"的门槛**：进不惑要判、破天命也要判；**< 90 则突破必然失败** | `需求/11` §6 |
| 7 | **灌顶 = 加大成功率，基本等同保送** | `需求/11` §7.4 |
| 8 | **属性上限要有**（三层加法，满值可达 200） | `需求/01` §2.1 |
| 9 | **层级制与修为条互补**：先判层级（瓶颈）→ 进门 → 攒修为 → 条满再判下一层 | `需求/11` §1 |
| 10 | **失败叠加成功率有硬上限 0.1**：基础 0.05 时，失败 10 次与 50 次都是 0.15 | `需求/11` §3.2 |
| 11 | **法术四档** 0 / 0.85 / 1.0 / 1.15；**品级只有黄级分上中下（1–3 品）**，天地玄不分 | `需求/12` §0.1 |
| 12 | **法术来源四条**：学堂 / 坊市 / 城主府 / **奇遇事件** | `需求/12` §0.1.2 |
| 13 | **跨年事件先不做** | `需求/20` §4.3 |
| 14 | **隐藏属性 / 寿命只给 sysadmin** | `设计/40` §1.1、`设计/92` G1 |
| 15 | **命格 / 天赋 / 年度链（A1/A2/A3）按设计做** | `设计/01` §1、`需求/01` |
| 16 | 缺事件导致链路不通时，**可以自行补事件**，先保证逻辑能跑 | `src/seed/events.json` |

---


## 1. 现在能不能跑

**能。** `node start.js` → `http://127.0.0.1:8787`

| 项 | 状态 |
| --- | --- |
| `node test/smoke.js` | **73 通过 / 0 失败**（2026-11-08 实测，Node v24.16.0） |
| 首页 `/` | ✅ 地图 + 三入口（填名 / 继续这一世 / 开始新游戏） |
| 游戏页 `/game.html` | ✅ 六块：今年的事 / 修炼 / 法术 / 百艺 / 营生 / 坊市；左栏有「囊中」 |
| 登录 `/login.html` | ✅ `sysadmin/sysadmin`、`user/useradmin` |
| 配置页 `/admin.html` | ✅ 表格 / 表单；中文名列头 + 只读格灰掉 + 算子带中文释义 |

---

## 2. 三段代码的状态

### 前端 ✅ 完成

| 做的事 | 文件 |
| --- | --- |
| 首页三入口：名字输入（空则「沈砚」）、继续这一世、开始新游戏（有活局时两段式） | `public/index.html` `public/js/home.js` `public/styles/home.css` |
| 游戏页六块：主事件 / 修炼 / 法术 / 百艺 / 营生 / 坊市 | `public/game.html` `public/styles/game.css` |
| 战斗独立一屏（720×620 定死），逐帧播报 | `public/js/game.js` |
| 左栏三段可折叠 + 钱吸底 | 同上 |
| 配置页：列头中文名 + 只读灰字 + 算子中文释义 | `public/js/form.js` `public/js/admin.js` |
| 大陆地图（七国 + 断天山脉居中） | `public/js/map.js` |

### 后端 ✅ 打通

| 做的事 | 文件 |
| --- | --- |
| 静态服务 + `/seed/*.json` 兜底 | `src/router/static.js` |
| Cookie 会话 + 玩局 `gid` | `src/middleware/session.js`（落 `sessions` 表） |
| **按 viewer 裁剪** | `src/controller/serialize.js` ⚠️ 只裁事件，不裁 state，见 `设计/92` G1 |
| 配置读写 + 配置字典 `/api/schema` | `src/controller/content.js` |
| **事件抽取**：四步入池 → 优先批 → 权重归一化 | `src/model/systems/draw.js` |
| **手牌**：主事件 / 突破 / 修炼 / 法术 / 百艺 / 营生 + I15 封锁 | `src/model/systems/hand.js` |
| **回合结算**：`wait/train/break/art/use/action/event/buy/sell/...` | `src/model/systems/turn.js`（691 行） |
| **效果执行器**：16 个算子 | `src/model/systems/effects.js` |
| **修饰器管线**：路径寻址、四层顺序、同源唯一、到期 | `src/model/rules/mods.js` |
| **公式唯一实现**：月修为 / 出墙率 / 成功基数 / `judgeBreak` / 外溢 / 拆墙 | `src/model/rules/realm.js` |
| **阶 + 品**：`L = 阶 + 品`、够不够得着 | `src/model/rules/grade.js` |
| **耗时**：`base × 品阶系数 × ref / 属性分` | `src/model/rules/time.js` |
| **术法**：四档熟练、有效阶品、三来源 | `src/model/rules/spells.js` |
| **百艺**：12 门 / 阶 / 天赋封顶 | `src/model/rules/arts.js` |
| **战斗**：查表 / 手段层 / 压制 / 三血条 / 法力≠盾 / 闪避 / 逃跑 / 认输 / 用符 | `src/model/rules/battle.js`（709 行） |
| **战事日历** | `src/model/systems/calendar.js` |
| **开局入品** | `src/model/systems/opening.js` |
| **存档落库** | `src/model/state/running.js` + `src/model/repository/saves.js` |

### 数据库 ✅

| 表 | 用途 | 状态 |
| --- | --- | --- |
| `users` | 账号 + scrypt + 角色 | ✅ |
| `config_overrides` | 配置覆盖层（JSON 整档） | ✅ |
| `saves` | 存档：一局一份（`gid` 主键），整份 state + 版本号 | ✅ r29 |
| `sessions` | 会话持久化 | ✅ r29 |

> 存档「整份存」：`wall / study / arts / mods / pending / turn.mainId / flags.market` 全在里面。
> 漏存任何一个都能读档刷数值。版本号 `saves.VERSION`，改 state 结构就 +1，**旧档直接丢**。

---

## 3. 数据层当前条目数

```text
seed/ 共 17 份 JSON
  events 42 · actions 7 · arts 12 · conditions 10 · macros 12 · items 24 · spells 10
  identities 10 · templates 2 · talents 1 份（⚠️ 无人引用，见 设计/92 A2）
  schema 1 份（221 字段 / 17 文件）
  rules 20 项（含 TIME / BATTLE / BREAK_GATE / LIFESPAN / MILESTONE）
  calendar · world · limits · ops · invariants
```

---

## 4. 还没做的（按建议顺序）

> 每条的**完整证据**（文档说法 / 代码实际 / 该改哪一行）都在 `设计/92`。
> 这里只排优先级。

### P0 · 先修「文档自相矛盾」，否则改代码就是猜

| # | 事项 | 落点 |
| --- | --- | --- |
| 1 | **心魔成活率方向**（正比 vs 反比）+ **心性地板 60 让心魔永不触发** | `需求/99` 待裁决 → 定完改 `需求/01` §3、`需求/20` §11、`设计/02` §8 |
| 2 | **失败累积上限 +8% vs +0.03** | `需求/00` 全局第 6 条 ↔ `设计/11` §6 |
| 3 | **判定型事件瓶颈被 `force` 跳过**（`SUCCESS.event` 四组常数成死数据） | `设计/92` B6 |
| 4 | **玄阶术法进了坊市**（违反「散修天花板是黄上」） | `设计/92` C5 |

### P1 · 影响所有后续数值

| # | 事项 | 落点 |
| --- | --- | --- |
| 5 | **防御数值统一调整**（用户点名"后面再调"） | `rules.BATTLE` / `spells.json#shield` / `suppressMul`。跑 20 场模拟看回合数（目标 6–12） |
| 6 | **加载期校验** | 新 `src/model/repository/validate.js`：17 份种子交叉引用 + I2/I25 静态拦 |
| 7 | **术法阶位系数与相性**（`gainOf` 现在既没阶位系数也没相性） | `设计/92` C6 |
| 8 | **百艺月入重排**（差 10–40 倍） | `设计/92` D3 |

### P2 · 玩法地基

| # | 事项 | 落点 |
| --- | --- | --- |
| 9 | **权限裁剪补 state**（`publicState` 加 `viewer`） | `设计/92` G1 |
| 10 | **命格 / 天赋 / 年度链**（寿元→气运→心性→心魔，现在只做了寿元） | `设计/92` A1 / A3 |
| 11 | **寿元 = 下限 + 掷骰 + extraLife**（现在只取上限） | `设计/92` B7 |
| 12 | **跨年 `pending` 与城破成链** | `设计/92` F1 / F9 |
| 13 | **灵脉 / `spiritCoef`** | `realm.js` 里还是兜底 1.0 |

### P3 · 内容量（不阻塞）

| # | 事项 | 落点 |
| --- | --- | --- |
| 14 | 术法 10 → 30 门（`设计/30` 目标是 93 条） | `seed/spells.json` |
| 15 | 机缘 4 → 20 条、灾祸 4 → 20 条 | `seed/events.json` |
| 16 | 三禁（血丹 / 炼魂 / 蛊）+ 百艺天赋 40 个 | `设计/92` D1 / D2 |
| 17 | 战斗天赋 T1–T5 阈值 | `state.tally` 已在记，缺判定 |
| 18 | 极境（§9.5）整套 | `设计/92` E6 |
| 19 | 表单增删行 / 地图 hover / 转世 | `public/js/form.js` / `map.js` / 新 `systems/reincarnate.js` |

---

## 5. 断点标记（代码里的 TODO）

```text
src/model/rules/realm.js      灵脉未接，spiritCoef 兜底 1.0；寿元只取上界
src/model/rules/spells.js     gainOf 无阶位系数 / 无相性
src/model/rules/battle.js     极境零实现；伤病单条 25%；护盾 1:1（文档 1:2）
src/model/systems/turn.js     rollYear 缺气运漂移 / 心性衰减 / 心魔 / 城池层
src/model/rules/dsl.js        chance 与 judge 恒真；between / in 未实现
```

---

## 6. 版本流水（一句话一轮）

> 详细改动记录已移到 `docs/README.md` §四；这里只留一句话，方便认版本。

| 版本 | 一句话 |
| --- | --- |
| **r34** | 拳头砸得开气墙，术法撑得住境界；门都摆在明面上，够不着就灰着告诉你差什么。 |
| r33 | 世界上只有一套刻度——**阶 + 品**；术法、百艺、器物、对手全在上面排队。 |
| r32 | 法力归法力、盾归盾；术法四档，入门还不能打；学手艺的门一直开着，价钱写在门上。 |
| r31 | 这一仗打得明白——两边血条一跳一跳地动；切磋点到为止，死斗死了就没了。 |
| r30 | 一年一件大事；修为满了只剩一个按钮；点下去不是掷骰，是把那一关过掉。 |
| r29 | 关掉服务、关掉浏览器，回来还是那个十岁的孩子——连今年桌上那张牌都没变。 |
| r28 | "未入门"被删掉了——先判门，再站上去；站上去以后，修为条才存在。 |
| r27 | "一张卡点一年"变成"五块各管一件事"；满了就别再假装能修。 |
| r25–r26 | 换骨架：断天山脉居中 + 前端重做 + 数值通电。 |
| r24 及以前 | 原型期。旧代码在 `归档/r24-旧版/`。 |

---

## 7. 这轮踩过的坑（别重踩）

| 坑 | 解 |
| --- | --- |
| **`flag` 算子写成 `{flag:'x'}` 会静默丢失** | 两种写法都收；写数据前先看 `effects.js` 的签名 |
| **`effects.runList` 每跑完一条要查 `state.dead`** | 否则人死了还在加军功、写"你从缺口里爬出来" |
| **强制卡放不下会死锁** | 活路必须挂在**主事件卡自己身上**（`renderMain` 的 `stuck` 分支） |
| **"看一眼就改状态"** | `publicList` 里调 `stateOf` 会把没学的术法建成"已学"。读接口先判 `know()` |
| **线性公式代替查表** | 数值一律查 `BATTLE.tables`，表就是文档 |
| **`PROF[level]` vs `PROF[level-1]`** | 是 `level-1`（站在本品练满才破下一品） |
| **`q=0` 也占年度名额** | 置位要放在 `no_wall` 分支之后（`设计/92` B9） |
| **`state.luck \|\| 50` 吞掉合法的 0** | 数值默认一律 `Number.isFinite(v) ? v : 默认` |
| **同名变量撞了** | `const entry` 在 `realm.js` 已存在；测试里 `const opening = require(...)` 会盖掉顶层函数 |
| **把年龄直接拨到 14 会换出强制卡** | 测试里先循环走掉 forced 卡，再断言 |
| 顶栏 `.bar` 与进度条 `.bar` 撞名 | 进度条叫 `.pbar` |
| 本地 curl 全 502 | 探测本地一律加 `--noproxy '*'` |
| 改了 `seed/*.json` 不生效 | `seed.js` 按 **mtime** 失效——应该自动生效，查是不是读的是 `config.get()` 之外的路径 |
| Git Bash 的 `/tmp` 与 Windows node 不互通 | 临时文件放工作区 `.tmp/`（现在 `.tmp` 已清理，只剩 `cdp.js`） |

---

## 8. 文件地图

```text
src/
  index.js                 启动（8787 + pid）
  router/index.js          路由表（14 条 API + /api/config/<file>）
  router/static.js         静态资源
  middleware/session.js    会话 + 玩局 gid
  controller/auth.js       登录 / requireAdmin
  controller/content.js    世界 / 事件 / 配置 / 配置字典
  controller/game.js       手牌 + 结算入口 + 玩家可见状态 + 背包
  controller/serialize.js  ★按 viewer 裁剪（目前只裁事件）
  model/repository/db.js       sqlite
  model/repository/seed.js     磁盘种子（mtime 失效）
  model/repository/saves.js    ★存档：整份 state + 版本号
  model/repository/config.js   ★有效值 = 种子 + 覆盖层
  model/rules/dsl.js       when 求值 + $arg 绑定
  model/rules/mods.js      ★修饰器管线
  model/rules/realm.js     ★公式唯一实现
  model/rules/grade.js     ★阶 + 品
  model/rules/time.js      ★耗时
  model/rules/spells.js    ★术法
  model/rules/arts.js      ★百艺
  model/rules/battle.js    ★战斗
  model/systems/opening.js    ★开局入品
  model/systems/calendar.js   ★战事日历
  model/systems/hand.js       ★手牌六块 + 坊市货架
  model/systems/draw.js       ★事件抽取
  model/systems/effects.js    ★do 的执行器
  model/systems/turn.js       ★回合结算
  model/state/demo.js         开局状态
  model/state/running.js      内存缓存 + 库
  util/http.js                sendJSON / readBody / redirect
  seed/*.json                 17 份数据层
test/smoke.js                 离线断言（73 项）

public/
  index.html game.html login.html admin.html
  js/{data,map,home,game,form,admin}.js
  styles/{base,home,game,login,admin}.css

data/                         运行时生成（dayao.db / server.pid）
docs/                         需求 + 设计（唯一权威）
  README.md                   索引
  需求/ 00 01 02 10 11 12 13 14 15 20 21 30 + 99(待裁决)
  设计/ 00 01 02 03 04 11 12 15 20 21 30 40 90 91 + 92(差异台账)
归档/                          历史版本（含 r24-旧版 旧代码），不参与运行
.tmp/cdp.js                    无头 Chrome 验证脚本（唯一保留）
```

★ = 改动风险最高，动之前先看 `docs/设计/40` 与 `docs/设计/03`。

---

## 9. 巡检命令

**必须带 `--noproxy '*'`**，否则本机代理回 502，看着像服务挂了。

```powershell
node start.js
foreach ($p in @('/','/game.html','/login.html','/admin.html','/api/health','/api/world','/api/hand','/api/has','/api/me','/api/schema')) {
  "{0,-14} {1}" -f $p, (curl.exe -s --noproxy '*' -o NUL -w '%{http_code}' "http://127.0.0.1:8787$p")
}
```

期望：`/ /game.html /login.html /api/{health,world,hand,has,me}` → **200**；
`/admin.html` → **302**、`/api/schema` → **403**（游客）。
