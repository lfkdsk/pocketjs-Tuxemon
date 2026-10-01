# Review: GI-0 组件仓升级、actorSlots 与 KP2 文本读取（task 2052）

审查范围为基线 `635fde0` 到被审 HEAD `6ec3bae`。结论：**PASS**。组件仓与嵌套
PocketJS 指针正确，自动导入、actorSlots、KP2 桌面文本通道、网页 pak 回退和既有剧情回放均成立；
构建、测试与卫生门禁全部通过。没有阻断项。

本次另发现两个不阻断合并但应准确记录的问题：锁检查器继承自 main 的一行 false-success，以及
GI0 报告把一次 65.5 ms 样本和每节点估算写得过于确定。前者不由本分支引入；后者的机制由单变量
A/B 证实，但当前低干扰复测没有再次超过 50 ms。

## 1. 规格逐项核对

| 项目 | 结论 | 独立证据摘要 |
| --- | --- | --- |
| 子模块升级 | 成立 | 顶层 gitlink 为 `7c16a281…`；组件仓内 PocketJS gitlink 与 checkout 均为 `9eda4b5b…`；顶层没有直接修改嵌套 PocketJS 文件。 |
| 两遍自动导入与外壳自检 | 成立 | 两次 `TUXEMON_SRC=/var/tmp/tuxemon-src bun run import` 均 exit 0、输出同为 263 maps / 430 TILESET entries，运行后工作树均无 diff；shell/report SHA-256 两次分别固定为 `cd220b3e…` / `36082181…`。隔离双根 determinism 另得 4,637 files、61,751,758 bytes、`15e536f0…`。 |
| KV1 actorSlots | 成立 | 所有 map event 都计槽，只有规格指定的 `test_*` fixture 豁免；263 图实际 playable max 为 `spyder_dryadsgrove=205`，`test_npcs=501`；隔离变异 205→17 令守护测试变红。 |
| KP2 接入 | 成立 | 桌面 map 走 `readFileSync(entry, "utf8")`；旧桌面宿主由 framework 回退分页 bytes；pak-only host 不挂 `readText`。隔离 `readText: undefined` 变异令 recording-host 测试变红。 |
| GB6/J1 与短 tape 不回退 | 成立 | 当前分支的五份 tape/验证器与 main 字节一致；独立复跑得到 GB6 主线 `d62d1465…`、首败 `d321b217…`、中途败 `2e76caf0…`、J1 `88c3c691…`；短 tape 两个 repository replay 测试通过并钉住 `5653f011…`。 |
| locks / frozen | 成立但有继承缺口 | 命令通过：333 lock commands / 333 checks / 0 unresolved / 0 error，freeze 为 263 maps / 0 permanent locks / 0 blocking fibers / 0 errors；但其中一项 transfer 未实际触达 lock，见 §6。 |
| 网页回放 | 成立 | 真 Chrome/CDP 回放 3,793 帧，四个 map/像素 checkpoint、终点、`scene null` 全匹配，0 console error，输出 `WEB JOURNEY PASS`。 |
| QuickJS 263 图首访 | 成立 | 真 rquickjs guest 强制访问 263 个唯一 map；两次独立 `read_parse` p95/max 为 `1.501/5.558 ms` 与 `1.208/5.192 ms`，优于原报告 `2.600/11.642 ms`。该阶段当前用 wall clock，不能标成 thread CPU。 |
| 常规门禁与卫生 | 成立 | `tsc`、build、wasm、202 tests、web 均 exit 0；0 fail / 0 skip；`bun.lock` blob 未变；生产 diff 和提交信息无任务号、本机路径、Co-Authored-By；三层工作树干净。 |

## 2. 子模块、导入与范围

`git diff --submodule=log 635fde0..HEAD -- vendor/pocket-rpgkit` 只显示组件仓从 `4bba234`
升级到 `7c16a28` 的七个上游提交。独立指针核验：

```text
$ git ls-tree HEAD vendor/pocket-rpgkit
160000 commit 7c16a281166b5629ab086d22612f10c82b9642bb vendor/pocket-rpgkit
$ git -C vendor/pocket-rpgkit rev-parse HEAD
7c16a281166b5629ab086d22612f10c82b9642bb
$ git -C vendor/pocket-rpgkit/vendor/pocketjs rev-parse HEAD
9eda4b5bc3a253682e223e522de170bf9fd9b155
```

顶层 `635fde0..HEAD` 共改 10 个路径：组件 gitlink、生成报告/常量、`gen-assets.ts`、KP2 reader
与接线、两个守护测试、QuickJS map 入口及 GI0 报告；没有图片 diff，也没有直接修改 PocketJS。

导入器仍从 `availableMapIds()` 全量取图（`gen-assets.ts:29`）。actor 预算对每张图统一执行
`(map.events ?? []).length`（`gen-assets.ts:87`），生产逻辑唯一筛选是规格明确的
`id.startsWith("test_")`（`gen-assets.ts:89-93`），没有具体地图 ID 或逐图补丁。
`ui/game-assets.ts` 与 `data/g6-assets-report.json` 均由同一导入过程写出。

两次完整导入后 `git status --porcelain` 和 `git diff --stat` 都为空，且关键文件哈希逐位相同：

```text
cd220b3e5efd5f168efbf13587b73e3e7025022b0119e97b113d5c787082423e  dist/project-shell.json
36082181465b894a5e42bf72bde19bd180b9a676aeb91dd88b944dc27b966d9e  data/g6-assets-report.json
```

`gen-assets.ts:181` 在写盘后重新读取 shell 并调用 freshness check；组件仓实现会重算 canonical
manifest/schema SHA-256。`verify:g6:determinism` 又在两个隔离输出根执行完整生成并通过：

```text
G6 determinism: PASS isolatedRoots=2 files=4637 bytes=61751758
sha256=15e536f07737915ee6384eb10356bae1a5d92fbff04737ca834e1de84e224c87
```

## 3. actorSlots 与性能诊断

### 3.1 计数与守护测试

`GameView` 的 `collectMapSlots` 允许任何 event 之后通过 appearance op 获得精灵；shell 项目因此必须
提供覆盖任意可玩地图事件数的预算。实现位于 `gen-assets.ts:75-94`，守护测试在
`tests/g6-assets.test.ts:66-93` 遍历 shell 索引中的每个 shard，并同时钉住 playable max 与真实
fixture 豁免。独立统计为：

```json
{"maps":263,"maxAll":{"id":"test_npcs","n":501},
 "maxPlayable":{"id":"spyder_dryadsgrove","n":205},
 "paperScoop":{"id":"spyder_paper_scoop","n":28},
 "route3":{"id":"spyder_route3","n":119},
 "paperTown":{"id":"spyder_paper_town","n":59},
 "testMaps":[{"id":"test_npcs","n":501}]}
```

在隔离 worktree 把生成的 `GAME_ASSETS.maxActors` 从 205 变为 17 后，目标测试以
`37707_town needs 25 actor slots` 变红（0 pass / 1 fail）；恢复 205 后为 1 pass / 0 fail / 264
assertions。该测试能辨认旧的精灵计数预算，也能辨认误把 501-event fixture 放入运行预算。

### 3.2 全局预建池诊断成立，绝对数值需降格

组件仓 `GameView.tsx:679` 把 `assets.maxActors` 纳入全局 `actorSlotCount`；
`GameView.tsx:231-242` 按这个值同步创建 image 节点。世界 UI 包在
`Show when={scene() === null}` 中（`GameView.tsx:934-1087`），所以战斗退出会重新挂载池。

主 agent 在无并发负载时，只改隔离构建产物中的 `maxActors` 常量，按
205→119→119→205 顺序跑同一 QuickJS binary、同一 960×544 短旅程：

| actor budget | battle-exit thread CPU | create/remove 结构计数 |
| ---: | ---: | ---: |
| 205 | 36.479 ms | 531 / 1 |
| 119 | 22.454 ms | 445 / 1 |
| 119 | 22.112 ms | 445 / 1 |
| 205 | 32.378 ms | 531 / 1 |

两组恰差 86 次 create，与 205−119 一致，因果方向成立：全局池扩大确实增加 battle-exit 成本，
KV2 的按地图可增长池是正确修复层。被审任务保存的样本也真实记录了 205→119 时
65.522→35.002 ms，两个状态文件均为 `5653f011…`。

不过独立复测的 205 槽两次都低于 50 ms，没有复现“修复前完整脚本必然非零退出”；本次差值为
9.9–14.0 ms，即约 0.12–0.16 ms/节点，也没有复现报告估算的 0.35 ms/节点。因此
`findings/GI0.md:78-91` 应理解为一次高成本样本与合理机制诊断，不应当作稳定的绝对成本或必然失败。
这不影响 actorSlots 功能正确性。

## 4. KP2 文本通道、网页回退与变异

`ui/entry-readers.ts:25-27` 的桌面 byte reader 仍用 `readFileSync(entry)`，map-only text reader 用
`readFileSync(entry, "utf8")`；host 为空时 byte reader 改走 `pakGet(entry)`，且 text reader 明确为
`undefined`。`ui/entry-readers.ts:35-45` 把两条通道交给 map repository，并继续把 byte reader 返回给
battle/animated/npc/terrain shard。`main.tsx:37-57` 正确使用该组合。

recording host 让 text op 返回真实 map JSON、byte op 返回 `CORRUPT`，同时断言 text=1、bytes=0。
在隔离 worktree 将 repository 接线从 `readText: readers.readText` 变异为
`readText: undefined` 后，实际结果为：

```text
error: map repository: 37707_tower (maps/37707_tower.json) is not JSON
3 pass
1 fail  (the map repository prefers the native readText channel)
```

恢复后目标测试 4/4 通过；完整测试也覆盖了它。另用真实 `dist/main.pak` 探针取得
`readText=undefined loadedFromPak=37707_tower`。最终网页验收输出：

```text
boot 268 ms; replayed 3793 frames in 1615 ms; viewport 480x272
4 checkpoints: state and pixels all match
end: spyder_route1,14,19, scene null
console errors: 0
WEB JOURNEY PASS
```

## 5. 回放、画面与门禁

被审分支没有修改 GB6/J1 tape 或验证器；与 `main` 比较五个相关文件均为 byte-identical。独立重跑：

```text
verify:g6:locks       pages=329 lockCommands=333 dynamicChecks=333 unresolved=0 error=0 exceptions=0
verify:g6:frozen      263 maps; 0 permanent input locks; 0 permanent blocking fibers; 0 errors
verify:gb6:mainline   frames=109983 battles=100 state=d62d146549221907…
verify:gb6:failures   first=d321b2173aca055d… later=2e76caf07b19e4b0…
verify:j1:mainline    frames=122145 state=88c3c6914356dd4b…
verify:j1:segment     frames=12162  state=88c3c6914356dd4b…
```

`bun run build`、`bun run build:wasm`、`bunx tsc --noEmit` 均 exit 0。构建后完整测试为：

```text
202 pass
0 fail
80289 expect() calls
Ran 202 tests across 39 files. [168.13s]
```

没有 skip；内置 bundle replay、map golden、battle golden、J1 golden 都实际执行。肉眼打开
`tests/goldens/g6-route-1.3792.png`，看到了水面、树林、作物、路标/花朵与底部可见玩家，地形没有
空白或错层；打开 `gb5-battle-main-menu.960x544.png`，双方怪物、HP 条、技能/交换/道具/投降菜单与
2× 布局均完整、无裁切或错位。语义像素断言也在完整测试中通过。

卫生复核输出：

```text
production_diff_hygiene=clean
commit_hygiene=clean
bun_lock_unchanged=yes
top_worktree_clean=yes
submodules_clean=yes
```

## 6. QuickJS 独立复测与非阻断审计发现

### 6.1 263 图首访

先执行 `bun tools/desktop.ts --build-only`，随后使用独立
`G6_BENCH_ROOT=/var/tmp/fleet/2062/g6-review-bench` 构建并运行真实 rquickjs 宿主。输出严格包含
263 个唯一 map；第一遍原始 TSV 保存在 `/var/tmp/fleet/2062/GI0-map-first-visits.tsv`
（Fleet artifact 27915，SHA-256 `280f18c8…`）：

| 阶段 | 第一次 p50 / p95 / max | 第二次 p50 / p95 / max |
| --- | --- | --- |
| read_parse | 0.346 / 1.501 / 5.558 ms | 0.314 / 1.208 / 5.192 ms |
| validate | 0.113 / 0.416 / 1.573 ms | 0.104 / 0.371 / 1.560 ms |
| compile | 0.409 / 3.150 / 21.649 ms | 0.382 / 3.206 / 19.679 ms |
| total | 0.887 / 5.533 / 24.419 ms | 0.818 / 5.357 / 21.930 ms |

这独立确认 KP2 后的读取成本在预期内，但没有逐位复现原报告的 2.600/11.642 ms。原因之一是
map 阶段的 `timed_bool` / `timed_unit` 使用 `std::time::Instant`（
`tools/g6-quickjs-bench.rs:1107-1159`），而 thread CPU clock 仅用于 journey frame；因此该数字会受机器
负载与缓存影响。原报告没有把 map 表标成 CPU time，故这是口径说明，不是验收失败。

### 6.2 继承自 main 的 lock verifier false-success

`findings/G6-lock-report.json:1176-1198` 的
`professor_lab/e001_teleport_to_map1_r001` 记录 `outcome="transferred"`，但同时
`lockedAt=-1` 且 `error="instrumented lock was not reached"`。全报告 333 checks 中只有这一项
`lockedAt < 0`，所以真实动态触达为 332/333。

`tools/verify-g6-locks.ts:492-498` 只因 transfer 就把它归为成功，`tests/g6-locks.test.ts:19-30`
又只对五个点名 row 要求 `lockedAt >= 0`。该文件、验证器及行为在 `635fde0` 基线已完全相同，
GI-0 没有改变事件、锁逻辑或其测试；因此它不是本次 kit bump 的回退，也不阻断本分支。但
“333 dynamic checks”不能解释成“333 locks 全都实际触达”。应另行收紧验证器，要求任何成功检查先
命中目标 lock，或显式建模 transfer-before-lock 的不可达分支。

## 7. 阻断项

无。组件仓已知 actor 池成本有 KV2 专项修复链；lock verifier 缺口是 main 已有的独立测试问题，已
另行提出后续任务，不要求在 GI-0 分支夹带修复。

subagent 使用：4 个；分别核对子模块/自动导入、actorSlots 与隔离变异、KP2 recording-host 与隔离变异、回放/QuickJS/locks；并行静态审查与轻量测试节省了时间，主 agent 亲自复跑全部重门禁、网页、画面和性能基准。

PASS
