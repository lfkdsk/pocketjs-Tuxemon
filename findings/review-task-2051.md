# Review J2（task 2042 + 续做 2051）：主线续录到 hospitalcure

- 被审分支：`fleet/task-2042`（worktree `~/.fleet/worktrees/task-2042`），tip `0170435`，基线 `635fde0`，15 commits。
- 被审报告：`findings/J2.md`（自判 PASS）。规格：`game-J2-mainline.md`、`game-J2-resume.md`。
- 审查方式：4 个只读 subagent 并行（tape/verifier、上游剧情对照、golden+变异、实现逐行），主 agent 串行复跑全部门禁与前向合并。所有重跑均在主 agent 串行执行。
- 审查时 `main` 已从规格点名的 `170e2c4`（GI-0）前进到 `43ab2d2`（+子模块改名、CI 并行 jobs、kit 升到 `df2d1c3`，含 `7c16a28`）；前向合并按当时的 `43ab2d2` 执行（覆盖规格点名范围）。审查途中 main 又前进到 `7ffa5fb`（D1 昼夜天气）——J2 规格第 5 条已声明 D1 合并会让 chars 事件 id 顺延、终态哈希变化，由 commander 统一重钉，不在本审查范围内。

## 逐条对照规格

### 1. 真打（成立）

- J2 段 **49,915 帧、只有按键**：`data/j2-hospitalcure-journey.json` 的 `.frames` 与 `.masks | length` 均为 49,915；顶层键只有 masks/metadata/checkpoints/hashes，无任何写状态指令（subagent 递归扫描无 `write`/`event`/`op`/`command` 键）。录制器 `tools/j2-journey.ts` 只通过生产 `Session` 发 input masks，剧情变量只读不写（`tools/j2-journey.ts:110-115,193-367`）。
- **frame-0 合并 172,060 帧**（GB6 109,983 + J1 12,162 + J2 49,915）：主 agent 实跑 `verify:j2:mainline` PASS，`combinedFrames=172060`。
- **56 场战斗真实进入 Battle Processing 并获胜**：verifier 从实际重放重新采集战斗数组（`tools/verify-j2-mainline.ts:320-342`），与冻结表全量 canonical 比对（`:367-377`），并断言 `state.scene.kind === "battle"`（`:321`）。56 = 50 trainer + 6 wild，全部 `won`；第 56 场为 `spyder_greenwash_looten`（bearloch/rocktot/foxko/agnsher L35）；`spyder_billie` 出现两次。战斗走 `battle/autoplay.ts` 确定性策略，无占位。
- **终点 `spyder_candy_hospital3@5,7`、`hospitalcure=1`**：冻结 `.map`/`.position` 与 story 均确认；`hospitalBillie` 不是冻结 story 的键，由录制器（`tools/j2-journey.ts:367`）与 verifier（`tools/verify-j2-mainline.ts:263`）在运行时断言为 0——措辞上 J2 报告的「冻结终态应保持 `v.hospitalbillie=0`」是运行时常量而非冻结键，行为成立。

### 2. 剧情对照原作（成立，一处措辞）

上游 `/var/tmp/tuxemon-src`（`9e6258ff`）逐事件核对，10 项中 9 项完全确认、1 项部分确认：

1. Mansion Lenny 给 `dojo_pass` 并设 `dojomagician`：`spyder_mansion_top.tmx:201-209`。确认。
2. Dojo 2/3/4 路线与 Thri 双分支都设 `dojothrimonster`：`spyder_dojo4.tmx:85-104`。确认。
3. Nimrod Tru 队伍与胜后开门：`spyder_nimrod_bottom.tmx:92-96,148-152`。确认。
4. Timber `seentimber` 是 `is char_at player` 触格事件（入图不触发）：`spyder_timber_town.tmx:159-165`。确认。
5. Scoop4 先 L40 Sludgehog 野战再设 `scooplandrace`、Tunnel 北端阻挡格：`spyder_scoop4.tmx:136-157`、`spyder_tunnel.tmx:266-302`。确认。
6. Tunnel 跨层 70 格序列：`spyder_tunnel.tmx:44-49,84-89`、`spyder_tunnel_below.tmx:98-103`。**部分确认**：facing-DOWN 检查在上游是事件**条件** `cond2=is char_facing player,down`（`spyder_tunnel_below.tmx:101`），J2 报告 §2.6 说「DOWN 检查位于 commands 内」——这对**导入后的** `dist/project.json` 成立（降为 command 级 `{"op":"if","if":{"kind":"facing","dir":"down"}}`），对上游 TMX 不成立。行为等价，仅报告措辞不精确。
7. Route 6 Gunner `(30,17)` 创建、`(29,17)` talk、战后 pathfind `(28,17)`：`spyder_route6.tmx:357-374`。确认。
8. Candy `seencandy` 是无 `is char_at` 的 parallel（入图即设）：`spyder_candy_town.tmx:213-218`。确认。
9. Greenwash：主门 `(25,23)` transfer 存在（`spyder_candy_town.tmx:171-176`），`(25,24)` guard 条件 `not battle_outcome won spyder_greenwash_looten`（`:268-272`）正好挡住南门路线；`(30,21)` 无条件 transfer 到 greenhouse（`:260-266`）；Looten 队伍与胜后 `add_item aardant`（`spyder_greenwash.tmx:70-78`）；greenhouse→上层→level2→下层 Looten 的 transfer 链真实存在。确认「Looten 前置 guard」结论，不是 importer 漏图层/碰撞/transfer。导入产物保留了 guard 的 `battle_outcome` negate 条件与 greenhouse transfer（`dist/project.json` 事件 `e019_create_guard`、`e018_teleport_to_greenwash_r016`）。
10. Hospital 密码 `Blue`/`10` 传送后 clear 两个 passcode 变量（`spyder_candy_center.yaml` Passcode Correct 段）；持 Aardant 关 scanner 设 `screendown`（`spyder_candy_hospital3.tmx:70-80`）；cure 交互设 `hospitalcure`（`:127-142`）。确认。

没有绕过门槛或借占位：Scoop 野战、Tunnel 跨层、Gunner 门卫、Looten 前置均按原作真实路径完成。

### 3. 一致性（成立）

主 agent 在被审分支独立实跑（单命令均 <300s）：

| 模式 | 结果 | 关键数 |
| --- | --- | --- |
| `verify:j2:segment` | PASS | 49,915 段帧；standalone fold 59,983.5 ms；终态 `519154d6…`；139.1 s |
| `verify:j2:mainline`（合并 60 Hz） | PASS | 172,060 帧；GB6/J1 双边界一致；56 战；fold 131,583.1 ms；131.8 s |
| `verify:j2:stateful`（save/load + KR2） | PASS | save 170,683/48,537 恢复后终态一致；KR2 169,762←170,683，keyframe 169,624，refold 138/3,600 帧、5.377 ms；256.1 s |
| J2 rate-60 | PASS | 326,894 host / 172,060 aligned；280.5 s |
| J2 rate-30 | PASS | 163,447 host / 86,677 aligned；260.6 s |
| J2 rate-20 | PASS | 108,965 host / 57,968 aligned；261.6 s |

所有模式终态 SHA-256 均为 `519154d646891afd2a6378ff20b80e02bcd9190b8c1d8814778cd09adea6a3c4`。rate 验证在每个 source advance 用 `Bun.deepEquals(..., true)` 与独立 60 Hz reference 严格结构对齐（`tools/verify-j2-mainline.ts:515`）。

### 4. Golden（成立）

6 张 PNG 全部由 subagent 实际打开看过：aardant-acquired（Greenwash 木板地、紫灰机械、Looten 与玩家前后遮挡）、hospital-password（浅蓝实验室、电脑桌、彩色瓶架）、hospital-cure（橙色标本柜、绿色 cure console、接待台）。960×544 是真实更大视野（测试用 1.8×/1.4×/1.15× 颜色增量断言保证），不是拉伸。

断言有辨识力：变异测试在隔离副本（`/var/tmp/fleet/2071/mut-golden`，已删除）把 hospital-cure 的标本柜橙色断言改成品红，`bun test tests/j2-golden.test.ts` 立即变红（3 pass / 1 fail，失败点正是被改断言，`tests/j2-golden.test.ts:286`），副本与被审 worktree 均已还原。语义断言包括：玩家逐像素合成（`painted > 80` 且逐像素匹配）、Looten/玩家深度合成（`sourceOpaque > painted` 证明遮挡像素被覆盖）、三处地标颜色计数、视口颜色增量。

### 5. 前向合并（成立，重点项）

临时 worktree 合并当时的 `main`（`43ab2d2`，含规格点名的 GI-0 `170e2c4`；kit 指针 `4bba234`→`df2d1c3`，`7c16a28` 是其祖先）：

- **冲突**：仅 `.github/workflows/ci.yml` 一处——分支内联加了 J2 回放步骤，main 把 CI 重构为并行 jobs（import / 分片 test / journey matrix / web）。按 main 结构解决：把 J2 步骤加进 main 的 journey matrix。其余全部自动合并。
- **门禁**（合并副本，重新 `bun install` 后）：`bun run import` 两遍零 tracked diff（GI-0 的 importer 改动对导入产物字节稳定）；`bunx tsc --noEmit` exit 0；`bun run build`（4,623 entries、62,742,928-byte pak、1,290,504-byte JS，较分支 1,154,673 增大来自 kit 新能力）；`bun test` 207 pass / 0 fail / 0 skip / 40 files（202 + main 新增 5 个 entry-readers 测试）。
- **终态不变**：J2 segment/mainline/stateful/rate-60/30/20 全 PASS，终态 `519154d6…` 不变；J1 segment/mainline 终态 `88c3c691…` 不变；GB6 mainline/failures 终态 `d62d1465…` 不变。SA4 担心的 GI-0 风险（actorSlots 数所有事件、native readText、密码选项文本匹配、golden 精灵解析）实测均未改变任何终态。
- J1/GB6 的 stateful/rate 模式在合并副本未单独重跑：J2 的合并 tape（172,060 帧）包含 GB6+J1 全部前缀，其 stateful/rate 模式在两个 ancestor boundary 比较 canonical 哈希，覆盖等价。
- 被审分支未被修改（合并在一次性副本 `review-2071-merge` 中进行，已删除）。

### 6. 门禁（全部复跑，成立）

| 门禁 | 结果 | 实测 |
| --- | --- | --- |
| `bun run import` 两遍 | PASS | 12.44 s / 11.91 s；`dist/project.json` sha256 两遍均 `2db9e8e8…`；tracked diff 零 |
| `bunx tsc --noEmit` | PASS | exit 0，4.44 s |
| `bun run build` | PASS | 4,623 pak entries、62,742,928-byte pak、1,154,673-byte JS、14.07 s |
| `bun run build:wasm` | PASS | 289,758-byte wasm |
| `bun test tests/` | PASS | 202 pass、0 fail、0 skip、88,798 assertions、39 files、179.54 s |
| `verify:g6:locks` | PASS | 329 pages、333 locks、327 unlocked、2 transferred、0 unresolved/error |
| `verify:g6:determinism` | PASS | 4,637 files、61,751,756 bytes、sha256 `6921d89c…e9ff` |
| `verify:g6:frozen` | PASS | 263 maps、0 permanent locks、0 fibers、0 errors |
| `verify:gb6:*`（mainline/failures/stateful/rates×3） | PASS | 109,983 帧、100 战、终态 `d62d1465…`；败线 3,254/65,515 帧；save 100,672/101,772；KR2 56,657←57,075；rates aligned 109,983/55,296/36,953 |
| `verify:j1:*`（segment/mainline/stateful/rates×3） | PASS | 12,162 段帧、122,145 合并帧、17 战、终态 `88c3c691…`；save 118,588；KR2 117,554←118,524；rates aligned 122,145/61,433/41,055 |
| `verify:j2:*` | PASS | 见 §3 |
| `bun run web` + `verify-web-journey` | PASS | 1,155,274-byte JS；boot 后 0 console errors、checkpoints 全对 |
| CI 时长增量 | PASS | 新增 J2 60 Hz 合并回放本机 131.6 s（合并后 145.7 s）；在 main 的并行 CI 里它是 journey matrix 中最长的 job（GB6 ~59 s、J1 ~70 s），job 墙钟约 +2.5 min，总 CI 远低于 25 min，无需分片 |
| 仓库卫生 | PASS | `bun.lock`、`vendor/`、GB6/J1 tape 相对 `635fde0` 未改；importer（`gen-assets.ts`）未改；提交信息与改动文件无任务号/本机路径（`findings/` 除外） |

## 原则核对

- **全自动导入**：J2 没有手改任何导入产物，没有逐图特判；`gen-assets.ts` 零改动。Greenwash 阻挡被正确诊断为原作 guard，修正是 driver 走原作提供的温室入口，不是改产物。
- **组件仓无 Tuxemon 专用代码**：本分支不改 `vendor/pocket-rpgkit`（指针未动）；唯一的引擎侧改动是 `battle/tuxemon.ts` 的 JSON-safe fallback（删 `undefined` 的 `moveIndex` 自有属性），属游戏仓战斗模块的序列化修复，消费方对 absent/`undefined` 等价处理（`battle/tuxemon.ts:920`），不改变战斗结果，并有 `tests/battle-effects.test.ts` 锁定 round-trip。
- **不改 `vendor/pocketjs`**：确认。

## 变异检查

1. Golden 语义断言变异（上文 §4）：标本柜颜色计数改品红 → 测试变红，失败点精确。已还原。
2.  tape 完整性：subagent 重算 `sha256(JSON.stringify(masks))` 与冻结 `tapeSha256` 一致；verifier 重算 GB6/J1/J2 三段 tape 哈希并比对（`tests/j2-golden.test.ts` test 1）。
3. `048f4ef` 的 round-trip 测试（`tests/battle-effects.test.ts`）强制 `noddingoff` 怪物走 empty fallback，断言 action 无自有 `moveIndex` 且 JSON round-trip 结构不变——直接钉住该修复的动机（canonical state 与存读档路径结构一致）。

## 性能（QuickJS 口径）

J2 的 fold 计时来自 verifier 内嵌的 QuickJS 宿主帧计时（非 wall clock）：standalone fold 59,983.5 ms（49,915 帧）、合并 60 Hz fold 131,583.1 ms（172,060 帧）、KR2 refold 5.377 ms（138/3,600 帧）。主 agent 复跑得到同量级（59,983.5 / 131,583.1 / 5.377 ms 与报告的 92,565 / 130,516.5 / 9.125 ms 同口径，差异来自宿主负载）。rate 验证的 host frame 计数（326,894 / 163,447 / 108,965）与报告一致。

## 非阻断观察（不影响判定）

1. `findings/J2.md` §2.6 措辞：tunnel_below 的 facing-DOWN 在上游是事件条件 `cond2`，「commands 内」只对导入后形成成立。建议报告措辞修正。
2. `tools/verify-j2-mainline.ts:139-147` 硬编码 BTN 位（0x0010/0x0040/0x2000/0x4000）而非复用 `BTN_BITS`，当前与 `camera.ts:95-98` 一致，存在漂移风险。
3. CI 只跑 mainline 模式，segment/stateful/rate 留 release 门禁——与 J1/GB6 的门禁分层一致，符合规格设计。
4. 录制器与 verifier 共享同一引擎，引擎 bug 会两边同时复现；由独立语义断言（剧情变量、物品数、队伍行）与像素 golden 缓解。

## 阻断项

无。

## subagent 使用

4 个 subagent（relay Agent 工具，前台，一层）：SA1 核对 tape 结构/录制器/verifier 语义（17 项全确认）；SA2 上游原作 10 项剧情对照（9 确认、1 部分确认）；SA3 打开 6 张 golden 并在隔离副本做颜色变异（变红、已清理）；SA4 逐行读实现 diff（无 bypass/placeholder/手改产物，标出 GI-0 合并风险与 3 个小问题）。省了时间：四路只读核对并行约 5 分钟完成，主 agent 同时跑门禁；变异隔离符合规矩。所有结论经主 agent 复跑核实后写入本报告。

PASS
