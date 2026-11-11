# 开发进度与断点（r40 · 修炼流程修正）

> **这是续作用的唯一入口。** 新开一轮对话时：先读这一份 → 再看 `设计/92-待修清单.md` → 最后回 `docs/`。
>
> **本文件只记「做到哪一步了」。**
> - 代码与文档**差在哪** → `docs/设计/92-待修清单.md`（逐条带 `文件:行`）
> - 需求**要什么** → `docs/需求/`
> - 怎么**接手** → `HANDOVER.md`

---

## ⚠️ 0. 当前阶段：先把逻辑理清，数值全部重推

**r35 起进入"只理机制、不动数值"的阶段。**

所以：

1. **现在不要纠结具体数字**。`rules.json` 里那些成功率、修为总量、寿元区间、丹药加成、
   月修为系数——**全部视为占位值**，不是调好的平衡。
2. **逻辑定稿之后，会统一重新推导数值**（沿用 `设计/15` 的蒙特卡洛 + 三锚点那套方法）。
   在那之前，**任何"这个数是不是太高/太低"的问题都先搁置**。
3. **写代码时的判据是"链路通不通"，不是"数值好不好"**：
   一问「这个机制有没有被触发过」，二问「它触发时改的是不是它该改的地方」。
4. **改数值请只改 `src/seed/*.json`**，别把数字写进 `src/model/**`。

> 一句话：**这一段做骨架和语义，下一段做数字。**

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

## 0.2 r44 定下来的口径（已写进 docs）

| # | 结论 | 落在 |
| --- | --- | --- |
| 1 | **品 5 是两道链**：事件 1「唤醒」必出（年初自动、不占主事件）→ 无认可则唤醒；有认可则直接 `lv=5` | `需求/11` §1.2.2、`systems/recognition.settleWakeUp` |
| 2 | **事件 2「有人记住了你」**：普通进池事件（weight/priority = 2），**被唤醒才进池**，办成 → 认可 + `lv=5` | `需求/11` §1.2.2、`evt.gate.recognized` |
| 3 | **三道共用同一个事件**（锻/炼/养），不是三个；修心只有 4 品，不涉及 | `需求/11` §1.2.2 |
| 4 | **世界认可是永久的、跨道通用**：一道拿到，另两道冲第 5 品时事件 1 直接放行 | `state.recognition.recognized` |
| 5 | **灌顶过的人永久失格** | `state.recognition.fromVoidSoul`、`需求/02` §5 |

---

## 0.3 r42–r43 定下来的口径（已写进 docs）

| # | 结论 | 落在 |
| --- | --- | --- |
| 1 | **事件瓶颈是一个事件，不是一个按钮**：玩家要看得到标题、正文、选项，自己选 | `需求/11` §1.2.1 |
| 2 | **它进池掷骰、不是必出**：`weight = 2`、`priority = 2`，和机缘/灾祸/战事平等竞争 | `需求/11` §1.2.1 ①、`hand.gatesDue` |
| 3 | **`forced` 只是显示类型**：管"抽中之后封住常驻"，**不管优先级** | `需求/11` §1.2.1 ① |
| 4 | **进池资格四条**：事件瓶颈 / 修为满 / `lv < tier` / `BREAK_GATE` 过 | `需求/11` §1.2.1 ② |
| 5 | **抽中后四步推进**：修为满 → 抽中 → 办完 `lv+1` → `lv≥品级` 才出「突破」按钮 | `需求/11` §1.2.1 ③ |
| 6 | **修掉两个真 bug**：gate 事件 `force`→`byEvent`（15 个全废）、按钮替玩家选 `choices[0]` | `需求/11` §1.2.1 ④ |

> **反面用例（别再踩）**：`weight: 0` = 永远抽不到；`priority: 0/1` = 必出；
> 在掷骰前 `return gatesDue()` = 硬插队。三种都试过，都不对。

---

## 0.4 r40 定下来的口径（已写进 docs）

| # | 结论 | 落在 |
| --- | --- | --- |
| 1 | **概率瓶颈一次点击完成判定 + 真实进品**，不再分两次点击；真实突破**每道一年一次**（r40.1 改：不是全局），入门关豁免 | `需求/11` §1.3、§3.0.0、`realm.probabilityBreakthrough` |
| 2 | **事件瓶颈仍分两次动作**：事件只通 `lv`，玩家再手动点真实进品；事件本身不占真实突破名额 | `需求/11` §1.3、§3.0.0、`turn.breakAct` |
| 3 | **11 岁府学炼气学习完成后才开放炼气**；学习事件只解锁、不直接进品，且不要求锻体·脏腑 | `需求/15` §1.1–§1.3、`rules.BREAK_GATE.qi.1` |
| 4 | **普通玩家保留已入品修为 `bar/barMax`**，左栏不得再因权限裁剪显示 NaN | `设计/40` §1.1、`serialize.cropState` |

> **r40.1 追加（本会话）**：第 1 条里的「全局一年一次」**改成「每道一年一次」**。
> 用户口径：「每个瓶颈都是独立的」——锻体今年破过，炼气今年照样能破；
> 但**同一道**一年只能破一次。记账从 `turn.breakthroughUsed`（全局布尔）
> 改成 `turn.brokeThisYear = { body: true }`（按道）。旧档读到时按"全都破过"处理。

## 0.5 r39 定下来的口径（已写进 docs）

| # | 结论 | 落在 |
| --- | --- | --- |
| 1 | **年龄 → 强制事件链**：7 进蒙学(3月) / 10 蒙学毕业(1月) / 11 入感气(6月) / 14 学百艺(6月) / 15 大考(6月) / 16 判太学(1月) / 16 太学学习(6月) / 19 卒业(1月) | `需求/15` §1.1 |
| 2 | **除了"入太学判定"，其他节点都没有"跳过/留校/再读"选项** | `需求/15` §1.2 |
| 3 | **入门关同年可多试，品内小境界一年一次** | `需求/15` §1.3、`realm.raiseLevel` |
| 4 | **人与物两套写法**：人 = `N 阶 M 品`；物 = `N 阶黄/玄/地/天级` | `需求/11` §2.9.0 |
| 5 | **物品适用境界**：向下全有效、高一小品 ×0.1、**跨大阶一律无效** | `需求/11` §2.9.0.1、`grade.itemFit` |
| 6 | **取消「以力驭法」**：术法阶品是它自己的，不随人涨 | `需求/11` §2.9.0.2、`battle.strike` |
| 7 | **委托与每一门百艺挂钩**（12 门各一条线），出城的单会掷路上事件 | `需求/20` §7.4、`seed/commissions.json` |
| 8 | **扣心性的事件三条规矩**：降概率、给正收益、或改强制；**强制事件必须带"只来一次"守卫** | `需求/01` §3.3.1 |
| 9 | **法术列表只画"已学"和"今天真能学"** | `设计/40` §3.2.1 |

---

## 0.6 r38 定下来的口径（已写进 docs）

| # | 结论 | 落在 |
| --- | --- | --- |
| 1 | **游戏从 7 岁开始**（刚入蒙学），不是 10 岁 | `需求/15` §1、`demo.clock.age = 7` |
| 2 | **教育时间线**：7 蒙学 → 11 府学 → **14 选百艺** → **15 大考** → **16 判太学** → **20 卒业/离校** | `需求/15` §1 |
| 3 | **战争延后到 30 岁**，且改成**按角色年龄**触发（不写死年份） | `需求/21` §3、`calendar.json#atAge` |
| 4 | 开局**不白送修为**（那三年还没过） | `opening.js` |

---

## 0.7 r36 定下来的口径（已写进 docs）

| # | 结论 | 落在 |
| --- | --- | --- |
| 1 | **事件瓶颈的载体是事件**，判定按事件走，**不和概率瓶颈一样掷骰** | `需求/11` §1.3、§3.0.0 |
| 2 | **事件瓶颈只更新 LV 层级，不直接突破境界**；突破要手动点 | `需求/11` §1.3、`realm.raiseLevel` / `realm.breakthrough` |
| 3 | **「层级 `lv`」与「境界 `level`」是两个字段**；`lv` 可以超前于 `level` | `realm.js`、`demo.pathState()` |
| 4 | **能突破但不突破是合法玩法**（条件全绿也可以一直不点） | `需求/11` §1.3 |
| 5 | **没涉及到的界面元素整块隐藏**（未入品的境界行不画） | `设计/40` §3.2.1 |
| 6 | **灌顶是普通事件，不是常驻按钮**；前置 = 师承/宗门/人情；**要明示后果** | `需求/11` §7.4、`evt.teach.enlighten` |
| 7 | 修好的界面白屏：`cropState` 裁掉了前端必读字段 | `serialize.js`、`game.js` |

## 0.8 r35 定下来的口径（已写进 docs）

| # | 结论 | 落在 |
| --- | --- | --- |
| 1 | **心魔**：心性 **0–39 触发**，存活率**与心性成正比**，**0 → 0**、**39 → 0.1** | `需求/01` §3.5、`设计/02` §5 |
| 2 | **心性衰减是定时任务**：未入修心且 **心性 > 60** 才递减；**≤ 60 停止** | `需求/01` §3.2 |
| 3 | **事件可以改心性**（此前漏写）——正常人不会遇心魔，但做了某些事就会 | `需求/01` §3.3、`需求/20` §11 |
| 4 | **问心关失败也扣心性**（此前漏写） | `需求/11` §6.3、`需求/01` §3.4 |
| 5 | **修心的门是一次性的**：入门判定一次，之后不再重判 | `需求/11` §6.2 |
| 6 | **心性 ≥ 90 是"突破判定"的门槛**；**< 90 则突破必然失败** | `需求/11` §6.1 |
| 7 | **灌顶 = 加大成功率，基本等同保送** | `需求/11` §7.4 |
| 8 | **属性上限要有**（三层加法，满值可达 200） | `需求/01` §2.1 |
| 9 | **层级制与修为条互补**：先判层级（瓶颈）→ 进门 → 攒修为 → 条满再判下一层 | `需求/11` §1 |
| 10 | **失败叠加成功率有硬上限 0.1** | `需求/11` §3.0.1 |
| 11 | **法术四档** 0 / 0.85 / 1.0 / 1.15；**品级只有黄级分上中下** | `需求/12` §0.1 |
| 12 | **法术来源四条**：学堂 / 坊市 / 城主府 / **奇遇事件** | `需求/12` §0.1.2 |
| 13 | **跨年事件先不做** | `需求/20` §4.3 |
| 14 | **隐藏属性 / 寿命只给 sysadmin** | `设计/40` §1.1、`设计/92` G1 |
| 15 | **命格 / 天赋 / 年度链（A1/A2/A3）按设计做** | `设计/01` §1、`需求/01` |
| 16 | 缺事件导致链路不通时，**可以自行补事件** | `src/seed/events.json` |

---


## 1. 现在能不能跑

**能。** `node start.js` → `http://127.0.0.1:8787`

| 项 | 状态 |
| --- | --- |
| `node test/smoke.js` | **80 通过 / 0 失败**（2026-11-10 实测，Node v24.16.0） |
| 首页 `/` | ✅ 地图 + 三入口（填名 / 继续这一世 / 开始新游戏） |
| 游戏页 `/game.html` | ✅ 六块：今年的事 / 修炼 / 法术 / 百艺 / 营生 / 坊市；左栏有「囊中」 |
| 登录 `/login.html` | ✅ `sysadmin/sysadmin`、`user/useradmin` |
| 配置页 `/admin.html` | ✅ 表格 / 表单；中文名列头 + 只读格灰掉 + 算子带中文释义 |

---

## 1.1 r39 这一轮做了什么

**主题：年龄链、物品代差、委托挂百艺、心性事件去坑、法术分栏、文档清理。**

| 做的事 | 落点 | 实测 |
| --- | --- | --- |
| **7/10/11/14/15/16/19 岁强制事件链** | `evt.edu.enter.meng` … `evt.edu.graduate.tai` | 模拟里逐个走到，没有跳过 |
| **删掉"留校/再读/称病"选项** | 同上，每个节点只剩 1 个选项 | 只有「入太学判定」有 2 个分支 |
| **14 岁学百艺**：任选一门（9 个分支） | `evt.art.choose` | 选完就 `arts.<x>.learned = true` |
| **入门关可多试 / 品内一年一次** | `realm.raiseLevel` 的 `triedYear` | 入门连试 3 次都放行；品内第二次 `one_per_year` |
| **物品代差 `itemFit`** | `grade.itemFit` + `battle.strike` | 罗汉拳：体魄 1.0 / 脏腑 0.1 / 调息 0 / 炼气 0 |
| **取消以力驭法** | `battle.strike` | 炼气 3 品拿黄中术法 → 只剩一成 |
| **委托挂 12 门百艺** | `seed/commissions.json` + `systems/commission.js` | 没学手艺 0 条；学了丹道出 1 条 |
| **心性事件去坑** | `evt.heart.crime/betray` 等 | 降概率、全给正收益、betray 改强制 |
| **法术分两栏** | `hand.spellPractice` / `spellLearn` + 前端 | 7 岁只看到「练 罗汉拳」，「学」为空 |
| **文档清理** | 删 `92-实现差异台账`、删 `需求/99`，新 `设计/92-待修清单` | 29 条未修项，逐条核实过 |

### 这一轮踩的坑（都写进 docs 了）

1. **强制事件没加"只来一次"守卫** → `evt.heart.betray` 改成 forced 后**每年 −12**，
   心性 20/21/22/23 一路到 0，**30 岁前被心魔带走**。
   已修：`when` 加 `none:[flag]`，并在 `需求/01` §3.3.1 补第④条。
   **测试已守住这条**（`r39 心性事件：扣心的必须有正收益 + 只来一次`）。
2. **改测试文件时用下标切片，把 1200 行切成 255 行** —— 后来从 git 恢复。
   教训：**批量改测试要用"花括号配平找结尾"，不要用正则找 `});`**。
3. **两个服务抢同一个 sqlite 库** → 写入失败、`act` 返回 `ok=false`。
   测试时用独立 PORT，**别动正在跑的那个**。
4. **`fresh()` 没清 `arts`** → 随机天赋把某门百艺设成"已学"，
   百艺测试偶发失败（5 次里中 1 次）。已修：`fresh()` 现在把 `arts` 全部重置。
5. **`payload()` 漏了 `events` 字段** → `/api/hand` 的 `events` 恒为空数组。
   现在补上，且与 `main` 保持一致。
6. **`publicState()` 没发 `lv` / `levelReady`** → 前端拿不到"这道门通了没有"，
   没法显示「突破」按钮。现在两个都发了。

---

## 1.2 r38 这一轮做了什么

**主题：开局 7 岁、教育时间线对齐、战争改按年龄、查清心性为什么"掉得快"。**

| 做的事 | 落点 | 实测 |
| --- | --- | --- |
| **开局 7 岁** | `demo.clock.age = 7`、`opening.START_AGE = 7` | 开局文本"第一天进蒙学" |
| **不白送修为** | `opening.js` 删掉 `bar = cap * 0.45` | 开局 `body.bar = 0` |
| **蒙学卒试 10→11 岁** | `evt.edu.graduate.meng` | 7 岁不出、11 岁出 |
| **府学卒业 14→15 岁** | `evt.edu.graduate.fu` | 与"大考 15"对齐 |
| **战争改按年龄** | `calendar.json` 用 `atAge`；`calendar.js` 读 `clock.age` | 30 岁预警、31 岁城战 |
| **`pass()` 兜底翻年** | `turn.pass()` | 月份满时不再卡死 |

### 心性排查结论（用户问"怎么掉这么快"）

**定时衰减没问题。** 一局实测：

```text
7 岁 心性 72  →  每年 −1（在校）  →  19 岁到 60  →  停住
86 岁寿终，心性仍 60，终身无心魔
```

三条线都验过：在校 −1、离校 −2、**触底钳 60 不再降**、入修心后完全不扣。

**真正能扣到 40 以下的只有事件**（`evt.heart.crime` −8 / `evt.heart.betray` −12 /
`evt.art.forbidden` −10）——这是**设计意图**："正常人不会遇心魔，但做了某些事就会"。

**"三四十岁嗝屁"的两个真凶**（都不是衰减）：

1. `pass()` 在月份已满时不翻年 → 年份不推进，看起来像"突然死了"；
2. 旧存档（7 岁开局前的 `dayao.db`）读进来后年龄与时间线对不上。

> **测之前建议先删 `data/`**（或点「开始新游戏」），否则读的是按老时间线存的档。

---

## 1.3 r36 这一轮做了什么

**主题：把「层级」和「境界」拆开，并修掉权限裁剪导致的界面白屏。**

| 做的事 | 落点 | 实测 |
| --- | --- | --- |
| **拆出 `lv`（层级）与 `level`（境界）** | `demo.pathState()`、`realm.raiseLevel` / `realm.breakthrough` | 冲关后 `lv=2 / level=1`（层级超前，境界不动） |
| **事件瓶颈按事件判定**，不掷 q/b | `realm.raiseLevel({byEvent:true})` | 事件办成 → `lv=5`，**修为条不清** |
| **突破是玩家手动动作**（一年一次） | `realm.breakthrough` | 点一次才进品、才清条 |
| **能突破但不突破** | `hand.breakCards` 的 `levelReady` | 卡②显示「脏腑 · levelReady=true」，点不点随玩家 |
| **未入品的境界行隐藏** | `public/js/game.js` 的 `renderPaths` | 只画 `level > 0` 的道 |
| **灌顶改成普通事件** | `evt.teach.enlighten`（`nature: 机缘`） | 前置 = 师承/宗门/人情；`hint` 明示全部代价 |
| **修好界面白屏** | `serialize.js` + `game.js` 容错 | 玩家无 `attr`/`lifespan` 时整块不画，不再抛错 |

**白屏的原因**（记下来，别再踩）：r35 给 `cropState` 裁掉了 `attr`/`lifespan`/`luck`，
但 `game.js` 的 `renderChar()` 直接读 `S.attr.aptitude` —— **`S.attr` 是 `undefined`，
抛异常后整个 `renderAll()` 中断**，页面就空了。
**教训：服务端裁剪一个字段之前，先 grep 前端有没有读它。**

---

## 1.4 r35 那一轮做了什么

**主题：把「心性 / 心魔 / 修心 / 属性上限 / 法术来源」这套因果链接上，并做权限裁剪。**

| 做的事 | 落点 | 实测 |
| --- | --- | --- |
| **心性三条线**：定时衰减（只到 60）/ 事件 / 心关失败 | `realm.heartDecay` / `heartClashFail`、`turn.rollYear` | 心性 61 → 60 → 不再降 |
| **心魔完整判定**：0–39 触发、**存活与心性成正比**、活下来 −5 且修为清零 | `realm.rollDemon` / `demonSurvive` | 39→0.100、20→0.051、**0→0** |
| **心性 < 90 修心突破必然失败** | `judgeBreak` 返回 `heart_low` | 心性 89 拒、90 放行 |
| **失败累积上限 0.10** | `rules.SUCCESS.failCap` | 失败 10 次 = 50 次 |
| **`q=0` 不占年度名额** | `breakthroughUsed` 置位挪到 `no_wall` 之后 | — |
| **`force` 也吃「一年一次」** | `judgeBreak` | 15 条 gate 事件不能再同年连破 |
| **灌顶** +0.5（基本保送，一次性） | `rules.ENLIGHTEN`、`path.enlighten` | — |
| **属性上限三层**（出生/命格/事件/永久/临时 → 200） | `rules.ATTR_CAP`、`state.attrCaps` | 单项 100 / 总量 200 |
| **命格 + 天赋**真的进面板 | `demo.js` 抽 `fate`/`talents`，`talents.json` 的 `mods[]` 变成永久修饰器 | `tal.shenli` → 资质 +8 |
| **年度链按 I7 重写** | 寿元 → 气运漂移 → 心性衰减 → 心魔 → 战事 | 一年后 `heart −1`、`luck` 回 50 一格 |
| **法术四条来源**（加奇遇） | `spells.sourceOf` 的 `chance` 分支 | 玄 → 城主府；地/天 → 奇遇 |
| **玄阶不许进坊市** | `rules.SPELL_SHELF.max = 3` 硬校验 | 落石术不再可买 |
| **权限裁剪到角色卡** | `serialize.cropState` | 玩家 JSON 里没有 `attr`/`lifespan`/`luck`/`fate`/`bar` |
| **新增两个算子** | `learn`（学会术法）、`random`（按概率掷） | 心关 30% 实测 0.293 |
| **补 6 条事件 + 2 个宏** | `events.json` no 45–50、`macros.json` | 每条都跑过 |

**为什么补这些事件**：原来的数据层里**没有任何东西能把心性压到 40 以下**
（`evt.heart.firstblood` 只 −3，`evt.art.forbidden` 只 −4），
所以"心魔"这条规则写完也永远触发不了。补了 `evt.heart.crime`（−8）、
`evt.heart.betray`（−12）之后，**这条链路才真的通**。

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

### P0 · ~~先修「文档自相矛盾」~~ ✅ r35 已全部结清

| # | 事项 | 状态 |
| --- | --- | --- |
| 1 | 心魔成活率方向 + 心性地板 | ✅ 定为正比、地板只管定时任务（`需求/01` §3） |
| 2 | 失败累积上限 +8% vs +0.03 | ✅ 定为 **0.10**（`需求/11` §3.0.1、`rules.SUCCESS.failCap`） |
| 3 | 判定型事件瓶颈被 `force` 跳过 | ✅ `force` 也吃「一年一次」；事件瓶颈本身仍不掷骰（`需求/11` §1.3） |
| 4 | 玄阶术法进了坊市 | ✅ 三门玄改城主府/奇遇；加 `SPELL_SHELF.max = 3` 硬校验 |

### P1 · 影响所有后续数值（**要等数值重推那一轮再动**）

| # | 事项 | 落点 |
| --- | --- | --- |
| 5 | **防御数值统一调整**（用户点名"后面再调"） | `rules.BATTLE` / `spells.json#shield` / `suppressMul`。跑 20 场模拟看回合数（目标 6–12） |
| 6 | **加载期校验** | 新 `src/model/repository/validate.js`：17 份种子交叉引用 + I2/I25 静态拦 |
| 7 | **术法阶位系数与相性**（`gainOf` 现在既没阶位系数也没相性） | `设计/92` C6 |
| 8 | **百艺月入重排**（差 10–40 倍） | `设计/92` D3 |
| 8.1 | **求学的「每年 2 次」**（`teachCap` 0.06/0.12 永远吃不到，现在只能 +0.03） | `设计/92` B8 / F12 |

### P2 · 玩法地基

| # | 事项 | 状态 |
| --- | --- | --- |
| 9 | 权限裁剪补 state | ✅ r35（`serialize.cropState`） |
| 10 | 命格 / 天赋 / 年度链 | ✅ r35（A1/A2/A3 全部按设计做了） |
| 11 | **寿元 = 下限 + 掷骰 + extraLife**（现在只取上限） | ⬜ 待做（`设计/92` B7） |
| 12 | **跨年 `pending` 与城破成链** | ⬜ **r35 明确暂缓**（用户：跨年事件先不弄） |
| 13 | **灵脉 / `spiritCoef`** | ⬜ 待做（`realm.js` 里还是兜底 1.0） |
| 13.1 | **`chance` / `judge` 作为条件恒真**（`dsl.js:103-104`） | ⬜ 待做（当前数据层没用到，但迟早会踩） |
| 13.2 | **`between` / `in` 条件算子未实现**（`ops.json` 已登记） | ⬜ 待做（`设计/92` F6） |

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
test/smoke.js                 离线断言（83 项）

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
