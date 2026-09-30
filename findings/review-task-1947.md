# GP1 修复 1 复审（被审任务 1947）

## 结论

**FAIL。** 三类新分片本身是确定的派生数据，缓存位于 reducer / 存档之外；完整功能门禁、网页 journey、golden、锁与冻结扫描都通过，切图与进出战斗的 QuickJS 帧预算也没有回退。但本修复仍有三个阻断项：

1. 低负载独立 10 连跑仍不能稳定满足启动的双重门槛：480×272 的中位数为 `225.538 ms` 且有一次 `250.157 ms` 硬失败；960×544 的中位数为 `243.518 ms`。
2. NPC / 动画贴图保活清单虽由导入器生成、当前内容也正确，却没有测试强制它与分片引用双向一致；删掉一个真实 NPC 路径后完整 140 项测试仍全绿。这正是规格明确要求阻断的静默漏贴图风险。
3. 分段标记的后半段是真测，但“bundle 求值 / pre-JS”边界不完整：实际产品 bundle 在 `module-start` 之前已经执行 Solid/PocketJS 的顶层初始化，所以不能把 `boot_ms - marked_ms` 全部归因为 QuickJS 字节码编译，也不能据此断言完整 engine/module evaluation 仅花 0–1 ms。

审查基线为 `8e417d7`，被审 HEAD 为 `1bd6376`，范围为：

```text
1bd6376 docs: report GP1 startup budget stability and the pak-baking fix
6e4ec7c test: cover the three new lazy repositories, stage their shards everywhere
2c4bbf4 feat(ui): lazy Proxy repositories for the new shards, startup-stage marks
bb3765c feat(importer): shard animated tiles, NPC sprites, and terrain-stream refs
```

## 阻断项

### B1. 启动仍不稳定，独立低负载 10 连跑不满足验收

先执行了 `bun tools/desktop.ts --build-only`；桌面产物为 `988,463 B` JS、`62,026,000 B` pak。再用独占目录 `G6_BENCH_ROOT=/var/tmp/fleet/task-1954/quickjs` 构建并运行官方 `tools/bench-g6-quickjs.sh`。首次官方整轮给出 `240.946 ms`（480×272）和 `248.165 ms`（960×544），两者单次均低于 250 ms，但这不是规格要求的 10 连跑。

随后复用该脚本编出的 release desktop host，以完全相同的 `g6_quickjs_bench::journey`、产品 bundle、data.fs 分片和终态哈希检查，各视口顺序运行 10 次。每次开始都打印 `uptime`；主样本负载范围只有 `2.18–2.88`，与 builder 报告所称 light load `2.16–3.39` 相同量级。

| 视口 | n | min | median | p90（第 9 个顺序统计量） | max | `>250 ms` | 验收 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 480×272 | 10 | 220.366 | **225.538** | 242.648 | **250.157** | **1/10** | 中位与硬上限均失败 |
| 960×544 | 10 | 222.256 | **243.518** | 245.568 | 249.539 | 0/10 | 中位失败 |

原始 `startup_to_first` 样本：

```text
480x272: 226.826 224.251 222.074 242.648 238.236 236.531 221.282 220.366 250.157 220.660
960x544: 243.224 244.583 230.205 222.256 224.017 224.135 245.568 243.812 249.539 243.940
```

480 第 9 次的真实官方断言结果是：

```text
BOOT viewport=480x272 boot=248.011ms first_qjs=1.589ms first_total=2.038ms startup_to_first=250.157ms
test result: FAILED. 0 passed; 1 failed
```

为排除负载争议，在负载降到 `1.96` 后又做一批确认。480 批次的运行时负载为 `2.31–3.34`，结果为 min/median/p90/max `223.142 / 235.127 / 239.674 / 244.303 ms`；虽然没有越过 250 ms，中位仍明显失败。随后 960 确认批次负载为 `3.65–3.84`，结果为 `228.470 / 245.615 / 250.762 / 257.802 ms`，3/10 越过 250 ms；这组负载略高，只作为旁证，不替代上面的低负载主样本。

所有成功完成的主样本终态仍为 `7fdc130b0b90fece5f3814d886dad0a4513417ce31e2d59019dd0ce310d8dd64`。因此失败不是 journey 状态漂移，而是启动预算仍没有稳定余量。

### B2. 保活清单没有双向一致性测试，删项变异仍全绿

PocketJS build 的 pass 1 递归扫描源码字面量（`vendor/pocket-rpgkit/vendor/pocketjs/tools/build.ts:287-314`），随后只把匹配 PNG/SVG 的 `classStrings` 烘焙为 image/sprite 条目（同文件 `:364-464`）。所以 JSON 分片里的动态贴图名不会自动保活，这个风险判断成立。

实现的好的一面是清单并非手写：

- `gen-assets.ts:66-74` 从 `characters.npcSrc` 去重、排序并生成 `ui/npc-src-assets.ts`；
- `gen-assets.ts:129-135` 从动画 cooker 的 atlas 集合生成 `ui/animated-assets.ts`；
- `main.tsx:48-56` 让三份 battle/NPC/animated 字面量清单保持在 pass-1 可达图中。

独立遍历所有分片后，当前产物确实双向相等：

```json
{
  "npc": { "shardRefs": 1847, "keepalive": 1847, "missing": [], "extra": [] },
  "animated": { "shardRefs": 86, "keepalive": 86, "missing": [], "extra": [] }
}
```

但测试没有约束这个关系。`tests/g6-assets.test.ts:47-58` 只检查 175 个 NPC 索引、48 个动画索引和 5,785 个动画 placement；文件头 `:1-8` 根本没有导入 `NPC_SRC_ASSET_PATHS` 或 `ANIMATED_ATLAS_NAMES`。三份 repository 测试也只把每个 provider 与它读取的同一份 shard 比较。

按规格做了真实删项变异：把清单最后的 `assets/characters/npc-npc-xerogrunt-walk-r-3.png` 替换成重复的 `walk-r-2.png`。变异确认输出为：

```text
MUTATED_KEEPALIVE refs=1847 listEntries=1847 unique=1846 missing=assets/characters/npc-npc-xerogrunt-walk-r-3.png
```

在不重新运行 importer（避免它自动修复变异）的情况下运行完整测试，结果仍为：

```text
140 pass
0 fail
63901 expect() calls
Ran 140 tests across 30 files. [113.36s]
```

变异已恢复且 `git diff --exit-code -- ui/npc-src-assets.ts` 为 0。由于新增地图/NPC 可以在现有测试覆盖不到的画面上静默漏烘焙，这一项按复审规格必须阻断。修复应从所有 `dist/npc-src/*.json` 与 `dist/animated/*.json` 重新收集引用，并分别与生成清单做 **Set 双向相等**；测试不可只钉数量。现有 battle 清单的做法可直接参考：`tests/battle-import.test.ts:137-151` 同时比较实际资产文件、`collectBattleArtRefs` 与 `BATTLE_ASSET_PATHS`。

### B3. 四段计时只覆盖标记后的部分，不能支持完整归因

源码层面的依赖顺序假设只成立了一部分。`main.tsx:2-28` 依次导入 marker、kit wrapper、data wrapper 和三个 repository；wrapper 的 trailing mark 分别位于 `ui/gp1-kit-stage.ts:17` 和 `ui/gp1-data-stage.ts:39`。产品 bundle 也确实保持了这些相对顺序：

```text
2:     solid-js/dist/solid.js
4181:  ui/gp1-marks.ts
4190:  gp1Mark("module-start")
14378: ui/gp1-kit-stage.ts
14379: gp1Mark("engine")
14380: dist/project-shell.json
31095: ui/gp1-data-stage.ts
31096: gp1Mark("json-literals")
31167: main.tsx
31179: gp1Mark("battle-registration")
31209: gp1Mark("mount")
```

因此 `json-literals → battle-registration → mount` 是运行时真时间，不是按字节比例推出来的；`main.tsx:46-47` 和 `:69-88` 也使 rule factory 与同步 mount 的边界直接可见。独立 10 次的 mount delta 支持 “GameView 初次同步挂载约 100 ms” 这个局部结论：

| 视口 | mount min | median | p90 | max |
| --- | ---: | ---: | ---: | ---: |
| 480×272 | 103 | 105.5 | 114 | 115 ms |
| 960×544 | 105 | 116.5 | 120 | 121 ms |

但完整 bundle 从第 2 行就已开始执行 Solid/PocketJS 顶层初始化，`module-start` 到第 4,190 行才出现。因此：

- `engine=0–1 ms` 漏掉了 marker 之前的框架模块初始化，不能代表完整 engine/bundle evaluation；
- `boot_ms - marked_ms` 同时包含 host 初始化、QuickJS 编译和 marker 之前的 JS 执行，不能被写成“就是 QuickJS 编译”；
- `Date.now()` 只有整数毫秒分辨率，报告中的 0/1 ms 只能视为粗粒度上界；
- `tools/g6-quickjs-bench.rs:165-180` 明说 stage reader “asserts nothing”；marker 缺失或顺序变化也不会让门禁失败。

所以 mount 占已标记 JS 执行的大头成立，但“四段完整解释启动总耗时”和“pre-JS bucket 已证实为 bytecode compile”不成立。要满足原规格，应在 QuickJS host 的 bundle compile/eval 调用边界计时，或确保最早 marker 真正在 bundle 的第一条应用初始化之前，并断言 marker 名称/顺序/数量。

## 新分片实现、纯度与错误路径

### 生成与装载边界

- `splitAnimatedTiles` 按 map id 排序后生成 48 个 canonical JSON shard；`splitNpcSrc` 按 NPC id 排序后生成 175 个 shard；`splitStreamRefs` 按 map id 排序生成 ground/upper 共 526 个 shard（`importer/animated.ts:30-44`、`importer/npc-src.ts:28-39`、`importer/terrain.ts:213-242`）。
- `pak.json` 中对应条目数也是 `48 / 175 / 526`；`tools/desktop.ts:39-55` 把三棵目录复制到 desktop data.fs，网页路径则通过同一个 `readEntry` 从 pak 读取。
- `ui/lazy-entry-table.ts:29-46` 的 index 与 cache 都是 provider 闭包内的 `Map`；`main.tsx:44-66` 在 reducer 之外构建 provider 并只作为 `GameAssets` 传给 `GameView`。缓存不进入 `SessionState`、存档、canonical hash 或 reducer 输入。
- indexed 但缺失的 shard 与非法 JSON 都带 repository label、id 和 entry。独立触发输出为：

  ```text
  missing: missing repository: missing entry for 'x' (shard/x.json)
  bad: bad repository: entry for 'x' (shard/x.json) is not JSON
  ```

### 正向变异与确定性

其余两个变异证明分片测试本身有效：

1. 把 `cache.set(id, value)` 改成不缓存后，animated、NPC、terrain 三个测试各自因第二次读取多一次而失败（3 fail）；恢复后全量门禁通过。
2. 把 upper provider 错接到 ground index 后，terrain parity 测试显示四个 `upper` tile key 被对应 `ground` key 替代并失败；恢复后工作树无差异。

生产路径专项复跑：

```text
G6 maintained journey sharded vs inline: per-frame byte-identical
attract replay: 60 / 30 / 20 / 4 Hz byte-identical
cross-map save: restores evicted map and rejects another content build
battle sharded vs inline: every slug and every maintained-journey frame equal
extension save + rewind and shared-economy save + rewind: PASS
16 pass, 0 fail, 8496 assertions
```

这与分片仅影响 UI 派生读取、不改变 reducer 状态的静态边界一致。网页 journey 的四个状态与像素 checkpoint 也全部命中。

## QuickJS 切图与战斗预算

主样本成功运行中的最坏真实 release QuickJS 数字如下：

| 指标 | 480×272 max | 960×544 max | 门槛 |
| --- | ---: | ---: | ---: |
| map-switch total | 15.145 ms | 25.034 ms | ≤50 ms，PASS |
| battle-entry total | 8.490 ms | 8.401 ms | ≤50 ms，PASS |
| battle-exit total | 29.816 ms | 35.962 ms | ≤50 ms，PASS |

官方全图 staged benchmark 也通过：263 图，p95 `18.886 ms`，全体最大为豁免图 `test_npcs=59.523 ms`，非豁免最坏 `buddha_mountain=48.922 ms`。所以三类新分片没有把切图/进战斗推过 50 ms；启动失败不能归咎为把成本简单转移后又超出切图预算。

Fix 1 的 exit probe 用 Bun 隔离 `BattleRules.done()`，只适合作相对份额诊断，不是 QuickJS 门禁；它支持 reducer completion 很小，但无法把剩余 26–37 ms 在 kit-owned teardown/remount 之间继续细分。此项在修复规格中是非阻断。

## 完整门禁

| 命令 | 独立结果 |
| --- | --- |
| `bun run import` 连续两遍 + 每遍 `git diff --exit-code` | 两遍均成功，0 diff |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | success；`dist/main.js=987,860 B`，pak `62,026,000 B` / 4,622 entries |
| `bun run build:wasm` | success；wasm `289,758 B` |
| `bun test tests/`（正式、恢复所有变异后） | 140 pass，0 fail，63,901 assertions |
| GB2 / GB3 / spawn focused suite | 38 pass，0 fail，8,351 assertions；GB2 完整 8,560 cases，通过全部 GB3 capture/item/run/progression/double 与 spawn golden |
| `bun run verify:g6:locks` | 329 pages / 333 checks；327 unlocked、2 transferred、0 unresolved、0 error |
| `bun run verify:g6:frozen` | 263 maps；0 permanent locks、0 permanent blocking fibers、0 errors |
| `bun run verify:g6:determinism` | PASS；2 roots，4,636 files，60,587,915 bytes，SHA-256 `17adca099ab92d9c77ae26b06895cec5d335238fc8316360caecad023a7f7d5d` |
| `bun run web && bun tools/verify-web-journey.ts` | PASS；2,788 frames，4/4 state + pixel checkpoints，0 console errors |
| QuickJS 两视口各 10 次 | **FAIL**，见 B1 |

`git diff 8e417d7..HEAD -- bun.lock vendor` 无输出；组件子模块在 base 与 HEAD 都是 `a124186`，`vendor/pocketjs` 未改。代码（排除 findings）与四条提交信息均没有 fleet 任务号。所有变异均已恢复。

## 画面人工核对

实际打开了两张 PNG：

- `tests/goldens/g6-route-1.2787.png`：水面、岩石、树线、成片作物、花、路牌、围栏与 16×32 玩家均可见，层级与裁切正常。
- `findings/GB4-battle.png`：Budaye/Nut 双方怪物、森林背景、两个 HUD、HP 条和技能菜单均完整可读，没有错位或裁切。

这不是只核对哈希；built-bundle 像素 replay 与网页像素 checkpoint 也在正式门禁中通过。

## 合并 `main@ba32513` 前瞻

在 `/var/tmp/fleet/task-1954/merge-preview` 从 `1bd6376` 建 detached worktree，执行 `git merge --no-commit --no-ff main`。共同祖先为 `e905824`，实际冲突只有：

```text
data/battle-assets-report.json
data/g6-assets-report.json
tools/g6-quickjs-bench.rs
```

语义与建议：

1. 两份 JSON 都是生成报告：GP1 一侧加入 `battleRepository` 且 runtime DB 为 801,152 B，GB5 一侧将 presentation 字段加入 runtime DB（1,042,969 B）。不要手拼数字；合并 `importer/battle.ts` 后运行 `bun run import` 整体重生成，应同时保留新 runtime 内容和分片报告。
2. Rust 冲突同一位置分别调用 `report_startup_stages(...)` 与 `bench.install_structural_counter()`。两者都要保留；先报告 boot marks，再在第一帧前安装 structural counter。随后检查 startup_to_first，因为 counter 安装发生在 boot 计时起点之后、首帧之前。
3. GB5 没有新增一套漏保活的战斗贴图：`main` 与本分支的 `ui/battle-assets.ts` 都正好 578 项且字节相同。它们由 `writeBattleArtifacts` 生成，`tests/battle-import.test.ts:137-151` 已做文件集合、DB art refs 与清单的双向相等。因此 GB5 皮肤会沿既有 `BATTLE_ASSET_PATHS` 进入 pak。NPC/动画清单的缺测仍需单独修复，不能由 battle 测试替代。
4. main 把 journey 从 2,788 延长到 3,793 帧、Route 1 checkpoint 从 2,787 移到 3,792，终态哈希从 `7fdc130b…` 改为 `5653f011…`；脚本 expected hash 和 golden 名也必须取 main 版本。更长战斗主要扩大 steady-frame 样本，不会自然改变“恰好一个 entry/exit”断言，但 GB5 runtime shell、`b778aa0` 组件 bump、structural wrapper 与新 scene mount 会共同改变启动/进出战斗成本，合并后必须重新跑完整 10×2 启动分布和 ≤50 ms 帧门禁，不能沿用任一分支的旧数字。
5. 临时 merge 已 `git merge --abort` 并删除 worktree；被审分支没有被修改。

## 放行条件

1. 让两个视口在独立低负载 10 连跑中同时满足 median ≤225 ms 且每次 ≤250 ms，并保留足够余量。
2. 添加由分片内容反推引用集合、与 `NPC_SRC_ASSET_PATHS` / `ANIMATED_ATLAS_NAMES` 做无硬编码双向 Set equality 的测试；删掉任一真实项必须变红。
3. 把 bundle compile/eval 与 marker 前顶层执行纳入可信分段，并让 benchmark 对预期 marker 名称、顺序和数量做断言；保留当前可直接证明的 mount 边界。
4. 按上节方式合并 main、重生成所有产物并重跑全部门禁。

FAIL
