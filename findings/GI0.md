# GI-0 — 游戏仓升级组件仓到 7c16a28 + KV1 actorSlots + KP2 文本读取

基线 `635fde0`（组件仓指针 `4bba234`）→ 组件仓 `7c16a28`（嵌套 PocketJS `9eda4b5b`）。
5 个提交，工作树干净，`bun.lock` 未动。

## 1. 子模块升级（404e3f1）

`vendor/pocket-rpgkit` 升到 `7c16a28`，只提交指针；嵌套 `vendor/pocketjs` 随之到 `9eda4b5b`（KP2 的 `fs.readText` op）。
组件仓 `package.json` 在 `4bba234..7c16a28` 之间只加了 `./editor-api` 导出与两个 `rpgkit-edit` 脚本，**无新依赖**，故未跑 `bun install`、`bun.lock` 不变。
`bun run import` 重新生成，外壳哈希自检（`assertShellManifestFresh`）通过；两遍 import 字节稳定（`git diff --stat` 两次一致）。

> 备注：本 worktree 的 `vendor/pocket-rpgkit` 初始是空目录（子模块未初始化，早先的 `git -C` 命令都落到了上级游戏仓上）。用 `git submodule update --init` 正常初始化后再升级。

## 2. KV1 actorSlots（2c45c84）

KV1 后组件仓 `collectMapSlots`（`GameView.tsx:105`）把**所有事件**入槽（运行时 appearance op 可给任意事件挂精灵），shell 项目必须由游戏侧提供 `maxActors`。游戏仓 `gen-assets.ts` 仍只数带精灵的事件 → 运行时池 17 装不下大图。

改动：`actorSlots` 改成数所有事件（`(map.events ?? []).length`），保留 `test_*` 压力图豁免。真实数值（263 张导入图）：

| 量 | 旧 | 新 |
|---|---|---|
| `maxActors`（含 test_，仅报告） | 500 | 501（test_npcs 共 501 个事件） |
| `runtimeMaxActors`（非 test_，喂 `GAME_ASSETS.maxActors`） | 17 | **205**（spyder_dryadsgrove） |
| `excludedActorStressMaps` | test_npcs:500 | test_npcs:501 |

KB6 收尾文档说 `runtimeMaxActors = 28`，那是它当时 bench worktree 只覆盖到 paper_scoop；全量导入下真正的可玩最大是 dryadsgrove 的 205（paper_scoop 28、route3 119、paper_town 59）。

守护测试（`tests/g6-assets.test.ts` 新增 "sizes the actor pool from every event on every reachable map (KV1)"）：读 `dist/project-shell.json` 的 mapIndex，逐张读生成产物 `dist/maps/<entry>`，断言每张非 test_ 图事件数 ≤ `GAME_ASSETS.maxActors`、且池预算恰等于可玩最大值、test_npcs 仍超出预算（豁免真实存在）。
变异自查：把 `ui/game-assets.ts` 的 `maxActors` 改回 17 → 该测试与值断言测试同时变红（2 fail）；恢复后 4 pass。

## 3. KP2 文本读取（6822ba2 + 7ae0086）

旧分支 `fleet/2012-game-readtext`（tip `afbcab3`，3 个独有提交）相对其父的核心改动是 `main.tsx` 的 `readEntry`/`readText`。手工移植到新 main，并抽到可测模块 `ui/entry-readers.ts`：

- `read`：字节路径（桌面 `readFileSync(entry)`、网页/主机 `pakGet(entry)`）——战斗、动画、npc-src、terrain-stream 所有 shard 沿用，与 pre-KP2 一致。
- `readText`：地图仓库专用的原生 UTF-8 通道（`readFileSync(entry, "utf8")`），仅桌面宿主挂载 `globalThis.fs` 时提供；网页为 `undefined`，回退 pak 字节路径。

**设计要点**：`read` 与 `readText` 是两条不同路径（read=字节、readText=文本），这样 `readText: undefined` 变异才可被行为观测——审查指出的正是这个变异没有测试变红。守护测试 `tests/entry-readers.test.ts` 用 recording host（`readText` 给真内容、`read` 给 CORRUPT）证明仓库优先走文本通道；另覆盖老宿主无 readText op 时的分页回退、字节路径、网页无文本通道。
变异自查：`readText: readers.readText` → `readText: undefined` → "prefers the native readText channel" 测试变红（仓库落到 CORRUPT 字节路径）；恢复后 4 pass。

`tools/map-benchmark-entry.tsx`（首访基准入口）同样接了 `readText`，否则 263 图首访基准测的是旧字节路径、验证不到 KP2。旧分支还改了 `c1-readpath-*` 微基准脚手架，与本任务验收无关，未移植。

## 4. 门禁

| 项 | 结果 |
|---|---|
| `bun run import` 两遍无 diff | ✅ |
| `bunx tsc --noEmit` | ✅ 0 |
| `bun run build` / `build:wasm` | ✅ |
| `bun test` | ✅ 202 pass / 0 fail / 0 skip |
| `verify:g6:locks` | ✅ 333 锁命令 / 333 动态检查 / 0 unresolved / 0 exception |
| `verify:g6:determinism` | ✅ sha256 `15e536f0…` |
| `verify:g6:frozen` | ✅ 263 图 / 0 永久锁 / 0 错误 |
| `verify:gb6:mainline` | ✅ 终态 `d62d1465…`（与仓库钉值一致） |
| `verify:gb6:failures` | ✅ 首败 `d321b217…`、中途败 `2e76caf0…`（均与钉值一致） |
| `verify:j1:mainline` / `segment` | ✅ 终态 `88c3c691…` |
| `bun run web` + `verify-web-journey.ts` | ✅ 像素哈希全对、0 console 错误 |
| `bun.lock` | ✅ 未改 |
| 任务号 / 本机路径 | ✅ 代码与提交信息无 |

**终态哈希零回退**：GB6 主线/首败/中途败、J1 段全部逐位复现仓库钉值。

### QuickJS 首访（规格的 KP2 验收口径）

`bun tools/desktop.ts --build-only` + `bench-g6-quickjs.sh` 的 `map_first_visits` 阶段，263 图：

| 阶段 | p50 | p95 | max |
|---|---|---|---|
| read_parse（KP2 文本通道） | 0.649 | **2.600** | **11.642** |
| validate | 0.190 | 0.755 | 4.620 |
| compile | 0.780 | 5.408 | 22.137 |
| total | 1.658 | 9.584 | 32.813（test_npcs 压力图） |

read_parse p95=2.6 / max=11.6 ms，优于规格预期的 ~3.5/15 ms，证明 readText 生效（字节路径下同尺寸图约 47 ms）。

### ⚠️ 发现：battle-exit 帧预算在 960x544 下回退（kit 侧设计问题）

`bench-g6-quickjs.sh` 的 journey 阶段在 960x544 视口 panic：battle-exit 帧 `f3224:spyder_paper_town` = **65.5 ms > 50 ms** 预算（480x272 视口同帧 20.9 ms，过）。

诊断（重建桌面 app 对比）：

| `GAME_ASSETS.maxActors` | 960x544 battle-exit |
|---|---|
| 119（覆盖旅程到 route3，不含 dryadsgrove） | 35.0 ms（过） |
| 205（规格要求，覆盖全部图） | 65.5 ms（超） |

根因：组件仓 `CurrentMapActors`（`GameView.tsx:231`）按 `slotCount`（= 全局 max）**预建**原生 image 节点，池在 GameView 挂载时建一次、战斗退出时重建。205 槽 vs 119 槽多建 86 个节点 ≈ 30 ms（每节点在 960x544 约 0.35 ms）。这是 KV1「按所有事件分配槽位 + 全局 max 池」与大图（dryadsgrove 205 事件）相互作用的结果，**不是游戏仓实现缺陷**——规格明确要求数所有事件（205），游戏仓无法在不违反规格的前提下绕过。

建议（kit 侧后续任务）：把 actor 池改成**懒加载/可增长**——只为当前图实际有事件的槽位建节点，空槽位不预建（`gen-assets.ts` 注释里也提到 "A kit-side growable pool can eventually make direct rendering of stress fixtures cheap as well"）。这样 battle-exit 只重建当前图的节点数（paper_town 59），与全局 max 解耦。已用 `fleet_spawn` 提议。

在 kit 修复合并并 bump 前，`bench-g6-quickjs.sh` 全脚本会在 journey 阶段非零退出；首访阶段（规格的验收口径）单独跑通过。480x272（PSP 量级）视口不受影响。

## 提交

```
7ae0086 perf(bench): read map entries through the text channel in the first-visit probe
6822ba2 feat(runtime): read map entries through the native text channel (KP2)
18191f3 test: pin the actor-pool guard against bun's numeric toBe typing
2c45c84 fix(importer): size the actor pool from every map event for KV1 slots
404e3f1 chore: bump pocket-rpgkit to 7c16a28 (extChoice, editor, actorSlots, edit API, map text reads)
```

## subagent 使用

2 个（relay/Explore 型，只读调研，并行）：① 从旧历史分支 `fleet/2012-game-readtext` 提取 `readEntry`/`readText` 完整 diff 与移植注意点；② 读组件仓 `findings/KB6.md` 游戏仓配套改动、KV1 `collectMapSlots`/panic 实现、KP2 `MapEntrySource.readText` 契约与桌面/网页宿主差异。省了时间——两块调研与我自己的子模块升级/import 重活并行，结论均经我亲自复核（diff、类型、panic 路径、数字）后才动手。
