# Review: J1（task 2008）主线续录到 captainreturns + 前移检查

被审分支：`fleet/task-2008`（worktree `~/.fleet/worktrees/task-2008`），基线旧历史 `f8fe484`，5 条提交（`59a967d`..`deb1b63`）。
规格：`/var/tmp/fleet-specs/pocket-tuxemon/game-J1-mainline.md` + 本任务审查清单。审查方法：2 个只读 subagent 并行核对（剧情对照上游 / 实现审计），主 agent 串行复跑全部重命令与变异。

## 结论

**PASS**。J1 从冻结的 GB6 终点 `spyder_route3@4,6` 续录 12,162 帧到 `spyder_mansion@1,13`，`v.captainreturns=1`；10 场训练师战 + 7 场野战全部真实进入 Battle Processing 并获胜；frame-0 合并回放、snapshot 独立续段、存读档、KR2 倒带、60/30/20 Hz 终态全部一致；6 张 golden 肉眼与语义断言均通过且变异有辨识力；前向移植到新 main `588f60b` 无冲突、全绿。无阻断项。

## 逐条规格对照

### 规格 1：续录（guestbook 补签名、主线到 captainreturns）

**成立。** `tools/j1-journey.ts:163-239` 从 GB6 terminal snapshot 恢复后，按键驱动走完全程：Wayfarer guestbook 选 Yes（flashback）→ Route 4（护士 + 3 训练师 + Billie）→ Route A（护士 + Koan/Dagger/Billie/Rosy）→ Mansion（护士 + Lucy）→ 东梯下地下室 → Flick（`foundcaptain`）→ Catholi → 西梯返回 → `(1,13)` 触发 `captainreturns`。终态 `data/j1-captainreturns-journey.json`：`spyder_mansion@1,13`，五个剧情值均为 1，全队 Arthrobolt L40 201/201 等（与报告一致）。唯一剧情选择是 guestbook 的 Yes；无购物、无额外刷级、无直接注入（subagent 审计确认 Driver 只产按键 mask，autoplay 用生产伤害公式选技能/换怪/治疗/捕捉，无 `result=won` 赋值）。

### 规格 2：产物（独立段 + frame-0 合并回放 + 冻结 hash）

**成立。** 段文件只含 base 元数据（父段身份/tape hash/terminal hash/snapshot hash/heldMask/timelineFrame）、masks、地图/战斗检查点、终态与 hash，不含 terminal snapshot（`tools/j1-journey.ts:252-270`）。验收器 `tools/verify-j1-mainline.ts` 支持 segment（snapshot 续段）与 ci/stateful（GB6+J1 masks 内存拼接从 frame 0 回放）两种模式，并在合并回放的 GB6 边界逐帧断言 frozen terminal hash（`verify-j1-mainline.ts:214-216`）。

### 规格 3：验收（真实战斗、多 hz、存读档、倒带、golden）

**成立，主 agent 亲自复跑：**

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| frame-0 合并 60 Hz | `verify:j1:mainline` | PASS；122,145 帧；17 战（10 trainer/7 wild）；终态 `88c3c691…`；67.7s |
| snapshot 独立续段 | `verify:j1:segment` | PASS；standalone fold 10,551 ms；终态相同 |
| 存读档 + KR2 倒带 | `verify:j1:stateful` | PASS；存档 next frame 118,588 恢复终态相同；倒带 118,524→117,554，keyframe 117,351，refold 203/3,600 帧，11.6 ms |
| 60 Hz 对齐 | `J1_VERIFY_MODE=rate-60` | PASS；122,145 次 aligned comparison |
| 30 Hz 对齐 | `J1_VERIFY_MODE=rate-30` | PASS；61,433 次 aligned comparison |
| 20 Hz 对齐 | `J1_VERIFY_MODE=rate-20` | PASS；41,055 次 aligned comparison |

所有模式终态 SHA-256 均为 `88c3c6914356dd4bf98c64e54ade36da6aaca6fd94a31e393181fa73c2a10ab2`。10 场训练师战的对手/队伍/回合/帧区间与 `findings/J1.md` 表格逐项一致（验收器把 replay 观察到的战斗与 tape 内冻结检查点做 canonical JSON 比对，`verify-j1-mainline.ts:222-230`）。

### 规格 4：挡路修根因、不手改产物

**成立。** 分支 diff 无 importer/gen-assets/组件仓/PocketJS 改动（subagent 审计 + 主 agent `git diff --name-only` 复核）；无手改导入产物（`data/` 只新增 `j1-*.json`）；无 dist 提交。J1 报告称未遇到需要新增引擎能力的阻塞，与 diff 一致。

### 规格 5：CI

**成立。** `.github/workflows/ci.yml` 在 gb6:mainline 后新增 `verify:j1:mainline`（frame-0 60 Hz 合并回放），注释说明多 hz/存读档/倒带留在 `verify:j1:full`。本机实测该步骤墙钟 67.7s（报告称 67.64s，一致）。

### 审查清单 1：真打

**成立。** 见上：独立从第 0 帧合并回放，17 战全部真实进入 Battle Processing（验收器观察 scene 从空切入 `kind==="battle"` 再退出为 won，`verify-j1-mainline.ts:179-201`），终态 `v.captainreturns=1`、`spyder_mansion@1,13`。

### 审查清单 2：剧情对照上游

**成立（subagent 逐事件核对，主 agent 复核结论）。** 对照 `/var/tmp/tuxemon-src`（0.5 分支）：

- **Guestbook**：`spyder_wayfarer_inn1.tmx` object 89（tile 10,6，`char_facing_tile` + INTERACT）→ `translated_dialog_choice no:yes,enforcers_response`；选 Yes 后 object 90 传送 Nimrod Room 播 flashback，`spyder_nimrod_room.yaml` 末尾 `set_variable enforcers_response:done` 并传送回 inn1。J1 在 (9,6) 面向东按确认，位置/朝向/按键全对。No 分支无惩罚可重试，选 Yes 是 S5 要求的主线补签名。
- **三处护士**：route4/routea/mansion 三图均有原作 "Create Nurse"+"Talk Nurse" 事件，回血动作为无参 `set_monster_health`（全队回满），无收费。
- **Captain 救援链**：mansion col3 墙 + obj14 封死，drinking buddies A/B create 在仅有的缺口 (3,8)/(3,9)（条件 `not captainreturns:yes`），西翼与西楼梯在救人前不可达；东梯 (15,3) 下地下室；Flick 对话设 `foundcaptain:yes`；Catholi 视野砖卡在地下室南侧走廊（Foofle L20 + Rosarin L24，与 tape 一致）；西梯 (6,19) 返回；(1,13)-(2,13) 触发砖设 `captainreturns:yes` 并 `remove_npc` 三个临时 actor + unlock_controls。J1 路线与原作事件顺序完全一致。
- **训练师名单/队伍**：10 场训练师的对手、位置、怪物与等级逐只与原作 tmx 一致（含 rosamund 的 vision 事件 Flummby L18 与 billie_choice 变量解析为 Budaye 的原作状态链）。Lucy 视野砖封死东梯走廊是硬门槛，Catholi 自然 aggro，均非可跳过占位。
- 无绕过剧情门槛、无占位跳过、无原作没有的内容。

### 审查清单 3：一致性

**成立。** 见规格 3 表：frame-0 合并、standalone snapshot、存读档、KR2 倒带、60/30/20 Hz 全部终态一致（分模式跑，单条命令均在 300s 内；rate-60 墙钟 274s 为最长）。

### 审查清单 4：golden

**成立。** 6 张 PNG 主 agent 逐张打开看过：

- `j1-wayfarer-guestbook`（480/960）：旅馆木地板、柜台、床、住客与玩家完整；960 因地图小于视口而居中黑边（合理）。
- `j1-route-4-billie`（480/960）：林缘、草地、作物行、花、NPC（含 Billie）与玩家清楚；960 明显展示更大视野（更多树与 NPC）。
- `j1-captain-found`（480/960）：地下室砖墙、石地、箱桶、玩家与桌后 Captain Flick 清楚；960 展示更多房间。

`bun test tests/j1-golden.test.ts`：4 pass / 0 fail / 8,801 assertions。语义像素断言（旅馆木作、Route 4 植被、地下室石砌、玩家逐像素合成、Captain 在上玩家在下的遮挡合成、960 视野扩大比例）有辨识力——变异见下。

### 审查清单 5：前向移植（重点）

**成立，无冲突。** 新 main `588f60b`（含 W1 world index、PUB1）在 `/var/tmp/oss/pocket-tuxemon`。在临时 worktree（`git worktree add -b fleet/2025-fwd-port /var/tmp/fleet/2025/forward-port 588f60b`）里 `git diff --binary f8fe484..fleet/task-2008 | git apply -3`：**16 个文件全部干净应用，无冲突标记**。3-way 合并正确处理了两处分叉：`tools/gb6-journey.ts`（新 main 改用 `BTN_CONFIRM`/`BTN_CANCEL` 常量做边沿，J1 加 `previousMask` 构造参数——两者都保留）与 `package.json`（j1 脚本并入新脚本集）。

移植后（submodule init + `bun run build`，pak 62,742,928 bytes，比旧基线大 ~537KB 来自 W1 world index）：

| 检查 | 结果 |
| --- | --- |
| `verify:j1:mainline` | PASS；122,145 帧；17 战；终态 `88c3c691…` 与旧基线逐字节相同 |
| `verify:j1:segment` | PASS；终态相同 |
| `verify:j1:stateful` | PASS；存档/倒带帧与 keyframe 完全相同（118,588 / 117,554 / 117,351 / refold 203） |
| `verify:gb6:mainline` | PASS；109,983 帧、100 战、终态 `d62d1465…` 未变 |
| `bun test tests/`（含 build:wasm） | 186 pass / 0 fail / 0 skip / 79,993 assertions |

结论：J1 段可干净前移到新 main，行为不变。临时 worktree 与分支已删除（未改被审分支）。

### 审查清单 6：门禁（主 agent 全部亲自复跑）

| 门禁 | 结果 |
| --- | --- |
| `bun run import` 两遍 | PASS；各 11.5s，每次后 `git status` 为空（字节稳定） |
| `bunx tsc --noEmit` | PASS，exit 0 |
| `bun run build && bun run build:wasm` | PASS；main.pak 62,206,272 bytes、wasm 289,808 bytes（与报告一致） |
| `bun test tests/` | 175 pass / 0 fail / 0 skip / 79,945 assertions（与报告一致） |
| `verify:g6:locks` | PASS；333/333 动态检查，0 unresolved/error |
| `verify:g6:determinism` | PASS；4,636 files，SHA `eb0e6d0f…` |
| `verify:g6:frozen` | PASS；263 maps，0 permanent locks/fibers/errors |
| `verify:gb6:mainline` / `failures` | PASS；109,983 帧 100 战终态 `d62d1465…` 未变；首战与 Wanda 失败/恢复路径通过 |
| `bun run web && bun tools/verify-web-journey.ts` | PASS；0 console errors |
| `bun.lock` / `vendor` gitlink | 分支 diff 无改动（`git diff --name-only f8fe484..fleet/task-2008` 无命中） |
| 任务号/本机路径审计 | 新增代码、提交信息、data 文件 grep `2008`/`/var/tmp`/`/home/` 均无命中；5 条提交信息英文、conventional-commit 风格 |

## 变异检查（隔离副本，用完即删）

在 `git worktree add` 的隔离副本 `/var/tmp/fleet/2025/mut-1`（分支 `fleet/2025-mut-1`，已删除）里做了两个变异，均确认测试变红后还原：

1. **语义像素断言辨识力**：把 `j1-route-4-billie.480x272.png` 中全部 58,468 个草色像素 (64,176,128) 改成洋红，并把 manifest 的 pngSha256/rgbaFnv1a 重烤（模拟「坏渲染器重烤 golden」）。结果 hash 类断言仍 pass，但语义断言 `route grass > 58,000` 变红（Received: 0）——证明语义断言独立于 hash 有辨识力。
2. **验收器冻结 hash 辨识力**：把 `data/j1-captainreturns-journey.json` 的第 5000 帧 mask 翻转一个 bit。验收器立即失败：`J1 mainline: J1 tape hash changed`，exit 1。

## 阻断项

无。

## 备注（非阻断）

- J1 报告提到 `verify:j1:full` 聚合调用曾被 300s 通道限制终止，改为分模式复跑；主 agent 同样分模式跑（rate-60 单条墙钟 274s，接近但未超 300s），检查内容不减。
- 前向移植后 pak 增大 537KB 来自 W1 world index，与 J1 无关。

## subagent 使用

2 个（并行只读调研，主 agent 汇总并亲自复跑全部门禁与变异）：(1) 剧情对照上游——逐事件核对 guestbook/护士/Captain 救援链/训练师名单与 `/var/tmp/tuxemon-src` 及 S5 §2，省了主 agent 大量 tmx/yaml 通读时间；(2) 实现审计——通读 Driver/autoplay 确认无注入、diff 确认无手改产物与卫生项。两个 subagent 结论均经主 agent 抽样复核（git diff、grep、复跑）后采信。并行只读调研明显节省了主线探查时间。

PASS
