# 复审 K2 修复 1（task 1847）：B1–B4 与非阻断项

- 审查任务：1848（按 `reviewer-generic.md` + `review-K2-fix1.md`）
- 被审分支：`fleet/task-1824`，修复提交 `c62bc19..c544f19`（7 个），修前参照 `9d0a785`（= 上轮被审 HEAD `51e3994` + 上轮审查报告），K2 前基线 `d8324b0`
- 规格：`kit-K2-fix1.md`（修复任务单）、上轮报告 `findings/review-task-1842.md`
- 日期：2026-09-29
- 复现脚本：上轮的 `findings/review-task-1842/*.ts`，本轮新增 `findings/review-task-1847/*`。修前用 `git archive 9d0a785` 解到 `/var/tmp/fleet/1848/pre`，K2 前用 `git archive d8324b0` 解到 `/var/tmp/fleet/1848/base-full`；两处都软链本 worktree 的 `node_modules` 和 `vendor/pocketjs`（gitlink 同为 `76ae741f`）。QuickJS 宿主是 builder 的 crate 拷贝（`/var/tmp/fleet/1848/quickjs-host`），额外 `include!` 了 wander 的场景基准（`wander_bench.rs`，拷自 `/var/tmp/kit-wander-scratch/bench-host/src/bench.rs`），没有改子模块。

## 结论摘要

B1–B4 四个阻断项都修好了：修前红、修后绿，都亲自复现过。另外补了一批比上轮更严的对抗检查：
- 修前/修后的差分：旧词汇下，运行期 override 序列经 `setPassageOverride` 与 `d8324b0` 直接写数组逐位一致。
- 同步版与增量版 BFS 在 20,000 张随机图上零差异。
- 分帧搜索每一帧都做 JSON 存档往返：228 个检查点，逐帧比较 68,400 次，零差异。

门禁全绿：两次构建 16 个文件逐字节一致，`tsc` 0，`bun test` 646/0。上轮宣称已处理的非阻断项基本落实。上轮存活的两个变异 M2/M4 现在都会被测试打红。

但有 **1 个新阻断项（B5）**。本轮修复重写了 `buildPassage`：`c62bc19` 改成每格调用一次 `cookPassageCell`，`d74886e` 再让带 override 的格也解析一遍 tile id。结果 QuickJS 下 passage 烘焙比修前又慢了约 1.2–1.6 倍：
- wander 每次浮动原点重建都要付这笔：重建帧从修前 6.6–10.0 ms 升到 10.0–12.5 ms。K2 前是约 1.8 ms。
- Tuxemon 规模（263 图、175,093 格）的整表烘焙从 110–136 ms 升到 168–220 ms。K2 前是 11–13 ms。

builder 报告里「修复没有造成可观测的 QuickJS 回退」的结论只测了寻路基准，没覆盖这条路径。规格明确要求「QuickJS 数字不回退」，所以判 FAIL。修法很小：按 tile id 记忆化烘焙。本审查的原型与 HEAD 产物逐格一致，把重建帧降到 2.3–3.4 ms，Tuxemon 整表降到 37–45 ms。

## 阻断项

### B5　修复后的 passage 烘焙在 QuickJS 下比修前更慢，wander 重建帧和整表烘焙明显回退；报告的「无 QuickJS 回退」结论没有覆盖这条路径

- **成因**：`c62bc19`（B1）把 `buildPassage` 的内联循环改成对每格调用 `cookPassageCell(table, idx)`（`src/engine/passability.ts:88-127`、`:147`）：每格一次函数调用，每次读写都走 `table.*` 属性；并且每格先把 3 个数组清零。`d74886e`（N1 还原）又让带 PASS/BLOCK override 的格也执行 `parseTileId` 等全部解析（`:99-109`），以便算出 exitMask。热点是逐格 `parseTileId`：两次字符串 `slice`、`Number()`、分配一个对象，加上 `Map.get`。可是一张图里不同的 tile id 很少：wander 窗口 9,216 格只有 5 种，当前 Tuxemon 导入产物全是 `tux.0` 这 1 种。
- **影响面**：`createSession` 在会话创建时给**所有地图**建表（`src/engine/session.ts:160`）。wander 每次浮动原点重建都会新建会话（`examples/wander/wander-sim.ts` 的 `swap → makeSession → createSession`），所以这笔开销落在重建帧上。Tuxemon 则是开机时付一次。
- **QuickJS 实测**（release 桌面宿主，rquickjs；数字为多次运行的区间）：

  | 场景 | K2 前 `d8324b0` | 修前 `9d0a785` | 修后 HEAD | 记忆化原型 |
  | --- | ---: | ---: | ---: | ---: |
  | wander 96×96 `buildPassage` 均值 | 0.33–0.38 ms | 6.66–7.96 ms | **9.09–11.05 ms** | 1.70 ms |
  | wander `sim.step` 重建帧（27 次/7,200 帧）均值 / 最大 | 1.30 / 1.89 ms | 7.70–8.04 / 8.96 ms | **10.96–11.18 / 12.39 ms** | — |
  | wander 整个 app（Guest+UiSurface，480×272，3,600 帧）10 个重建帧 | ≤1.76 ms | 6.62–9.95 ms | **9.97–12.49 ms** | 2.33–3.36 ms |
  | 同上：最坏帧 / 超过 8 ms 的帧数 | 4.61 ms / 0 | 9.33–9.95 ms / 2–8 | **12.44–12.49 ms / 10–11** | 4.08–4.84 ms / 0 |
  | Tuxemon 263 图 175,093 格整表烘焙（5 次） | 11.4–13.3 ms | 109.7–136.4 ms | **168.1–220.3 ms** | 36.8–44.7 ms |

  各场景的轨迹完全一致（终点 `{"x":210,"y":-19}`，重建 10 次），所以可以直接对比。按提交归因（Tuxemon 整表，同一轮）：修前 110–127 ms，`c62bc19` 163–170 ms，`d74886e` 197–210 ms。原始输出见 `/var/tmp/fleet/1848/bench-*.log`。
- **为什么算阻断**：`kit-K2-fix1.md` 的验收写的是「QuickJS 数字不回退（报告里给修后数字）」，本轮复审规格第 2 条是「新 API 的语义与性能（QuickJS 数字不回退）」，context 的硬规矩要求「每帧/切图耗时要报 QuickJS 的数」。`findings/K2.md` 的「修后 QuickJS 复测」只复跑了 K2 寻路基准。寻路基准确实没有回退（见「性能」），但它不经过 `buildPassage`，所以「修复没有造成可观测的 QuickJS 回退」这个结论不成立。桌面上单帧仍低于 16.7 ms，但与修前相比，wander 的 10 个重建帧均值上升 33–49%（7.70/8.36 → 11.46/11.13 ms），最坏帧上升 25–34%，而 context 把网页和 PSP 列为目标平台。
- **额外说明（K2 整体，上轮漏测）**：从 K2 前到修前，wander 重建帧已经从约 1.8 ms 涨到约 8 ms，Tuxemon 整表从约 12 ms 涨到约 130 ms。来源是 `4fe95d0` 把惰性查表改成了开机全量烘焙。本轮让它再慢了约 30%。
- **修法（建议）**：`buildPassage` 里对每个不同的 tile id 只算一次地形意见（solid 位、entry、exit、是否 sheet.pass），打包成一个整数缓存在 `Map<TileId, number>`。逐格只做 override 优先级判断和数组写入，数组都放在局部变量里。`setPassageOverride` 可以继续用单格的 `cookPassageCell`，它每次调用 1.1–1.3 µs，不是瓶颈。原型见 `findings/review-task-1847/memo-prototype.patch`：
  - 与 HEAD 的 `solid/entryMask/exitMask/overrides` 在 5,000 张随机图、144,856 格上零差异。
  - 在原型 checkout 里 `build:example` 通过；`movement`/`pathfind`/`k2-movement`/`wander-sim`/`body-passability` 共 100 条测试全过。
  - wander 重建帧 2.3–3.4 ms，Tuxemon 整表 37–45 ms，都优于修前。
  - 修完需在报告里补 wander 重建帧和整表烘焙的 QuickJS 数字。

## 逐条核对 B1–B4（上轮复现脚本，修前红 → 修后绿）

| 项 | 修前 `9d0a785` | 修后 HEAD `c544f19` | 判定 |
| --- | --- | --- | --- |
| B1 wander 生长阻挡（`review-task-1842/wander-grow-fixed.ts`） | `(47,37) overrides=-1 canEnter=true`；按住下：`47,36 -> 47,37 -> 47,38 -> 47,39` | `canEnter=false`；`47,36`（停住） | **修复** |
| B2 重试上限（`retry-bound.ts`，20,000 tick） | pathTo retries=1/3/默认、approach 2/默认都「STILL PARKED」 | pathTo 0/1/3/默认 在 8/15/29/78 tick 恢复；approach 0/2/默认 在 8/22/78 tick 恢复 | **修复** |
| B2 轨迹（`retry-trace.ts`，retries=2） | 60 tick 内建了 9 个 plan，没有结束 | 建 3 个 plan（初始 1 个 + 重试 2 个），t22 起 route 清空，`scene done: A` | **修复** |
| B3 搜索中途 JSON 往返（`midsearch-roundtrip.ts`） | frame 500：`(1,57)` 对 `(1,55)`；frame 1000：`(22,98)` 对 `(21,98)` | 各采样帧位置全部一致，最后都到 `(99,98)` | **修复** |
| B4 lockfile | `974e344` 把 305 个包的 URL 改写成内部镜像 | `git diff d8324b0 HEAD -- bun.lock` 为 0 行；blob `01862b5b…` 与 `d8324b0` 相同；HEAD 树的 `bun.lock` 里 `<internal-mirror>` 出现 0 次，`https://` 出现 0 次；修复后只有 `6380b74` 这一个提交（只改 `bun.lock`）碰过它 | **修复** |

补充的对抗检查：
- **B1 语义**（`review-task-1847/passage-diff2.ts`）：3,000 张随机图、124,268 格、2,236,824 个布尔查询，另有 10,117 次运行期写入（`d8324b0` 直接写 `overrides`，HEAD 调 `setPassageOverride`，覆盖 BLOCK/PASS/清零）。`isStandable`、`canEnter`、`canEnter(entry)`、`canStepFrom`、`cellBlocksExit`、`overrides` 数组本身全部零差异。唯一的差异是导出的辅助函数 `cellBlocksEntry`（见 N-b）。
- **B2 边界**（`b2-edges.ts`）：
  - 阻挡在第 30 帧消失时，retries=0–3 会先放弃（8/15/22/29 帧），retries=5 在第 92 帧走到终点，与「有界」的语义一致。
  - `repeat` 的 page patrol 放弃后会以满额预算重来，每约 7 帧开一次搜索。这是 patrol 本身的设计，单帧开销仍受切片预算约束。
  - 上轮 `multihz-big.ts` 在 100×100 图上：n2 现在在第 2342/2342/2343/2344 tick（60/30/20/15 Hz）结束（修前永不结束）。60 Hz 下带活动搜索的帧数从 3,584 降到 483。各 hz 的终点和朝向一致。
- **B3 穷举**（`b3-exhaustive.ts`）：场景包括 NPC pathTo 越墙、NPC approach 玩家、玩家 pathTo 越墙、3 个 NPC 同时搜索，各跑 60/30 Hz。在**每一个**搜索进行中的帧做 JSON 往返，之后逐帧 `Bun.deepEquals` 比较 300 帧：228 个检查点、68,400 次比较、0 差异。同一脚本在修前的前三个场景上 39/39、34/34、39/39 个检查点**全部在恢复后的第一帧就分叉**，所以这个脚本有区分力。

## B1 覆盖面与新 API

- **运行期写 passage 的地方都已覆盖**：
  - 在组件仓的 `src/`、`examples/`、`editor/`、`tools/` 里搜 `overrides[..] =`、`.overrides.set/fill`、`solid`/`entryMask`/`exitMask` 的写入。除了 `passability.ts` 自己（`:145` 建表、`:165` 新 API），唯一的运行期写入就是 wander 的 `patchChunk`，已经改用 `setPassageOverride`（`examples/wander/wander-sim.ts:389`）。
  - `examples/wander/driver.ts:160,237` 只读 `overrides`，新 API 会同步维护它。
  - `grow`/`meadow`/`sunstone`/`wander window.ts` 都是在创作期拼 `map.passage`，再经 `buildPassage` 烘焙。
  - 编辑器只改项目 JSON，然后重建会话（`editor/` 和 `src/ui/` 里没有表写入）。
  - `tests/body-passability.test.ts:94` 写的是局部数组，随后转成 `passage` 交给 `buildPassage`，不属于运行期写入。
  - 游戏仓 `/var/tmp/oss/pocket-tuxemon`（`ba8800f`）没有调用任何 passage 表 API。
  - KF1（task-1844）worktree 相对 `7cf590c` 没有代码改动。
- **语义**：`setPassageOverride` 会校验下标和取值（`passability.ts:154-167`），只重烘这一格。每格的烘焙结果只取决于这一格自己的 ground、sheet 和 override，所以不存在需要连带更新的邻格。`stampBlockedCells` 的浅拷贝共享同一组数组，写入对带角色的表也立即可见。与 `d8324b0` 等价，见上面的差分。
- **性能**：`setPassageOverride` 在 QuickJS 下每次 1.09–1.34 µs，直接写数组是 0.05–0.06 µs。wander 7,200 帧里只有 124 帧有写入，共 1,048 次，单帧最多 78 次（`wander-writes-count.ts`）。最重的那一帧，生长阶段从修前 0.10–0.12 ms 升到 0.21–0.23 ms，可以忽略。真正的回退在 `buildPassage`，见 B5。
- **可维护性（非阻断）**：`PassageTable.overrides` 仍然是可写的公开 `Int8Array`，约束只写在注释里（`:49-50`）。`src/engine/README.md` 和 CHANGELOG 都没提「运行期改 passage 必须走 `setPassageOverride`，直接写数组不再生效」。下游（例如将来游戏仓要做动态碰撞）很容易踩到和 B1 一样的坑。

## 上轮「非阻断」中本次宣称处理的项

| 项 | 判定 | 证据 |
| --- | --- | --- |
| N1 恢复旧 `dirBlock` 边角语义 | 成立 | 上轮 `passage-diff.ts`（基线指向 `d8324b0`）：HEAD 输出「cells checked: 56767 / NO DIFFERENCES」；修前同一脚本有 8,533 处加若干组差异。本轮扩展差分见上。新测试 `tests/movement.test.ts:195`（sheet.pass 只在进入时绕过）、`:230`（PASS 格仍保留出口边）会被变异打红（N1a–c） |
| N2 增量 BFS 出口侧、固定顺序、同格目标的测试 | 成立 | `tests/pathfind.test.ts:157,174,181`。上轮存活的 M2（交换 left/up）和 M4（去掉出口检查）现在都会变红。残留缺口见 N-c |
| N2 `retries ≥ 1` 的上限测试、搜索中途往返测试 | 成立 | `tests/k2-movement.test.ts:177`（NPC 0/1/3/默认）、`:211`（玩家）、`:389`（JSON 往返，逐帧 `toEqual`） |
| N3 文档：types/schema 的 retries 口径、`pathfind.ts` 两处注释、根 README | 基本成立 | `pathfind.ts` 注释已改（「including the goal」「first advance immediately yields an empty path」）；根 `README.md:230-231,252` 已补 `dirEdges`、命名事件路线和寻路步骤；editor 生成的 `PROJECT_SCHEMA` 与 `src/data/schema.json` 深度相等。但新写的「before the route continues」说法与实现不符，见 N-a |
| N4 目标就是当前格时不再整图搜索 | 成立 | `pathfind.ts:262` 提前返回。`pathto-self.ts`：100×100 上修前 41 tick（其中 39 tick 在搜），HEAD 2 tick（0 tick 在搜） |
| `proposal 1643` 注释 | 成立 | 已删除（`passability.ts:21-22`）；`d8324b0..HEAD` 新增的非 findings 行里没有 fleet 任务号或提案号 |
| 性能数字不回退 | **不成立** | 寻路基准成立（见「性能」），passage 烘焙回退，见 B5 |

## 门禁复跑（审查者亲自执行，worktree `c544f19`）

```
$ bun run build:example     # exit 0（real 7.2s）；再跑一次（7.1s），dist/ 下 16 个文件 sha256 全部一致
$ bunx tsc --noEmit         # exit 0
$ bun test                  # 646 pass, 0 fail, 456698 expect() calls, 37 files [77.33s]
$ git diff --name-only d8324b0 HEAD -- tests/goldens '*.png' '*oracle*' | wc -l   # 0（共 735 个受跟踪文件，均未改动）
$ git ls-tree HEAD vendor/pocketjs   # 76ae741f…（与 d8324b0 相同，子模块工作区干净）
```

`dist/sunstone.js` 为 341,692 B，`dist/sunstone.pak` 为 3,308,352 B，与 `K2.md` 一致。

## 变异检查（`findings/review-task-1847/mutate.sh`：每次改完都 `git checkout` 还原，最后工作区干净）

| 编号 | 变异 | 结果 |
| --- | --- | --- |
| B1a | `setPassageOverride` 只写 overrides、不重烘 | **红**：`movement` 的运行期 override 用例和 `wander-sim` 的生长用例都失败 |
| B1b | wander 改回直接写 `table.overrides[at]` | **红**：`newly grown blockers update the live passage table` |
| B2a / B2b | NPC / 玩家每建一个新 plan 都重置预算（回到 B2 的 bug） | **红**：NPC 用例 / 玩家用例 |
| B2c | NPC「不可达」分支不递减预算 | **红** |
| B2d | NPC 守卫 `<= 0` 改成 `< 0` | **红** |
| B2e / B2f | NPC / 玩家「下一步被挡」分支不递减预算 | **不红**（91 条、21 条全部通过），见 N-c |
| B3a / B3b | `clonePathSearch` 不复原 Int32 / Uint8（`blockedMask`） | **红**：`JSON round-trip during an incremental search …` |
| N1a / N1b | PASS / BLOCK override 清掉 exitMask | **红**（2 条 / 1 条） |
| N1c | sheet.pass 格保留 dirBlock 进入限制 | **红** |
| N1d | sheet 实心格清掉 exitMask | **不红**（71 条全部通过），见 N-c |
| M2 | 增量 BFS 交换 left/up 的扩展顺序（上轮存活） | **红**：`equal-length ties … incremental kernel` |
| M4 | 增量 BFS 去掉全部出口检查（上轮存活） | **红**：`incremental search observes a source-side exit barrier` |
| M4b | 只去掉 down 方向的出口检查 | **不红**（87 条全部通过），见 N-c |
| N4 | 去掉 `start===goal` 提前返回 | **红** |

另做了差分：同步 `bfsPath` 与增量内核在 20,000 张随机图上比较（dirBlock、dirEdges、sheet 的 pass/block、override、空洞、角色阻挡、blockedCells，每次切片 1–5 格），0 处不一致（`bfs-diff.ts`）。

## 性能（QuickJS，release 桌面宿主）

**K2 寻路基准**（builder 的 `k2_path_bench`，event-model bundle，200 帧预热 + 1,000 帧，HEAD 与修前交替各跑两轮；mean / p95 / max，单位 ms）：

| 用例 | HEAD 第 1 轮 | 修前 第 1 轮 | HEAD 第 2 轮 | 修前 第 2 轮 |
| --- | --- | --- | --- | --- |
| 一次同步角到角 BFS | 2.845 / 3.103 / 4.648 | 2.846 / 3.111 / 4.454 | 2.991 / 3.120 / 4.230 | 2.791 / 3.101 / 3.982 |
| 每帧 10 次同步 BFS | 21.93 / 23.56 / 24.95 | 22.39 / 23.60 / 25.52 | 22.19 / 23.61 / 24.97 | 21.84 / 23.61 / 25.23 |
| 每帧 10 个增量切片 | 0.762 / 0.844 / 1.626 | 0.858 / 0.889 / 1.146 | 0.775 / 0.878 / 1.343 | 0.835 / 0.890 / 2.311 |
| 每帧 10 条真实路线（完整 reducer） | 1.329 / 1.778 / 3.019 | 1.300 / 1.764 / 2.837 | 1.202 / 1.604 / 2.260 | 1.168 / 1.588 / 2.360 |

- 两者处在同一分布内，最大值由个别离群帧决定。**寻路路径没有回退**，与 builder 的结论一致。
- 夹具里 `real-ten` 用的是 `retries: 100_000`（`tests/fixtures/event-model/project.ts:309`），B2 修复后仍然是稳态搜索，所以前后可比。
- 原始输出：`/var/tmp/fleet/1848/bench-k2.log`。

**passage 烘焙与 wander**：见 B5 的表格。原始输出：
- `bench-wander-swap.log`、`bench-buildpassage.log`、`bench-tux-boot*.log`
- `bench-wander-app*.log`、`bench-wander-qjs.log`

复跑方法：
- `bun build --target=browser --format=iife` 打包 `*-qjs.template.ts`（把 `__ROOT__` 替换成对应 checkout），再用 `wander_bench::qjs_script` 在裸 QuickJS Guest 里执行。
- 整个 app 用 `run-wander-app.sh <dist>`（`wander_bench::app_bench`）。
- 测量时机器负载 1–5 / 32 核。

## 画面

本轮只改了引擎、wander 模拟和文档，没有改 `src/ui/`，也没有新增渲染产物。735 个 golden/oracle/PNG 文件都没变，带 golden 的渲染测试都在全量测试中通过，所以本轮没有需要肉眼核对的新 PNG。

## 原则

- 没有写 Tuxemon 专用代码。`passability.ts:21-22` 注释里引用了 G5 的数据统计，与既有惯例一致。
- 没有改 `vendor/pocketjs`。
- 提交作者都是 `lfkdsk <lfkdsk@gmail.com>`，没有 trailer；提交信息按规格带上了 B 编号。

## 非阻断问题

- **N-a　「before the route continues」的文案与实现不符**：`src/engine/types.ts:60`、`src/data/schema.json:581`（以及 editor 副本 `:610`）写的是 retries 用完后「before the route continues / before continuing the route」。实现是 `releaseRoute`/`endPlayerRoute`，**整条路线就此结束**，后面的步骤不再执行。`b2-edges.ts`：`[pathTo 不可达 retries=1, moveLeft]`，NPC 和玩家都在第 15 帧结束，`moveLeft` 被跳过。这符合修复规格的「路线结束」，但 schema 是规范性文档，应改成「然后放弃这条路线（剩余步骤不执行），恢复等待方」。
- **N-b　导出的 `cellBlocksEntry` 口径变了**：旧版是「目标格 sheet 的 dirBlock 原始掩码」，不看 override、实心和 sheet.pass；现在读的是烘焙后的 `entryMask`。随机差分里有 35,053 处 old=true → new=false（修前是 25,406 处）。组件仓运行期没有调用它，游戏仓也没用，只是公开 API 的口径漂移，建议在注释或 CHANGELOG 里写明。
- **N-c　测试缺口（残留）**：
  - 「下一步被挡」分支的预算递减没有测试钉住（B2e/B2f 存活）。
  - 「站在实心格上仍受出口边限制」没有单测（N1d 存活；随机差分确认实现是对的）。
  - 增量内核的出口检查只有 right 方向有用例（M4b 存活）。
  - 建议加一条上轮提过的「同步版 vs 增量版随机图差分」单测（本审查的 `bfs-diff.ts` 可以直接改成测试）。
- **N-d　文档漂移**：
  - `src/engine/clone.ts:5` 仍写「typed arrays are NOT part of these states」。K2 之后搜索中途的 `SessionState` 就带 typed array，B3 的修法恰好依赖「先经过克隆器再复原」。
  - `setPassageOverride` 没有写进 `src/engine/README.md` 和 CHANGELOG（见 B1 一节）。
  - B3 的修法是在克隆器里隐式复原，不是规格给的两个选项（可 JSON 往返的结构，或显式序列化）之一；功能上没问题，但刚 `JSON.parse` 出来、还没走过一次 `stepSession` 的状态与原状态结构并不相等。
- **N-e　`K2.md` 小失实**：「之后 1,618 帧逐帧…」，同一场景实测为 1,611 帧（`b3-count.ts`）；「56,767 个格/方向组合」其实是 56,767 个格，每格检查多个方向。
- **N-f　lockfile 历史**：最终树干净，但 `974e344` 的历史里仍有 305 个内部镜像 URL（`git log d8324b0..HEAD -p -- bun.lock` 能 grep 到 610 行）。上轮报告 `findings/review-task-1842.md` 的正文也点名了这个镜像主机。组件仓 main 从来没有 `findings/`，合并时建议 squash，或者把 `974e344` 的 lockfile 片段剔掉，并且不带 `findings/`，以免主机名进入公开历史。
- **N-g　合并参考**：`git merge-tree HEAD 7cf590c` 仍然只有 `tests/sunstone-game-sim.test.ts` 的包体上限这一处文本冲突，其余 8 个两边都改过的文件可以自动合并。
- **N-h　真实 reducer 10 路的最大帧**仍偶尔超过 2 ms（本轮 2.26–3.02 ms），p95 1.60–1.78 ms，与上轮 N6 相同。

## 结论

B1–B4 修得扎实：都有回归测试，变异会变红，对抗检查也都通过；上轮的大部分非阻断项也落实了。但修复重写的 passage 烘焙在 QuickJS 下明确回退（B5）：wander 重建帧均值 +33–49%，Tuxemon 规模整表烘焙约 +30–60%。这违反了「QuickJS 数字不回退」的验收，报告也没测这条路径。按 tile id 记忆化即可修复，原型已验证语义一致、比修前还快，修完补上 wander 重建帧和整表烘焙的 QuickJS 数字后复审。

FAIL
