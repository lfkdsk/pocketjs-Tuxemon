# 复审 K2 修复 2（task 1851）：B5 passage 烘焙记忆化

- 审查任务：1853（按 `reviewer-generic.md`，规格见任务单：QuickJS 复跑、记忆化正确性、门禁与变异）
- 被审分支：`fleet/task-1824`，修复提交 `ad386d8..d2f57d3`（4 个：`ad386d8` 记忆化、`337a865` 相邻复用、`227f258` 包体上限、`d2f57d3` 文档），修前参照 `a1960b6`（其 `src/engine`、`examples` 与 `d74886e` 相同），K2 前基线 `d8324b0`
- 上轮报告：`findings/review-task-1847.md`（FAIL，唯一阻断项 B5）
- 日期：2026-09-29
- 复现脚本与原始输出：`findings/review-task-1851/`（本报告引用的所有日志都在这里），工作目录 `/var/tmp/fleet/1853`。QuickJS 宿主是上轮 crate 拷贝的再拷贝（`/var/tmp/fleet/1853/quickjs-host`），只把 `app_bench` 打印慢帧的阈值改成环境变量 `BENCH_SLOW_MS`（`wander_bench-slow-threshold.patch`），这样每个重建帧的耗时都能列出来；`qjs_script` 未改。修前用 `git archive a1960b6` 解到 `/var/tmp/fleet/1853/pre-full`，软链本 worktree 的 `node_modules` 与 `vendor/pocketjs`。

## 结论摘要

B5 本身修好了，而且数字比上轮原型更好：wander 96×96 `buildPassage` 均值 1.5–1.8 ms（修前 9.3–11.1 ms），sim 重建帧均值 2.4–2.6 ms、最大 2.7–3.3 ms（修前 10.7–11.3 / 12.0–13.4 ms），Tuxemon 263 图整表 31.6–42.7 ms（修前 168–212 ms）。同一台机器上修前数字与上轮报告一致，所以可以直接对比。记忆化在语义上是正确的：40,400 张随机图、3,143,125 格、302,798 次运行期写入，HEAD 与修前实现逐格零差异，`setPassageOverride` 单格更新与整表重建零差异。

门禁全绿：两次构建 16 个文件逐字节一致，`tsc` 0，`bun test` 647/0，`bun.lock` 与 `d8324b0` 无差异。

但是规格第 3 条「变异检查（改坏缓存键，测试应变红）」**没有过**：把缓存键改成只剩 cell 号（丢掉 sheet）之后，**全部 647 条测试仍然通过**；让 PASS override 把 entry 位带进后续同 tile 格的变异也 647/647 通过。builder 新增的回归测试只断言了第 0–2 格，看不到从第 3 格开始的泄漏，所以 `K2.md` 里「确认缓存的静态意见不会夹带逐格 override」这条不成立。这是唯一的阻断项（B6），修法只涉及测试：本审查给出的 `test-gap.patch`（45 行）在 HEAD 上绿，并让 5 个缓存相关变异在 `movement.test.ts` 一个文件内就变红。

另有一个需要说明的性能现象（非阻断）：完整 app 里仍有 > 8 ms 的帧，但都是 QuickJS GC 停顿，关掉自动 GC 后 7,200 帧全部 ≤ 3.9 ms；K2 前基线在同一轨迹上也有 6.3 ms 的 GC 帧。见 N-a。

## 阻断项

### B6　缓存键与快路径没有被测试钉住：两个变异在全部 647 条测试下存活；新增回归测试的断言止于第 2 格

- **现象**（`findings/review-task-1851/mutate.sh`，日志 `mutate-summary.log`、`mutfull-summary.txt`）：
  - MK2「缓存键只用 cell 号」：`opinions.get(tile)` → `opinions.get(tile.slice(tile.lastIndexOf(".") + 1))`（`src/engine/passability.ts:178,180`）。passage 相关 8 个测试文件 216/216 通过，**全量 `bun test` 647 pass / 0 fail**。
  - MK5b「PASS override 清掉后续同 tile 格的 entry 位」：在 `:185` 的 PASS 分支加 `previousOpinion &= ~(OPINION_MASK << OPINION_ENTRY_SHIFT)`。8 个文件 216/216，**全量 647/0**。
  - MK5「BLOCK override 把 solid 位带进 `previousOpinion`」（`:186-188`）：其它 9 条测试变红，但 builder 为此写的 `tests/movement.test.ts:153`「reused tile opinions keep build-time overrides cell-local」**本身通过**。
- **原因**：该测试的地图是 100 格同一 tile `edge.0`，override 在第 1（BLOCK）、第 2（PASS）格，断言只取 `slice(0, 3)`（`:165-167`）。泄漏进 `previousOpinion` 的位只会影响**之后**的同 tile 格，也就是第 3 格起，恰好在断言之外。而现有测试里没有一张图同时用到两个 sheet 的同一 cell 号且两者意见不同（`tests/body-passability.test.ts:85-99` 的 `open.0`/`wall.0` 同图出现，但那条测试比较的是同一张基表派生出的两个视图，基表错了也相等），所以丢掉 sheet 的键没人发现。
- **为什么算阻断**：本轮规格把「改坏缓存键，测试应变红」列在门禁里；K2.md「修复 2」宣称新增测试「确认缓存的静态意见不会夹带逐格 override」，被上面的 MK5/MK5b 推翻。Tuxemon 引用 50 个 tileset，同图多 sheet 同 cell 号是常态，这个键一旦被重构改坏不会有任何测试报警。
- **修法（已验证）**：`findings/review-task-1851/test-gap.patch`，对 `tests/movement.test.ts` 两处改动：(1) 把现有测试的断言扩到 `slice(0, 4)`，第 3 格是紧跟 BLOCK/PASS 之后的同 tile 格；(2) 新增「reused tile opinions are keyed by sheet and cell together」：sheet `a`（默认 pass、block [1]、dirBlock 0:left）与 sheet `b`（默认 block、pass [1]、dirEdges 0:enter up / 1:exit down）按 `a.0 b.0 a.1 b.1 …` 交替铺 100 格，第 4 格 BLOCK、第 6 格 PASS，断言前 12 格的 `solid/entryMask/exitMask` 以及 4 个 `canEnter`。验证：`git apply --check` 在 HEAD 干净通过；HEAD + 补丁 `bun test tests/movement.test.ts` 52/0；MK1 19 红、MK2 1 红（新测试）、MK3 1 红、MK5 1 红（扩展后的旧测试）、MK5b 1 红（同上）（`mutpatched-*.log` 的摘要见「变异检查」）。也可以把 `memo-diff.ts` 收成单测。

## 逐条核对 `findings/K2.md`「修复 2」

| K2.md 的说法 | 判定 | 证据 |
| --- | --- | --- |
| `buildPassage` 把每个 tile id 的静态意见（solid、entry、exit，sheet.pass 折入 entry）打包成整数缓存在 Map 中；逐格只处理 override 优先级和 typed-array 写入 | 成立 | `src/engine/passability.ts:85-109`（`tileOpinion`：bit0 solid，bit1–4 entry，bit5–8 exit，`:104` 折入 sheet.pass）、`:165,178-180`（Map）、`:184-190`（逐格只看 `over` 与位提取） |
| 连续相同 tile 走 last-value 快路径 | 成立 | `:166-167,176-183`；void 格 `continue` 时不动 `previousTile`（`:171-174`），所以 void 之后的同 tile 仍复用正确 |
| 运行期 `setPassageOverride` 仍调用单格重烘函数 | 成立 | `:198-211` → `cookPassageCell`（`:114-136`），它与 `buildPassage` 共用 `tileOpinion` 和同一套分支顺序（exit 先写；PASS 返回；BLOCK 或 solid 位置 solid；否则写 entry） |
| 新增回归覆盖同一 tile id 的 unset/BLOCK/PASS 三格，确认缓存不夹带逐格 override | **推翻** | 三格自身的值断言正确（`tests/movement.test.ts:165-167`），但「不夹带」要看第 3 格；MK5 下该测试通过，MK5b 下全量通过。见 B6 |
| 以 `d74886e` 实现做 5,000 张随机图差分、150,591 格、17,361 次运行期写入，四个数组全部一致 | 无法判定（脚本未提交），结论被独立证实 | 本审查 `memo-diff.ts`：两个种子各 20,200 张图（含 20×20–100×100 的 200 张），共 3,143,125 格、302,798 次写入，`overrides/solid/entryMask/exitMask` 在「静态 HEAD vs 修前」「运行期写入后 HEAD vs 修前」「HEAD 单格更新 vs 整表重建」三组比较中 **0 处差异**（见下节） |
| wander 96×96 `buildPassage` 均值 1.51–1.76 ms | 成立 | 本轮 1.512 / 1.782 / 1.835 ms（`bench-buildpassage.log`）与 1.525 / 1.521 / 1.739 ms（`bench-wander-swap.log`），均 ≤ 2 ms |
| sim.step 重建帧（27/7,200）均值 2.515–2.533、最大 2.824–3.563 ms | 成立 | 均值 2.580 / 2.615 / 2.418 ms，最大 3.222 / 3.342 / 2.684 ms，≤ 5 ms |
| 完整 app 3,600 帧最坏帧 4.01–7.49 ms、无 > 8 ms 帧 | 部分成立 | 3 次运行的最坏帧 8.31 / 4.45 / 4.70 ms，> 8 ms 帧 1 / 0 / 0；那一帧是 f=2018 的非重建帧，K2 前基线在 f=2012 也有 4.48 ms，关闭 GC 后消失。10 个重建帧 2.08–3.84 ms。7,200 帧轨迹上每次都有一帧 > 8 ms（GC 落在 f=5700 的重建帧上）。见 N-a |
| Tuxemon 263 图整表 36.9–41.7 ms | 成立 | 3 组 × 5 次：31.6–42.7 ms（各组最小 38.2 / 31.6 / 38.7），≤ 50 ms |
| 各次完整 app 轨迹结束于 `{"x":210,"y":-19,"recentres":10}` | 成立 | 本轮 HEAD 3 次、修前 1 次、NOGC 1 次都是这个终点；7,200 帧为 `{"x":434,"y":-135,"recentres":27}`，与修前、基线一致 |
| 门禁：两次构建 16 文件一致；tsc 0；647 pass；`sunstone.js` 342,413 B，上限 343,000；pak 3,308,352 B；worktree 干净 | 成立 | `gates-summary.txt`、`dist-sha256.txt`；`tests/sunstone-game-sim.test.ts:408` |
| 没有 fleet 任务号进入源码 | 成立 | `git diff ad386d8^ d2f57d3 -- src tests | grep -nE 'task[- ]?[0-9]{4}|18(47|48|51)|fleet'` 无输出 |

## 记忆化正确性

- **缓存键覆盖面（静态分析）**：`tileOpinion(tile, sheets)` 的输入只有 tile id 字串和 `sheets` 表；键就是完整的 tile id 字串（`sheet.cell`），`parseTileId` 用 `lastIndexOf(".")` 切分（`src/engine/tiles.ts:16-25`），所以 sheet 名里带点也不会混。`sheets` 在一次 `buildPassage` 调用内不变，缓存 Map 是调用内的局部变量（`:165`），跨调用不共享，sheet 表变了自然重算。影响地形意见的其余输入——`defaultPassage`、`pass`/`block` 列表、`dirBlock`、`dirEdges.enter/exit`——都由 `(sheet, cell)` 决定，全部在 `tileOpinion` 内解析。逐格变化的输入只有 override 与 void，它们不进缓存（`:170-174,185-190`）。单向边：`exit = undirected | directedExit`，`entry = directedEntry | (pass ? 0 : undirected)`（`:104-105`），与修前 `cookPassageCell` 的公式逐字相同。
- **单格更新 ≡ 整表重建**：`cookPassageCell` 先清零三个数组再按同一分支顺序写（`:115-135`），`buildPassage` 从全零数组按同一顺序写（`:184-190`）。差分 2b 直接验证了这一点。
- **随机差分**（`findings/review-task-1851/memo-diff.ts`；`bun findings/review-task-1851/memo-diff.ts`，`SEED=7 …`）：

  ```
  trials=20200 (big=200) modes={"uniform":5137,"single":5048,"alternate":4943,"runs":5072} cells=1578964 runtimeWrites=151861 maxDistinctTileIdsInOneMap=23
  NO DIFFERENCES
  trials=20200 (big=200) modes={"alternate":5126,"uniform":4977,"runs":4976,"single":5121} cells=1564161 runtimeWrites=150937 maxDistinctTileIdsInOneMap=22
  NO DIFFERENCES
  ```

  地图生成刻意针对缓存与快路径：1–40 格的同 tile 长跑、严格交替、两个 sheet 的同一 cell 号交替、void 切断同 tile 跑、带点的 sheet id、不在表里的 sheet、单一 tile 整图（Tuxemon 形状）；sheet 随机带 `defaultPassage`、`pass`、`block`、`dirBlock`、`dirEdges.enter/exit`（各 80% 概率出现）；建图 override 密度 0–25%，之后 0–15 次 `setPassageOverride`（BLOCK/PASS/清零）。比较的是四个数组本身，`canEnter`/`canStepFrom` 等查询函数在本轮 diff 里没有改动，无需重比。

## B1–B4 回归

- 全量 `bun test` 647/0 包含上轮验证 B1–B3 的测试：`tests/movement.test.ts`（运行期 override 同步）、`tests/wander-sim.test.ts:212`（生长阻挡）、`tests/k2-movement.test.ts`（重试上限、搜索中途 JSON 往返）、`tests/pathfind.test.ts`（增量 BFS）。变异脚本每次都跑这 8 个文件，未变异时 216/216。
- B4：`git diff d8324b0 HEAD -- bun.lock | wc -c` = 0；`d8324b0..HEAD` 里碰过 `bun.lock` 的仍只有 `974e344` 与 `6380b74`，本轮 4 个提交都没碰。

## 门禁复跑（审查者亲自执行，worktree `d2f57d3`）

```
$ bun run build:example     # exit 0（real 5.5s）；再跑一次（5.6s），dist/ 16 个文件 sha256 全部一致
$ bunx tsc --noEmit         # exit 0
$ bun test                  # 647 pass, 0 fail, 456701 expect() calls, 37 files [74.81s]
$ git diff d8324b0 HEAD -- bun.lock | wc -c   # 0
$ git status --short        # 干净（门禁与变异之后都干净）
```

`dist/sunstone.js` 342,413 B，`dist/sunstone.pak` 3,308,352 B。本轮 diff 只有 4 个文件（`passability.ts`、两个测试、`K2.md`），没有 UI、golden 或 PNG 改动。

## 变异检查（`findings/review-task-1851/mutate.sh`，每次改完都 `git checkout` 还原）

| 编号 | 变异（`src/engine/passability.ts`） | 8 个 passage 相关文件 | 全量 647 | 加 `test-gap.patch` 后 `movement.test.ts` |
| --- | --- | --- | --- | --- |
| MK1 | 缓存键只留 sheet（丢 cell） | **红** 24 | — | 红 19 |
| MK2 | 缓存键只留 cell（丢 sheet） | **绿** 216/216 | **绿 647/0** | 红 1（新测试） |
| MK3 | Map 命中时不更新 `previousOpinion`（快路径读到陈旧值） | 红 1（只有一条测试发现） | — | 红 1 |
| MK4 | 快路径永不失效（整图用第一个 tile 的意见） | 红 24 | — | — |
| MK5 | BLOCK 分支 `previousOpinion \|= 1` | 红 9（pathfind/k2/wander），**builder 的新测试通过** | — | 红 1（扩展后的新测试） |
| MK5b | PASS 分支清掉 `previousOpinion` 的 entry 位 | **绿** 216/216 | **绿 647/0** | 红 1（同上） |
| MK6 | `buildPassage` 里把 entry 位写进 `exitMask` | 红 10 | — | — |

## 性能（QuickJS，release 桌面宿主 rquickjs；测量时负载 1–2 / 32 核）

**裸 QuickJS `qjs_script`**（`bench-buildpassage.log`、`bench-wander-swap.log`；3 轮交替 HEAD / 修前 / `ad386d8`）：

| 场景 | 修前 `a1960b6`（本轮实测） | `ad386d8` 仅记忆化 | HEAD `d2f57d3` | 验收 |
| --- | ---: | ---: | ---: | --- |
| wander 96×96 `buildPassage` 均值（窗口 JSON） | 10.89 / 9.25 / 11.01 ms | 2.00 / 2.09 / 1.87 ms | **1.84 / 1.51 / 1.78 ms** | ≤ 2 ms ✓ |
| 同上，WanderSim 实时窗口（1,467 overrides） | 10.11 / 11.09 / 11.06 ms | — | **1.53 / 1.52 / 1.74 ms** | ✓ |
| `createSession`（窗口工程）均值 | 9.85 / 10.30 / 11.16 ms | — | 1.55 / 1.66 / 1.82 ms | — |
| `sim.step` 重建帧（27 / 7,200）均值 / 最大 | 11.27/12.34、11.28/13.36、10.73/12.03 ms | — | **2.58/3.22、2.62/3.34、2.42/2.68 ms** | 最大 ≤ 5 ms ✓ |
| `sim.step` 其它帧均值 | 0.345 / 0.336 / 0.331 ms | — | 0.347 / 0.338 / 0.326 ms | 无变化 |
| Tuxemon 263 图 175,093 格整表（5 次，最小） | 204.4 / 168.4 / 182.4 ms | 37.1 / 44.8 / 38.1 ms | **38.2 / 31.6 / 38.7 ms**（全部单次 31.6–42.7） | ≤ 50 ms ✓ |

修前数字与上轮报告的「修后 HEAD」列（9.09–11.05 / 10.96–11.18 / 168–220 ms）一致，机器可比。`337a865` 的相邻复用在 `ad386d8` 之上再省约 10–15%。所有场景终点相同（`player {"x":434,"y":-135}`）。

**完整 app**（Guest + UiSurface，480×272；`run-wander-app.sh`，列出所有 > 2 ms 的帧；`bench-wander-app-*.log`）：

| 运行 | 重建帧数 / 范围 | 最坏帧（帧号、是否重建） | > 8 ms 帧数 | 终点 |
| --- | --- | --- | ---: | --- |
| HEAD 3,600 帧 ×3 | 10 / 2.08–3.84、2.39–3.08、2.13–3.30 ms | 8.31（f=2018 否）、4.45（f=2018 否）、4.70（f=2018 否） | 1 / 0 / 0 | x=210,y=-19,10 次 |
| 修前 3,600 帧 | 10 / 10.23–12.34 ms | 12.34（f=616 是） | 10 | 同上 |
| HEAD 7,200 帧 ×3 | 27 / 除 f=5700 外 2.06–4.07 ms；f=5700 = 10.59 / 19.01 / 10.66 ms | f=5700（是） | 1 / 1 / 1 | x=434,y=-135,27 次 |
| HEAD 7,200 帧，`BENCH_NOGC=1` | 27 / 2.08–3.90 ms | 3.90（f=4497 是） | 0 | 同上 |
| HEAD 3,600 帧，`BENCH_NOGC=1` | 10 / ≤ 2.99 ms | 2.99 | 0 | x=210,y=-19 |
| 修前 7,200 帧 | 27 / 10.0–12.5 ms；f=5700 = 16.79 ms | 16.79（f=5700 是） | 27 | x=434,y=-135 |
| K2 前基线 `d8324b0` 7,200 帧 | 仅 1 个重建帧 > 2 ms（f=5540，2.97） | 6.27（f=5539 否） | 0 | 同上 |

解读：关掉自动 GC 后 HEAD 的 7,200 帧没有任何一帧超过 3.9 ms，所以 > 8 ms 的帧全部是 QuickJS GC 停顿；这类停顿在修前（f=5700 比其它重建帧多 5–6 ms）和 K2 前基线（f=5539 的 6.27 ms）都存在，只是基线的 GC 恰好没有落在重建帧上。运行结束后对 6.39 MB / 28,822 对象的堆做一次完整 GC 需 3.13 ms（`bench-wander-app-gc.log`），运行中落在重建帧上的停顿约 7 ms（10.6 − 3）。

## 画面

本轮只改了 `src/engine/passability.ts`、两个测试文件和 `K2.md`，没有渲染产物变化，无需肉眼核对。

## 原则

- 没有 Tuxemon 专用代码；没有改 `vendor/pocketjs`（gitlink 仍为 `76ae741f`）。
- 4 个提交作者都是 `lfkdsk <lfkdsk@gmail.com>`，没有 trailer；提交信息按仓库风格（`perf(engine):`、`test:`、`docs:`）。
- 源码与测试的 diff 里没有 fleet 任务号。

## 非阻断问题

- **N-a　GC 停顿会让完整 app 出现 > 8 ms 的帧**：见「性能」。这不是 B5 的回退——修复把重建帧从 ~11 ms 压到 ~2.5–3 ms，GC 停顿的大小取决于存活堆而不是烘焙代码——但 K2.md 的「完整 app 没有超过 8 ms 的帧」只在 3,600 帧且 GC 落在 f≈2018 时低于 8 ms 才成立；同一轨迹跑到 7,200 帧必有一帧 10 ms 以上。建议在 wander 的 swap 之后（或任何空闲帧）主动触发一次 GC，或者减少 swap 的分配量（新 session、World、四个 9,216 字节的 typed array）；这是 wander 示例的工作，不在本修复范围。
- **N-b　builder 的差分脚本没有提交**：K2.md 的 5,000 图 / 150,591 格 / 17,361 次写入无法从仓库复现。`memo-diff.ts` 可以直接改成单测（把 PRE 换成对 `cookPassageCell` 逐格调用的参考实现）。
- **N-c　文档（上轮 N-d 遗留，本轮未处理，也不在规格里）**：`setPassageOverride` 仍未写进 `src/engine/README.md` / CHANGELOG；`buildPassage` 注释（`:39-44`）没提记忆化。
- **N-d　MK3 只有一条测试能发现**（`dirBlock destination reverse edge > every direction`），快路径的陈旧值几乎没有覆盖；`test-gap.patch` 的交替图也会让它变红。

## 结论

B5 的性能回退已经消除，四项 QuickJS 门槛全部达到，记忆化在 3.1M 格的随机差分下与修前逐格一致，门禁全绿。但规格要求的「改坏缓存键，测试应变红」不成立：丢掉 sheet 的缓存键和 PASS 泄漏到后续格的变异在全部 647 条测试下都存活，builder 新增的回归测试断言止于第 2 格，其「不夹带 override」的说法被推翻（B6）。修法是 45 行的测试补丁（已验证能杀死这些变异），实现代码不需要改。

FAIL
