# KF2：对话框冻结玩家（可选开关）+ NPC 碰撞遵守 `blocks`

- 基线：`main` = `4dfb651`；分支 `fleet/task-1868`
- 来源：G6 修复复审 `review-task-1862.md` 的 B1、B2（探针在 `findings/review-task-1862/probe/`，游戏仓 G6 worktree 内）
- 提交（作者 `lfkdsk <lfkdsk@gmail.com>`，无 AI 尾注，未 push）：
  - `fc9c645` feat(engine): character collision follows page blocks
  - `3fcf66f` feat(engine): system.messageBlocksPlayer holds the player under any open box
  - `2e5dca1` docs: describe the message hold option and blocks-only character bodies
  - 本报告与 `findings/KF2/` 另起一个 docs 提交

## 结论先行

1. **新增工程级开关 `system.messageBlocksPlayer`（默认关）**。打开后，任何 fiber（main 或 parallel）的 text/choices 框开着时：玩家不能移动，不启动新的 `action` / `playerTouch` 页；`autorun` / `parallel` 照常推进。关闭或不写时，v1 行为逐字节不变。
2. **角色碰撞改为只认 `blocks: true`**，与玩家一致。NPC 的每一步（page patrol、random/approach、`moveRoute`）和 `pathTo` / `approach` 搜索都不再被 `blocks: false` 的事件挡住。玩家自己的 `pathTo` 搜索同样不再绕开这类事件。
3. **门禁**：
   - `bun run build:wasm` → `bun run build:example` → `bun test`：**695 pass / 0 fail / 0 skip**，458,535 个 `expect()`。基线是 676 / 0 / 0，456,928 个。
   - `bunx tsc --noEmit` exit 0。
   - `tests/goldens` 与 `bun.lock` 相对基线都没有改动。
4. **在真实的 G6 工程上验证**（`dist/project.json`，用审查的探针，只把引擎换成本分支）：
   - B1 的三个场景都消失了（开关打开时）；开关不写时，结果与审查数字逐帧一致。
   - B2 的 5 处永久锁里，由 `blocks:false` 造成的 3 处全部解锁。
   - 全部 319 个上锁页里，只有这 3 页的结局变了，而且都是由卡死变为解锁，没有任何一页变差。
5. **QuickJS**：只测 reducer，重放 G6 journey 3,410 帧。三种配置的每帧 p95 都在 0.57 ms 左右，没有可测的差别。
6. **对游戏仓的影响（bump 后需要处理）**：
   - journey tape 在新 kit 下仍然到达全部 4 个检查点，终点也相同。
   - 但 Paper Scoop 店员剧情里 Harith 不再原地耗完重试，玩家因此提前 57 帧进入卧室（f1657，基线是 f1714）。所以 f513–f2478 之间的逐帧状态不同，卧室检查点 f1723 的玩家朝向也不同（见 §4）。
   - 游戏仓 bump 后需要重录 tape，或重新生成卧室 golden。

## 1. 开关：`system.messageBlocksPlayer`

**格式**：
- `Project` 新增可选的 `system` 对象（`src/engine/types.ts:262` `ProjectSystem`，`:278`）。
- schema 在 `src/data/schema.json:15`，`additionalProperties: false`，字段是 `messageBlocksPlayer: boolean`。
- 编辑器里的 schema 副本已用 `bun editor/gen-assets.ts` 重新生成（`editor/engine/projects.ts`，只多了这 8 行）。

**实现**：一个判定、两个闸门。
- 判定是 `messageHoldsPlayer(world, interp)`，定义在 `src/engine/interpreter.ts:649`：开关打开且 `interp.modal !== null`。
- `createWorld(map, common, hz, { messageBlocksPlayer })` 把开关存进 World（`interpreter.ts:632`）。`createSession` 从 `project.system` 读出开关，传给每张图（`session.ts:158`）。
- **触发闸门**：`scanTriggers` 在所有 fiber 执行之前采样一次（`interpreter.ts:852`）。按确认键时哪个框开着，这一下就归哪个框。
  - action 页：`if (s.inputLocked || held || !input.confirmEdge) continue`（`:895`）。
  - playerTouch 页（含原地转向触发）：`if (held) continue`（`:909`）。
  - autorun 与 parallel 不经过这两道闸门。
- **移动闸门**：session 的 mover 条件里加了 `!held`（`session.ts:399-400`），与原有的 busy / choices / inputLocked 闸门并列。

**设计取舍**：
- **冻结语义沿用现有闸门：不调用 `stepMovement`**。
  - 同一 tick 里，mover 先于解释器运行。所以如果框和一步移动在同一 tick 开始，这一步会停在已走的像素偏移上，框关了再走完。
  - G6 卧室复现里，第 1 tick 按住左键，就会停在 px=62，也就是偏了 2 px。
  - 用基线引擎、把同一段开场改成 autorun，也同样停在 px=60。说明这是 v1 所有闸门早就有的行为，不是新引入的。
  - MV 和 Tuxemon 的做法是走完这一步再停。要改成那样，得把所有闸门一起改，会改变 v1 的 golden，所以这次没动。
  - 现在这种做法还有一个好处：落地一定发生在框关闭之后，所以不会吞掉 playerTouch 的进入沿。
- **被闸住的 touch 不补发**。框开着时，玩家只可能被强制路线移动；这期间经过的 touch 格不触发。这与 main fiber 运行期间的既有规则一致（`if (s.main) continue`）。
- **autorun 可以在框下启动**。它自己的 text 按原有的单槽规则排队等框（C09）。parallel 不受影响。
- **存档**：`canSave` 本来就要求 `modal === null`，所以「被框冻结」这个状态永远不会进存档。开关属于工程数据，不属于状态。测试覆盖了存档往返。

## 2. 角色碰撞遵守 `blocks`

**改动**：
- `occupantBlocks` 跳过 `!o.blocks` 的角色（`src/engine/chars.ts:413`）。它被 patrol、random、approach、强制路线的每一步共用。
- NPC 的 BFS 占位集合也只收 `blocks: true`（`chars.ts:652`）。
- 玩家的 `pathTo` / `approach` 以前会额外把所有角色格加进 BFS 的排除集（原注释写的是「the way a character route excludes others」）。现在删掉了这层，只用盖过 body 的 passage 表（`session.ts:816`）。这样玩家实际能走的格子，和搜索认为能走的格子一致。

**不变的部分**：
- 角色永远不踏进玩家所在的格，以及玩家正要进入的格。
- 移动者自己的 `blocks` 不影响它会不会被挡：`blocks: false` 的角色照样会被 `blocks: true` 的 body 挡住。

**已有测试的调整（1 处）**：`tests/k2-movement.test.ts:260`「an occupied corridor is replanned after its blocker moves away」。
- 它的 blocker 用的是默认 `blocks: false` 的 `staticNpc`。
- 新规则下这个测试仍然通过，但不再覆盖「等待 → 重规划」这条路径。
- 所以把 blocker 改成 `blocks: true`，恢复测试原本的意图。

其余 676 个原有测试全部不改就通过，`expect()` 数量也不变。只改第 2 部分时跑过一遍全量：676 pass，456,928 个 `expect()`，与基线相同。

## 3. 测试（+19）与变异

**新增测试**：
- `tests/message-blocks-player.test.ts`（12 个）。夹具是一间卧室：开场剧情是 parallel 页（两行字 → 「跳过吗」 → 两行演讲），外加一张床（action，有 body）和楼梯（touch 传送）。
  - `:139` 开场框开着时按住方向键，位置和像素都不变；框关闭后，同样按住会走到墙边。`:162` 是 v1 对照（不写开关、写 `false` 两种），玩家会在框下走开。
  - `:172` 面朝床翻页，床不启动；框关闭后再按确认，床会启动。`:187` 是 v1 对照：同一下确认把床也启动了。
  - `:196` 开场期间走不到楼梯，结束后能走到。`:207` 是 v1 对照：开场期间就走上楼梯，开场被跳过。
  - `:215` 框开着时，parallel 计时器照常累加，autorun 也照常启动并跑完。
  - `:240` 解释器层：框开着时，touch 进入沿不触发；v1 会触发。
  - `:301` 60/30/20/4 Hz 下，每 30 tick 的采样全部相等。采样内容包括位置、像素、相位、框内容和变量。另有语义断言：玩家在 tick 32 落到 (4,4) 时框打开，直到 tick 240 都停在 px=64，之后继续走。
  - `:316` 在开场 wait 期间存档（这是安全点），走 `createSnapshot` → `encodeEnvelope` → `decodeEnvelopeText` → `restoreProblem` 再恢复。接着逐帧比对 390 帧：位置、框、变量都相等，最后整个 `SessionState` 也 `toEqual`。其中有 100 多帧处于被冻结状态。
  - `:375`、`:381` schema 接受 `true`、`false` 和空的 `{}`，拒绝非布尔值和未知键。
- `tests/chars.test.ts`（4 个，reducer 层）：
  - `:202` 巡逻路线穿过 `blocks:false` 标记，最后停在 `blocks:true` 的 NPC 前面。
  - `:217` 等待型、不可跳过的路线越过无精灵的传送标记，正常落地并释放 waiter。
  - `:237` 一格宽走廊里有 `blocks:false` 标记，`pathTo` 能穿过去。
  - `:261` 同一条走廊换成 `blocks:true` 的 body，搜索仍然被挡，重试次数用完后路线结束。
- `tests/k2-movement.test.ts`（3 个，session 层；对应 B2 的形状）：
  - `:330` 上锁的过场让 NPC 走过无精灵的 touch 传送标记，然后解锁（对应 route1 gym time）。
  - `:344` NPC 还没登场时，它的 `blocks:false` 占位页可以穿过；登场之后，body 会挡住（对应 im here）。
  - `:372` 玩家等待型 `pathTo` 能穿过一格宽走廊里的 `blocks:false` 标记。

**变异检查**（改坏、跑新测试文件、再 `git checkout` 还原）：

| 变异 | 结果 |
|---|---|
| M1 `messageHoldsPlayer` 恒为 false | 7 个红 |
| M2 mover 闸门去掉 `!held` | 5 个红 |
| M3 action 闸门去掉 `held` | 1 个红（床） |
| M4 touch 闸门去掉 `held` | 1 个红（touch） |
| 第 2 部分整体还原到基线（`chars.ts` 和 `session.ts`） | 6 个新测试红：chars 3 个，k2 3 个 |

`blocks:true` 仍然挡路的那条测试，以及修复了意图的走廊重规划测试，在新旧引擎下都通过。

## 4. 真实 G6 工程上的验证

**方法**：
- 探针取自审查（`findings/KF2/probe/`），只改了两处：引擎路径可以用 `ENGINE` 切换；`MBP=1` 时往工程里注入 `system.messageBlocksPlayer: true`。
- 工程是 G6 worktree 的 `dist/project.json`（kit `4dfb651` 导出）。
- 「基线」指 G6 worktree 里 vendored 的 `4dfb651` 引擎。

### B1（开关打开时消失；不写开关时与审查一致）

| 探针 | 基线 / 本分支不写开关 | 本分支 + 开关 |
|---|---|---|
| `walktext.ts … spyder_bedroom 4 4 down LEFT` | 开场问题框开着，玩家第 40 帧走到 (0,4)；两种配置输出逐行相同 | 一直在 (4,4)，px=62（第 1 tick 在框出现之前迈出的 2 px，见 §1） |
| `walkintro.ts`（选「不跳过」后按住左） | CEO 演讲期间第 64–100 帧从 (4,4) 走到 (0,4) | 到第 275 帧仍在 (4,4)，px=64 |
| `confirmleak.ts … 1 2 left`（面朝床翻页） | 第 62 帧确认，`main=e004_resting_in_bed_r004`，此时开场的 choices 框还开着 | 第 62 帧确认，`main=-` |
| `escape.ts '[["RIGHT",60],["UP",40],["LEFT",12]]'` | 第 181 帧传送到 `spyder_downstairs`，`v.spyder_intro` 未写入 | 到第 570 帧都在卧室 (4,4)，演讲框开着 |

### B2（逐页直接触发全部上锁页：`lockfire2.ts`，`PARTY=1`）

结局对照（完整逐页表：`findings/KF2/lockfire-outcomes.tsv`，319 行）：

| 配置 | locked→unlocked | lock-not-reached | STUCK-LOCKED | no-start-cell | locked→transfer | transfer-before-lock |
|---|---:|---:|---:|---:|---:|---:|
| 基线 | 243 | 66 | 5 | 3 | 1 | 1 |
| 本分支 | 246 | 66 | 2 | 3 | 1 | 1 |
| 本分支 + 开关 | 246 | 66 | 2 | 3 | 0 | 2 |

基线这一行与审查的 `lockfire-party1.json` 相同。

**基线 → 本分支，结局变化的恰好 3 页，都是从卡死变为解锁**：
- `route1` gym time：第 1,352 帧解锁。基线里，Kyle 在 (54,34) 向上走，被 (54,33) 的 `e047_enter_the_battle_area` 挡住（`blocks:false`）。
- `taba_ba_br_3` there he is：第 2,315 帧解锁。基线里，`npc_cam` 在 (14,6) 向右走，被 (15,6) 的 `e009_teleport_to_main_room` 挡住（`blocks:false`）。
- `taba_ba_main` im here：第 4,064 帧解锁。基线里，Kyle 在 (9,4) 向下走，被 (9,5) 的 `npc_aeble` 挡住：它还在第 0 页，是 `blocks:false` 的占位。

**仍然卡住的 2 页不属于 kit 的问题**：
- `taba_ba_main` time to face the master：Kyle 从 (9,9) 向左走，撞的是墙。新旧引擎结果相同，需要导入器把 `char_move` 改成 `skippable:true`。
- `taba_ba_br_2` battle redo：审查已经判定是探针误报，需要 `talkedonce=1`。
- 审查表里的 get acolyte 在这个探针里是 lock-not-reached，新旧相同。按审查的结论也是撞墙。

**另有 7 页仍然解锁，但解锁帧变了**（4 页提前，3 页推后）：
- 原因都是同一种：过场里某条 `pathTo` 在基线下会被 `blocks:false` 的格子判为不可达。
- 于是 NPC 原地站着，把 10 次重规划耗完（大约 78 帧），然后过场继续，NPC 并没有走过去。
- 现在 NPC 真的沿路线走完。
- 推后的例子：`spyder_routeb` Billie 的 `pathTo (0,37)`。基线在 (17,37) 原地耗完重试，第 97 帧解锁。本分支向西走 17 格到终点，第 156 帧解锁（`probe/lockfire2.ts` 的 TRACE 输出）。

**开关打开后只多变 1 页**：`spyder_bedroom` Resting in Bed，从 `locked→transfer@87` 变成 `transfer-before-lock@87`。
- 探针原本是在开场框开着时按确认（第 6、30 帧）来启动床的，靠的正是 B1 的确认泄漏。
- 开关打开后，这一下被框吞掉，于是走完开场、直接传送。这是修复本身预期的结果。

### G6 journey 重放（`data/g6-journey.json`，3,410 帧，60 Hz；`probe/journey.ts`）

**检查点一致**：三种配置下，4 个检查点的地图和位置都相同（bedroom f1723 在 (3,4)，downstairs f1951 在 (3,6)，paper-town f2017 在 (10,8)，route-1 f3409 在 (14,19)）。终点都是 `spyder_route1@14,19`。

**开关对这条 tape 没有影响**：本分支开和关的逐帧哈希链相同（`7feb9a95`）。这条 tape 在对话期间从不按方向键，也不在框下按确认去碰事件。

**基线与本分支的逐帧差异（`probe/journey-diff.ts`、`probe/harith.ts`、`probe/cp-state.ts`）**：
- 相差 1,211 帧，分布在 513–565、599–1723、2289–2305、2463–2478 四段。
- **根因**：Paper Scoop 的 `e010_continue_storekeeper` 让 Harith 执行 `pathTo (6,10)` 走到门口。门口 (6,10) 上站着 `npc_spyder_billie` 第 0 页的占位（不可见，`blocks:false`）。
  - 基线：Harith 在 (6,7) 原地重试。
  - 本分支：Harith 走 (6,8) → (6,9) → (6,10)，第 513 帧落地。
- **后果**：整段剧情提前结束，玩家进卧室的时间从 f1714 提前到 f1657。
- 在卧室检查点 f1723：
  - 基线在 f1714 进入卧室，淡入 9 帧，f1723 是淡入结束后的第一帧（解释器第 0 帧），玩家朝上。
  - 本分支在 f1657 进入，到 f1723 已经在卧室运行了 57 个解释器帧，玩家朝下。
- f1951、f2017、f3409 三帧的状态与基线完全相同。

**游戏仓要处理的事（推断）**：卧室 golden（f1723）和维护中的 tape sha256 会变；f1951（`d39d7b7e`）与 f2017（`4380c25c`）的状态相同，大概率不受影响。我没有用本分支构建游戏包去实测渲染结果。

## 5. QuickJS（只测 reducer）

**方法**：`findings/KF2/qjs-bench/`，这是一个离线构建的最小 crate，用 rquickjs 0.12.2，与桌面宿主 `pocket-mod` 使用的 `rquickjs = "0.12"` 相同。
- 把「引擎 + 重放入口」用 bun 打成 IIFE。
- 在 QuickJS 里 `JSON.parse` G6 工程，逐帧调用 `stepSession`，用 Rust 计时。
- 每种配置 3 次重放，一共跑 2 轮（原始输出：`findings/KF2/qjs-results.txt`）。

| 配置 | 启动（createSession，263 图） | 全部帧 p50 / p95 | 行走帧 p95 | 3,410 帧合计 |
|---|---:|---:|---:|---:|
| 基线 | 311–313 ms | 0.320–0.330 / 0.566–0.582 ms | 0.570–0.649 ms | 1,316–1,347 ms |
| 本分支 | 305–319 ms | 0.310–0.326 / 0.565–0.587 ms | 0.569–0.594 ms | 1,264–1,338 ms |
| 本分支 + 开关 | 307–313 ms | 0.309–0.325 / 0.566–0.584 ms | 0.572–0.585 ms | 1,268–1,333 ms |

- 差别在噪声范围内。个别帧的最大值在 0.7–2.1 ms 之间，三种配置都有，是 GC 抖动。
- 这是纯 reducer 的数字，不含 UiSurface 和绘制，不能与审查的整帧 p95（0.90 ms）直接比较。
- 从代码看，本次每个 tick 只多了一次布尔判断，却少了一次遍历全部角色（玩家 BFS 的排除集）。NPC 的 BFS 排除集也变小了。

## 6. 文档

- `src/data/CHANGELOG.md`：新增「v1 amendment — 2026-09-29 (message hold, character bodies)」。写明开关默认关、v1 文档行为不变；写明角色 body 的规则变更，以及依赖旧行为的文档要把 `blocks` 改成 `true`。
- `README.md`「The format in one screen」：说明了 body 规则和这个开关。
- `src/engine/README.md`：
  - 模块表里 `chars.ts` 的描述改了。
  - P1②↔P1③ 集成示例里加上了 `messageHoldsPlayer` 闸门。
  - Conventions 里新增「Message hold」一条，`isBusy` 一条也补充了说明。
  - session 折叠第 2 步写全了所有闸门。

## 7. 复现

```sh
# 门禁（worktree 根目录）
git submodule update --init          # 已用 --reference 指向本机 pocketjs 模块
BUN_CONFIG_REGISTRY=https://registry.npmjs.org/ bun install --frozen-lockfile
bun run build:wasm && bun run build:example && bun test && bunx tsc --noEmit

# G6 探针。P 是 G6 worktree 的 dist/project.json；BASE 是那里 vendored 的 4dfb651 引擎
cd findings/KF2/probe
MBP=1 bun walktext.ts $P spyder_bedroom 4 4 down LEFT '{}' 60     # MBP=0 / ENGINE=$BASE 作对照
MBP=1 bun walkintro.ts $P
MBP=1 bun confirmleak.ts $P spyder_bedroom 1 2 left
MBP=1 bun escape.ts $P '[["RIGHT",60],["UP",40],["LEFT",12]]'
PARTY=1 ONLYTAG=all-branch bun lockfire2.ts $P                     # 输出写到 /var/tmp/fleet/1868/probe/
TRACE=1 PARTY=1 bun lockfire2.ts $P spyder_routeb:e015_billie      # 逐 4 帧打印强制路线
OUT=j.json bun journey.ts && bun journey-diff.ts && bun harith.ts && bun cp-state.ts

# QuickJS reducer 计时
cd ../qjs-bench && sed "s#ENGINE#$PWD/../../../src/engine#" entry-template.ts > entry.ts
bun build entry.ts --format=iife --target=browser --outfile=bundle.js
PATH=$HOME/.cargo/bin:$PATH cargo build --release --offline
target/release/kf2-qjs-bench bundle.js $P <G6>/data/g6-journey.json 0 3
```

## 8. 遗留与建议（交给 commander）

- **游戏仓（G6 下一轮修复）**：
  - bump 到本分支之后，导入器给工程写上 `system: { messageBlocksPlayer: true }`，这样 B1 才真正在游戏里生效。kit 默认关。
  - `char_move` 导成 `skippable: true`，解掉剩下 2 处撞墙的锁。
  - 重录 journey tape 和卧室 golden（f1723），原因见 §4。
- **tick 顺序**：同一 tick 里 mover 先于解释器，所以框打开的那个 tick 迈出的一步，会冻结在已走的像素偏移上（最多 14 px）。这是 v1 所有冻结闸门共有的行为。如果以后想对齐 MV/Tuxemon 的「走完这一步再停」，需要单独立项，一起改所有闸门并重录 golden。
