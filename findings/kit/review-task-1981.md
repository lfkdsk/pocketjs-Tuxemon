# Review — KW1 (task 1981): `worldIdle` derived condition

Reviewed branch `fleet/task-1981` (commits `3bd3889` feat + `5f1518e` test/docs)
against baseline `fb3b319`, spec `kit-KW1-world-idle.md`, and the upstream
state-stack trace in `pocket-tuxemon` `findings/GB6-F1.md` §1.

## 结论

PASS — 规格逐条成立，语义与上游「栈顶是 WorldState」对齐，门禁全部自复跑通过，
两个变异均按预期变红。无阻断项。

## 1. 规格逐条核对

| 规格条目 | 结论 | 证据 |
| --- | --- | --- |
| 新条件 `{kind:"worldIdle", negate?}`，页面条件与 `if` 两处可用 | 成立 | `src/engine/types.ts:125-127`；页面路径 `interpreter.ts:1264`（scanTriggers）、`1223`（cancelStaleParallels）、`chars.ts:303`、`session.ts:665`、`GameView.tsx:127`；`if` 路径 `interpreter.ts:1930`；商店货物条件也接入 `interpreter.ts:1560` |
| 逐项列出纳入的阻塞状态并说明理由 | 成立 | `findings/KW1.md:17-35` 表格 11 项，与实现 `interpreter.ts:884-901`（`isWorldIdle`）一一对应 |
| 同一 tick 求值语义写清并测 | 成立 | `findings/KW1.md:37-48`；测试 `tests/world-idle.test.ts:215-260`（同 tick 后行者见前者锁；页面扫描取样、解锁下一 tick 才可见） |
| schema / validator / CHANGELOG(v1 修订) / README 同步 | 成立 | `src/data/schema.json:766-775`；`save-validate.ts:100-104`；`src/data/CHANGELOG.md:306`（"v1 amendment — 2026-09-30"）；根 `README.md:377-396`、`src/engine/README.md:108-116,316-327` |
| 纯派生、不新增存档字段 | 成立 | diff 中 `SessionState`/`InterpState`/`Project` 无字段新增（`session.ts:186-201` 只加函数）；存档往返测试 `world-idle.test.ts:401-418` |
| 每种阻塞状态单独为假、解除后为真 | 成立 | `world-idle.test.ts:95-159`（inputLock / text·choices·shop 三种 modal / pendingTransfer / pendingBattle / 玩家路线 / 致命错误，逐项 false→true；NPC 路线不阻塞）；session 侧 scene/fade/playerRoute/menu `:182-211` |
| 剧情锁→战斗→战后剧情→解锁夹具，解锁 tick 前全局页不启动 | 成立 | `world-idle.test.ts:276-373`；`unlockTickHadGlobal === false`（`:361`）复现 trace tick 5,984 |
| 60/30/20/4 Hz 一致 | 成立 | `world-idle.test.ts:375-378`，全绿 |
| 旧工程逐字节不变（goldens、pr1-equivalence） | 成立 | diff 不含任何 golden/PNG；`tools/pr1-equivalence.sh` 复跑 `PASS scenarios=37 states=12376` |
| 验收门禁 | 成立 | 见 §4 自复跑结果 |

## 2. 语义对照上游 trace（GB6-F1.md §1）

上游检查的是**状态栈顶**：`lock_controls` 压 `SinkState`、对话压 `DialogState`
（trace tick 5,572 栈为 `DialogState → SinkState → WorldState → BackgroundState`）、
战斗压 `CombatState`；tick 5,984 剧情在同一 tick 内 `unlock_controls`+治愈，
但该 tick 结束前栈顶仍不是 `WorldState`，全局 `Teleport Faint` 一次也不启动。

KW1 的映射：

| 上游栈顶非 WorldState 的情形 | KW1 阻塞项 | 对齐 |
| --- | --- | --- |
| `SinkState`（lock_controls） | `inputLocked` + 剧情主 fiber `main !== null` | 对齐 |
| `DialogState`（任意 fiber 开的对话） | `modal !== null`（单槽，不属主） | 对齐——parallel 页对话框同样阻塞 |
| `CombatState` / 其它 scene | `pendingBattles` + `scene !== null` | 对齐 |
| 传送/淡入淡出 | `pendingTransfer` + `fade` | 对齐 |
| 商店 | `modal.kind === "shop"` | 对齐 |
| 存档/菜单界面 | host `menuOpen`（`isSessionWorldIdle(state, true)`） | 对齐；fold 期间 host 暂停，菜单状态不入存档 |
| （上游无对应）致命错误 overlay | `error !== undefined` | 保守，无害 |

**同 tick 约定复现 trace**：页面条件在触发扫描时取样（fiber 执行前），`if` 读实时
工作状态。解锁 tick 的扫描时刻主 fiber 仍在跑且 `inputLocked` 仍为真 →
`worldIdle=false` → 全局 autorun 页该 tick 不启动，下一 tick 才启动
（`world-idle.test.ts:235-260` 与 `:359-373`）。这正是 trace 里「剧情收尾那一 tick
结束前全局传送不启动」的效果。

**多纳（相对上游，均为规格认可的保守选择，方向只延迟不丢弃/不乱序）**：

1. **主 fiber 运行中但未锁输入**：上游此类事件在 WorldState 内执行，`current_state`
   仍为真；KW1 因 `main !== null` 判假。规格标题自述对标 RPG Maker「地图场景且无事件
   运行」，且 Tuxemon 剧情普遍配 `lock_controls`，影响仅为全局页晚一 tick 启动。
2. **玩家 moveRoute（未配锁）**：上游玩家实体在 WorldState 内移动；KW1 判假。
   同上，只延迟。
3. **`worldContinues:true` 的 scene**：map fiber 仍在折叠，但 KW1 一律判假
   （`src/engine/README.md:316-319` 已明示）。规格要求「不在其它 scene 中」。

**漏纳**：未发现。attract/demo 输入所有权不是游戏 scene，不阻塞（`findings/KW1.md:33-35`），
与上游无冲突；rewind 恢复快照后重新派生，有字节一致测试
（`world-idle.test.ts:420-458`）。

## 3. 测试辨识力（变异检查，已还原）

对 `src/engine/interpreter.ts` 的 `isWorldIdle` 做两个变异，各跑
`bun test tests/world-idle.test.ts`：

| 变异 | 结果 |
| --- | --- |
| 删去 `s.inputLocked === false` | **3 fail / 8 pass**：每阻塞器单项测试（inputLock 分支）、`a later branch sees an earlier parallel lock in the same tick`（`:231`）、`page conditions sample before fibers run`（`:256`，解锁 tick 当天 `gated.started` 提前启动——trace 复现测试变红） |
| 删去 `s.modal === null` | **1 fail / 10 pass**：每阻塞器单项测试（text modal 不再阻塞，`:113`） |

变异后 `git diff` 为空，工作树已还原干净。

## 4. 门禁（本人复跑）

- `bun run build:example` → exit 0（全部 fixture 构建，含 `dist/sunstone.js` 440,370 字节）
- `bun test` → **936 pass / 0 fail**，468,593 expect()，62 文件，无 skip（91s）
- `bunx tsc --noEmit` → exit 0
- `bash tools/pr1-equivalence.sh` → `PASS scenarios=37 states=12376`，37 个语义哈希全部匹配
- `git diff fb3b319..HEAD -- bun.lock` → 0 行
- golden/PNG → diff 中 0 个
- 无 fleet 任务号、无本机路径（grep `1981`/`task-1981`/`/var/tmp`/`/home/` 于 src/tests/editor/tools 无命中）
- 提交分两步：`3bd3889` 实现+测试、`5f1518e` 兼容验证+文档+报告

## 5. 兼容与传播细节

- **schema hash**：独立重算 `sha256Text(canonicalJson(schema.json))` =
  `0ff7c248…30692c`，与 `map-repository.ts:134` 字面量一致；
  `tests/map-repository.test.ts:120` 也断言此等式（套件已绿）。
- **编辑器 schema 同步**：`editor/engine/projects.ts:795-804` 与 normative schema
  同形；`tests/editor-model.test.ts:64` 断言 `PROJECT_SCHEMA` 等于 normative schema（已绿）。
- **bundle 尺寸测试**：`EXPECTED_BYTES` 438,550 → 440,370（+1,820），注释说明与
  实测增量一致；该测试证明战斗 UI 标识符仍未进入 sunstone 包。
- **低层调用方保守失败**：`evalCondition` 无 context 时 `worldIdle` 为 false
  （`interpreter.ts:196-199`），`negate` 在保守 false 之后取反——语义安全。
- **存档**：`save-validate.ts` 仅新增条件种类校验（编译进存档程序的指令需要），
  无新存档字段；存档往返测试通过。
- **画面**：无渲染产物变更（GameView 仅给既有页面选择传 context），goldens 未动，
  wasm golden 全套通过。

## 6. 阻断项

无。

## 7. 非阻断观察

- 同 tick 可见性测试只覆盖了 lock 一种发布物（modal/transfer/battle/route 未逐一
  覆盖同 tick 场景）；机制同一（都是 `if` 指令时刻读 `s` 上的字段），且每字段有
  独立谓词测试，辨识力足够。
- `main !== null` / 玩家路线 / `worldContinues` scene 三处相对上游的保守多纳
  （§2），建议游戏仓导入器在映射 `current_state WorldState` 时知悉：效果只延迟、
  不丢弃。

PASS
