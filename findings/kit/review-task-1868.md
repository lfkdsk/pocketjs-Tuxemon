# Review KF2（task 1868）：对话冻结与 NPC 碰撞

- 被审分支：`fleet/task-1868`，`d56efcc`
- 规格基线：`4dfb651`
- 审查结论：**PASS**。阻断项为零；有一项已披露、可复现但不阻断本次合并的半格冻结限制，见 §6。

## 阻断项

无。

## 1. 规格逐项结论

| 要求 | 结论 | 证据 |
|---|---|---|
| `system.messageBlocksPlayer` 为工程级可选开关，默认关闭 | 成立 | 类型与默认语义在 `src/engine/types.ts:260-278`；schema 在 `src/data/schema.json:15-23`；`createSession` 只把严格的 `true` 传给所有 world（`src/engine/session.ts:151-161`），`createWorld` 再归一化为布尔值（`src/engine/interpreter.ts:588-633`）。 |
| 任意 fiber 的 text/choices 开着时冻结玩家，并阻止新 action/playerTouch；autorun/parallel 继续 | 成立 | 唯一判定 `messageHoldsPlayer` 见 `src/engine/interpreter.ts:642-650`；mover 闸门见 `src/engine/session.ts:389-403`；触发扫描在 fiber 折叠前采样一次，action/touch 闸门见 `src/engine/interpreter.ts:845-919`。定向测试见 `tests/message-blocks-player.test.ts:138-260`。 |
| 关框确认不能同时启动床前 action | 成立 | `held` 在确认关闭 modal 之前采样（`src/engine/interpreter.ts:850-852`），床夹具在 `tests/message-blocks-player.test.ts:172-193`。将“完成文字的确认”从 held 中排除后，该测试单独变红，见 §5 M2。 |
| 开关关闭时保持 v1 | 成立 | absent/`false` 的行为测试在 `tests/message-blocks-player.test.ts:162-170,187-193,207-213`。审查探针将碰撞提交 `fc9c645` 与 HEAD 在真实 G6 tape 上逐帧比较完整 `SessionState`：两种默认写法均 3,410/3,410 帧字节相同，chain 都是 `ada28608`。 |
| schema、README、engine README 与 v1 CHANGELOG 修订 | 成立 | `src/data/CHANGELOG.md:109-130` 明确默认关闭及 body 规则；`README.md:278-287`、`src/engine/README.md:110-124,147-159` 说明运行时语义；全量测试中的 editor schema 副本一致性测试通过。 |
| NPC 单步、路线与 BFS 只被 `blocks:true` body 阻挡 | 成立 | 单步占位判定跳过 `!o.blocks`（`src/engine/chars.ts:392-417`），NPC BFS 只收 `blocks:true`（`src/engine/chars.ts:648-656`）；无 active page 的角色会在同步时移除（`src/engine/chars.ts:220-285`）。 |
| `blocks:false`、无精灵占位、未生成 NPC 槽可穿过；`blocks:true` 仍挡 | 成立 | reducer 与 session 夹具在 `tests/chars.test.ts:202-280`、`tests/k2-movement.test.ts:321-387`。旧行为变异造成 5 个针对性失败，见 §5 M3。 |
| 玩家 `pathTo` 额外改动合理且有测试 | 成立 | 实际移动已经使用只盖 `blocks:true` 的 body table（`src/engine/session.ts:250-262,590-642`）；BFS 删除“所有角色都排除”的第二套口径后与实际步进一致（`src/engine/session.ts:754-818`）。一格走廊夹具在 `tests/k2-movement.test.ts:372-387`，并在 60/30/20/4 Hz 临时扩展下通过。 |
| 原有 corridor-replan 测试没有掩盖回归 | 成立 | `tests/k2-movement.test.ts:258-277` 将真正的临时 blocker 明确设为 `blocks:true`，保留“等待 → blocker 离开 → 重规划”的原意；新的 false/true 成对夹具分别钉住新旧边界。 |
| 存档、多 Hz、确定性 | 成立 | 消息冻结在 60/30/20/4 Hz 的采样一致及存档恢复逐帧一致见 `tests/message-blocks-player.test.ts:263-363`；碰撞/寻路 JSON 往返见 `tests/k2-movement.test.ts:390-488`。审查还把 blocks:false 的 NPC 路线和玩家 pathTo 临时扩到 4 Hz，3 项均通过。真实 G6 开关开启双跑完整状态 hash 均为 `ada28608`。 |
| goldens 与渲染预算不变 | 成立 | `git diff --quiet 4dfb651..HEAD -- tests/goldens` 成功；Sunstone 定向套件 24/24 通过，覆盖固定 framebuffer、双跑、60/30/20/4 Hz、transfer burst、idle/steady op budget、节点数和 pak/bundle 大小。 |
| QuickJS 无可测回归 | 成立 | §7 的独立复跑：基线 p95 0.544–0.574 ms，分支关闭 0.553–0.585 ms，开启 0.534–0.577 ms，区间重叠且都约 0.57 ms。 |
| 通用组件实现、无内容特判；`bun.lock`/`vendor` 未改；无新增 fleet 号 | 成立 | runtime 只新增通用 system/body 规则；`git diff --quiet` 对 `bun.lock`、`vendor`、`tests/goldens` 均成功；对 `src tests editor README.md` 的零上下文 diff 与四条提交信息搜索均输出 `new task reference: none`。 |

## 2. 强制门禁（严格顺序）

我先单独运行构建，确认 exit 0 后才启动测试：

1. `bun run build:example` → exit 0，最后一个构建为 `PocketJS build: done`。
2. `bun test` → exit 0：`695 pass`、`0 fail`、`458535 expect() calls`，43 个文件，82.15 s。
3. `bunx tsc --noEmit` → exit 0，无诊断。

恢复所有变异后又运行：

- `bun test tests/message-blocks-player.test.ts tests/chars.test.ts tests/k2-movement.test.ts` → **59 pass / 0 fail / 3,480 expect**。
- `bun test tests/sunstone-game-sim.test.ts tests/sunstone-journey.test.ts` → **24 pass / 0 fail / 140 expect**。

工作树在这些检查后只含本审查报告与审查探针，没有残留实现变异。

## 3. 对话开关细查

实现采用“一个判定、两个闸门”：world 上的严格布尔开关与当前 `modal !== null` 合成 `held`，session mover 和 interpreter trigger scan 都读取它。这避免移动和触发对“什么算打开的消息框”产生分叉。

触发顺序正确：`stepInterp` 先取消失效 parallel，再扫描触发，最后才折叠 parallel 与 main（`src/engine/interpreter.ts:1233-1265`）。因此按确认时若框已打开，`held` 必为真；即使同一折叠稍后关闭框，确认也不会漏给面前的床。autorun/parallel 分支位于 action/touch 闸门之前，仍可启动或继续，符合规格。

默认兼容不是只看最终位置。审查探针 `findings/review-task-1868/default-byte-compare.ts` 用真实 G6 的 3,410 帧 tape，对 `fc9c645`（只有碰撞修复）和 HEAD 比较每帧完整 JSON `SessionState`：

```text
default absent: 3410 full SessionState frames byte-identical; chain=ada28608
default false: 3410 full SessionState frames byte-identical; chain=ada28608
enabled replay A/B: ada28608 / ada28608
```

这条 tape 本身不会在消息框下移动或把确认漏给事件，所以开关开启与关闭 chain 相同；专门的卧室夹具覆盖了这些分支。

## 4. `blocks` 碰撞与真实工程结果

修改同时落在 NPC 的即时 occupant 检查与 BFS 初始 blocked 集合，且玩家 `pathTo` 使用同一份 `tableWithBodies`。这三处口径一致；`blocks:false` mover 不会在 BFS 阶段被误判不可达，也不会在真正迈步时再次被挡。

玩家 `pathTo` 的顺带修改虽超出最窄措辞，但属于必要的一致性修复：此前搜索排除全部角色，而实际步进只认 body，导致搜索声称无路；现在搜索与步进都认 `blocks:true`。它有 session 层一格走廊测试，不是未测的扩张。

我重新聚合了 `findings/KF2/lockfire-outcomes.tsv` 的 319 行逐页结果：

- 基线：243 `locked→unlocked`、5 `STUCK-LOCKED`；
- 分支：246 `locked→unlocked`、2 `STUCK-LOCKED`；
- 恰好三页从卡死变为解锁：`route1/e041_gym_time_r007`、`taba_ba_br_3/e003_there_he_is_r002`、`taba_ba_main/e003_im_here_r003`；
- 开启消息冻结只额外改变床页：`locked→transfer` 变为 `transfer-before-lock`，因为探针旧时依赖了框下确认泄漏，属于预期修正。

没有 Tuxemon 地图名、变量名或导入规则进入 `src/engine`；真实地图只存在于 findings 探针与证据中。

## 5. 变异检查

所有变异均以补丁改坏实现、运行定向测试、再以反向补丁恢复；最终源码与 HEAD 相同。

| 变异 | 实际结果 | 说明 |
|---|---|---|
| M1：让 `messageHoldsPlayer` 只承认 main-owned modal，等价于去掉 parallel 分支冻结 | `5 pass / 7 fail` | 玩家在 parallel 文本下移动、床 action 泄漏、touch 未被挡、4-Hz/存档语义断言均红。 |
| M2：当确认关闭完整 text 时把 `held` 强制为 false | `11 pass / 1 fail` | 唯一失败正是 `the confirm that advances the box never starts the faced bed`，收到 `home/bed` main fiber。 |
| M3：NPC occupant 与 BFS 不再跳过 `blocks:false` | `42 pass / 5 fail` | sprite-less transfer、未生成 NPC 槽、普通路线、等待路线和 NPC pathTo 全部被对应测试抓住；`blocks:true` 测试仍通过。 |

恢复后 59 个定向测试全绿，`git diff` 对两处实现文件为空。

## 6. 非阻断项：消息出现同 tick 的半格冻结

真实 G6 卧室探针可稳定复现：

```text
[0] player spyder_bedroom@4,4 px=62,64 ... modal: text ... e002_intro_question
[10] player spyder_bedroom@4,4 px=62,64 ... modal: text ... e002_intro_question
```

原因是 session 每个 reference tick 先折 mover、后折 interpreter；玩家在本 tick 先迈 2 px，parallel 随后打开框，下一 tick 才看到 `held` 并停住。它不会再开新一步，也不会漏触发 action/touch；多 Hz、存档与双跑仍确定。相同的“立即停住已提交的一步”也是 v1 的 main/choices/input-lock 闸门既有规则。

我将它判为本次**非阻断**：规格同时要求开关缺省时 v1 逐字节不变，而把所有冻结闸门改成 RPG Maker/Tuxemon 的“走完已提交的一格再停”会改变既有时序和 golden。只修新开关虽能避免 v1 变化，却会让 parallel message hold 与 main message hold 采用两套步进语义。

后续最小通用改法是在 `src/engine/session.ts:389-403` 计算 frozen 后：禁止开始/串联新步，但若 `s.move.moving` 已为真，则用 `buttons=0` 继续调用 `stepMovement` 直到 tile boundary。需更新所有“框/锁在步中打开”的夹具，并重审对应 frame goldens；在 G6 卧室的上述输入下，玩家会完成向左一步落到 x=3，而不是在 x=4 的 px=62 停住。

## 7. QuickJS 复跑

方法与 builder 一致：用 `findings/KF2/qjs-bench` 的 rquickjs 0.12 harness，把基线 `4dfb651` 与当前 engine 各自打成 IIFE，在 QuickJS 中重放真实 G6 的 3,410 帧。每组 3 次：

| 配置 | boot | 全帧 p95（3 次） | walking p95（3 次） | 终点 |
|---|---:|---:|---:|---|
| 基线 `4dfb651` | 315.8 ms | 0.571 / 0.544 / 0.574 ms | 0.580 / 0.538 / 0.575 ms | `spyder_route1@14,19` |
| 分支，开关关 | 309.4 ms | 0.572 / 0.585 / 0.553 ms | 0.581 / 0.585 / 0.554 ms | 同上 |
| 分支，开关开 | 304.9 ms | 0.534 / 0.560 / 0.577 ms | 0.541 / 0.574 / 0.585 ms | 同上 |

三组区间重叠，没有可测回归；结果复现 builder 报告的 p95 ≈ 0.57 ms。数字只含 reducer，不把它冒充完整渲染帧。

## 8. 画面与仓库卫生

我打开了 `tests/goldens/sunstone-attract.700.png` 原图：画面是完整的绿色村庄、树篱/栅栏/NPC 与中央玩家，顶端显示 `YOU HAVE CONTROL`，左右 letterbox 为黑色；不是空帧、占位色或错误裁切。对应 framebuffer 语义/hash 测试及 render budget 均通过。

`git diff --check 4dfb651..HEAD` 无输出；`bun.lock`、`vendor/`、`tests/goldens/` 都无 diff。被审的四条提交均由 `lfkdsk <lfkdsk@gmail.com>` 创建，提交信息无 fleet/task 号、无 AI trailer，且按碰撞、消息、文档、报告分步提交。

PASS
