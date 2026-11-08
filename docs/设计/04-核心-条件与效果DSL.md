# 设计 · 04 条件与效果 DSL（公共因素 ②）

> 系统：**0x 全局 · 内容配置层**
> 需求侧：`需求/20`（事件可配）、`需求/14`（资源）、`需求/11`（突破资源）
> 这一份回答一个问题：**"金币 +2""资质 > 80"这种东西，策划怎么填，才不用改代码。**
> 结论：事件、物品、天赋、身份、配方**全部退化成 JSON**；代码只提供**算子**（op）。规则公式锁在 `rules/`，但以**具名判定器**的形式暴露给配置。
> **r23 补一条**：**聚合条件也是数据**（§3.6 `conditions.json`）。条件组、宏、模板三层聚合全部在 `data/`，业务层不知道它们的存在。

---

## 1. 三层分工（谁写什么）

| 层 | 写什么 | 谁改 | 改动频率 |
| --- | --- | --- | --- |
| `rules/` 公式 | 月修为、出现率 `q`、成功基数 `b`、伤害 | 程序 | 低（改数值 = 改常量表） |
| `data/*.json` 内容 | 事件、物品、天赋、身份、配方、文案 | 策划 | **高（每周）** |
| `engine/` 时序 | 年月初序、池子、上桌、跨年 | 程序 | 中 |

**判据**：一句话能说清"什么时候、满足什么、加什么"的，进 JSON；需要"算一个连续函数"的，进 `rules/` 并起个名字给 JSON 调。

---

## 2. 两种 JSON 块：`when` 与 `do`

```json
{
  "id": "evt.road.coin",
  "when": [ { "gte": ["attr.aptitude.eff", 80] } ],
  "do":   [ { "add": ["money.copper", 2] } ]
}
```

- `when` 是**条件数组**，多项之间是 **AND**（写在一行里就是"都要满足"）。
- `do` 是**效果数组**，**按书写顺序执行**。
- 条件永远无副作用；效果永远有副作用。二者不混写。

---

## 3. 条件算子（`when` 里能写什么）

### 3.1 比较类

| 写法 | 含义 | 备注 |
| --- | --- | --- |
| `{"eq": [路径, 值]}` | 等于 | 字符串/布尔/数字都行 |
| `{"neq": [路径, 值]}` | 不等于 | |
| `{"gt": [路径, 值]}` / `{"gte": …}` | 大于 / 大于等于 | **资质 > 80 就是 `{"gt":["attr.aptitude.eff",80]}`** |
| `{"lt": [路径, 值]}` / `{"lte": …}` | 小于 / 小于等于 | |
| `{"between": [路径, 下, 上]}` | 闭区间 | 上下可写 `null` 表示不限 |
| `{"in": [路径, [值…]]}` | 属于集合 | 身份、境界名常用 |
| `{"has": [路径, 数量]}` | 物品/标记 ≥ n | `{"has":["item.xisui",1]}` |

### 3.2 世界与标记

| 写法 | 含义 |
| --- | --- |
| `{"flag": "seen_lixiang"}` | 标记为真 |
| `{"notFlag": "banned"}` | 标记为假 |
| `{"stage": "tai"}` | 学籍阶段（语法糖，等价 `eq education.stage`） |
| `{"realm": {"dao":"qi","gte":2}}` | 境界 ≥ 2 品（`path.qi.level` 的语法糖） |
| `{"zone": "city"}` | 当前场景 |

### 3.3 组合子（这就是"聚合"的第一种）

```json
{ "all": [ … ] }                  // 全真（等价于 when 数组）
{ "any": [ … ] }                  // 任一真
{ "not": { … } }                  // 取反
{ "none": [ … ] }                 // 全假
{ "count": { "of": [ … ], "gte": 2 } }   // 满足 n 条以上
```

嵌套深度上限 **8 层**，超了加载期报错（防止配置写成迷宫）。

### 3.4 随机条件（唯一允许随机的地方）

```json
{ "chance": { "p": 0.15, "luck": true, "label": "三成机缘" } }
```

- **必须显式写 `luck: true` 才吃气运**——这是 I5「气运只做加法与时序偏置」的落地口。默认 `false`。
- `chance` 只用来"事件本身出不出"，**不许**用来决定突破成不成（突破判定走 §5 的具名判定器）。

### 3.5 具名判定器（规则公式的唯一入口）

```json
{ "judge": { "kind": "break", "dao": "qi", "tier": 4 } }
```

`kind` 是注册表里的函数名，参数由 JSON 给。**配置不能写公式**，只能选判定器 + 传参。

| `kind` | 用途 | 参数 |
| --- | --- | --- |
| `break` | 破境判定（`q` → 首次必败 → `b`） | `dao` `tier` |
| `attr` | 属性对抗（`a` vs `b` + 气运） | `a` `b` `scale` |
| `suppress` | 境界压制 | `a` `b` |
| `study` | 求学是否可投 | `dao` `tier` |

### 3.6 条件组：把一串条件起个名（聚合条件，数据层）

**这是用户这轮点名要的东西**：`when` 写十行门槛，八个事件都要用，改一次要改八处。所以条件可以**存成数据、按名引用**：

```json
// data/conditions.json
{
  "cond.break_ready": {
    "params": ["dao", "tier"],
    "all": [
      { "eq":  ["path.$arg.dao.level", "$arg.tierMinus1"] },
      { "gte": ["path.$arg.dao.bar",   "$prof.$arg.dao.$arg.tier"] },
      { "notFlag": "flag.in_seclusion" }
    ]
  },
  "cond.can_join_army": {
    "all": [
      { "realm": { "dao": "qi", "gte": 2 } },
      { "lte": ["clock.age", 40] },
      { "none": [ { "flag": "flag.exiled" } ] }
    ]
  }
}
```

```json
// 事件里只写这一行
{ "when": [ { "use": "cond.break_ready", "args": { "dao": "qi", "tier": 2 } } ] }
```

| 规则 | 内容 |
| --- | --- |
| 引用 | `{"use": "cond.<名>", "args": {...}}`，可嵌套（条件组里再 `use` 另一个条件组） |
| 递归 | **禁止环**（A 引用 B、B 引用 A），加载期检测 |
| 命名 | `cond.*`，写不存在的名字 = 加载失败 |
| 求值 | 与内联 `when` 完全等价，**没有性能差异**（加载期展开成同构 AST） |

**为什么放数据层**：条件组不是公式，是"门槛的组合方式"——它随玩法变，不随数值变。策划加一个"只有四品以上、且不在闭死关、且没有通缉"的门槛，不该找程序。

**和宏的分工**：

| | 条件组 | 宏 |
| --- | --- | --- |
| 管什么 | **什么时候**（`when`） | **发生什么**（`do`） |
| 有无副作用 | 无 | 有 |
| 能否互相调用 | 能（`use`） | 能（`call`） |
| 典型 | `cond.break_ready` | `macro.break.attempt` |

---

## 4. 效果算子（`do` 里能写什么）

### 4.1 数值

```json
{ "add": ["money.copper", 2] }        // 金币 +2
{ "sub": ["money.copper", 2] }        // 扣
{ "mul": ["rate.realm.month.eff", 1.1] }
{ "set": ["path.qi.bar", 0] }
{ "clampAdd": ["attr.heart.eff", -3, 0, 100] }   // 加并钳制
```

> **写 `money` 必须走 `money` 系统**（`{"money":{"copper":2}}`），因为铜/银/金有进位规则；直接 `add money.copper` 只用于"同一货币内的加减"。

### 4.2 修饰器（永久/临时都在这）

```json
{ "mod": {
    "target": "attr.aptitude.eff", "op": "add", "value": 3,
    "duration": { "kind": "permanent" },
    "source": "item.xisui", "stack": "unique"
} }
{ "unmod": "item.xisui" }
```

字段语义见 `03` §3。**这是"洗髓（永久）/ 悟道丹（临时）"在配置里的唯一写法**——差别只在 `duration`。

### 4.3 物品、标记、事件链

```json
{ "grant": { "item": "peiyuan", "n": 1 } }
{ "flag": { "id": "seen_lixiang", "value": true } }
{ "chain": { "event": "evt.lixiang.2", "delayMonths": 12 } }
{ "log": "你服下洗髓丹，经脉如洗。" }
```

### 4.4 控制流（这就是"聚合"的第二种）

```json
{ "if": { "when": [ … ], "then": [ … ], "else": [ … ] } }
{ "each": { "list": "party.members", "as": "m", "do": [ … ] } }
{ "roll": { "table": "loot.t1", "n": 1, "as": "drop" } }
{ "call": { "macro": "break.attempt", "args": { "dao": "qi", "tier": 4 } } }
```

### 4.5 宏：把常用组合打包（"选择逻辑进行聚合"的正式形态）

```json
// data/macros.json
{
  "break.attempt": {
    "params": ["dao", "tier"],
    "do": [
      { "judge": { "kind": "break", "dao": "$arg.dao", "tier": "$arg.tier" } },
      { "if": {
          "when": [ { "eq": ["$last.ok", true] } ],
          "then": [ { "call": { "macro": "break.success", "args": { "dao": "$arg.dao", "tier": "$arg.tier" } } } ],
          "else": [ { "call": { "macro": "break.fail", "args": { "dao": "$arg.dao" } } } ]
      } }
    ]
  }
}
```

**四层复用**（这是"选择逻辑聚合"的完整形态）：

| 层 | 是什么 | 例 | 谁写 |
| --- | --- | --- | --- |
| 算子 | 原子效果 | `add` / `mod` / `grant` | 程序 |
| **条件组 / 宏** | 可命名的门槛组合 / 效果组合 | `cond.break_ready` / `macro.break.attempt` | 主策 |
| **模板** | 带参数的骨架 | `tpl.break.prob` / `tpl.war.city` | 主策 |
| 实例 | 一行参数 + 文案 | `evt.break.potai` / `evt.war.city.beiguan` | 策划 |

策划写事件时只写 `{"call": {"macro": "break.attempt", "args": {...}}}`，公式和副作用都收在宏里，改平衡只改一处。

---

## 5. 判定器 `break` 的契约（写死，配置不许改）

```js
// rules/break.js —— 唯一实现，JSON 只能调用
function judgeBreak(state, { dao, tier }) {
  const path = state.path[dao];
  if (path.bar < PROF[dao][tier - 1]) return { ok: false, why: 'bar_not_full' };
  if (state.turn.breakthroughUsed)     return { ok: false, why: 'one_per_year' };

  const q = appearRate(state, dao, tier);          // 墙出不出现（只掷一次，见 11 §6）
  if (Math.random() >= q) return { ok: true, why: 'no_wall', q };

  path.attempts++;
  if (path.attempts === 1) { path.fail = 0.02; return { ok: false, why: 'first_try', q }; }

  const p = Math.min(0.95, successBase(state, dao, tier) + path.fail
                        + studyBonus(state, dao, tier) + pillBonus(state, dao, tier) + luckAdj(state));
  const roll = Math.random();
  if (roll < p) return { ok: true, why: 'roll', q, p, roll };
  path.fail = Math.min(0.03, path.fail + 0.01 + Math.random() * 0.02);
  return { ok: false, why: 'roll', q, p, roll };
}
```

**返回值统一为 `{ ok, why, ...traces }`**——`why` 既是日志，也是 UI 置灰文案（对应 `20` §8「任何置灰必须有 why」）。

---

## 6. 求值上下文（`$` 变量）

| 变量 | 含义 |
| --- | --- |
| `$self` | 当前结算的角色（默认） |
| `$target` | 对手/被作用者 |
| `$event` | 当前事件对象（`$event.id`、`$event.choice`） |
| `$last` | 上一个效果的返回值（`$last.ok`、`$last.p`） |
| `$arg.*` | 宏参数 |
| `$roll` | 本次掷骰结果（0–1），**同一效果块内复用同一个值** |

> `$roll` 的意义：一个事件里"判定 + 分支演出"必须用同一个随机数，否则读档会漂。

---

## 7. 三个完整例子（从简到繁）

### 7.1 金币 +2

```json
{
  "id": "evt.road.pickpurse",
  "title": "路边拾遗",
  "nature": "chance",
  "priority": 4,
  "weight": 3,
  "months": 0,
  "when": [ { "lte": ["luck", 60] }, { "notFlag": "picked_today" } ],
  "do": [
    { "money": { "copper": 2 } },
    { "log": "你在道旁捡到两枚铜钱。" }
  ]
}
```

### 7.2 资质 > 80 才有资格

```json
{
  "id": "evt.sect.recruit",
  "title": "宗门选徒",
  "nature": "identity",
  "priority": 2,
  "forced": true,
  "months": 1,
  "when": [
    { "gt": ["attr.aptitude.eff", 80] },
    { "gte": ["clock.age", 16] },
    { "none": [ { "flag": "joined_sect" } ] }
  ],
  "choices": [
    { "id": "join", "label": "拜入门下", "when": [],
      "do": [ { "flag": { "id": "joined_sect", "value": true } },
              { "mod": { "target": "reputation.eff", "op": "add", "value": 10, "duration": { "kind": "permanent" }, "source": "sect.join" } } ] },
    { "id": "refuse", "label": "婉拒", "when": [],
      "do": [ { "add": ["reputation.eff", -2] } ] }
  ]
}
```

**为什么 `when` 用 `gt` 而不是 `gte`**：用户的原话是"资质 > 80"，边界取开区间；若策划要含 80，写 `gte`。**边界含义必须在配置里一眼可见**，不留"默认包含"的坑。

### 7.3 立相（判定 + 跨年 + 分支）

```json
{
  "id": "evt.break.lixiang",
  "title": "立相",
  "nature": "bottleneck",
  "priority": 2,
  "forced": true,
  "months": 12,
  "span": true,
  "when": [
    { "realm": { "dao": "qi", "gte": 3 } },
    { "gte": ["path.qi.bar", 900] },
    { "eq": ["education.graduated", true] }
  ],
  "choices": [
    { "id": "try", "label": "引气立相", "when": [],
      "do": [ { "call": { "macro": "break.attempt", "args": { "dao": "qi", "tier": 4 } } } ] },
    { "id": "wait", "label": "再等一年", "when": [],
      "do": [ { "log": "你按住心火，把这一年让给别的事。" } ] }
  ]
}
```

---

## 8. 静态校验（加载期，不是运行期）

| 检查 | 失败后果 |
| --- | --- |
| 路径是否存在（`attr.aptitude.eff` 合法，`attr.gongfa` 不存在） | 拒绝加载该条并报错 |
| 算子是否注册 | 拒绝加载 |
| 引用 id 是否存在（物品/事件/宏/表） | 拒绝加载 |
| 宏递归 / 嵌套 > 8 | 拒绝加载 |
| 条件组成环（A→B→A） | 拒绝加载 |
| `use` 未定义的条件组 | 拒绝加载 |
| 对 `path.*.bar` 写 `mul` | 拒绝加载（违反 I2） |
| `chance` 未写 `luck` | 默认 `false`，并在日志里提示 |
| `when` 为空数组 | 视为恒真（合法） |

**所有错误都发生在启动，不在玩家点下去的那一刻。** 这条是配置化的底线：宁可开不了服，不可玩到一半报错。

---

## 9. 目录与命名

```text
data/
  ops.json            # 算子清单（程序同步生成，只读）
  conditions.json     # 条件组（聚合条件）
  macros.json         # 宏
  templates.json      # 模板（22 瓶颈 / 4 城战共用骨架）
  calendar.json       # 日历（战事、主线节点的绝对年份）
  merit.json          # 贡献兑换表
  limits.json         # 各路径上下限
  events/*.json       # 事件（按域分文件：break / mainline / chance / disaster / identity）
  items/*.json
  talents/*.json
  tables/*.json       # 权重表（掉落、天赋、事件池）
```

**id 命名空间**：`域.对象.名`，小写点分。`evt.break.lixiang`、`item.xisui`、`macro.break.attempt`、`tbl.loot.t1`。

---

## 10. 扩展方式（两类改动分开走）

| 想做的事 | 改哪里 | 动不动代码 |
| --- | --- | --- |
| 加一个事件 / 改一次奖励 / 加一道门槛 | `data/events/*.json` | 不动 |
| 加一种药（永久或临时） | `data/items/*.json` + `mod` | 不动 |
| 加一种"新组合"（如"先扣钱再判定"） | `macros.json` | 不动 |
| 加一种**新效果**（如"改变天气"） | 注册 `op.weather` + schema | 要（一处） |
| 改平衡数值（修为条、`q`、`b`） | `rules/prof.js` 常量表 | 要（一处） |

**新算子的模板**（唯一需要写代码的场景）：

```js
// ops/weather.js
registry.op('weather', {
  schema: { type: 'object', props: { to: { enum: ['rain','drought','snow'] }, months: { type: 'int', min: 1 } } },
  run(state, args, ctx) { state.world.weather = args.to; return { ok: true }; }
});
```

注册后 `data` 里立刻可用，DSL 不变、事件文件不变。

---

## 11. 断言

| 场景 | 期望 |
| --- | --- |
| 事件 `when` 里写 `{"gt":["attr.aptitude",80]}`（漏 `.eff`） | 加载告警：应读 eff，否则忽略洗髓加成 |
| 同一事件里两次 `chance` | 允许，但各自独立掷；需要联动就提到 `$roll` |
| 宏调用深度 9 | 加载失败 |
| `do` 里第 3 条抛错 | 前 2 条已生效，第 3 条记日志并中止该事件（不静默） |
| `money` 为负 | 钳 0，并产出 `debt` 标记（不出现负钱） |
| 事件被 `forced` 且 `when` 为真 | 上第 1 槽，常驻区全灰（见 `20` §6） |

---

## 12. 变更传播：改一处，哪些地方自动跟着变

这一节回答"**代码之间的变动由关联**"——不是靠自觉同步，是靠**只有一个地方存这个数**。

| 你改什么 | 自动跟着变的 | 需要手动做的 |
| --- | --- | --- |
| 修为表 `PROF`（如脏腑 310 → 320） | 所有破境节拍、进度条、模板里的 `when`（`$prof.qi.2`）、人口 | 重跑一次校准脚本 |
| 成功基数系数（0.0030 → 0.0034） | 所有概率瓶颈的 `p`、30 岁人口、事件里的显示 | 重跑校准 |
| 洗髓 `value: 3 → 4` | 面板、突破 `b`、`q`、人口（永久项） | 无 |
| 事件加一条 | 自动进池、自动参与权重归一化 | 无（跑一次校验） |
| 加一个宏 | 所有引用它的事件同时改 | 无 |
| 加一个算子 | 所有事件立刻可用 | 注册表 + schema（**唯一要写代码的场景**） |
| 改一个价格 | 坊市、事件里的 `{"money":…}`、NPC 报价 | 无（都读同一张 `items`） |
| 改一条条件组 | **所有 `use` 它的事件同时变** | 无（跑一次校验） |
| 改 `MILESTONE`（4） | 身份准入、养灵门槛、事件门槛 | 无（三处都读常量） |
| 改日历年份 | 战事、主线节点的触发 | 无（改 JSON 即可） |

**三条"不许"**（违反了就会出现"改了一处、别处还是老值"）：

1. **不许在事件里写死数字**：门槛写 `$prof.qi.2` 不写 `300`；价格写 `$price.peiyuan` 不写 `120`。
2. **不许在 UI 里算**：面板只调 `resolve()`，不算公式。
3. **不许有第二份常量表**：`rules/prof.js` 是唯一来源，`data` 只能引用。

> 判据很简单：**删掉 `rules/prof.js` 里的一个数，游戏应该起不来，而不是悄悄用旧值。**
