# 复审 G1 修复 1（task 1823）：B1–B5 与覆盖率差距拆分

审查人：task 1828（claude-p）。被审分支 `fleet/task-1797`，提交 `9644d33..eb1ac4a`（6 个）。
上一轮审查 `findings/review-task-1816.md` 判 FAIL（B1–B5）。
规格：`game-G1-fix1.md`、`review-G1-fix1.md`、`reviewer-generic.md`（`/var/tmp/fleet-specs/pocket-tuxemon/`）。
临时脚本与日志都在 `/var/tmp/fleet/1828/`：`gates.sh`、`mutations.log`、`logs/*.log`、
`probe/`（插桩副本）、`k1probe/`（vendor 指向组件仓 `d8324b0`）、`mut/`（变异沙盒）。

## 结论先行

1. **B1–B5 都按修复规格修好了**，且我自己的探针复核过：
   - M1 变异（disposition 恒为 dropped）现在会打红测试。
   - `spyder_cotton_cafe` 可以走动。
   - `leather_town → flower_city` 落点可走。
   - 开关关闭时，产物与 B5 之前的提交逐字节相同；开关打开时两遍构建一致。
2. **门禁全绿**：
   - `bun run import` 两遍 4 个产物哈希一致，也与 G1.md 一致。
   - `bunx tsc --noEmit` 0；`bun test` 13 pass / 0 fail。
   - Spyder 开场 60/30/20 Hz 各 11/11。
3. **覆盖率数字如实**：用插桩逐条复算，与报告完全相等。差距 147 次动作、1,062 次条件，拆成四类：
   - **(a) Tuxemon 本来就不执行**：11 / 11。
   - **(b) 转换器该补没补**：2 / 2。只有 `cotton_misa_house`（Xero 线）一处 `char_gender`，**不在主线上**；修了也只是换成另一个变体被丢，指标净变化 0。
   - **(c) 等 K1/K2**：0 / 2。这是打开全部开关后实测的数，不是估的。
   - **(d) 按 S1/P1 计划本来就不做**：134 / 1,047。其中 885 次条件是 P1 静默的野外遇敌；其余是 P2 怪物状态、P1 不会输、无时钟、展示层等。
   - 这一类任务单里没有列出；它们都有 S1 §5/§7 或 G1 规格的明文规则，不是转换器欠的账。
4. **S1 底线在「按转换路径记账」下达不到，这是口径造成的**。S1 的 45.9% / 53.0% 是按类型普查，
   把 S1 自己的 P1 规则会整事件丢弃的规则也算了进去（遇敌、输的分支、日期台词……）。
   即使 K1/K2 开关全开，T1 也只有 6,099 / 3,531（44.79% / 40.76%）。建议改写这条验收，见「建议」一节。
5. 另外有几个**打开开关之前必须先修的问题**，对这一轮不阻断：
   - `areas` 开了会让同格叠放事件互相吞掉。实测主线 Paper Town 妈妈的任务对话丢了。
   - `inputLock` 开了会让 `tuxe_mart_taba` 永久锁住输入。
   - 用当前钉住的 schema 跑全量导入时，任何改变产物的开关都会让校验器栈溢出。

判定：**PASS**。没有阻断项；非阻断项和开开关之前的先决条件见后文。

## 阻断项

无。

按判定原则：(a)(c) 不阻断；(b) 只有 `char_gender` 一处，在 `cotton_misa_house`。
S1 `mainline.json` 的 Spyder 可达 99 张图里没有这张，所以主线上的 (b) 为 0。
(d) 类在主线上的条目（动作 58 次、条件 533 次）我逐个看过写状态的那些事件，没有一个卡住主线推进，见 §2.4。

## 1. B1–B5 逐条核对

| # | 要求（`game-G1-fix1.md`） | 判定 | 证据 |
|---|---|---|---|
| B1 | T1 只数 disposition ∈ {native, degraded}；`meetsBaseline` 据此判定；加会被 M1 打红的测试；数字如实 | **成立** | `importer/coverage.ts:116-117`（按 disposition 过滤）、`:146`（`meetsBaseline: tier1Uses >= baseline.uses`）；`tests/importer.test.ts:28` 钉了 tier1 6,099 / 3,529、`meetsBaseline:false` 和 `char_face` 等逐类计数。变异 M1、M1b、M1c 都变红（§3） |
| B2 | 转换过程记账；删静态表；`rows` 键不截断 | **成立** | `project.ts:148-234`（`EventCoverage`/`ConversionCoverage`，整事件丢弃时 `dropAll`），`coverage.ts` 只剩 T1 成员表。插桩复算 `trace N/D/P/X` 与报告逐项相等（`logs/gap-v1.log`：动作 6161/2822/433/4201、条件 3529/1238/850/3046）。`import-report.json` 有 193 行、193 个唯一键。变异 M1e（`dropAll` 空操作）变红 |
| B3 | 无条件、无行为的源事件丢弃并计 Dropped；回归测试：cafe 可动 | **成立** | `project.ts:1055-1060`；与 Tuxemon `eventengine.py:244`（`if not all_conditions: return`）一致。6 个惰性事件都丢了（`rows`：`trigger:inert(no conditions or behavior)` 6）。`probe/cafe.ts`：从 (8,10) 走 600 帧到 (5,3)，阻塞 fiber 0/600（上轮 599/600）。`probe/frozen.ts` 263 张图只标出 `taba_ba_br_2/3`，都是正常长独白（3,000 帧台词序列，`probe/br2.ts`）。变异 M2、M2b 变红 |
| B4 | 夹取后不可走就用确定性 BFS 找最近可走格；测试：落点至少一个方向可走 | **成立（有保留）** | `project.ts:614-650`、`:859-881`；落点 (39,0)→(38,3)，测试 `importer.test.ts:191`。变异 M3（去掉 BFS）变红。保留见非阻断 5：(38,3) 在一块 132 格的区域里，唯一出口是去 `route5` 的传送，走不到城里其他地方（不卡死） |
| B5 | `ImportOptions`，默认全关时 v1 字节不变；每个开关一个最小单测 | **成立（有保留）** | `project.ts:44-84`，7 个开关、`--kit=v2`。关闭时：B5 之前的提交 `426de45` 全量构建出的 4 个哈希与现在完全一致（`/var/tmp/fleet/1828/pre-b5`）。打开时：每个开关两遍构建都一致，并且确实产出新构造（§4）。K1 开关对**已合并的 K1 schema（组件仓 `d8324b0`）**全量 0 错误。保留：「默认保持 v1 字节」这条测试是恒真式（M5b 仍绿）；「只需打开开关」还不成立（非阻断 1–3） |
| 顺手修 | 宽高为 0 的事件；`shapes.ts` 过时头注释；`rows` 截断 | **成立** | `project.ts:1061-1066`（`tt_paper_town` 事件，计 Dropped）；`importer/` 里已没有 "not product code"；`rows` 见 B2 |

**验收（`game-G1-fix1.md`）**：

| 条目 | 判定 | 证据 |
|---|---|---|
| import 两遍哈希一致 | 成立 | 见 §5 |
| schema 0 错 | 成立 | 见 §5 |
| 传送 0 失效 | 成立 | 见 §5 |
| Spyder 开场 60/30/20 Hz | 成立 | 见 §5 |
| `tsc` 0 | 成立 | 见 §5 |
| `bun test` 全绿（含新增回归与变异测试） | 成立 | 见 §5 |
| G1.md 与 G1-coverage.md 为真实数字 | 成立 | 我逐项核对了 G1.md 的产物统计：263 图、175,093 格、5,443 事件、24,321 命令、1,285 传送、635 个战斗占位、175 精灵、50 道具、14 格可移除碰撞，全部与 `dist/project.json` 相符；覆盖率数字也相符 |
| `vendor` 未提交 | 成立 | `git diff --stat 55358c1..HEAD -- vendor` 为空；`git ls-tree HEAD vendor/` = `160000 commit 5dd48ef`；子模块工作区干净 |
| 不 push | 成立 | 本地分支无上游，`git branch -r` 里没有 task-1797 |

## 2. 覆盖率差距拆分（专项 2）

### 2.1 方法

插桩副本 `probe/importer/`（`probe/patch.ts` 只加记录，不改行为）逐条输出覆盖率条目，记下三样东西：

- 所在源事件；
- 被选中的物化地图；
- 整事件被丢弃时的**根因**：恒假守卫是哪几个条件，空转换丢掉了哪些动作类型。

差距条目的定义：类型属于 S1 T1、但处置不是 Native/Degraded 的条目。一共 147 + 1,062 条，与报告的差值完全吻合。

主线的定义：S1 `mainline.json` 里 Spyder 可达的 99 张图，加上 `spyder.yaml` 剧本事件。

每个根因都对照了 Tuxemon 源码和 S1 §5/§7 的 P1 规则。脚本 `probe/classify.ts`，
结果在 `logs/gap-classified.txt`，逐条明细在 `gap-entries.json`。

### 2.2 结果

| 类 | 根因 | 动作 | 条件 | 其中主线 动作/条件 |
|---|---|---:|---:|---:|
| (a) | `battle_menu.yaml`：只被开始画面的快速对战加载（`tuxemon/states/start.py:193`），没有任何地图加载它，所以不属于世界 | 5 | 10 | 0/0 |
| (a) | 惰性事件（无条件无行为，`eventengine.py:244`）：`spyder_cotton_cafe` "Rand facing" | 4 | 0 | 4/0 |
| (a) | 宽高为 0 的 TMX 事件：`tt_paper_town` "Teleport to Sea Route" | 1 | 1 | 0/0 |
| (a) | `char_wander` 的目标 NPC 在该图上没人创建（上游数据错）：`spyder_leather_museum` "Create Miner" | 1 | 0 | 1/0 |
| **(a) 小计** | | **11** | **11** | 5/0 |
| (b) | `is char_gender player,male` 被折叠成假，可 boot 页固定选的是 `gender_male`；Tuxemon 此时为真（`start_tuxemon.yaml:76`，`char_gender.py:52`）：`cotton_misa_house` "Talk Granny Male" | 2 | 2 | **0/0** |
| **(b) 小计** | 修了只是改由 "Talk Granny Female" 被丢（两个变体的 T1 组成相同），指标净变化 0 | **2** | **2** | **0/0** |
| (c) | 事件体只有 `pathfind` 和对别的 NPC 的 `char_face`，打开 K2 `routes` 就会产出：`professor_lab` "wemoving"、`route1` "move bob" | 0 | 2 | 0/0 |
| **(c) 小计** | 实测：K1/K2 全开，T1 动作 6,099 不变，条件 3,529 → 3,531 | **0** | **2** | 0/0 |
| (d) | P1 静默野外遇敌（S1 §7、G1 规格「`random_encounter` 不做事」），事件体为空 | 0 | 885 | 0/448 |
| (d) | 同上：以 `check_char_parameter player,moving,1` 为守卫的遇敌事件 | 0 | 5 | 0/5 |
| (d) | 怪物、队伍、账单、计步、冲浪状态守卫（T3/P2，S1 §5 规定折叠为常量） | 37 | 23 | 25/23 |
| (d) | `has_kennel`（PC 箱 "Kennel"），见 §2.3 | 7 | 4 | 7/4 |
| (d) | 事件体只有治疗、PC、图鉴、冲浪、战斗背景（T3/P2） | 0 | 67 | 0/23 |
| (d) | P1 不会输、没有瘟疫（S1 §7：lost/draw、`char_defeated player`、`party_infected some/all`） | 42 | 13 | 19/8 |
| (d) | 没有时钟和叠加层（T2-17：固定白天，日期为假） | 30 | 15 | 0/6 |
| (d) | 事件体只有展示层（T4 / T2-13 / T2-15 开局外观） | 0 | 16 | 0/6 |
| (d) | 金额比较用了变量（T2-16） | 11 | 3 | 0/0 |
| (d) | 按玩家名 `ApexPlayer` 触发的作弊码；P1 固定名字 Red（T2-14） | 4 | 4 | 4/4 |
| (d) | 精灵状态（T2-15）：闪回后恢复默认外观的守卫；`set_template` 已被丢，所以永不适用 | 1 | 6 | 1/6 |
| (d) | 事件体只有商店（T2-10 → K4，不属于 K1/K2） | 0 | 6 | 0/0 |
| (d) | NPC 背包（T3） | 1 | 0 | 1/0 |
| (d) | 传送之后的 `wait 0.1`（淡出期间，无可见效果）：`spyder_candy_inn2` "Bee Event Buzzing" | 1 | 0 | 1/0 |
| **(d) 小计** | | **134** | **1,047** | 58/533 |
| **合计** | | **147** | **1,062** | |

### 2.3 需要说明的归类

- **`has_kennel` 归 (d)，不归 (b)**。S1 §5 的备注写「kennel count 0」，照这个说法 "Box Empty"（`spyder_candy_cafe.yaml:65`）应该为真。
  但 Tuxemon 的实际语义不同：
  - "Kennel" 箱只有两种情况会创建：打开过 PC（`states/pc.py:61`），或者 quarantine 时队伍满了（`quarantine.py:118`）。
  - 箱子不存在时 `has_kennel` 抛异常（`has_kennel.py:47`），`RunningCondition.check` 捕获后返回假（`running.py:284`）。
  - P1 丢掉了 PC（`access_pc`）和 quarantine，箱子永远不会存在，所以 Tuxemon 里两个 cafe 事件都不会触发。
    导入器「两个都为假」正好是这种状态。
  - 即使按 S1 的备注处理，这一幕也不卡主线：`cafe_done` 只被这两个事件自己读；
    `spyder_candycafe_nora` 全库没人创建；cafe 的 "Go Outside" 要求 `party_size > 0`，P1 从拿到初始怪起就满足。
- **`check_char_parameter` 分两种**。`player,moving,1` 都是遇敌守卫，事件体是 `random_encounter`。
  `player,name,ApexPlayer` 是作弊码，它的非作弊版本（`spyder_wayfarer_inn1` object 54，`not check_char_parameter …`）照常产出。

### 2.4 主线上的 (d) 会不会卡主线

`probe/mainstate.ts` 列出主线上被整事件丢弃、又会写状态的 8 个事件（`logs/mainstate.log`）。结论如下：

| 事件 | 结论 |
|---|---|
| Candy Town "After infected" / "Seen Candy + Infected" | P1 走「未感染」分支。"Seen Candy + Not Infected" 同样写 `confiscation_done:yes` 和 `henrik_react:start` |
| `spyder_cotton_tunnel` "Talk Benden Captured" | "Talk Benden Not Captured" 同样写 `cottontunnelbenden:yes` |
| `spyder_dojo1` 各个 stage 变体 | "No Stage" 变体照常对话；道场训练是怪物服务，属 P2 |
| cafe 两个 Box 事件 | 见 §2.3 |
| 作弊码 | 非作弊版本照常产出 |
| `spyder.yaml` "Not surfable" | 写 `swimming:no`；P1 不游泳 |

结论：没有一个是主线推进必需的写入。

### 2.5 其他账目（都是高估，量很小）

- `spyder_test_map` "Box2"：对话对象从没被创建。计了 3 个 T1 Native，但永不执行。
- `water_underwater` "Water Gemuar Battle"：用了不存在的条件 `player_facing_tile`。Tuxemon 求值时抛异常、被捕获后为假（`running.py:284`），所以永不执行。
  导入器把它导成了 action 事件（非阻断 7），计了 2 个 T1 Native。
- `tuxe_mart_taba` "professor pls"：过场在第一句对白后就被取消（非阻断 2），后面约 5 个 T1 条目计了 Native 却不执行。

合计约 10 条，不到全部 22,280 次使用的 0.1%，不影响结论。

## 3. 变异检查（沙盒 `/var/tmp/fleet/1828/mut`，改完即还原；原始日志 `mutations.log`）

| # | 改坏的地方 | 结果 |
|---|---|---|
| M1 | `dispositionFor` 恒返回 `"dropped"`（上轮的 M1） | **红**：2 fail（all maps pass schema…、ImportOptions.localReset） |
| M1b | 把 B1 改回按类型计 T1 | **红** |
| M1c | `meetsBaseline: true` | **红** |
| M1e | `dropAll` 空操作 | **红** |
| M2 / M2b | 去掉惰性事件规则 / 宽高为 0 规则 | **红**（cafe 测试） |
| M3 | 去掉 BFS，直接用夹取格 | **红**（clamped transfers） |
| M3b | 可走判定不再要求有可走邻格 | 绿：本例的夹取格本身就被挡，这半条判定没被测到（小事） |
| M5 | 默认 `localReset: true` | 红（覆盖率计数），但「默认保持 v1 字节」测试仍绿 |
| M5b | 默认 `areas: true`，只跑「默认保持 v1 字节」 | **绿**：这条测试把默认值和默认值比，是恒真式。全量跑时另外 4 条测试变红（全量构建触发了校验器崩溃，见非阻断 3），所以默认值漂移仍会被间接发现 |
| M6 | `inputLock` 分支失效 | **红**（inputLock 测试） |
| M4 | 从产物删掉 `spyder_route1` 再跑 smoke（上轮遗留） | 仍 PASS（接受「请求了传送但失败」），非阻断 8 |

## 4. K1/K2 开关实测（专项 1 的延伸）

组件仓 `main` 已合入 K1（`cffd2d5`，现在是 `d8324b0`），K2 还没合。我把 `d8324b0` 的 `src/` 解到 `/var/tmp/fleet/1828/kit-d8324b0`，
让 `k1probe/` 的 vendor 指向它，这样可以用**真的 K1 schema 和 K1 引擎**检验开关。

### 4.1 每个开关的产物差异

`logs/optdiff.log`：每个开关单独打开、全量 263 张图、构建两遍。

| 开关 | 两遍一致 | 新构造 | 序列化长度（字符） |
|---|---|---|---:|
| 默认 | ✓ | — | 17,076,588（文件 17,076,730 字节） |
| `areas` | ✓ | 362 个 w/h 事件；事件 5,443 → 4,639 | 15.8 MB |
| `facing` | ✓ | 1,257 个 facing 条件（放在 `all` 里） | 17.2 MB |
| `condAll` | ✓ | 2,178 个 `all` 条件 | 9.9 MB |
| `localReset` | ✓ | 产物不变，只改处置 | 17.1 MB |
| `place` | ✓ | 1,484 个 `place` 命令、303 个页 `dir` | 21.3 MB |
| `inputLock` | ✓ | 722 个 `lockInput`、685 个 `unlockInput` | 17.2 MB |
| `routes` | ✓ | 2,037 条指向事件的路线；`pathTo` 604、`approach` 516、`turnToward` 374、`turnTowardPlayer` 569 | 18.1 MB |
| 全开（`--kit=v2`） | ✓ | 以上全部 | 9.6 MB |

### 4.2 对 K1 schema 与 K1 引擎的检验

- **schema**（`logs/k1schema.log`）：K1 的 6 个开关单开、合开，对 `d8324b0` 的 schema 全量都是 **0 错误**，传送 0 失效。
  构造名和形状（`lockInput`/`unlockInput`、`place{target,x,y,dir?}`、`{kind:"facing",dir}`、`all`、页 `dir`、事件 `w/h`）与 K1 的 `types.ts` 一致。
- **K1 引擎跑 Spyder 开场**（K1 开关合开，`k1probe/tools/smoke-spyder-k1.ts`）：
  - smoke 驱动需要改一行：在出口垫上按「下」。因为 K1 的 facing 忠实地要求朝下才出门，原来侧着走过去 60 Hz 会停在楼下门口。
  - 改完后 60/30/20 Hz 都是 11/11，都到 `spyder_route1` (14,19)。
  - 与 v1 的差异：妈妈的「帮我从 Cotton Mart 带球」对话没有出现，原因见非阻断 1。
- **冻结扫描**（K1 引擎 + K1 开关，`k1probe/frozenk1.ts`）：3 张图最后 600 帧一直锁着输入。
  - `tuxe_mart_taba`：锁住且没有任何阻塞 fiber，只到过 1 格，是真的永久锁死（非阻断 2）。
  - `taba_ba_br_2`：过场独白（v1 下也被标出）。
  - `taba_ba_br_master_foyer`：过场进行中；在 900 帧的扫描窗口内没有解锁。
- **嵌套深度**（`logs/depth.log`）：默认产物最深 1,008 层（`test_npcs`），打开 `condAll` 后只有 24 层。上轮提的深嵌套风险，K1 的 `condAll` 能消除。

## 5. 门禁复跑（`/var/tmp/fleet/1828/gates.sh`）

```text
$ bunx tsc --noEmit            → exit 0（3.2 s）
$ bun run import ×2           → Imported 263 map(s); schema errors: 0（每次约 1.7 s）
    project.json        96f12c7e…ccec8b
    variable-enums.json 5f301e89…dfc481
    import-report.json  6aaec4a8…a64933
    G1-coverage.md      5704761a…ecb96f
  两遍相同，也与 G1.md 所列相同
$ bun test tests/              → 13 pass, 0 fail, 28252 expect() calls（7.0 s）
$ HZ=60|30|20 bun tools/smoke-spyder.ts → 各 11 个 PASS，终点都是 spyder_route1 (14,19)，剧情变量相同
```

- 测试前后 `dist/*.json`、`dist/*.log`、`G1-coverage.md` 的哈希不变（`hashes-before.txt` = `hashes-after-test.txt`）。
- 工作区只有 `?? node_modules`。
- 三种频率下 PICK/MAP/PASS/RESULT 行完全一致。
- 60 Hz 日志多一行 `CHOICE [Yes | No]`，是日志按弹窗去重造成的（上轮已记，测试过滤了 CHOICE）。

## 6. 性能与画面

- **性能**：修复规格没有要求运行时数字，导入器是构建期脚本（约 1.7 s）。我没有在 QuickJS 上量 17 MB JSON 的解析，这一项**没做**。深度数据见 §4.2。
- **画面**：G1 用占位地形，没有渲染产物可看，真实地形由 G5 负责。

## 7. 原则

- **无手改**：`dist/project.json` 不入库，入库的 `import-report.json`、`variable-enums.json`、`G1-coverage.md` 都与复跑结果逐字节相同。
- **无地图名特判**：用 263 个图名 grep `importer/*.ts`，只有 `DEFAULT_MAPS`（`--sample` 用）、起点 `spyder_bedroom` 和 `start_tuxemon`，与上轮一样。
  修复范围内新增的行里没有任何图名。`Rand facing`、`flower_city` 等都靠通用规则处理，没有专门判断。
- **组件仓与 PocketJS**：没有写 Tuxemon 专用代码进组件仓，`vendor/pocket-rpgkit` 仍是 `5dd48ef`，`vendor/pocketjs` 仍是 `76ae741f`，工作区都干净。
- **提交规范**：6 个提交作者都是 `lfkdsk`，没有 AI 尾注，每个 B 一个提交。

## 8. 非阻断问题

1–3 是打开开关之前必须先修的。

### 1. `areas` 绕过了同格合并，叠放事件互相吞掉

- **原因**：v1 把同一格、同一触发的多个源事件合成一个（先锁存各自的匹配标志，再依次执行，`project.ts:1225-1238`）。
  `areas` 分支（`project.ts:1139-1156`）直接产出矩形事件，不进这个合并。
  K1 每一步只启动一个阻塞 fiber（K1 `interpreter.ts:841`），另一个的「踏入边沿」就丢了。
- **规模**：打开 `areas` 后，有 27 格（5 张图，其中主线 16 格）仍有 ≥2 个同触发事件叠放（`logs/overlap-notrackers.log`）。
- **实测**：主线 `spyder_paper_town`，同一 2×1 区域上叠了三个事件：
  - "Stop!"（`spyder_paper_town.tmx:155`）；
  - "Autosave Cotton"（`:606`）；
  - "Mom Quest Intercept"（`:623`）。

  在 K1 引擎上，(14,1) 那一步 `touched` 里只有 `e047_autosave_cotton`，妈妈的对话始终没有出现（`k1probe` 逐帧跟踪）。
- **只开 `areas`、不开 `condAll` 时更糟**：17 个整图打卡区域（全在主线上）的 `not tracker` 子句放不进页条件，只能包成 `if`。
  结果它们变成无条件的 `playerTouch` 区域，每一步都会触发并占掉阻塞槽（`logs/overlap.log`）。
- **建议**：对重叠的区域事件继续做合并（按区域求交集，或者照样按格合并）；`areas` 必须和 `condAll` 一起开，或者保留 parallel 打卡降级。

### 2. `tuxe_mart_taba` "professor pls"：过场被截断；开 `inputLock` 后永久锁死

- 这个事件形状上是 spawn（`tuxe_mart_taba.tmx:101`），但事件体是一整段过场。导入器把它导成 parallel 页，页条件 `local.npc.kay_wren == 0`，页里自己把这个值设成 1。
- 组件仓会在页失效后的下一帧取消这个 parallel fiber（`interpreter.ts:588-609`），所以过场在第一句对白后就被砍掉，`proftalk1` 永远不会被写。
  - v1 现在：这条支线断掉，但玩家还能走。
  - 打开 `inputLock` 后：`lockInput` 永远不会被解开，玩家锁死。
- 全库只有这 1 处（`logs/spawncut.log`），在 Xero 线上。
- **建议**：spawn 事件体里有阻塞命令时，把后续部分拆到 autorun 页，或者不要用自己的存在变量做页条件。

### 3. 校验器在「有 schema 错误的全量构建」上栈溢出

- **现象**：用当前钉住的 `5dd48ef` schema 全量导入时，只要打开任何一个改变产物的开关，就会抛 `RangeError: Maximum call stack size exceeded`，而不是报出 schema 错误。受影响的开关有 `areas`、`facing`、`condAll`、`place`、`inputLock`、`routes`，以及 `--kit=v2` 的命令行（`clean/kitv2-cli.log`）。
- **原因**：组件仓 `schema-validate.ts:72-81` 每处理一个 `oneOf` 就把 `errs.push` 再 bind 一层。整个工程里一旦有错误要 push，就要穿过几千层 bound 函数。单张图不会触发，全量构建才会。
- **与 K1/K2 的关系**：bump 到 `d8324b0` 后，K1 开关会通过；`routes` 在 K2 合并前仍然会这样崩溃。
- **建议**：修校验器（组件仓），或者导入器先按图分批校验再汇总。

### 4.「默认保持 v1 字节」测试是恒真式

`importer.test.ts:231` 比较的是 `buildProject(maps, DEFAULT_IMPORT_OPTIONS)` 和 `buildProject(maps)`，两边都是默认值（M5b 仍绿）。
字节不变这件事本身我已经实证过（`pre-b5` 构建哈希一致），但这条测试应该改成钉住已提交的哈希或 v1 快照。

### 5. 传送落点

- **(38,3)**：在 `flower_city` 右上角一块 132 格的区域里（`logs/fcregion.log`），唯一出口是去 `route5` 的传送，走不到 `leather_town` 出口 (12..14,39)。
  能走、不卡死，但不是「传回源图出口旁」。这张图不在主线上。
- **另外 4 个图内落点**：在占位地形里是被四面围住的死格，都不在主线上（`logs/landings.log`）：
  - `timber_town` (29,39) 和 (30,39)，来自 `witcher_route_7`；
  - `37707_town` (35,1)；
  - `rubberduck_cave_01` (49,12)。

  修复规则只在发生夹取时才运行，所以没覆盖它们。建议 G5/G6 加「所有落点都能走出一步」的断言。

### 6. `char_gender` 折叠与 boot 页的性别选择不一致

这是 §2 里唯一的 (b)，在 Xero 线上。建议按 boot 页的固定选择（`gender_male`）折叠 `char_gender player,<g>`。

### 7. `player_facing_tile` 事件被导出

`water_underwater` 的 "Water Gemuar Battle" 在 Tuxemon 里永不执行（条件不存在，抛异常后被当作假）。导入器把它导成了可以按键触发的 action 事件，在 Water 线上。
建议对未知条件类型，按「整事件恒假」处理。

### 8. smoke 最后一拍仍接受「请求了传送但失败」（上轮 M4 遗留）

建议断言 `st.mapId === "spyder_route1"`。

### 9. 商店

- `open_shop` 在主线 7 张图上有 25 次使用（`spyder_*_scoop`、`spyder_flower_petshop`）。
- 导入后被丢弃，丢弃原因却写成「presentation / meta」；实际它是 S1 的 T2-10，要等 K4。
- `ImportOptions` 里没有商店开关，而 P1 要求「商店生效」。建议 K4 合并时加一个 `shop` 开关，并改正这条丢弃原因。

### 10. 措辞小问题

G1.md 写「normalized text/choice/… sequence is identical」，其实 CHOICE 行有去重差异，测试把它过滤掉了。另外 `--kit=v2`「bump 后即可用」一说，要等 1–3 修好才成立。

## 9. 建议（给 commander）

- **改写 G1 的 T1 验收**。S1 的 45.9% / 53.0% 是按类型普查，在转换路径记账下按构造达不到。
  可以改成：「转换路径 T1 ≥ P1 计划上限，差额必须全部落在有文档的 (a)(c)(d) 类里」。
  当前 v1 是 6,099 / 3,529；K1/K2 全开是 6,099 / 3,531。
- **切换 K1 开关之前先派一个小任务**：修非阻断 1、2、4；smoke 驱动在出口垫上转向；在 K1 引擎上跑全图冻结扫描（`k1probe/frozenk1.ts`）。
- **把非阻断 3 转给组件仓**。

## 复现

```sh
/var/tmp/fleet/1828/gates.sh                     # tsc、import ×2（记录哈希）、bun test
/var/tmp/fleet/1828/mut/run-mutations.sh         # 全部变异，结果写到 mutations.log
cd /var/tmp/fleet/1828/probe                     # 插桩副本（patch.ts），vendor 为软链接
bun gap.ts [k1|v2]        # 差距按根因分组（k1/v2 要加 SKIP_SCHEMA=1）
bun classify.ts           # (a)(b)(c)(d) 归类，含主线计数
bun cafe.ts; bun frozen.ts; bun br2.ts           # B3
bun landings.ts; bun fcregion.ts flower_city 38 3 # B4 与全部落点
SKIP_SCHEMA=1 bun optdiff.ts; SKIP_SCHEMA=1 bun overlap.ts   # B5 开关差异与重叠
bun spawncut.ts; bun mainstate.ts; bun deadtalk.ts
cd /var/tmp/fleet/1828/k1probe                   # vendor → 组件仓 d8324b0 的 src
bun k1schema.ts; bun writek1.ts; HZ=60 bun tools/smoke-spyder-k1.ts; bun frozenk1.ts
```

PASS
