# 审查报告：GB4（task 1907，真的打）

被审分支 `fleet/task-1907`，HEAD `1451ac8`，基线游戏仓 main `d74222f`。依据 `reviewer-generic.md`、规格 `game-GB4-wiring.md`、附加审查清单 `review-GB4.md`。方法：独立复核（不复用被审报告的产物作为 golden），关键路径分派 5 个后台 agent 并行核验（怪物生成 oracle 重生成+变异测试、BattleRules 语义 vs 上游 Python、导入器覆盖率抽查 10 处、journey/倒带确定性、全部门禁+QuickJS 性能复跑），本人另行核对 `bun.lock`/`vendor/` 差异、提交信息/代码中的 fleet 任务号泄漏、战斗截图肉眼核对。

## 1. 怪物生成逐位一致 — 成立

独立用 `/var/tmp/fleet/gb2-oracle-venv` 重新生成 21 组 golden（7 物种 × 3 种子：`rockitten/nut/dollfin/budaye/ignibus/miaownolith/tweesher` × `7/0xDEADBEEF/999983`），未复用被审任务的 `generate_spawn.py` 产物或提交的 golden 文件，逐字段（性别、冷/暖口味、身高、体重、6 项 IV、生日、招式、6 项基础属性）与 `battle/spawn.ts` 的 TS 实现比对，**0 差异**；每只怪确认消耗 13 次 RNG 抽取，抽取顺序与 `/var/tmp/tuxemon-src/tuxemon/monster/monster.py:135,145,151-152,167,220` 一致。

`billie_choice` 变量怪：追踪 `importer/battle.ts` 的 `memberFromAction`/`buildSelection`（第 297-339 行），确认其扫描全部地图的 `set_variable` 得到 10 个候选物种集合，变量解析发生在 `spawn_base` 调用之前、不消耗抽取游标；抽查 `dollfin`、`budaye`、`miaownolith`（40 级进化形）三个候选逐字段匹配。

变异检查：在临时 worktree 里 (a) 交换身高/体重抽取顺序 → `bun test tests/battle-spawn.test.ts` 变红（677 处 mismatch）；(b) IV 抽取上界 off-by-one → 同样变红；两处改动 revert 后测试恢复绿、`git status` 干净。golden 由固定版本的真实 Tuxemon 引擎产出（`tools/battle-oracle/README.md`），SHA-256 `8ac41a86e700ded139b7f74289f8bed301351cc4492c5e3be9cbb649c249344b` 与报告一致。

**结论：成立，证据充分，非自证。**

## 2. BattleRules 适配 — 成立（5/5）

逐条核对 `battle/runtime.ts`、`battle/extension.ts`：

- **种子来源**：`start()` 的种子来自 `vendor/pocket-rpgkit/src/engine/session.ts:664-671` 从会话持久 RNG 游标 `state.sw.rng` 派生（非 `Math.random`/时间戳），`battle/runtime.ts:457` 直接消费。成立。
- **不合法队伍**：`legalParty`（`runtime.ts:217-221`）复现 `check_battle_legal`（`/var/tmp/tuxemon-src/tuxemon/combat/utils.py:28-52`）的三条判据（空队、全倒、无招），对玩家/敌方队伍及无环境情形均 `release(); return null;`，调用方 `session.ts:672-676` 在 `null` 时立即 `continueExternal`，事件 fiber 不卡死。成立。
- **random_encounter 判定**：`runtime.ts:487-490` 为 `nextRandom(rng) * 100 > (setup.probability ?? 1)`，与上游 `encounter.py:25,148-149` 的 `uniform(0,100) > total_prob`（0–100 量纲、同方向、缺省 1）一致，未中返回 `null` 且走同一条 fiber 继续路径。成立。
- **`done()` 写回**：`completionFor`/`completedExtension`（`runtime.ts:360-423`）写 `v.battle_last_*`、`bo.<npc>.<outcome>`、`boc.<npc>.<outcome>`、`defeated.*`，HP/经验/训练点/金钱经 `writeBackMonster`（`runtime.ts:337-358`）与 `boundedInteger`（`runtime.ts:331-335`，非安全整数即抛错）夹紧、非负。数值写入受游戏侧扩展校验器（`extension.ts:102-153,223-225`）约束，语义与报告描述一致（组件仓通用规则本身只要求"有限数"，更严格的安全整数/非负/范围约束由本任务的 ext 校验器实现）。成立。
- **昏厥/回血**：`completedExtension` 不擅自传送或回血，HP 只做夹紧不重置；`tux.prepare_faint_transfer`（`extension.ts:519-539`）精确复现"只在已处于昏厥点所在图时才回血"的上游怪癖（对照 `/var/tmp/tuxemon-src` `teleport_faint.py:83-85`，Scout S4 §2.12/§2.14 第 4 条）。成立。

**结论：5 项全部成立，含 file:line 证据，无发现问题。**

## 3. 导入器接线与覆盖率 — 成立

抽查 10 处（覆盖 start_battle 折叠队伍/变量对手、random_encounter×2、add_monster×2、set_teleport_faint+teleport_faint、set_monster_health/status、wild_encounter），逐条对照 `/var/tmp/tuxemon-src` 源事件语义与生成命令，**10/10 匹配**（详见 agent 报告，含具体文件行号，如 `eclipse_lion_mountain_middle.yaml:132-135` 折叠三怪队伍、`spyder.yaml:228-236` 诊所图正确排除昏厥传送等）。

`char_defeated player`：`battle/extension.ts:566-575` 实时读取 `currentExtensionState(context.ext)` 后扫描队伍 `every(m => m.currentHp <= 0)`，**是实时队伍 HP 判定，不是战果开关**，符合 Scout S4 §2.12 对 S1 的修正要求。

覆盖率数字：`dist/import-report.json` 差分基线后确认动作 11537/13617=84.7%、条件 7664/8663=88.5%，与报告数字精确一致。8 个 `start_double_battle` 在报告中记为 `placeholder:8`（源码 grep 确认恰好 8 处），5 个 NPC-vs-NPC `start_battle`（如 `spyder_leather_gym.yaml:22,30`）记为 `placeholder:5`，两者均生成可见的阻塞文本事件（`[BATTLE] ... (not supported yet; skipped)`），**不是静默丢弃，也未被算进 native 分子**，84.7%/88.5% 的净增量数字没有靠隐藏缺口注水。

**结论：成立。**

## 4. Journey — 成立

独立重跑（未信任报告自述帧数），胜线（Nut）60 Hz 2,774 帧到 `spyder_route1 [14,19]`，最终态 canonical SHA-256 `fa06b6c6...d7993`、胜线结果 SHA-256 `aedba1e2...8941`，**与报告数字逐位相同**；败线（Rockitten）60 Hz 2,887 帧，昏厥传送回卧室 `[3,4]`、回血、经 "First Fight - Lose" 分支到 Route 1。30/20/4 Hz 均落在同一地图/坐标/战果。`bun test tests/importer.test.ts`（20 pass）本身在测试内部对两条路线跑全部 4 个 Hz 并断言战果/checkpoint 一致、拒绝 FAIL。

L 倒带：确认 `AttractController.rewind()`（`vendor/pocket-rpgkit/src/engine/attract.ts:457`）是真实从头重放输入日志的 `refold()`，非快照 hack；`smoke-spyder.ts` 与专门单测 `tests/battle-extension.test.ts:270`（"rewind refolds monster identity, attributes, and RNG byte-for-byte"）都做的是 `canonicalJson`/`toEqual` 深度相等断言，8/8 次（4 Hz × 2 结果）通过，**不是"不崩溃就算过"**。

初始怪选择仍是上游 5 选一的真实分支（`rockitten/lambert/nut/tweesher/agnite` 各自独立 `add_monster` bin 事件，全部导入为独立 `tux.add_monster` 调用），journey tape 只是行使了其中两个选项，不构成造假/挑种子撑场面。

**结论：成立。**（复核过程中发现审查清单引用 Scout S4 §5.2 的一处口误——"Agnite 0/40" 实为 Agnite vs Ignibus 而非 vs Budaye——但不影响 GB4 本身任何结论，因为 GB4 journey 只用了 Nut/Rockitten vs Budaye 这组已核实正确的数据。)

## 5. 画面 — 成立

本人打开 `findings/GB4-battle.png`（480×272）肉眼核对：草地背景、Nut 背面图（右下）、Budaye 正面图（右上角站台）、双方名字/等级/HP 条清晰可读、底部 "CHOOSE A TECHNIQUE" 菜单含 BULLET（选中态高亮）/SHURIKEN/STATIC FIELD 三项技能，布局与 Scout S4 §4.4 的 mock 一致。`tests/battle-scene.test.ts` 对 HP 条末端像素与 `hpBarWidth(current,max)` 做语义断言（非仅像素哈希）。

**结论：成立。**

## 6. 性能（QuickJS）— 成立，附一条建议关注项

独立复跑两遍真实 QuickJS 宿主（`rquickjs`，非 Bun/JSC，确认 `pocket-mod` 依赖），journey 终态 SHA-256 两遍都对上报告数字，正确性无疑；帧延迟数字与报告同量级但非精确复现（±15–20%，如 480×272 战斗 p95 两遍为 6.510/5.998 ms vs 报告 6.830 ms，进出战斗 max 两遍 35.063/29.019 ms vs 报告 34.043 ms），符合项目记忆里已知的共享宿主机抖动，非回归信号，也没有代码断言因此失败。

代码里唯一硬编码的延迟预算是 `tools/g6-quickjs-bench.rs` 里非豁免地图 50 ms 首访上限，本次复跑 `buddha_mountain` 两次分别 48.292/43.768 ms，与既往记忆（`tuxemon-g7-review-1897`：曾一次量到 81.7 ms）一致地贴近上限但仍在预算内，属已知的、与本任务无关的既有边际问题。

进出战斗延迟（29–40 ms，两遍复跑）与地图切换基准（≤50 ms 的非正式目标，见 `findings/G7.md`）相比只用了约 58–80% 预算，明显比走路/切图（约 13–15 ms，约 30%）更紧，但当前整条 journey 只有一场战斗（n=2 样本），也没有任何代码断言约束这个数字。**建议**：本任务不必因此阻断，但若后续战斗更多、双打/连续遭遇战出现，建议把"进出战斗"也纳入正式预算断言，避免退化到不被发现。

**结论：成立，附一条非阻断性能建议。**

## 7. 门禁 — 全部通过

独立在隔离 worktree 复跑（`git submodule update --init --recursive` + `bun install --frozen-lockfile --registry https://registry.npmjs.org/`，`bun.lock` md5 未变）：

| 门禁 | 结果 |
| --- | --- |
| `bun run import` ×2 无 diff | PASS |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build && bun run build:wasm` | PASS（pak 3154 entries；wasm 290,086 B，报告 289,758 B，328B 工具链级差异，无害） |
| `bun test tests/` | **91 pass, 0 fail, 54,901 expect() calls**，与报告数字完全一致 |
| 8,560 场差分（`tests/battle-db-adapter.test.ts`，对生产 `data/battle-runtime-db.json`） | identical=8560, different=0；两份数据库 SHA-256 与报告一致 |
| `verify:g6:locks` | `{pages:329, lockCommands:333, dynamicChecks:333, unlocked:327, transferred:2, unresolved:0, error:0}`，与报告精确一致 |
| `verify:g6:determinism` | 两个隔离根 `files=3167 bytes=58526345 sha256=7fbcce6e...` 一致，与报告一致 |
| `verify:g6:frozen` | 263 maps, 0 permanent locks/blocking fibers/errors |
| `bun run web && bun run web:verify` | 30 requests, 0 failed, 0 console error, PASS |
| `bun.lock`/`vendor/` 相对 `d74222f` | 无差异（本人另行 `git diff d74222f..HEAD -- bun.lock vendor/` 确认为空） |
| 提交信息/代码中的 fleet 任务号 | 本人对 `git log d74222f..HEAD` 与 `git diff d74222f..HEAD` 全文 grep `1907|1865|fleet.?task`，**无命中** |

**结论：门禁全绿，无阻断项。**

## 阻断项

无。

## 非阻断建议

1. 进出战斗延迟（29–40 ms 复跑区间）相对非正式的 ≤50 ms 地图切换预算余量偏紧（约 58–80% vs 走路/切图的约 30%），当前 n=2（仅一场战斗）且无代码断言约束；建议后续任务（更多战斗/双打接入时）补一条正式的进出战斗延迟预算断言，防止无声退化。
2. `bun run bench:g6:quickjs` 依赖 `dist/linux-app/pocket-tuxemon.pak` 先存在（需先跑 `bun run desktop -- --build-only`），报告未提及此前置步骤；建议在 README 或报告里补一句，避免复跑者卡壳（本次复核已自行发现并解决，不影响验收）。

## 原则核对

- 内容全自动导入：抽查的全部 10 处导入命令、地图/事件/队伍/怪物数据均由导入器从 `/var/tmp/tuxemon-src`（`9e6258ff`）自动生成，未发现逐图手改产物或特判。
- Tuxemon 专用代码位置：怪物生成、战斗规则、扩展命令/条件均在游戏仓 `battle/`、`importer/`；未在组件仓改动中发现 Tuxemon 专用逻辑（`vendor/` 无差异）。
- `vendor/pocketjs`：未改动（子模块指针无差异）。

PASS
