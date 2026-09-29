# 复审：G6 修复 2（task 1878）

规格 `game-G6-fix2.md`，被审提交范围 `836635f..8da23bf`（HEAD `8da23bf`，分支 `fleet/task-1833`）。上一轮复审 `findings/review-task-1862.md`（FAIL：B1 自动对话回归、B2 逐锁证明不可信）。子模块 `vendor/pocket-rpgkit` = `c2e55a0`（KF2 message hold + blocks 碰撞，含 KR1 `08880fa`）。

全部复核均在本 worktree 上用真实 `bun run import` / `bunx tsc` / `bun test` / 真实 reducer 驱动完成，不采信 builder 自述数字；每条关键结论都做了变异测试（改坏后必须变红，验证完立即 `git checkout --` 还原）。

## 1. B1：对话冻结玩家（回归修复）

- `importer/project.ts:1705` 现在始终写 `system: { messageBlocksPlayer: true }`；组件仓 `session.ts:239`/`interpreter.ts:650` 消费该开关。
- `tests/g6-dialogue-lock.test.ts` 是对真实 `dist/project.json` 跑真实 reducer 的集成测试（非 mock）：开场问题期间按住 LEFT 59 帧玩家坐标/像素完全冻结在 `(4,4)`；面朝床确认开场问题不会启动 `resting_in_bed`；不跳过 CEO 独白期间按方向键走不到楼梯，`state.mapId` 仍是 `spyder_bedroom`；`v.question_intro` 先于 `v.spyder_intro` 先于传送写入。全部复跑通过（`bun test tests/g6-dialogue-lock.test.ts` → 3 pass / 35 expect）。
- **变异**：把 `importer/project.ts` 的 `messageBlocksPlayer` 改成 `false`，重新 `bun run import`，同一测试文件两个用例立即变红——玩家在独白期间走到 `(7,2)`（预期 `(4,4)`）。改完立即 `git checkout -- importer/project.ts` 还原，重新 import 确认 `git diff` 为空。
- 结论：**成立**，且回归测试对该开关敏感（非摆设）。

## 2. B2：`routes` 5 处永久锁 + 逐锁证明

- `importer/project.ts:902` 的 `char_move` 现在导成 `skippable: true`（对应 Tuxemon `reroute.py`/`char_move.py` 撞墙即停语义），配合组件仓 KF2 的 `blocks` 碰撞修复。
- `tools/verify-g6-locks.ts` 读代码确认：`verifyProjectLocks` 对每个含 `lockInput` 的页面、对页面里**每一条** `lockInput` 命令都单独调用 `checkPage`（`tools/verify-g6-locks.ts:451-466`），`checkPage` 用真实 `createSession/startSession/stepSession` 跑满 12,000 帧直到 `inputLocked` 变 false 或 `mapId` 变化（`tools/verify-g6-locks.ts:196-252`）；`staticHint`/`reachable` 只作为诊断字段写入报告，**不参与 outcome 判定**（`outcome` 完全由 `checks[].outcome` 决定，`tools/verify-g6-locks.ts:475-482`）——上一轮复审点名的"静态推理冒充证明"问题在代码层面已经不存在。
- 复跑 `bun run verify:g6:locks`：`{"pages":319,"lockCommands":323,"dynamicChecks":323,"outcomes":{"unlocked":317,"transferred":2,"unresolved":0,"error":0},"exceptions":0}`，与 `findings/G6-lock-report.json`、`findings/G6.md` 声称的数字完全一致。`dynamicChecks === lockCommands` 说明确实是逐条锁做了动态检查，不是抽样。
- **变异 1**：把 `route: { steps, repeat: false, skippable: true }`（project.ts:902）改回 `skippable: false`，重新 import + 复跑 verify:g6:locks：`unresolved` 从 0 变成 2，其中一条正是 `taba_ba_main "time to face the master"`——复审 1863 点名的 5 处回归之一。还原后重新验证恢复 0 unresolved。
- **变异 2（terrain，见下）**同样能让 dynamic 检查捕捉。
- `tests/g6-locks.test.ts` 对 5 个具体点名页面（`route1` gym time、`taba_ba_br_3` there he is、`taba_ba_main` im here / time to face the master、`taba_ba_br_1` get acolyte）逐个断言 `outcome === "unlocked"` 且每个 `check` 都有 `lockedAt>=0 && resolvedAt>=lockedAt`；复跑通过。
- **抽查 ≥10 页自证**：用独立的旧探针 `findings/review-task-1862/probe/lockfire2.ts`（不依赖 `verify-g6-locks.ts` 自己的 `forceLockBranch` 机制，而是真的把玩家放到事件旁边按方向键/确认键触发）对当前 `dist/project.json` 全量跑了一遍（319 页），加上手工抽查 10 个随机页 + 1 个复杂交叉事件页深挖：
  - `taba_ba_br_2 e008_battle_redo_r005`（"battle redo"）在这个简化探针下报 `STUCK-LOCKED`。追查发现：该页本身没有 `unlockInput`，靠同图的 parallel 事件 `e005_acolyte2battle_won` 在 `v.talkedonce==1 && v.battle_last_result==5 && v.acolyte2battledone!=2` 时解锁；而进入 `battle_redo` 页本身要求 `v.lossbattle==2 && v.acolyte2battledone==2`，这两个变量**只**在另一并行事件 `e006_acolyte2battle_loss` 里、且**在其自身守卫已要求 `v.talkedonce==1`** 的分支下才会被一起写入。也就是说"能进入 battle_redo"这件事本身就蕴含 `v.talkedonce==1` 已经成立。`verify-g6-locks.ts` 的 `resolutionSeed`（沿 if 链收集到 `unlockInput` 的守卫条件）正确地把这条蕴含关系当作种子注入，`taba_ba_br_2/e008` 在正式报告里判定 `unlocked`（`resolvedAt: 21`，`seededBy: "e005_acolyte2battle_won"`）是对的；简化探针的 `STUCK-LOCKED` 是假阳性，原因是它只满足目标页自身的 `condition`，不会传播"如何到达这个前置状态"所蕴含的额外事实——这正是上一轮复审记录的探针已知局限（"in-fiber guards" 无法满足），不是本次修复引入的新问题。
- 结论：**成立**。`verify-g6-locks.ts` 的动态证明经代码审查 + 复跑 + 两次变异 + 一次复杂案例深挖，是真实、非自欺的逐锁验证。

## 3. Journey 重录

- `data/g6-journey.json`：`hz:60 frames:2728 map:spyder_route1 position:[14,19] sha256:496365020783604da13fa153a71e50ad1d51f5595cf219d25d0c9d0a8db9f17f`，四个检查点 `bedroom@1064 / downstairs-mom@1292 / paper-town@1367 / route-1@2727`。
- 独立重跑 `HZ=60/30/20/4 bun tools/smoke-spyder.ts` 四次，全部到达 `spyder_route1 @14,19`；60 Hz 输出的 `sha256` 与冻结的 `data/g6-journey.json` 完全一致（byte-for-byte 可重放）。30/20/4 Hz 的 frames（1441/1009/382）与 checkpoints 与 `findings/G6.md` 一致。
- 帧数从 3,410 降到 2,728 的原因是可信的：NPC 现在真的沿路线走动（K1/K2 生效）+ 对话冻结玩家后驱动不用再空等玩家能走的窗口；`tools/smoke-spyder.ts:143-150` 的 `waitForOpenGoal` 用真实 `tick()`（即 `stepSession`）等一个 NPC 让开目标格，帧数上限 `HZ*10`（10 秒），超时才失败；`walkTo`/`goTo` 走的是组件仓真实 `searchWalk` 寻路，没有绕过或修改组件仓规则。
- 四张 golden PNG 全部打开肉眼核对：卧室（玩家站毯子上，朝下）、楼下（玩家+粉发妈妈站在餐桌旁）、Paper Town（完整小镇布局，商店/民居/篱笆/树，蓝发玩家站在路口）、Route 1（草地/农田/树林/水域，玩家+两只怪物精灵），画面干净、无缺失贴图或错位。
- `g6-downstairs-mom.1292.png`/`g6-paper-town.1367.png`/`g6-route-1.2727.png` 与旧文件 `git diff` 显示纯重命名（0 insert/0 delete），sha256 与 `findings/G6.md` 声称的旧哈希（`a430bf14…`/`5a43f4c6…`/`a089d5b5…`）完全一致——確认"仅改名，字节不变"属实。新卧室 golden 的 `rgbaFnv1a`/`pngSha256`（`00af3e6f`/`3e63b2f4…`）与 `data/g6-goldens.json` 记录一致。
- `bun test tests/g6-golden.test.ts` 复跑：6 pass / 0 fail / 38 expect。
- 结论：**成立**。

## 4. 驱动是否绕过组件仓规则

`tools/smoke-spyder.ts` 的 `waitForOpenGoal`/`walkTo`/`goTo`（第 134-191 行）读代码确认：卡在挡路 NPC 时是反复调用真实 `tick()`（`stepSession`）让世界按正常规则推进，超时（10 虚拟秒）才抛错；`vendor/pocket-rpgkit` 复核 `git -C vendor/pocket-rpgkit status --porcelain` 为空，无本地修改。**成立**。

## 5. 非阻断 d/e/f

- **(d) 地形单向台阶**：`importer/terrain.ts:1006` 不再合并保留旧 G1 `collision*` 矩形，只用 G5 `patch.passage`。独立重跑复审 1863 遗留探针 `oracle_export.py`（原始 TMX oracle）+ `kitsteps.ts`（真实组件仓 `canStepFrom`）：`{"maps":263,"compared":453624,"mismatch":0,"oneWayOracle":1161,"oneWayKitAgree":1161}`，与 `findings/G6.md` 声称数字完全一致。**变异**：把 `passage` 字段改回旧的"过滤合并"写法，重新 import 后复跑同一探针，精确复现之前报告过的 49 处 mismatch（全部在 `rubberduck_*` 地图），验证了这就是该修复要解决的问题。还原后确认恢复 0 mismatch。
- **(e) 默认 v1 输出变化**：`tests/importer.test.ts:238-243` 把默认 profile 的字节哈希钉成新值 `1f4aa5b232b5…`，`findings/G6.md` 说明了变化原因（对话冻结是全局语义、`char_move` 修正对所有 profile 生效）。该测试在 `bun test` 全绿结果中。
- **(f) 写死路径**：`grep -rn "1862" tools/ importer/ tests/` 无命中；`tools/verify-g6-determinism.ts:75` 现在用 `G6_SCRATCH_ROOT` 环境变量（默认回退共享 `/var/tmp/fleet/pocket-tuxemon`），不再硬编码 `/var/tmp/fleet/1862`。
- 结论：三项均**成立**。

## 6. 性能（QuickJS）

`findings/G6.md`"修复 2"一节**没有**重新给出 QuickJS 数字——文档明确写"desktop, web, application-size, and QuickJS measurements above are retained from the original G6 acceptance and were not rerun for this review-fix pass"，而那组数字（walk p95 18.0-18.2ms、switch max 227-234ms）来自更早、未做 K1/K2 性能修复的旧组件仓基线，不代表当前 `c2e55a0` 的真实情况（上一轮复审 1863 已经测过 fix1 在新组件仓上是 0.90ms/3.8ms 量级，和这里贴的"original G6 baseline"数字差两个数量级，容易让人误判有没有回退）。

本次复审自己跑了 `bash tools/bench-g6-quickjs.sh`（`PATH` 需要加 `~/.cargo/bin`，真实 rquickjs Guest + UiSurface，重放新 2,728 帧 journey tape）：

| 视口 | 启动到首帧 | 走路 p95/max | 切图 p95/max |
| --- | ---: | ---: | ---: |
| 480×272 | 946 ms | 1.047 / 1.969 ms | 1.383 / 3.546 ms |
| 960×544 | 1018 ms | 0.932 / 3.442 ms | 1.491 / 4.177 ms |

对照复审 1863 记录的 fix1 数字（960×544：走路 p95 0.90 ms，切图最坏 3.8 ms，启动 845–895 ms），fix2 的数字在同一量级、无回退（切图 max 略高到 4.18ms 但仍远低于原始 230ms 灾难值，且不同 journey tape 内容不同，属正常波动）。

**结论**：功能上**没有性能回退**（成立），但 builder 的 `findings/G6.md` 报告本身**遗漏了这次修复应有的 QuickJS 对照更新**，留着一段容易误导（数量级不对）的旧基线文字。`game-G6-fix2.md` 的「验收」清单本身没有把 perf 列为强制交付项，所以判**非阻断**，但建议下次顺手把这段更新或删除。

## 7. 门禁复跑

```
bunx tsc --noEmit                 # exit 0
bun test tests/                   # 40 pass / 0 fail / 39406 expect（与声称一致）
bun run import (×2 独立根)        # verify:g6:determinism PASS，2388 files / 47170419 bytes /
                                   # sha256 2b534f0d7dc5324fc797d98f0b334559a784a4a92c7679578f1408b31d384381（与声称一致）
bun run verify:g6:locks           # 319/323/323, unresolved 0, exceptions 0（与声称一致）
bun tools/frozen-k1.ts            # 263 maps / 0 permanent input locks / 0 blocking fibers / 0 errors（与声称一致，耗时约71秒）
git diff --stat -- bun.lock       # 空
```

## 8. 合并 / 提交卫生

- `git log 836635f..8da23bf`：merge commit `21bfc86`（`836635f` + `6fcfea9`）只新增文件（KF2/KR1 归档报告 + 子模块指针），没有删除/覆盖任何游戏仓已有内容；`vendor/pocket-rpgkit` diff 只改了一行 `Subproject commit`，无内联改动。
- `bun.lock`：`git diff 836635f..8da23bf -- bun.lock` 为空。
- `tools/__pycache__/`：`git status --porcelain` 只显示为 untracked，未被提交（`git ls-files | grep -i pycache` 无结果）。
- 代码与提交信息里没有 fleet 任务号泄漏（除 git 自动生成的 merge 提交信息引用分支名 `fleet/task-1833`，不算违规）。

## 阻断项

无。

## 非阻断项（建议后续顺手做）

1. `findings/G6.md` 的"Desktop QuickJS performance"一节仍标注"original G6 baseline"且明确没有为本次修复重跑；建议下次修复顺带贴一份 c2e55a0 下的真实数字，避免与"回退没回退"的判断产生歧义（详见第 6 节，本轮复审已自行补测，未发现回退）。

PASS
