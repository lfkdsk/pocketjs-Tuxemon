# 审查 task 1986（GW1：worldIdle 导入 + tape 重录）

被审分支 `fleet/task-1986`（基线 `15f4519`，HEAD `88d87f0`，6 个提交）。规格：`/var/tmp/fleet-specs/pocket-tuxemon/game-GW1-worldstate.md` + `reviewer-generic.md`。审查方式：3 个只读 subagent 并行（上游对照 / tape 核查 / 导入器与覆盖率），主 agent 串行复跑全部门禁与变异。

## 1. 逐条对照规格

### 1.1 组件仓升级（规格 §1）— 成立

- `vendor/pocket-rpgkit` gitlink `fb3b319 → 4bba234`（`git diff 15f4519..HEAD -- vendor/` 只此一项）；`4bba234` 即 `feat(engine): add a worldIdle condition`，两基线间只此一个提交；嵌套 `vendor/pocketjs` 指针在 `fb3b319..4bba234` 间无 diff。
- `worldIdle` 是通用 reducer 派生谓词（组件仓 `src/engine/types.ts:127`、`interpreter.ts` 的 `isWorldIdle`、`tests/world-idle.test.ts`），代码 hunk 中无 "tuxemon" 字样，无游戏专用逻辑进组件仓。
- schema hash 刷新：`data/g6-assets-report.json` 6 行 diff = entryBytes/manifestHash/schemaHash（`0ff7c248…`），与 GW1.md §1 一致；`bun run import` 两遍自检通过（见 §2）。

### 1.2 导入器映射（规格 §2）— 成立

- `lowerCurrentStateCondition`（`importer/project.ts:457-471`）：OR-list 含 `WorldState` → `{kind:"worldIdle"}`，`not` 加 `negate:true`；不含 → 常量（`is`→false、`not`→true）。`current_state` case（`:628-646`）对常量结果发 `{k:"const"}` 并记 T2-dropped；`worldIdle` clause 唯一消费点 `toIf`（`:687-690`），condition.all 路径（G6/K1 `condAll:true`）同样覆盖。
- 五种源状态的折叠理由（GW1.md §2 表格）与上游语义（`tuxemon/event/conditions/current_state.py:33-37`：栈顶状态 ∈ OR-list）和本运行时架构（battle/menu/transfer 期间冻结地图 fiber）逐个相符：`MainCombatMenuState` 等不可运行 arm 折叠为不可达值是可观察语义的正确保持，不是丢语义。
- Paper Town 特例确已删除：`importer/project.ts` 中 `spyder_paper_town` + `firstfightdue/firstfightend` 特判块在 diff 中整段移除；导入产物 `dist/maps/spyder_paper_town.json` 的 `Teleport Faint` 现为 `{kind:"worldIdle"}`；`tests/importer.test.ts:618-622` 有负向断言。（`data/gb6-mainline-journey.json` 的变量快照里仍有 `firstfightend/firstfightdue` 字段，那是 tape 记录的游戏状态，不是特判。）
- 覆盖率处置更新：`dist/import-report.json` 中 `cond:is current_state:T1` count 1129、`T2-dropped` count 358；78 个定义 → 34 native / 44 dropped；conditions summary native 7666→7700、degraded 95→61（G6 options 口径；`tests/importer.test.ts:91-94` 钉的是 DEFAULT options 口径 3539/1234，两套数字各自自洽）。`findings/G1-coverage.md` 同步更新。

### 1.3 上游真跑验收（规格 §3）— 成立

- 上游侧（subagent 对照 `/var/tmp/tuxemon-src` 逐条核实）：`Stop!` 事件 `spyder_radiotower.tmx:102-142`，lock(:105)→battle(:120)→六段剧情(:109-133)→`kernelquest:yes`(:135)→unlock(:136)；`Teleport Faint` 在 `spyder.yaml:230-238`（`is char_defeated` + `not location_type clinic` + `is current_state WorldState`）；5 张图 `Evolution all` 页条件均为 `is check_evolution` + `is current_state WorldState`（scenario `spyder.yaml:93-99` / `xero.yaml:11-17`）；`teleport_faint.py:83-85` 只在动作开始时已位于目的地图才治疗；Wanda 战后页本就 `add_item fishing_rod` + 钓鱼竿文本（`spyder_route3.tmx` Talk Wanda 两页）。
- 本地测试 `tests/gw1-world-idle.test.ts` 与上游比较的是同一件事：战后调度顺序（剧情全部完成 → unlock → 昏厥传送；进化只在 battle/story 释放后）。本地夹具用一 tick 确定性败局替换耗时战斗，符合规格「不必走 tape」的要求。
- 我自己重跑上游驱动：`TUXEMON_SRC=/var/tmp/tuxemon-src SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy /var/tmp/fleet/gb2-oracle-venv/bin/python tools/upstream-world-idle-oracle.py /var/tmp/fleet/1998/oracle-rerun.json` → exit 0，2,179 ticks，输出与 `data/gw1-upstream-world-idle-oracle.json` **逐字节相同**（SHA-256 `cf8372fd…`）。
- 本地侧数字（`bun test` 输出）：Radiotower battle 284-285 / kernelquest+unlock 580 / transfer 590 / heal 提示 1 次 / 终点 `spyder_leather_center@6,7` / rockitten 0/71；5 图进化 battleExit 1、unlock 0 或 5、choice 3 或 6、全部 `cataspike → puparmor`。与 GW1.md §3.1/§3.2 一致。
- 两处数值差异的说明属实：最大 HP 75 vs 71 是上游 `spawn_base` 与本地固定 RNG 的 IV 差异（两边战后当前 HP 都是 0）；`heal_before_leave` 2 次 vs 1 次是上游异步 fade 未结束又重排同一全局事件的调度竞态，本地以 worldIdle 的 transfer/fade blocker 有意去除。

### 1.4 Tape 重录（规格 §4）— 成立（一处报告措辞需修正，非代码问题）

- 主线 `data/gb6-mainline-journey.json`：109,981 → 109,983（+2）。逐帧对齐：旧序列是新序列的精确子序列，纯插入两帧 mask=0（index 13,017 与 34,121），非零按键序列两边均 28,577 个且完全相同；剥除 frame 字段后 100 个 battle 检查点与 112 个地图检查点与基线**完全相同**；22 场训练师全胜、78 场野战。`tapeSha256` 经独立重算（`sha256(JSON.stringify(masks))` 紧凑 JSON）= `ce6b28fa…`，与文件头一致。
- Wanda 败线 `data/gb6-later-loss-journey.json`：65,500 → 65,515（+15）。新增内容是 Wanda 战后页在昏厥传送前完整执行：`spyder_route3` 上依次出现 "The fishing's good in Flower City…"、"Here, you can have my Fishing Rod."、道具弹窗，`fishing_rod === 1`；`tools/gb6-later-loss.ts:165-168` 与 `tools/verify-gb6-failures.ts:205-207` 都加了严格断言。`tapeSha256` 独立重算 = `135c4a1e…`，一致。
- 驱动与策略未变：`tools/gb6-journey.ts`、autoplay 在本分支零改动；`tools/` 下只改了 `gb6-later-loss.ts`（+4 断言）、`verify-gb6-failures.ts`（断言+文本比对改为 map/lines 精确比较 + frame 差 1-2 的有界关系）、新增 oracle。
- 短 tape `data/g6-journey.json` 与首败 `data/gb6-first-loss-journey.json` 与基线逐字节相同（`git diff --quiet`）。
- **措辞修正（不影响判定）**：GW1.md §4.2 说「窗口为 61,897–65,224」是差异点——那是 battle 记录窗口（旧 61,895/65,222 整体 +2）；mask 级分歧实际从 13,017 开始（前两处插入与主线同源），Wanda 特有的插入在 65,235（一次必要的新 A 键，关道具弹窗）与 65,245–65,256（12 个空闲帧）。结论（Fishing Rod 完整发放先于昏厥传送）不受影响。
- 变化的 golden：本分支**没有任何 .png 变更**（`git diff --name-only 15f4519..HEAD` 全量过滤），无需逐张对比；我另打开了 web journey 产物 `dist/web-journey/end.png`：Route 1 地图、玩家 sprite、水体/树木/栅栏/告示牌地形均正常渲染。

## 2. 门禁复跑（主 agent 串行，全部亲自跑）

| 门禁 | 结果 |
| --- | --- |
| `bun run import` 连跑两次 | 两次 exit 0，第二次 tracked diff 为 0；`dist/project.json` `2db9e8e8…`、`dist/import-report.json` `61fda3aa…`、`data/g6-assets-report.json` `ee21f6e9…`，与 GW1.md §5 一致 |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` / `build:wasm` | 均 exit 0；WASM 289,758 bytes |
| `bun test` | **171 pass / 0 fail / 0 skip**，71,144 assertions，36 files，173.25s |
| `bun run verify:g6:locks` | 333 dynamic checks；327 unlocked / 2 transferred；0 unresolved / 0 errors |
| `bun run verify:g6:determinism` | PASS；4,636 files / 61,209,639 bytes；SHA-256 `eb0e6d0f…` |
| `bun run verify:g6:frozen` | 263 maps；0 permanent locks / blocking fibers / errors |
| `bun run verify:gb6:mainline` | PASS；109,983 frames / 100 battles；22 trainers / 78 wild；终点 `spyder_route3@4,6`；terminal `d62d1465…` |
| `bun run verify:gb6:failures` | PASS；首败 3,254 frames 终点 `spyder_route1@14,19` terminal `d321b217…`；later-loss 65,515 frames，Wanda gift 完整，终点 `spyder_leather_town@23,10`，terminal `2e76caf0…` |
| `verify:gb6:stateful` | PASS；save/restore 与 rewind 均完成，终态一致 |
| `GB6_VERIFY_MODE=rate-60/30/20` | 三项分别 PASS（109,983 / 55,296 / 36,953 aligned comparisons），终态 hash 均 `d62d1465…` |
| `bun run web && bun tools/verify-web-journey.ts` | `WEB JOURNEY PASS`；4 个 state/pixel checkpoint 全 ok；0 console errors；终点 `spyder_route1@14,19` |
| `bun.lock` | 与基线无 diff |
| `vendor/` | 只 `vendor/pocket-rpgkit` gitlink（`4bba234`）；嵌套 pocketjs 未动 |
| fleet 任务号 / AI 尾注 | 代码与数据中无 1986/task 字样；6 条提交信息均无 Co-Authored-By |

性能：本规格未要求 QuickJS 数字，无此项。

## 3. 变异检查（隔离副本 `/var/tmp/fleet/1998/mut-1`，已删除）

把 `lowerCurrentStateCondition` 的 WorldState arm 改回常量折叠（`is`→true、`not`→false，即 GW1 前行为），重跑 import 后：

- `bun tools/verify-gb6-failures.ts` → **exit 1**：`GB6 failure paths: first loss did not end on Route 1`（昏厥传送在首败 cutscene 期间抢跑，replay 偏离未重录的 tape）。首败验收现在确实只靠 worldIdle 成立。
- `bun test tests/gw1-world-idle.test.ts` → **0 pass / 3 fail**（Radiotower 顺序断言、两批进化门断言全红）。

副本已 `git worktree remove --force` 清理，被审 worktree 未被污染。

## 4. 原则核对（reviewer-generic §6）

- 内容全自动导入：改动是一条通用映射规则 + 通用引擎条件，无逐图手改产物；`data/` 变化全部可由 import 或原驱动 autoplay 重录复现。
- 无 Tuxemon 专用代码进组件仓（§1.1 已述）。
- 未改 `vendor/pocketjs`。

## 5. 阻断项

无。

非阻断观察：(a) GW1.md §4.2「窗口 61,897–65,224」措辞应为 battle 记录窗口而非 mask 分歧窗口（§1.4 已修正）；(b) 覆盖率 `tier1.meetsBaseline=false`（51.47% vs 53%）在基线 `15f4519` 已存在，本任务未使其恶化（native 7666→7700、degraded 95→61 是改善）。

## 6. subagent 使用

3 个 subagent（relay 一层，均只读、未写仓库、未跑重命令）：上游对照（核实 current_state/Stop!/Evolution all/teleport_faint/Wanda 上游语义与 oracle JSON 数字，71 次工具调用）、tape 重录核查（逐帧对齐两条 tape、独立重算 tapeSha256、确认驱动未变、确认无 golden 变更，24 次）、导入器与覆盖率（映射实现、Paper Town 特例删除、覆盖率数字、组件仓通用性、洁净度，36 次）。省了时间：三条线并行约 7 分钟完成，主 agent 同时串行跑门禁；subagent 结论均经主 agent 抽样复核（oracle 重跑、import-report 行、bun.lock、golden 清单）后才写入本报告。

PASS
