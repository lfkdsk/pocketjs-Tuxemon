# GB6-F2：自动战斗边界测试 + 战斗 p95 解释 + QuickJS CPU 计时（Wayfarer 必经证明已收窄）

三项跟进全部完成，结论（Wayfarer 一项已按 §0 收窄）：

1. **自动战斗边界测试**：为 `battle/autoplay.ts` 的每个阈值与并列分支补了边界值测试（恰好等于、±1 HP、并列取首个/末个）。四次变异（heal `<=`→`<`、damage 并列取末个、capture `<=`→`<`、switch `<=`→`<`）全部被新测试变红；策略行为零改动，`verify:gb6:mainline` 仍通过（终态 `bd3616c7…` 不变）。
2. **Wayfarer Inn 路线**：本 tape 选择了经过 Wayfarer Inn 的路线（3 场额外训练师战）；是否存在绕行未证明——两次必经证明尝试（§2 静态、§6.1 按状态）都因建模不完整被审查否定，见 `findings/review-task-1976.md`、`findings/review-task-2001.md`。
3. **战斗 p95 解释**：12 ms → 20 ms 是**样本差异，不是回退**。同一基准下，1v1 战斗帧在短/长 journey 上 p95 几乎相同（technique 11.779 vs 11.667 ms）；长 journey 的 20 ms 来自大队伍帧（pp=6 technique p95 18.5 ms，pp=6/ep=4 最高 29 ms）。

## 0. 收窄：放弃「Wayfarer 必经证明」（前移到公开 main 时）

本报告原含「Wayfarer Inn 必经证明」：§2 的全图静态 BFS 与 §6.1 的按真实运行时状态重算。两次尝试都被审查判定建模不完整，结论收窄为「tape 选择了经过 Wayfarer Inn 的路线」：

- **§2 静态模型**（review-task-1976）：事件体按「任一页 blocks」永久并集、parallel transfer 绑作者坐标，图模型不健全。
- **§6.1 按状态重算**（review-task-2001）：漏 104 条动态目标 parallel transfer（未按规格做「可用/不可用」双口径）；dry-run 改写了 19 张图的非 `local.*` 剧情状态，并非声称的「变量冻结」；旧 369 节点路线的 Paper Captain 格漏检；前向合并后硬编码的 f55839/f107479 帧号静默漂移。

取舍：

- **不再声称 Wayfarer 必经**。`findings/GB6.md` 的表述同步收窄为「tape 选择了经过 Wayfarer Inn 的路线（3 场额外训练师战）；是否存在绕行未证明」。
- **两个证明工具及其测试不随本次前移保留**（`tools/wayfarer-inn-proof.ts`、`tools/wayfarer-state-reach.ts`）：两次尝试都被否定，保留工具会暗示被否定的结论仍成立。§2、§6.1 原文保留在下方仅作历史记录，结论以本节为准。
- **保留并重新验证的成果**：§1 自动战斗边界测试、§3 战斗 p95 分桶（`G6_BATTLE_BUCKETS=1`，默认关闭）、§6.2 QuickJS 帧计时线程 CPU 时间（含 `G6_INJECT_CPU_*` / `G6_INJECT_SLEEP_*` 注入验证）。前移后的提交与验收见 §8。

## 1. 自动战斗边界测试

`battle/autoplay.ts` 的策略有四个阈值与五个并列分支。原六个单元测试只覆盖「满血选最大伤害」「1 HP 治疗」等远离边界的场景（review-task-1963 §3 指出的缺口）。本次在 `tests/battle-autoplay.test.ts` 新增 11 个边界/并列测试，并在 `autoplay.ts` 的并列点加注释说明约定（纯注释，无行为改动）。

### 1.1 覆盖的阈值与并列

| 分支 | 约定 | 边界测试 |
| --- | --- | --- |
| 回血阈值 `hpRatio <= 0.35` | 边界本身回血 | max HP 200：70（=0.35）回血、71 不回、69 回 |
| 捕获阈值 `ratio(enemy) <= 0.4` | 边界本身捕获 | 敌方 max HP 200：80（=0.4）捕获、81 不捕、79 捕 |
| 换怪阈值 `hpRatio <= 0.2` | 边界本身可换 | 40（=0.2）可换、41 不换 |
| 后备优势 `ratio(reserve) > hpRatio + 0.25` | **严格** `>` | 后备 90/200=0.45 == 0.2+0.25 不换；91/200=0.455 换 |
| 技能并列 `expectedDamage <= best` | **首个**最大 | firomenis 的 breathe_fire 与 kindling_flame 对 budaye 同为 90.4，取 breathe_fire（菜单更早） |
| 道具并列 `useful > … || amount < …` | 有效量相同取标称小者；再同源序 | 缺 26 时 potion(+50) 与 super_potion(+100) 有效量都 26，取 potion；cureall 与 mega_potion 有效量/标称都相同，取排序更早的 cureall |
| 后备并列 `damage > … || hpRatio > …` | 伤害同取血比高者；再源序 | 两只同种同种子后备伤害相同，血比高者胜；血比同取队位更早者 |
| 捕获球并列 `modifier > best` | **首个**最大 | tuxeball 与 tuxeball_candy 修正都为 1，取排序更早的 tuxeball |
| 遗忘招式 `score < selectedScore` | **首个**（最旧）最低分 | blade 与 wall_of_steel 都 1.25 最低，忘 blade（最早） |

HP 用 `pinHp` 在开战后钉到 200/40 等整数，使 0.35/0.4/0.2 落在精确 HP 上（spawn 的 HP 随 IV 变化，不能靠固定种子）。

### 1.2 变异验证（全部变红后撤销）

**变异 1：回血阈值 `<=` → `<`（autoplay.ts）**

```
(fail) battle autoplay boundary values and tie-breaks > heal threshold: heals at exactly 0.35 but not 1 HP above [0.82ms]
(fail) battle autoplay boundary values and tie-breaks > heal item tie: equal useful healing consumes the smaller nominal item [0.78ms]
(fail) battle autoplay boundary values and tie-breaks > heal item tie: equal useful and nominal amount keeps sorted source order [0.71ms]
 14 pass
 3 fail
```

**变异 2：技能并列首个 → 末个（`<=` → `<`）**

```
-   "slug": "breathe_fire",
+   "slug": "kindling_flame",
(fail) battle autoplay boundary values and tie-breaks > damage move tie: equal expected damage keeps the earliest menu move [0.73ms]
 16 pass
 1 fail
```

另做两个补充变异（同样变红，撤销后 17 pass / 0 fail）：

- 捕获阈值 `<=` → `<`：15 pass / 2 fail（capture threshold + capture tie，都坐在 0.4 边界）。
- 换怪阈值 `<=` → `<`：15 pass / 2 fail（switch threshold + reserve tie，都坐在 0.2 边界）。

变异只改 `battle/autoplay.ts`，测试文件不动；每次变异后 `git checkout` 还原。策略行为零改动。

## 2. Wayfarer Inn 必经证明（历史记录：工具未随前移保留，结论以 §0 为准）

### 2.1 方法

`tools/wayfarer-inn-proof.ts`（+ `tests/wayfarer-inn-proof.test.ts`）：

1. 用导入器构建**全部 263 张图**的真实工程（`importTerrain` + `buildProject` + `applyTerrain`），通行用引擎的 `buildPassage`（含 sheet block/pass、dirBlock/dirEdges 单向边、map.passage 覆盖），并把所有 `blocks` 事件体盖成 bodyBlock。
2. 收集全部 1,286 条静态 `transfer` 作为可选图边（忽略 facing 条件——对绕路更宽松）；跳过 104 条 `teleport_faint`（变量目标，是死亡复活机制，把玩家送回身后治疗点，不是玩家可控的绕路）。
3. 多图 BFS：起点 Route 3 南段 `@4,5`（inn 南入口旁），终点 Route 3 北段 `@1,3`（QQQ `@1,2` 旁的可站立格）。
4. 把三个训练师的 playerTouch 触发矩形从图中删掉，再 BFS。

对绕路宽松 = 若宽松模型都到不了，真实 facing 限制下更到不了。全图都在 = Route 4、Leather Town 等任何外接图的绕路都会被找到。

### 2.2 结果

```
Wayfarer Inn cut proof (263 maps, 112164 standable tiles, 104 faint teleports skipped)
  south: spyder_route3@4,5  north: spyder_route3@1,3  QQQ: spyder_route3@1,2
  trainer spyder_wayfarer1_morningstar: spyder_wayfarer_inn1@2,3 (event e016_talk_morningstar_r004)
  trainer spyder_wayfarer1_bravo: spyder_wayfarer_inn2@13,3 (event e009_talk_bravo_r003)
  trainer spyder_wayfarer1_victor: spyder_wayfarer_inn1@11,2, spyder_wayfarer_inn1@12,2 (event e017_talk_victor_r003)
  open path length 58; crosses: spyder_wayfarer_inn1@2,3 , spyder_wayfarer_inn2@13,3 , spyder_wayfarer_inn1@11,2
  north reachable WITH trainers:    true
  north reachable WITHOUT trainers: false
  block only spyder_wayfarer1_morningstar: north reachable=false (individual cut)
  block only spyder_wayfarer1_bravo: north reachable=false (individual cut)
  block only spyder_wayfarer1_victor: north reachable=false (individual cut)

PROVEN: the Wayfarer Inn trainer zones are a south->north cut.
```

- 不踩三个触发区：**到不了** Route 3 北段（全图 BFS，无任何绕路）。
- 三人各自的完整触发区单独都是割集（Morningstar 1 格、Bravo 1 格、Victor 2×1 两格）。
- 最短开放路径（58 节点）穿过全部三人。
- Route 3 单图（不进 inn）步行 BFS：南段到不了北段——地图地理上被切开，inn 是唯一桥梁。

inn 是一条线性走廊：南口 → Morningstar → 西楼梯上 → Bravo → 东楼梯下 → Victor → 北口。Morningstar/Bravo 是单格咽喉，Victor 是 2 格宽的咽喉（两格都封才断，但完整触发区本就是 2×1）。

## 3. 战斗 p95 解释

### 3.1 方法

同一基准（`tools/g6-quickjs-bench.rs`，新增 `G6_BATTLE_BUCKETS=1` 模式）在同一视口 480×272 下分别重放短 journey（`g6-journey.json`，3,793 帧，首战 Billie，1v1）与长 journey（`gb6-mainline-journey.json`，109,981 帧，100 场，队伍最大 6v6）。每帧记录我方/敌方队伍规模、战斗事件类型（演出阶段）、菜单状态，按 `(pp, ep, event, menu)` 分桶报 p95。富状态在帧计时点之后读取，不污染 js/core/draw 计时。

### 3.2 同桶对比：1v1 帧几乎相同（无回退）

短 journey 全部是 1v1（pp=1 ep=1）。长 journey 里同样的 1v1 桶：

| event | 短 p95 (n) | 长 p95 (n) | 差 |
| --- | --- | --- | --- |
| technique | 11.779 (673) | 11.667 (2071) | −0.112 |
| status | 11.575 (220) | 10.671 (540) | −0.904 |
| sendOut | 8.869 (95) | 8.888 (570) | +0.019 |
| faint | 11.627 (60) | 11.638 (300) | +0.011 |
| end | 11.635 (36) | 11.045 (216) | −0.590 |

都在 ~1 ms 运行噪声内。**1v1 战斗帧在两个 journey 上成本相同，没有回退。**

### 3.3 长 journey 的 20 ms 来自大队伍帧

长 journey 的 technique p95 随我方队伍规模单调上升（ep=1）：

| pp | n | mean | p95 | max |
| --- | ---: | ---: | ---: | ---: |
| 1 | 2071 | 9.416 | 11.667 | 13.184 |
| 3 | 1791 | 11.123 | 12.591 | 13.900 |
| 4 | 3669 | 12.959 | 14.749 | 19.743 |
| 5 | 1257 | 14.197 | 15.683 | 19.746 |
| 6 | 2643 | 15.978 | 18.538 | 20.933 |

大队伍战斗（p95 的主要驱动）：

| pp ep event | n | p95 |
| --- | ---: | ---: |
| 6 4 technique | 1071 | 28.187 |
| 6 4 faint | 300 | 29.420 |
| 6 4 sendOut | 287 | 24.279 |
| 6 6 technique | 282 | 22.822 |
| 5 6 technique | 282 | 22.054 |

总计：

- 短 battle-steady：n=1,132，p95 **11.754** ms，max 13.387 ms（全 pp=1 ep=1）。
- 长 battle-steady：n=44,008，p95 **20.759** ms，max 40.727 ms（pp 1..6 混合）。

### 3.4 结论

**12 ms → 20 ms 是样本差异，不是回退。** 原因：

1. 两个数字本来就不是同一桶：GB5/短 journey 的 ~12 ms 是 1v1 首战的 battle-round/decision 桶；GB6/长 journey 的 ~20 ms 是全部 battle-steady 帧（含 technique/status/sendOut/faint/end 等所有演出阶段）。
2. 同一基准下，1v1 帧在两个 journey 上 p95 几乎相同（technique 11.779 vs 11.667 ms）——若有回退，这里会先涨。
3. 长 journey 后期是 6 只怪、L32 的队伍（Wanda 6 只 nudiflot、Zoolander 4 只、Connor 6 只），每帧要动画/定位的场上精灵更多，sendOut/faint 事件更多，高等级招式演出更长。per-frame 成本随队伍规模单调上升（pp=1→6：technique p95 11.7→18.5 ms），battle-steady 的 p95 落在这些大队伍帧上。

无需定位回退提交——没有回退。

## 4. 验收

| 门禁 | 结果 |
| --- | --- |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | exit 0；pak 4,622 entries / 62,192,144 bytes |
| `bun run build:wasm` | exit 0；289,808-byte wasm |
| `bun test tests/` | 183 pass / 0 fail / 0 skip，71,077 assertions，36 files，164.24 s |
| `verify:gb6:mainline` | PASS；109,981 帧，100 场（22 trainer + 78 wild），终态 `bd3616c7…` |
| `verify:gb6:failures` | PASS；首战败线 3,357 帧 + Wanda 败线 65,500 帧 |
| `bun.lock` / `vendor/` | 无改动（submodule 仍在 `fb3b319d`） |
| fleet 任务号 / Co-Authored-By | 无 |

## 5. 提交

下表为旧历史（仓库已公开重写，旧 SHA 不在新 main 历史中）的提交；前移到公开 main 后的对应提交与验收见 §8。

| 提交 | 内容 |
| --- | --- |
| `6ecb17b` | test(battle): pin autoplay threshold boundaries and tie-break conventions |
| `c288a00` | test: bucket QuickJS battle frames by party size, event, and menu mode |
| 本提交 | test: prove the Wayfarer Inn is the only Route 3 south->north passage |
| 本提交 | docs: GB6-F2 report + GB6 §7 p95 explanation |

没有修改 `bun.lock` 或 `vendor/`，没有 push。

## 6. 修复 1（review-task-1976）

review-task-1976 判 FAIL，两项阻断：§3 Wayfarer「必经证明」的图模型不健全（事件体按「任一页 blocks」永久并集、parallel transfer 绑作者坐标）；§4 长基准两次 >100 ms 单帧调度尖峰触发 50 ms max 断言。本次修复两项。

### 6.1 Wayfarer 可达性按真实运行时状态重算（历史记录：工具未随前移保留，结论以 §0 为准）

**方法**（`tools/wayfarer-state-reach.ts` + `tests/wayfarer-state-reach.test.ts`，11 项测试）：

- 回放主线 tape 到真实 `SessionState`：首次进入 Route 3 南段（f55839）与进入 Wayfarer 前（f107479）。
- 每个事件用组件仓自己的 `activePage` 求当前 active page；阻挡体用真实角色位置/`visible`/`blocks`——当前图用 tape 的 live chars，其余图用「干跑进入」（fresh interp + 清 `local.*` bank + 真实 session 跑 parallel/autorun create 页，再 `tableWithBodies` 盖章）。干跑结果对 route3 与 live snapshot 逐字符一致（测试钉住）。
- 传送边绑真实触发格：playerTouch 绑事件 live rect（char 位置），action 绑 rect + 相邻可确认格；parallel/autorun 的 inner `if` 守卫用引擎自己的 `evalCondition` 对冻结状态求值——守卫成立才是强制边，不成立则不是边。
- 假设（写明）：搜索期间剧情变量冻结（路上不执行事件）；视线触发范围按当前 active page；facing 条件的传送页按「可用」处理（玩家可转向）；移动 NPC 按进入位置。

**结果（f107479，进入 Wayfarer 前）**：

- 移除三人触发区后北端**不可达**（`northReachableWithoutTrainers=false`）；经过 inn 的开放路径长 57、穿过全部三人。
- 0 条 parallel transfer 在冻结状态触发（51 条全部被 `v.rivergoto` 等剧情守卫挡住，`parallelFires=0`）。
- 外围候选路线被挡的具体格与原因：

| 格 | NPC | 为什么此时 blocks |
| --- | --- | --- |
| route3 @20,3 | Connor | create 页 `local.npc.connor==0`（无全局条件）每次进入都跑 → page1 blocks |
| route3 @29,31 | Curie | 同上 |
| paper_town @10,14 | Silver | 同上 |
| route4 @2,12 / @3,20 / @12,30 | Wulf / Beck / Rosamund | 同上 |
| route3 @32,7 | boulder | **可通行**：`v.spyder_boulder=1` → create 页 `v.spyder_boulder!=1` 不成立，不生成 |
| leather/timber/paper/flower Captain | Captain | **可通行**：`v.captainreturns` 未设 → create 页不生成 |
| paper_town @13,14 | Billie | **可通行**：未生成 |

- timber_town / flower_city / route4 可达格 = 0：城际 river-travel parallel（`v.rivergoto`）在冻结状态不触发，外围路断。leather_town（833 格）与 paper_town（401 格）可步行到达。
- **扰动**：冻结状态设 `v.rivergoto=2` → river-travel 开通 → 北端**可达**（外围路长 262：route3 → leather_town → flower_city → route4 → route3 北），结论翻转。

**f55839（首次进入 Route 3 南段）**：冻结假设下北端不可达（连 inn 都到不了——Novak/Curie 等 route3 训练师的 create-page NPC 挡住北上走廊；boulder 此时未销毁也挡）。这是冻结假设的结果（真实游戏里玩家靠对战推进）。

**结论**：f107479 状态下三人触发区仍是割集——但现在是健全图（真实阻挡体、真实触发格、守卫求值后的 parallel 边）上的结论。原静态搜索（`wayfarer-inn-proof.ts`）保留并标明「静态近似」：它的「不可达」结论碰巧一致，但方法（任一页永久并集 + parallel 绑作者坐标）不是证明。

### 6.2 QuickJS 帧计时改为线程 CPU 时间

`tools/g6-quickjs-bench.rs` 的每帧计时改为测**线程 CPU 时间**（`clock_gettime(CLOCK_THREAD_CPUTIME_ID)`，edition-2024 `unsafe extern`），墙钟时间照样测量和上报，但 50 ms `assert_frame_budget` 断言改用 CPU 时间。选 CPU 时间而非「超 50 ms 重放 N 次取最小值」：重放需要倒带状态、实现复杂，且对真正 >50 ms 的慢帧仍可能误判；CPU 时间直接度量线程实际工作量，对调度去调度免疫，是标准修法。非 Linux 平台回退墙钟（`cpu_clock=wall-fallback` 标记）。

注入验证：`G6_INJECT_CPU_FRAME` / `G6_INJECT_CPU_MS` 在指定帧烧真实 CPU 时间。短 journey 在 f2091（battle-entry）注入 80 ms → 该帧 CPU 102.579 ms → 断言变红（exit 101）；不注入时 21.655 ms 通过。证明断言仍能抓住真实慢帧。

**调度去调度免疫验证**：`G6_INJECT_SLEEP_FRAME` / `G6_INJECT_SLEEP_MS` 在指定帧 `thread::sleep`（只长墙钟、不耗线程 CPU 时间的空档，复现 review §4 的失败模式）。短 journey 480×272 在 f2091（唯一 battle-entry 帧）注入 120 ms，与不注入的基线背靠背对比：

| 运行 | battle-entry CPU | battle-entry 墙钟 | 50 ms 断言 | 终态 |
| --- | --- | --- | --- | --- |
| 不注入（基线） | 23.443 ms | 23.458 ms | PASS | `5653f011…` |
| 注入 120 ms sleep | 23.386 ms | 143.440 ms | PASS | `5653f011…` |

墙钟 +119.98 ms（恰好是注入的 sleep），CPU 时间差 0.057 ms（运行噪声内），CPU 时间断言照常通过，终态 sha 不变。与 CPU 注入（80 ms 真实 CPU → 断言变红）合起来覆盖两种情形：真实慢帧抓得住，调度空档不误触。

**前后对比**：

| 运行 | 断言依据 | 480×272 长 journey max | 结果 |
| --- | --- | --- | --- |
| review-task-1976 第 1 次 | 墙钟 | f6044 sendOut 101.610 ms | FAIL（调度尖峰） |
| review-task-1976 第 2 次 | 墙钟 | f92599 136.725 ms | FAIL（调度尖峰） |
| 本次（CPU 时间） | 线程 CPU | battle-entry 44.557 ms（墙钟 44.557 ms） | PASS |

review 的两次 >100 ms 是共享宿主调度噪声（review 自己也判「更像调度噪声」）；CPU 时间断言下这些帧的真实工作量（~20–44 ms）远低于 50 ms，不再误触。注入测试证明真实 >50 ms 的慢帧仍会变红。

**两视口 × 长/短 journey 结果**（`cpu_clock=thread-cputime`）：

| journey | 视口 | max CPU 帧 | max CPU | max 墙钟 | 50 ms 断言 | 终态 |
| --- | --- | --- | --- | --- | --- | --- |
| 短（g6-journey） | 480×272 | battle-entry | 21.655 ms | 21.654 ms | PASS | `5653f011…` |
| 短 | 960×544 | battle-entry | 25.879 ms | 25.879 ms | PASS | `5653f011…` |
| 长（gb6-mainline） | 480×272 | battle-entry | 44.557 ms | 44.557 ms | PASS | `bd3616c7…` |
| 长 | 960×544 | battle-entry f17090 | 81.756 ms | 83.690 ms | **FAIL** | 未写出（断言先于状态落盘） |

注：960×544 长 journey 两次跑都触发 50 ms CPU 断言，但失败帧不同——与 task-1989 的 QuickJS bench 并发那次挂在 battle-exit f63569（110.972 ms CPU / 110.971 ms 墙钟）；负载 7–13 的清洁重跑挂在 battle-entry f17090（81.756 ms CPU / 83.690 ms 墙钟）。两次墙钟都≈CPU 时间，是真实 CPU 工作量，不是调度去调度。battle-entry/exit 的 p95 在 960×544 已达 45–49 ms（480×272 同桶 28–35 ms），最重的战斗帧（大队伍、高等级招式）达 81–111 ms。结论：50 ms 预算按 480×272 标定，在 960×544 长 journey 上不稳定——这是真实的视口缩放成本（960×544 像素数 4×、battle 帧 CPU ~1.4×），不是测量噪声；CPU 时间断言正确地抓住了它（墙钟断言只会不可预测地误触）。短 journey 960×544（battle-entry 26.6 ms）仍通过。960×544 长 journey 的预算重标定/战斗帧优化列为后续。

## 7. 修复 1 验收

| 门禁 | 结果 |
| --- | --- |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | exit 0；pak 4,622 entries / 62,192,144 bytes |
| `bun run build:wasm` | exit 0；289,808-byte wasm |
| `bun test tests/` | 194 pass / 0 fail / 0 skip，71,374 assertions，37 files，250.10 s |
| `verify:gb6:mainline` | PASS；109,981 帧，100 场（22 trainer + 78 wild），终态 `bd3616c7…` |
| `verify:gb6:failures` | PASS；首战败线 3,357 帧 + Wanda 败线 65,500 帧，blocked exit + healed |
| `bun tools/desktop.ts --build-only` | exit 0；release host 构建成功 |
| `bench-g6-quickjs.sh` 两视口（journey 预算） | 480×272 battle-entry 23.838 ms PASS；960×544 battle-entry 26.630 ms PASS；两视口终态 `5653f011…` |
| `bench-g6-quickjs.sh` map_first_visits | PASS（重跑 49.297 ms）；首跑 50.204 ms 是负载 15.4 下的墙钟噪声（该测试仍按墙钟断言，见下方后续） |
| `bun.lock` / `vendor/` | 无改动（submodule 仍在 `fb3b319d` / 嵌套 `2d2b333b`） |
| fleet 任务号 / Co-Authored-By | 无 |

**修复 1 两项阻断均已解决并验证**：

1. **Wayfarer 可达性**（§6.1）：按真实运行时状态重算，f107479 状态下三人触发区仍是割集（健全图上的结论）；扰动 `v.rivergoto=2` 使结论翻转。原静态搜索保留为「静态近似」。
2. **QuickJS 帧计时**（§6.2）：断言改用线程 CPU 时间。注入 80 ms 真实 CPU → 断言变红（抓住真实慢帧）；注入 120 ms sleep → 墙钟 +119.98 ms 而 CPU 时间不变、断言通过（对调度去调度免疫）。

**验收中发现的两个后续项（不阻断修复 1）**：

- **960×544 长 journey 超 50 ms CPU 预算**：battle-entry/exit p95 已达 45–49 ms，最重战斗帧 81–111 ms CPU（墙钟≈CPU，真实工作量）。50 ms 预算按 480×272 标定，960×544 像素数 4×、battle 帧 CPU ~1.4×，需要重标定预算或优化大队伍战斗帧。这是 CPU 时间断言正确抓住真实成本的例证——墙钟断言只会不可预测地误触。
- **map_first_visits 仍按墙钟断言**：负载 15.4 时 buddha_mountain 测出 50.204 ms（超 0.2 ms），负载回落后重跑 49.297 ms 通过。与 journey 帧预算同类的墙钟噪声，建议同样改为 CPU 时间断言。

PASS

## 8. 前移验收（公开 main `588f60b`，分支 `fleet/task-1976-fwd`）

§0 所列保留成果前移到公开 main 后的提交与验收。

### 8.1 提交

| 提交 | 内容 | 对应旧历史提交 |
| --- | --- | --- |
| `5a62af1` | test(battle): pin autoplay threshold boundaries and tie-break conventions | `6ecb17b` |
| `b7b3fa9` | test: bucket QuickJS battle frames by party size, event, and menu mode | `c288a00` |
| `453ad94` | test: assert the QuickJS frame budget on thread CPU time, not wall clock | `d8978d6` |
| `2873458` | test: inject sleep to prove the CPU-time frame budget ignores descheduling | `35ce751` |
| `bae5be6` | docs: narrow the Wayfarer claim to a tape route choice and port GB6-F2 | 本文档与 `GB6.md` 收窄 |

未移植：`tools/wayfarer-inn-proof.ts`、`tools/wayfarer-state-reach.ts` 及其测试（见 §0）。移植时把三个 bench 提交注释里的审查任务号引用去掉（公开仓卫生），代码逻辑零改动。

### 8.2 验收

| 门禁 | 结果 |
| --- | --- |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | exit 0；pak 4,623 entries / 62,742,928 bytes，JS 1,154,609 bytes |
| `bun run build:wasm` | exit 0；289,808-byte wasm |
| `bun test` | 193 pass / 0 fail / 0 skip，71,217 assertions，37 files，207.81 s |
| `verify:gb6:mainline` | PASS；109,983 帧，100 场（22 trainer + 78 wild），终态 `d62d1465…` |
| `verify:gb6:failures` | PASS；首战败线 3,254 帧 + Wanda 败线 65,515 帧 |
| `bun run import` 连跑两次 | 两次 exit 0；tracked 文件 0 diff |
| `bun tools/desktop.ts --build-only` | exit 0；release host 构建成功 |
| `bench-g6-quickjs.sh` 两视口（短 journey） | 480×272 battle-entry CPU 22.180 ms PASS；960×544 battle-entry CPU 27.103 ms PASS；两视口终态 `5653f011…`；map_first_visits 263 图 non_exempt_max 46.063 ms PASS |
| `bun.lock` / `vendor/` | 无改动 |
| 任务号 / 本机路径 / Co-Authored-By | 代码、测试、非 findings 文档、提交信息中无 |

注：mainline 帧数（109,983）与终态（`d62d1465…`）相对旧分支（109,981 / `bd3616c7…`）的变化来自公开 main 上合入的世界索引等提交，tape 整体 +2 帧——正是 review-task-2001 指出的「帧号写死漂移」风险，也是不移植带硬编码帧号的 Wayfarer 工具的原因之一。

### 8.3 注入复验（新分支，帧号重新推导）

短 journey 的 battle-entry 帧重新确认为 f2091（`spyder_paper_town`；注入后该帧墙钟 +120.3 ms 自证帧号正确）：

| 运行 | battle-entry CPU | battle-entry 墙钟 | 50 ms 断言 | 终态 |
| --- | --- | --- | --- | --- |
| 不注入（基线） | 22.180 ms | 22.195 ms | PASS | `5653f011…` |
| 注入 120 ms sleep（f2091） | 22.434 ms | 142.497 ms | PASS | `5653f011…` |
| 注入 80 ms 真实 CPU（f2091） | 102.540 ms | 102.553 ms | **FAIL**（exit 101，断言变红） | 未写出（断言先于状态落盘） |

调度去调度免疫与真实慢帧捕获两种情形都在新分支上复现。`G6_BATTLE_BUCKETS=1` 分桶模式同样复验：短 journey 480×272 分出 9 组、1,132 帧 battle-steady，technique（pp=1 ep=1）p95 11.952 ms，与 §3.2 旧数（11.779 ms）一致（差异来自组件仓 bump）。
