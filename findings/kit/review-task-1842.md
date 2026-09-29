# 审查 K2（task 1824 + 收尾 1842）：移动扩展 / 寻路 / 单向通行

- 审查任务：1846（跨族审查，按 `reviewer-generic.md` + `review-K2-extra.md`）
- 被审分支：`fleet/task-1824`，基线 `d8324b0`，被审 HEAD `51e3994`（9 个提交）
- 规格：`kit-K2-movement.md`（原规格）、`kit-K2-continue.md`（收尾）
- 日期：2026-09-29
- 复现脚本：`findings/review-task-1842/*.ts`（在本 worktree 根目录用 `bun findings/review-task-1842/<name>.ts` 运行；需要对照基线时，在 `d8324b0` 的 checkout 里放同一脚本运行）

## 结论摘要

门禁全部复现：两次构建字节一致，`tsc` 0，`bun test` 638/638。QuickJS 数字也复现了。单向通行边（`sheet.dirEdges`）的语义正确，移动和寻路都遵守；分帧 BFS 按参考 tick 切片，100×100 大图多 hz 一致。

但有 **4 个阻断项**：

1. 把 passage 预烘成 `solid` 数组后，现有 wander 示例的运行期碰撞坏了。
2. 「被挡住后最多 N 次重试」的上限只在 `retries: 0` 时生效。默认值（10）和任何 ≥1 的值都会无限重算，等待中的 fiber 永远不恢复。
3. 分帧 BFS 搜索进行中，用 builder 自己的整状态存档（`snapshotFull`，即 JSON）读回后结果不一致。
4. `bun.lock` 被整体改写成内部镜像的 URL 并提交了。

另有若干非阻断问题：`dirBlock` 旧语义在边角情况下有漂移、测试缺口、文档不一致、注释里有 fleet 编号 `proposal 1643`。

## 阻断项

### B1　passage 预烘后，运行期写 `table.overrides` 不再生效：wander 示例玩家/NPC 穿过「生长」出来的阻挡格（回归）

- 提交 `4fe95d0` 让 `buildPassage` 把 overrides 一次性烘进 `solid`，见 `src/engine/passability.ts:84-107`。之后 `canEnter`/`isStandable`/BFS 只读 `solid`，见 `passability.ts:159`、`:200`、`pathfind.ts:101-137`。但 `PassageTable.overrides` 仍然导出，注释写的是「Kept for callers that author overrides directly」（`passability.ts:49`）。
- 组件仓自带的 wander 示例在运行中直接改写 live 表的 `overrides`：`examples/wander/wander-sim.ts:366` 调 `patchChunk(table.overrides, …)`，`:389` 执行 `overrides[at] = blocksAt(...) ? BLOCK : 0`。它的自动驾驶也读 `overrides` 规划路线（`examples/wander/driver.ts:160,237`）。K2 之后，这些写入对移动不再起作用。
- 复现（`findings/review-task-1842/wander-grow-fixed.ts`，seed 1、60 Hz、手动模式、第 49 帧后把玩家放到 (47,36) 按住下）：

  ```
  == K2 HEAD (51e3994)
  cell (47,37): overrides=-1 (BLOCK=-1) canEnter=true
  trail holding DOWN from (47,36): 47,36 -> 47,37 -> 47,38 -> 47,39
  == d8324b0
  cell (47,37): overrides=-1 (BLOCK=-1) canEnter=false
  trail holding DOWN from (47,36): 47,36
  ```

- builder 的提交说明写「Behavior is identical (full suite green)」，但这个回归测试集覆盖不到。修法有两种：一是让写 overrides 的地方同步更新 `solid`（提供 `setPassageOverride(table, idx, flag)` 这类 API，并把 wander 改用它）；二是去掉可写的 `overrides`，由调用方改写 `solid`。修完加一个「运行期改 passage 后移动遵守」的回归测试。

### B2　寻路重试上限失效：`retries ≥ 1`（含默认 10）永不放弃，waited fiber 永久挂起，BFS 每个周期重跑

- `chars.ts:700-701`、`:715-716` 先 `plan.retriesLeft--`，再 `route.plan = null`，把计数器所在的对象整个丢掉。下一个 tick 在 `chars.ts:655` 新建 plan，又把 `retriesLeft` 设回 `retries`（`:623-624` 从 step 读，默认 `DEFAULT_PATH_RETRIES = 10`，见 `chars.ts:72`）。所以计数永远不会减到 0。玩家路线（`session.ts:807-808` 读 `retries`，`:820` 新建 plan，`:852-854`、`:863-865` 递减后丢弃）也有同样的问题。
- 复现（`retry-bound.ts`，目标格被四面围死，`wait: true`，最多跑 20,000 tick）：

  ```
  pathTo retries=0: fiber resumed at tick 8
  pathTo retries=1: fiber STILL PARKED after 20000 ticks; route live=true
  pathTo retries=3: fiber STILL PARKED after 20000 ticks; route live=true
  pathTo retries=default(10): fiber STILL PARKED after 20000 ticks; route live=true
  approach retries=0: fiber resumed at tick 8
  approach retries=2: fiber STILL PARKED after 20000 ticks; route live=true
  approach retries=default(10): fiber STILL PARKED after 20000 ticks; route live=true
  ```

  `retry-trace.ts`（`retries: 2`）逐 tick 打出 `r2/b2 … r2/b7 → null → r2/b2 …`：60 tick 内新建了 9 个 plan，`retriesLeft` 始终是 2。
- 自然场景下也会触发，不只是人工构造的死路。`multihz-big.ts` 里两个 NPC 先后 `approach` 玩家的同一侧，后到的 n2 的站位格已被 n3 占住，于是在 60/30/20/15 Hz 下都 **6,000 tick 仍未结束**。60 Hz 时 6,000 帧里有 3,584 帧在跑 BFS 切片（100×100 大图上每 47 tick 做一次全图搜索，永不停止）。
- 规格原文是「被挡住就等待后重算，最多 N 次重试」，额外核对 2 要求「被挡住后的等待/重算有上限」，两条都不成立。对 Tuxemon 导入来说，一旦 `pathfind`/`pathfind_to_char` 的目标被占，过场就会软锁。builder 的测试只用了 `retries: 0`（`tests/k2-movement.test.ts:177-194`），所以没发现。修法：把剩余次数放在 route 上，不放在会被丢弃的 plan 上（或者重建 plan 时继承它）。再加一条 `retries ≥ 1` 且默认值下的有界测试。

### B3　分帧搜索进行中做整状态存档，读回后结果不一致（typed array 经不起 JSON）

- 分帧 BFS 的中间状态是 `Int32Array`/`Uint8Array`，见 `pathfind.ts:172-184`，放在 `SessionState.chars…route.plan.search` 里。builder 的「整状态存档」就是 `JSON.stringify(state)` / `JSON.parse`（`tests/fixtures/event-model/event-model.tsx:188-190`）。JSON 会把 typed array 变成 `{"0":…}` 普通对象；下一 tick `clonePathSearch` 再对它 `new Int32Array(obj)`（`chars.ts:184-186`、`session.ts:74-81`），得到的是**长度 0 的数组**，搜索状态就此损坏。
- 复现（`midsearch-debug.ts`，100×100，NPC 从 (0,0) `pathTo` (99,98)，第 5 帧时搜索仍在进行 `qh=1000/qt=1046`）：读回后的一支立刻「完成」搜索，得到 1 步的错误路径（`dirs=1`），随后被挡 7 tick、丢弃 plan、从头重搜。未中断的一支在 t40 就拿到 196 步路径，读回的一支到 t48 左右才重新搜完。`midsearch-roundtrip.ts` 的轨迹：frame 500 时未中断的 NPC 在 (1,57)，读回的在 (1,55)；frame 1000 时是 (22,98) 对 (21,98)。终点相同，时间线不同。
- builder 的两条「存档中途」测试（`tests/k2-movement.test.ts:319-345`，以及 sim 的 `snapshotFull`）都是在**搜索已完成、正在走路**时存档（10×6 的小图一个切片就搜完），分帧引入的新中间态完全没被测到。可 `9bc473f` 的说明和 `chars.ts:182` 的注释都宣称这个状态「pure and saveable」。额外核对 2 要求「存档在寻路进行到一半时读回，结果一致」，对分帧 BFS 这一半不成立。
- 修法：搜索状态用普通 `number[]`，或给 `SessionState` 提供显式序列化/反序列化。补一条「在 `plan.search != null` 时 JSON 往返，逐帧对比」的测试，并且要跑变异确认会红。注：公开槽位存档（`save.ts:52-65` 安全点，快照不含 `chars`）不受影响。

### B4　`bun.lock` 被整体改写为内部镜像 URL 并提交（混在 `974e344` 功能提交里）

- `974e344 feat(engine): one-sided directional passage edges` 同时改了 `bun.lock` 的 610 行。把 URL 归一化后，与 `d8324b0` 的 `bun.lock` 完全相同（`diff` 输出「IDENTICAL after normalizing registry URLs」）。也就是说，唯一的改动是把 305 个包的 resolved 从 `""`（默认 registry）改成了 `https://<internal-mirror>/...`。
- `main`/`7cf590c` 里这类 URL 为 0 处；KF1（1844）的 worktree 里有同样的改写，但没有提交。可见这是本机 `bun install` 带来的环境噪音。
- 危害：公开仓的 lockfile 会指向内部镜像；GitHub Pages CI 在 `.github/workflows/pages.yml:53` 执行 `bun install --frozen-lockfile`，会去这个主机拉包。修法：`git checkout d8324b0 -- bun.lock` 后单独提交，或者整理提交时剔除这个文件。

## 逐条对照规格（`kit-K2-movement.md`）

### 要做的

| # | 要求 | 判定 | 证据 |
| --- | --- | --- | --- |
| 1 | T2-4 `moveRoute` 可指定任意事件，`wait` 语义与原来一致 | 成立 | `types.ts` 的 `RouteTarget`；`interpreter.ts:1135-1166` 在发布时把 `"this"` 解析成自身事件；`session.ts` 目标事件没有角色时立即恢复 waiter；测试 `k2-movement.test.ts:91-124`（waited 挂起到落地、fire-and-forget 立即返回）通过 |
| 2 | T2-5 `turnTowardPlayer`/`turnToward`/`pathTo`/`approach`，确定性 BFS，被挡等待后重算、**最多 N 次**，与 hz 无关 | **部分** | 转向与站位语义正确（`facingToward` 纵轴优先，与 Tuxemon `map.py:237 get_direction` 的 `abs(y)>=abs(x)` 一致）；确定性和 hz 无关也成立（见额外核对 2）；**重试上限不成立（B2）** |
| 3 | T2-18 单向通行边；passability/movement/寻路都遵守；旧的无向写法保持原义 | **部分** | 单向语义与遵守情况见额外核对 1，成立；无向 `dirBlock` 有边角漂移（N1），运行期 overrides 回归（B1） |
| 4 | K1 审查非阻断项的两个有区分力的 sim 用例，改坏会红 | 成立 | `tests/k2-events-sim.test.ts`，4 个用例通过；本审查另做变异 M5（`all` 只判最后一条子句），用例变红（见「变异检查」） |

### 验收

| 验收 | 判定 | 证据 |
| --- | --- | --- |
| 单测 + sim 测试 | 成立 | `k2-movement`、`pathfind`、`movement`、`k2-events-sim`、`save` 均通过 |
| 多 hz 一致 | 成立（测试覆盖偏弱） | builder 的测试只用小图，BFS 一个切片就搜完；本审查在 100×100 大图上跑了 60/30/20/15 Hz（`multihz-big.ts`），终点与朝向一致，完成 tick 为 2741/2742/2742/2744 和 1064/1064/1065/1064，差值不超过 `ticksPerFrame-1` |
| 两遍哈希一致 | 成立 | 两次 `bun run build:example`，`dist/` 下 16 个文件 sha256 全部一致 |
| 存档中途读档一致 | **部分** | 走路中途：成立；分帧搜索中途：**不成立（B3）** |
| 现有测试全绿、goldens 不变、tsc 0 | 成立（但见 B1） | 638 pass / 0 fail；`git diff d8324b0..HEAD -- tests/goldens` 为空；`tsc` exit 0 |
| QuickJS：100×100 一次 `pathTo` 最坏值、10 事件同时寻路每帧 p95/最大（目标 ≤2 ms，超了就分帧） | 成立（数字复现） | 见「性能」。真实 reducer 10 路 p95 为 1.60–1.71 ms；最大 2.56–2.60 ms，略超 2 ms，builder 已如实写明 |
| README 补说明 | 部分 | 只在 `src/engine/README.md` 的模块清单加了 5 行；根 `README.md:250` 的 `moveRoute` 仍写「force the player or this event」，格式一节没提 `dirEdges` 和新的步骤类型 |

## 收尾规格（`kit-K2-continue.md`）

| # | 要求 | 判定 | 证据 |
| --- | --- | --- | --- |
| 1 | 门禁 | 成立 | 见「门禁复跑」 |
| 2 | QuickJS 分帧后数字 | 成立 | 见「性能」 |
| 3 | 存档中途/多 hz 有测试且会被变异打红 | 部分 | 多 hz 与走路中途存档有测试，builder 做了变异；分帧搜索中途没有测试，且确实有问题（B3） |
| 4 | README；代码/注释无 fleet 编号；`vendor/pocketjs` 不提交 | 部分 | `src/engine/passability.ts:22` 注释里有「(G5 collision report, **proposal 1643**)」，1643 是 fleet 提案号（与 builder 报告里「no current Fleet task-number references」的说法不符）；`vendor/pocketjs` 的 gitlink 在 `d8324b0` 和 HEAD 都是 `76ae741f`，子模块工作区干净 |
| 5 | 报告、提交、claim | 成立（报告有失实处） | `findings/K2.md` 写「Behavior is identical」（被 B1 否定），又写「no … task-number references」（与上一行不符） |

## 额外核对（`review-K2-extra.md`）

### 1. 单向通行边：与 Tuxemon 语义一致、旧 `dirBlock` 不变、寻路与移动都遵守

- **Tuxemon 语义**：Tuxemon 的 `enter_from`/`exit_from` 是按格记的**允许**方向集合。进入检查 `pairs(direction) in tile.enter_from`（`tuxemon/movement.py:336`）；离开检查的是该格显式列出的出口（`map/map.py:512-516`、`movement.py:is_explicitly_allowed`）。Kit 的 `dirEdges.enter`/`exit` 是按格记的**禁止**集合，方向同样以「该格的哪条边」命名：`canStepFrom` 查源格的 `exitMask` 和目标格反向边的 `entryMask`（`passability.ts:171-176`）。两者互为补集，可以一一表达（导入器取 `ALL − allow` 即可）。碰撞线在 Tuxemon 里按 `(position, direction)` 记，是单侧的（`movement.py:369`），也能落到源格的 `exit`。因此 kit 层的能力足以消除 G5 报告里的 1,161 处放宽，但游戏仓导入器（`importer/terrain.ts:636-722`，仍然只输出无向 mask）还需要一个后续改动，不在 K2 范围内。
- **移动与寻路都遵守**：`movement.test.ts` 的 6 条单向用例和 `pathfind.test.ts` 的 3 条单向用例都通过。本审查的端到端测试（`oneway-e2e.ts`，经 session reducer 让 NPC `pathTo`）：`exit:[right]` 的格在开阔图上会被绕开（`0,1->0,2->1,2->2,2->3,2->3,1->4,1`）；在单行走廊里正向不可达、会放弃，反向则可以穿过（`4,1->3,1->2,1->1,1->0,1`）；`enter:[left]` 时正向不可达。
- **旧 `dirBlock` 语义**：大体保持，有两处边角漂移（N1），当前组件仓内容没有用到；wander 的运行期 overrides 回归见 B1。

### 2. 寻路确定性

- 分帧与 hz 无关：切片在角色的边界 tick 里执行（`chars.ts` 的 `stepPath` 每个参考 tick 调一次 `advancePathSearch(…, BFS_CELLS_PER_TICK=250)`），不看毫秒。100×100 四档 hz 一致（`multihz-big.ts`，见上表）。
- 同地图、同状态得到同一路径：成立（没有 RNG，也不读时钟，扩展顺序固定为 down/left/up/right）。但运行期实际使用的增量内核，其顺序只由一条角到角的单测间接钉住（变异 M2/M2b）。
- 存档读回：走路中途成立；**搜索中途不成立（B3）**。
- 等待/重算有上限：**不成立（B2）**。

### 3. 性能可复现；内联/展开的可读性意见

- 复跑方法：把 builder 的宿主 crate（`/var/tmp/fleet/1824/quickjs-host`，`src/k2_path_bench.rs` 的 sha256 与原件一致）复制到 `/var/tmp/fleet/1846/quickjs-host`，`touch` 后重新编译。用本审查自己构建的 `dist`（与 builder 的字节一致），`BENCH_FRAMES=1000 BENCH_WARMUP=200`，当时机器负载约 4.7/32 核。结果见「性能」，与 builder 同量级。
- 可读性意见（不算阻断）：展开后的 BFS 每个方向一段、带边位注释，单看可读。问题在于**同样的四段展开写了两遍**（`bfsPath` 在 `pathfind.ts:93-143`，`advancePathSearch` 在 `:235-273`），而运行期只用后者。变异 M2/M4 表明，后者的邻居顺序和出口边检查几乎没有测试钉住，两份内核会悄悄分叉。另外，路径步逻辑在 `chars.ts:stepPath`（约 150 行）和 `session.ts:stepPlayerPath`（约 140 行）各有一份，两个 clone 助手（`clonePathSearch`/`clonePlayerPathSearch`）、`DIR4`/`DIR4_PLAYER` 也各有一份。B2 就在两份里各出现了一次，这正是重复带来的维护成本。建议：只保留一个内核（同步版 = 增量版加上无限预算），NPC 与玩家共用同一个 plan 步进函数，再加一条随机图上「同步版 vs 增量版」的差分测试（覆盖 dirEdges/dirBlock/bodies 和各种起终点）。

### 4. 与组件仓 main（`7cf590c`）和 KF1（1844）的关系（合并参考，不算阻断）

- `git merge-tree --write-tree HEAD 7cf590c`：K2 与 main 共同改动 7 个文件（`editor/engine/projects.ts`、`src/data/schema.json`、`src/engine/{interpreter,save-validate,session,types}.ts`、`tests/sunstone-game-sim.test.ts`），**唯一的文本冲突在 `tests/sunstone-game-sim.test.ts` 的包体上限**：main 是 345,000（331 KB），K2 是 342,000（340,595 B）。
- 试合并（临时 worktree，冲突取 main 一侧）：`build:example` 通过，`tsc` 0，`bun test` 共 659 条，658 pass，**1 fail，就是这个上限**：合并后 `dist/sunstone.js` = **351,456 B**，超过两边的上限。合并时需要把上限提到约 355,000–360,000。没有发现其他语义冲突。
- KF1（1844）：worktree 仍在 `7cf590c`，还没有代码改动（只有未提交的 `bun.lock` 镜像改写和 `vendor/pocketjs` 类型变化）。K2 **完全没碰 `src/ui/`**（包括 `GameView.tsx`），所以与 KF1 的 GameView 重做预计没有文本冲突。可能的交叉点：同一条 sunstone 包体上限（KF1 很可能也会让包体变大）；如果 KF1 给 `MapDef` 按 id 建索引时动到 `session.ts`，会与 K2 的 `session.ts` 改动（玩家路线 plan、`stepPlayerPath`）挨在一起，需要人工看一眼。
- wander 示例（B1）在合并后同样会受影响。

### 5. 代码/注释无 fleet 编号；`vendor/pocketjs` 未提交类型变更

- 编号：`src/engine/passability.ts:22` 有 `proposal 1643`（**不成立**，需删除）。另有 `K1-review leftover`、`K2/T2-18` 这类任务标签（不是编号），与既有惯例一致。
- `vendor/pocketjs`：成立（gitlink 没变，也没有提交 typechange）。

## 门禁复跑（审查者亲自执行，worktree `51e3994`）

```
$ bun run build:example            # exit 0（real 8.5s）；再跑一次，dist/ 16 个文件 sha256 全部一致
$ bunx tsc --noEmit                # exit 0
$ bun test tests/                  # 638 pass, 0 fail, 455044 expect() calls, 37 files [76.12s]
$ git diff d8324b0..HEAD --name-only -- tests/goldens | wc -l   # 0
```

## 变异检查（每次改完都 `git checkout` 还原；sim 类会重建 dist，重建后与原 dist 逐字节一致）

| 编号 | 变异 | 结果 |
| --- | --- | --- |
| M1 | `buildPassage` 把 `dirEdges.enter` 同时写入 exitMask（单向退化为无向） | **红**：`movement`、`pathfind` 共 6 条失败 |
| M2 | 运行期增量 BFS（`advancePathSearch`）交换 left/up 的扩展顺序 | **不红**：`pathfind`、`k2-movement`、`k2-events-sim` 共 36 条全部通过 |
| M2b | 增量 BFS 顺序改为 up,right,down,left | 只有 1 条单测变红（角到角搜索的同步版 vs 增量版一致性），会话层和 sim 测试都没变红 |
| M3 | 重试守卫 `retriesLeft <= 0` 改为 `< 0` | **红**：`retries:0` 那条用例失败 |
| M4 | 增量 BFS 去掉源格 `exitMask` 检查（寻路无视出口侧单向边） | **不红**：4 个文件共 84 条全部通过 |
| M5 | `allClausesHold` 只判最后一条子句（重建 bundle） | **红**：`compound all page gate` sim 用例失败 |

结论：单向语义、`all` 门、重试守卫这几处的断言有区分力；但**运行期寻路内核的顺序（M2）和出口侧遵守（M4）没有测试钉住**（N2）。

## 性能（QuickJS，桌面宿主，event-model bundle，warmup 200 + 1000 帧）

| 用例 | builder mean/p95/max (ms) | 审查复跑 mean/p50/p95/p99/max (ms) |
| --- | --- | --- |
| 100×100 一次同步角到角 BFS（10,000 格） | 2.8865 / 3.1223 / 4.0545 | 2.7524 / 2.6898 / 2.9913 / 3.5595 / 4.5606 |
| 每帧 10 次同步 BFS（上界） | 22.3395 / 23.7575 / 24.6365 | 21.2138 / 21.0892 / 22.6339 / 23.1179 / 24.6674 |
| 每帧 10 个增量切片（内核） | 0.7778 / 0.8622 / 0.9095 | 0.8376 / 0.8353 / 0.8649 / 0.9729 / 2.1421 |
| 每帧 10 条真实事件路线（完整 reducer） | 1.2917 / 1.7118 / 2.6015 | 1.1979 / 1.2790 / 1.5962 / 1.7252 / 2.5590 |

原始输出：`/var/tmp/fleet/1846/bench-rerun1.log`。补充：「真实 10 路」基准的目标格被围死、`retries: 100000`，所以测到的是持续搜索加重算的稳态，每 tick 还要复制每个搜索 NPC 约 80 KB 的 typed array，这个设计是合理的。另外，`pathTo` 到自身所在格会在 100×100 上把整图搜一遍才结束（41 tick，其中 39 tick 在搜；10×10 只要 2 tick，见 `pathto-self.ts`，N4）。

## 画面

K2 没有改 UI（`src/ui/` 零改动），也没有新增渲染产物；`tests/goldens` 零改动，含 golden 的渲染测试都通过。本任务没有需要肉眼核对的新 PNG。

## 原则

- 内容导入：不涉及（组件仓任务）。
- Tuxemon 专用代码：没有。新增能力是通用的（单向边、任意事件路线、转向、寻路、靠近）；注释里引用了 Tuxemon 语义，与 main 已有惯例一致（`interpreter.ts` 早就引用 `boundary.py`）。
- `vendor/pocketjs`：未修改。

## 非阻断问题（建议随修复一并处理）

- **N1　无向 `dirBlock` 在边角情况下有语义漂移**。差分脚本 `passage-diff.ts` 在 3,000 张随机小图上对比 `d8324b0` 与 K2 的 passability，只用旧词汇，共 56,767 格：
  - (a) 列在 `sheet.pass` 里、同时带 `dirBlock` 的格：旧实现在 `sheetCellBlocks` 里先判 pass，入口半边不生效；新实现生效（`canEnter(target, entry)` 有 8,533 处由 true 变 false）。新行为更符合 `types.ts`/schema 的文字描述。
  - (b) 带 passage override（pass/block）或本身实心的格：旧 `cellBlocksExit` 无视 override，照读 sheet 的 `dirBlock` 出口半边；新实现只给「非实心、无 override」的格烘出口 mask，于是站在这类格上可以从被 `dirBlock` 的边离开（多组 old=false → new=true）。
  - 当前组件仓示例都没有 `dirBlock` 数据。Tuxemon 导入器用的是 `defaultPassage:"pass"` 加上 block override 加上无向 mask（`importer/terrain.ts:717-721`），只有「角色站在被 block 的格上」时 (b) 才会显现。建议：要么恢复旧的出口语义，要么在 CHANGELOG/types 里明确新口径，并补对应单测。
- **N2　测试缺口**：运行期增量 BFS 的邻居顺序（M2）和出口侧遵守（M4）没有测试；多 hz 测试只在单切片小图上跑；分帧搜索中途的往返没有测试（B3）；`retries ≥ 1` 的上限没有测试（B2）。
- **N3　文档与实现不一致**：
  - `types.ts:57-60` 写「the whole path is recomputed after `retries` blocked retries」，schema 的 `moveStep` 描述写「replans after 'retries' blocked boundary ticks」。实际实现是：等 `PATH_REPLAN_TICKS=8` 个 tick（实测 7 个）后重算，`retries` 是放弃前允许重算的次数（而且因为 B2 并不生效）。
  - `pathfind.ts:48-51` 写「never enters a `blocked.cells` member except the goal」，但代码对目标格同样拦截。
  - `pathfind.ts:187-188` 写「start===goal returns a state already done」，实际并不是（见 N4）。
  - 根 `README.md:250` 的 `moveRoute` 说明过时。
  - 提交 `9bc473f` 说明里写 600 格/tick，代码实际是 250（后续提交已改）。
- **N4　`pathTo`/`approach` 的目标就是当前格时仍会整图搜索**：增量内核出队时不检查 `cur === goal`，NPC 侧也没有先短路（玩家侧 `session.ts` 有）。在 100×100 上多花约 40 tick 和一次整图搜索。
- **N5　与 Tuxemon 的路径细节**：Tuxemon 用 A*（`movement.py:158-213`，堆加 set 迭代），K2 用固定顺序 BFS。两者都给出最短路径，但等长备选路径的取舍可能不同。规格只要求确定性，这里仅作记录。
- **N6　性能边角**：真实 reducer 的最大帧 2.56–2.60 ms，略超 2 ms 目标（1000 帧中 1 帧）；p95/p99 在目标内。

## 结论

实现的主体质量不错：单向边语义正确、分帧 BFS 与 hz 无关、QuickJS 数字可复现、门禁全绿。但 B1（现有示例回归）、B2（重试上限失效，会软锁）、B3（分帧搜索中途存档不一致）、B4（lockfile 泄漏内部镜像）都是明确的阻断项，要在 `fleet/task-1824` 上修复后复审。

FAIL
