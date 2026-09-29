# 复审 G6 修复 1（task 1862）

审查人：task 1863（claude-p）。被审分支 `fleet/task-1833`，提交 `b906bde..3111ac9`（8 个），已合入游戏仓 main `ca7f82c`，子模块 `vendor/pocket-rpgkit` = `4dfb651`（含 K2 `af14ec3` 与 KF1）。
规格：`game-G6-fix1.md`、`review-G6-fix1.md`、`reviewer-generic.md`（`/var/tmp/fleet-specs/pocket-tuxemon/`）。
临时产物在 `/var/tmp/fleet/1863/`。证据图、探针、基准原始输出拷贝在 `findings/review-task-1862/`。

## 结论先行

判定：**FAIL**。有两个阻断项，都是本轮修复引入的回归，现有测试和工具都没有发现。

1. **B1（新）：N1 把所有「自动触发的剧情」改成 parallel fiber 以后，自动剧情的对话不再挡住玩家。**
   - 对话框开着时，玩家可以走动；按确认翻页，同一下还会触发面前的动作事件。
   - Tuxemon 的对话状态会吞掉全部输入。修复前的导入（b906bde）也会冻结玩家。
   - 发生在主线第一屏：卧室开场问题和 CEO 18 行独白期间，玩家能走到楼梯下楼。开场剧情因此被取消，脚本里「传送到 Paper Scoop」这一步不再发生。
2. **B2：打开 K2 `routes` 以后，新增 5 处永久锁输入。**
   - 原因是 `char_move` 被导成 `skippable:false` 的移动路线，挡住后永远等待；Tuxemon 挡住就停下并继续执行。
   - 新的逐锁证明 `tools/verify-g6-locks.ts` 把这 5 处都算成「有解」：3 处标为 `reachable`（静态推理），2 处标为 `local-unlock`（只看结构）。
   - 所以报告里「per-lock scan: 0 unresolved」「no permanent locks」不成立。
   - 这 5 处都在 Xero/TABA 线上，从 `spyder_bedroom` 按传送走不到，不影响 G6 journey。

其余交付都成立，数字能复现：

- **上一轮 B1（NPC 画在原点）**：游戏侧已修好。
  - 复现的四个场景里，NPC 都在自己的格子上；我逐张打开看过截图。
  - 新 golden 的 NPC 和玩家像素断言在三种变异下都会变红。
- **门禁**：导入两遍字节一致；`tsc` exit 0；`bun test` 38 pass / 0 fail。
- **journey**：在真正的 G6 工程上，60/30/20/4 Hz 各 12/12，42 个剧情节拍一致。
- **其他修复**：N2、N5、N7、N8 都成立；覆盖率前后数字与报告逐项相等；全图冻结扫描 0/0/0。
- **QuickJS 性能（新组件仓）**：960×544 下，走路 p95 0.90 ms，切图最坏 3.8 ms，启动 845–895 ms。G6 原始数字是 18.2 ms / 230.7 ms / 914 ms。

另有 7 条非阻断项。其中一条值得注意：1,161 条单向边已经写进 passage 表，但最终工程里有 49 条被 G1 的旧阻挡覆盖。builder 的对照工具比较的是地形片段，不是最终工程，所以没看出来。

## 阻断项

### B1：自动剧情的对话不再挡住玩家（N1 的回归，主线第一屏可见）

- **改动**：`importer/project.ts:1299-1322`。
  - 所有自动事件都导成 `parallel` 页，不再用 `autorun`。
  - 会阻塞的事件，守卫从页条件挪进 fiber 内部：`:1307-1311`。
- **组件仓现有规则**：
  - parallel fiber 的 `text` 不冻结玩家移动：`vendor/pocket-rpgkit/src/engine/session.ts:387-397`，注释写的是 "A parallel TEXT line does not freeze the world"。
  - 动作触发只检查 `s.main` 和 `inputLocked`，不检查对话框是否打开：`interpreter.ts:850-866`。
  - 导入器把自动剧情整体搬进 parallel，这两条规则就作用到了所有没写 `lock_controls` 的自动剧情上。
- **原作语义**：
  - `DialogState.process_event` 对任何输入都返回 `None`，也就是吞掉输入：`tuxemon/states/dialog_state.py:136-151`。
  - 事件管理器在某个状态吞掉输入后就停止向下传递（`tuxemon/event/eventmanager.py` 的 `propagate_event`）。
  - 所以任何对话框开着时，世界都收不到移动键和交互键。
- **实测（主线，`spyder_bedroom`）**：
  - **开场问题期间按住左键**：玩家从 (4,4) 走到 (0,4)，对话框一直开着。
    - reducer 里复现：`probe/walktext.ts`。
    - 构建出的包里复现：`probe/uiwalk.ts`；截图 `b1new-walk-during-intro.png`，已打开看过，对话框下玩家已经贴到左墙。
    - 同一个 kit、换用修复前的导入器（`git archive b906bde importer`）：玩家停在 (4,4)，因为那时 intro 是 main fiber 的 autorun。
  - **选「不跳过」进入 CEO 独白（18 行）**：独白期间玩家照样能走。修复前冻结。
    - 探针：`probe/walkintro.ts`。
  - **面朝床按确认翻页**：同一下还启动了「Resting in Bed」的 main fiber，而且是在开场对话中间。修复前不会。
    - 探针：`probe/confirmleak.ts`。
  - **独白期间走到楼梯 (7,2)**：第 181 帧传送到 `spyder_downstairs`。
    - `v.spyder_intro` 没有写入，「传送到 Paper Scoop」这一步被跳过，玩家可以在剧情开始之前到处走（序列跳过）。
    - 探针：`probe/escape.ts`。
- **影响范围**：
  - 全语料有 249 个 parallel 页（60 张图）含对话，而且这些对话前面没有本页自己的 `lockInput`：702/1,038 条 text。这是上界，没有计算别的事件先上的锁。
  - Spyder 主线几张图里有 9 页：开场问题、CEO 独白、5 个「Chosen – X」、第一战胜/负。第一战两页实际跑在 e024 的锁下。
  - 探针：`probe/unlockedtext.ts`，清单在 `unlocked-parallel-text.json`。
- **测试为什么没发现**：维护中的 journey 是自适应驱动，对话期间从不按方向键。
- **修复方向**：
  - 组件仓（推荐，通用）：任何 fiber 的 text 打开时，都冻结玩家移动、不启动新的 action/touch 触发。
  - 或者在导入器里：只对「条件会同时成立」的自动事件用 parallel，其余保持 autorun；或者给自动剧情的对话加 lockInput/unlockInput，并保留外层已有的锁。
  - 回归测试：开场对话期间按方向键，玩家不动；在床前按确认，不启动「Resting in Bed」。

### B2：打开 `routes` 后新增 5 处永久锁输入；逐锁证明不可信

- **5 处卡死**：都是给 NPC 的 `moveRoute … wait:true, skippable:false` 被挡住后永远等待。
  - 探针：`probe/lockfire2.ts`、`probe/stuck.ts`、`probe/verify-locks-all.ts`；输出在 `lockfire-party1.json`、`verify-locks-alldyn.json`。

  | 图 / 事件 | builder 的判定 | 卡在哪 | 挡住它的东西 |
  |---|---|---|---|
  | `route1` gym time | reachable | 剧情最后一步，Kyle 从 (54,34) `moveUp` | (54,33) 上的传送门事件 `e047_enter_the_battle_area`（无精灵，`blocks:false`） |
  | `taba_ba_br_3` there he is | reachable | 后续事件 `e007_unhinged_3`，`npc_cam` 从 (14,6) `moveRight` | (15,6) 上的传送事件；`npc_omnigrunt6` 向右是墙 |
  | `taba_ba_main` im here | reachable | 后续事件 `e010_yeah_kyle_still_kinda_sucks`，Kyle 从 (9,4) `moveDown` | (9,5) 上还没登场的 `npc_aeble` 槽位（第 0 页，`blocks:false`） |
  | `taba_ba_main` time to face the master | local-unlock | Kyle 从 (9,9) `moveLeft` ×2 | 墙：`canStepFrom(9,9,left)=n`，改前改后相同 |
  | `taba_ba_br_1` get acolyte | local-unlock | `npc_omnigrunt7` 第 7 步 `moveLeft`，在 (1,7) | 墙 |

- **因果（消融）**：
  - 用同一个导入器、全部 263 张图、只关掉 `routes`（K1 配置）重建工程。
  - 5 处全部能解锁，其中 im here 在第 3,352 帧，get acolyte 在第 522 帧；打开 `routes` 后全部卡死。
  - 上一轮审查（1838）用同一个探针跑修复前的工程，前 4 处也都能解锁。
  - 原因是 `char_move`：关掉 `routes` 时它被丢弃；打开后导成不可跳过的路线（`importer/project.ts:885-899`）。
  - 原作的 `char_move` 被挡住时发出 `StopMovementCommand`（`tuxemon/entity/path/policies/reroute.py:64-66`），角色不动也不再有路径，动作随即结束（`event/actions/char_move.py:82-88`），剧情继续。
  - 另外，组件仓的 NPC 碰撞 `occupantBlocks`（`src/engine/chars.ts:391-413`）把**所有**有位置的事件都当障碍，没有看 `blocks`，而玩家碰撞是看 `blocks` 的。
- **逐锁证明不可信**：
  - `verify-g6-locks.ts` 对 300 页只做结构检查，从不执行（`:344-351`）。
  - 它的结构检查只要求「至少一条路径上」有解锁（`:246-297`）。
  - `reachable` 靠静态推理（`:303-336`）：只要后续事件的**任一** `if` 条件被某个历史写入满足，就算能接上；只要页里**出现过** `unlockInput`，就算能解锁（`:316, :322`）。它不看这条链能不能真的跑完。
  - 用 builder 自己的动态探针（`checkPage`）对全部 319 页跑一遍：301 页解锁、2 页传送、16 页未解决。
    - 7 页上锁后从不释放：上表 5 页，加上 2 个探针误报（`battle redo` 需要 `talkedonce`，`hey!` 起点格选得不对）。
    - 9 页没能触发到锁，结论不确定。
- **抽查 5 条的结果**：
  - `route1` battle!：成立，第 1,842 帧解锁。
  - `taba_ba_br_2` battle redo：成立，补上 `talkedonce=1` 后第 15 帧解锁。
  - gym time、there he is、im here：**不成立**，都是永久锁。
- **与验收的关系**：
  - 验收写的是「冻结扫描（修正后的口径）263 图 0 永久锁死或每个例外都有文档」。
  - 冻结扫描确实是 0，但它从落点乱走，触发不到这些需要剧情状态的过场。
  - 报告里没有任何例外文档，反而写了「0 unresolved」「no permanent locks」。
- **修复方向**：
  - 导入器：`char_move` 改成 `skippable:true`，对应原作「挡住就停」。
  - 组件仓（通用）：NPC 之间的碰撞忽略 `blocks:false` 或没有精灵的事件，与玩家碰撞一致。
  - `verify-g6-locks`：对全部锁页都跑动态检查，`reachable` 只作提示，不算证明。
  - 把这 5 处加进测试。

## 1. 规格逐条（`game-G6-fix1.md`）

| 要求 | 判定 | 证据 |
|---|---|---|
| 第一步：merge main，子模块指向 `4dfb651`，重新导入 | 成立 | `git submodule status` 是 `4dfb6518…`；`git diff b906bde..3111ac9 -- vendor` 为空；两个子模块工作区都干净。导入两遍的结果都与提交内容逐字节相同（§2） |
| KF1 之后 golden 逐张打开看 | 成立 | 4 张我都打开看过（§5） |
| B1 游戏侧：拍得到 NPC 的 golden，NPC 像素断言；Paper Town 换成看得见玩家的帧并断言玩家像素（N3） | 成立 | `tests/g6-golden.test.ts:123-141`。复现与变异见 §3、§5 |
| N2：多 Hz 测试跑在 gen-assets 产出的 G6 工程上，测试后产物不被污染 | 成立（小瑕疵） | 见下方 N2 说明 |
| N5：`open_shop` 导成可见占位，覆盖率记为 placeholder | 成立 | 见下方 N5 说明 |
| N1：按原作并发语义建模，或列为已知缺口并确保锁有解锁路径；逐锁检查进测试 | **不成立** | 见下方 N1 说明，以及阻断项 B1、B2 |
| N7：换图后的锁也算；无限对话循环算无进展；determinism 真在两个隔离根目录烘焙 | 成立 | 见下方 N7 说明 |
| N8：玩家外观取 `appearance_options.yaml` 第一项 | 成立 | 见下方 N8 说明 |
| K2：打开 `routes`；G5 方向碰撞导成 `dirEdges`（1,161 处）；覆盖率更新；冻结扫描与 journey 重跑 | 部分 | 见下方 K2 说明 |
| 验收：导入两遍一致；journey 4 个频率 12/12；冻结扫描 0 永久锁死或例外有文档；`tsc` 0；`bun test` 全绿；G6.md 新增「修复 1」；子模块只提交指针；不 push | 部分 | 冻结扫描本身是 0，但有 5 处未写文档的永久锁（B2）。其余都成立：`findings/G6.md:23-57`；8 个提交作者都是 `lfkdsk <lfkdsk@gmail.com>`，没有 AI 尾注 |

各行说明：

- **N2**：
  - 测试先把完整 G6 工程烘焙到一个一次性根目录，断言 `options` 等于 G6 配置、`maps` 是 263，再在那里跑 4 个频率（`tests/importer.test.ts:456-523`）。
  - 我用 `G6_OUTPUT_ROOT` 另烘焙一份，`dist/project.json` 的 sha256 与维护中的完全相同（`b21469a3…`）。
  - 跑完 `bun test`，工作区里所有文件的哈希都没变。
  - 瑕疵：临时目录写死为 `/var/tmp/fleet/1862`（`tests/importer.test.ts:459`、`tools/verify-g6-determinism.ts:75`）。
- **N5**：
  - `import-report.json` 里 `open_shop` 共 28 次，全部是 placeholder，dropped 为 0。工程里有 28 条 `[SHOP]` 文本。
  - 实际游玩（Spyder 线可达的 `spyder_cotton_scoop`）：先出「Welcome!」，再出「[SHOP] Shopkeeper — Buy/sell items / Stock: Repellent $100, Potion $100, Tuxeball $100, …」。
  - Paper Scoop 在原作里本来就没有 `open_shop`，所以那里的店员没有对话是忠实的。
- **N1**：
  - 并发启动和「启动后跑完」这两点成立。`route1` 的 Xero 线在第 734 帧写 `completethis`、第 1,758 帧写 `left`、第 1,842 帧解锁。
  - 但这个改法让自动剧情的对话不再挡住玩家（B1）。
  - `routes` 打开后新增 5 处永久锁，逐锁证明给出了错误的「0 unresolved」（B2）。
- **N7**：
  - 换图后的锁：`tools/frozen-k1.ts` 判锁不再要求仍在起始图，新增测试 `tests/frozen-k1.test.ts:27-45`。
  - 无限对话：「世界指纹」不变就判为无进展。我在已知死路 `taba_ba_br_master_foyer`（`foyer_talk=1`）上套用同一判据，结果是 `blocking=true`（`probe/loopscan.ts`）。
  - determinism：`verify-g6-determinism.ts` 用 `mkdtemp` 建两个根目录各烘焙一次再比较。
- **N8**：`importer/characters.ts` 的 `firstPlayerSheet` 读 `options[0].template.sprite_name`，当前值是 `adventurer`；这个字段缺失或不安全时直接报错。
- **K2**：
  - `routes` 已打开：`G6_IMPORT_OPTIONS`，`gen-assets.ts:12,24`。
  - 1,161 条单向边已写入 passage 表（`data/terrain-report.json` 中 `oneWayEdgesEncoded: 1161`）。但最终工程里有 49 条被 G1 的阻挡覆盖（N-c）。
  - 覆盖率数字复算后逐项相等（§2）。journey 与冻结扫描都重跑通过（§2）。
  - `routes` 带来了 B2 的 5 处永久锁。

## 2. 门禁与复跑（命令与输出）

- **`bun run import` 两遍**：
  - 每遍约 9.2 s。
  - 我给工作区全部文件（除 `.git`、`node_modules`、`vendor`、构建产物外）逐个算哈希：两遍结果相同，也与导入前的已提交内容相同。
  - `dist/project.json` = `b21469a3…`，`git status` 干净。
- **`bun run verify:g6:determinism`**：输出 `PASS isolatedRoots=2 files=2388 bytes=47172280 sha256=fe3da5b2…`，与报告一致。
  - 我自己在 `/var/tmp/fleet/1863/g6root` 另烘焙一份：16 个生成路径与工作区逐一相同。
- **`bunx tsc --noEmit`**：exit 0，10.3 s。
- **`bun test tests/`**：38 pass，0 fail，39,370 个 `expect()`，44.3 s。
  - 跑完后工作区哈希不变，`dist/project.json` 不变，说明 N2 已修。
- **`bun.lock`**：`git diff b906bde..3111ac9 -- bun.lock` 为空。
- **journey，在 G6 工程上跑**：命令是 `G6_PROJECT_ROOT=… HZ=… bun tools/smoke-spyder.ts`。

  | Hz | 帧数 | PASS | 结束位置 |
  |---|---:|---:|---|
  | 60 | 3,410 | 12/12 | `spyder_route1 @14,19` |
  | 30 | 1,781 | 12/12 | 同上 |
  | 20 | 1,238 | 12/12 | 同上 |
  | 4 | 437 | 12/12 | 同上 |

  - TEXT、PICK、MAP 节拍 42 条，4 个频率完全相同；`story` 相同。
  - 60 Hz 结果 sha256 是 `f22c17c1…`，与 `data/g6-journey.json` 相同，masks 也完全相同。
- **`bun tools/frozen-k1.ts`**：263 maps；0 permanent input locks；0 blocking；0 errors；89 s。
- **覆盖率**：用 `probe/coverage.ts` 对 `availableMapIds()` 全量复算。

  | 配置 | 动作 native / degraded / 占位 / 丢弃 | 条件 native / degraded / 占位 / 丢弃 |
  |---|---|---|
  | 默认 v1 | 6,161（45.2%）/ 2,822 / 461 / 4,173 | 3,535（40.8%）/ 1,238 / 850 / 3,040 |
  | K1（当前导入器，`routes` 关） | 8,346 / 637 / 461 / 4,173 | 5,755 / 12 / 850 / 2,046 |
  | G6（K1 + K2 `routes`） | 9,619（70.6%）/ 637 / 461 / 2,900 | 5,757（66.5%）/ 12 / 850 / 2,044 |

  - 与 `findings/G6.md` 的表逐项相等。
  - 本轮前后对照（上一轮 1838 的 K1 数字是动作 8,346/637/433/4,201、条件 5,749/12/850/2,052）：
    - `routes` 使动作 native 增加 1,273。
    - N5 把 28 次 `open_shop` 从丢弃改成占位。
    - N1 使条件 native 在两个配置下各增加 6。

## 3. 变异检查（改坏 → 构建 → 跑对应测试 → 还原）

临时修改的是 `vendor/pocket-rpgkit/src/ui/GameView.tsx`：构建完立刻 `git checkout`，`git -C vendor/pocket-rpgkit status` 为空。golden、tape 和 `dist/main.*` 都已还原，还原后 golden 测试 6/6 通过。

| # | 改动 | 结果 |
|---|---|---|
| M-B1a | NPC 位置批处理全部写成 0（NPC 回到原点） | 回放测试**变红**：downstairs-mom 那一帧期望 `d39d7b7e`，实际 `da453b9a`。用这个包重新生成 golden 后，「downstairs mom is painted at her live NPC tile」**变红**：期望 202 个匹配像素，实际 0。对比图 `b1-mutation-mom-origin.png`：左边是妈妈在 (4,6)，右边是妈妈画在楼梯口原点 |
| M-B1b | 换图后不重新编译位置批处理 | 回放测试**变红**（`RangeError: jump batch index 6 outside 0..3`） |
| M-B1c | 玩家位置写成 0 | 重新生成 golden 后，Paper Town 玩家断言**变红**：期望 212，实际 0。卧室和 Route 1 的玩家断言也变红 |

局限：Paper Town 那张只断言玩家，不断言 NPC。M-B1a 下，这张图里的 NPC 也画在原点，但这张图本身的测试仍然通过；靠的是回放哈希和妈妈那张图发现问题。

## 4. 性能（QuickJS，新组件仓 `4dfb651`）

**方法**：
- 与 S3/KF1 相同。把 `tools/g6-quickjs-bench.rs` 拷进桌面宿主的临时副本 `/var/tmp/fleet/1863/quickjs-host`，release 构建。
- 用真实的 rquickjs Guest 加 UiSurface，重放维护中的 3,410 帧 tape。
- 每次重放：614 个走路样本、119 个切图样本、5 次传送，结束于 `spyder_route1`。
- 包是按 `tools/desktop.ts` 同样的构建计划打的：`pocket-tuxemon.js` 19,318,111 字节，`.pak` 26,266,544 字节。
- 原始输出：`findings/review-task-1862/bench/`。

| 视口 | 运行 | 启动到首帧 | 走路 QJS p95 / 最大 | 切图 QJS p95 / 最大 |
|---|---|---:|---:|---:|
| 960×544 | 1 | 852.5 ms | 0.880 / 1.638 ms | 1.245 / 3.709 ms |
| 960×544 | 2 | 844.6 ms | 0.906 / 1.751 ms | 1.225 / 3.799 ms |
| 960×544 | 3 | 894.6 ms | 0.903 / 1.621 ms | 1.408 / 3.810 ms |
| 480×272 | 1 | 942.9 ms | 0.991 / 1.408 ms | 1.234 / 3.290 ms |
| 480×272 | 2 | 969.6 ms | 0.910 / 1.390 ms | 1.387 / 2.932 ms |

与 G6 原始数字（960×544）对照：

- **走路 p95**：18.20 ms 降到 0.90 ms。
- **切图最坏**：230.7 ms 降到 3.8 ms。
- **启动**：914 ms 降到 845–895 ms，基本没变。启动主要花在解析 19.3 MB 的 JS 上，要靠 S3 建议的按图分片解决，不在本轮范围内。
- **内存**：QuickJS 开机堆从 41.37 MiB 降到 36.82 MiB。

## 5. 画面（逐张打开看过）

- **上一轮的复现，用 `probe/npcscan.ts`**：
  - 探针把每个角色的整张不透明精灵，与它 reducer 位置对应的屏幕像素逐个比较。
  - 渲染任意起点的做法：临时入口文件读 `__reviewStart`，构建后立即删除。
  - 坑：多次 boot 时 `__reviewStart` 会留在 `globalThis` 上，必须显式清空，否则回放 tape 会从错误的起点开始。
- **楼下妈妈（从 `spyder_downstairs @5,4` 开局 40 帧）**：她在 (6,6)，202/202 像素相符；原点什么都没有。
  - 图：`b1-downstairs-mom-6-6.png`。放大看过：妈妈站在桌子右下，玩家在 (5,4)。
- **Paper Town（注入剧情变量，使 Dante、摇滚猫等都登场）**：
  - Dante (15,8) 234/234。
  - 摇滚猫从 (24,2) 游走到 (25,3)，101/101。
  - 花店店员 204/204、Billie 248/248、船长 248/248、妈妈 (15,1) 202/202。
  - Conileaf 在 (27,4)：只有 36/157 相符，是被脚下这一格的栅栏上层盖住，符合 KF1 的遮挡规则。
  - 原点 (0,0) 一带只有树。
  - 图：`b1-paper-town-npcs.png`，绿框表示整张精灵相符。
- **journey 中的 Dante（第 2,190 帧，新 tape）**：Dante 在 (19,13) 便利店门口，212/236 相符，缺的下半截被对话框挡住；玩家在 (24,13)。
  - 图：`b1-journey-f2190-dante-19-13.png`。
- **4 张 golden**：
  - 卧室 f1723：玩家在地毯上。
  - 楼下 f1951：玩家 (3,6)、妈妈 (4,6) 在沙发旁。
  - Paper Town f2017：玩家 (10,8) 在路上，完整可见；花店店员、路牌也在。
  - Route 1 f3409：玩家在下缘栅栏处。
  - 回放第 1951 帧和第 2017 帧，fnv 分别是 `d39d7b7e` 和 `4380c25c`，都与 golden 相同。
- **B1（新）的画面证据**：`b1new-walk-during-intro.png`。开场问题对话框开着，玩家已经走到左墙。

## 6. 原则

- **全自动导入**：
  - 本轮 importer、`gen-assets.ts`、`main.tsx`、`ui/` 的新增代码里，没有地图名或角色名的特判。`route1` 只出现在一条注释里。
  - N5 的货单从同一张图的 `set_economy` 和 `db/economy` 读；N8 从 db 读。
- **组件仓**：本轮没改组件仓，也没写 Tuxemon 专用代码进去；`vendor/pocketjs` 未改。
- **提交规范**：`bun.lock` 未改；提交作者正确，没有 AI 尾注。

## 7. 非阻断项

- **N-a：同一帧内守卫的采样顺序与原作不同。**
  - 原作在一次 update 里先检查所有事件的条件，再执行动作（`eventengine.py:175-201`）。
  - kit 按事件 key 顺序逐个执行 fiber：后面的 fiber 采样自己的守卫时，前面的 fiber 本帧已经执行了不阻塞的指令。
  - 静态扫描（`probe/samelatch2.ts`，结果在 `samelatch2.json`）找到 15 张图上 42 对存在可满足的反例赋值。
  - 我逐个看了 Paper Scoop 和 Paper Town 的几对，都是实际不会同时出现的变量组合（例如两次不同的选怪）。目前还没发现可达的真实分歧。
- **N-b：N1 改变了默认 v1 配置的输出。**
  - 「defaults preserve the v1 output」测试的哈希被改成了 `e9cb28f1…`（`tests/importer.test.ts:241`）。
  - 也就是说，G1 修复时定下的「开关全关就等于 v1 原输出」不再成立。应当写进报告，或者用开关把这次改动隔开。
- **N-c：单向边在最终工程里有 49 条被覆盖。**
  - 用真实的 `canStepFrom` 检查 `dist/project.json`，对照直接读 TMX 的原作判定：比较 453,624 步，有 49 步不一致，都是「原作能走、kit 挡住」。
  - 分布：`rubberduck_route_01` 24、`rubberduck_city_01` 14、`rubberduck_cave_01` 11。1,161 对单向边里只有 1,112 对在最终工程中生效。
  - 原因：`applyTerrain`（`importer/terrain.ts:1006`）会保留 G1 的阻挡格；G1 把所有 `collision*` 对象覆盖的格子都标成阻挡（`importer/source.ts:285`），这 3 张图里有 50 格。
  - builder 的 Python 对照工具比较的是 `data/terrain.json`（地形片段），不是最终工程，所以看不到。
  - 这 3 张图从 Spyder 起点走不到。
  - 探针：`probe/oracle_export.py` + `probe/kitsteps.ts`；输出 `kitsteps-vs-oracle.txt`。
- **N-d**：临时目录写死为 `/var/tmp/fleet/1862`（测试和 determinism 工具各一处）。
- **N-e**：启动约 0.85–0.97 s，JS 包 19.3 MB，比原来的 18.2 MB 还大。需要 S3 提出的按图分片加载。
- **N-f：冻结扫描本身触发不到需要剧情状态的过场。**
  - B2 的 5 处它全都漏掉。
  - 建议把 `checkPage` 这类动态检查对全部锁页常规运行，替代结构检查和静态推理。
- **N-g**：builder 本轮没有重跑 desktop 和 web，报告里如实写了。我也没有重跑。

## 8. 复现

```sh
# 在 worktree 根目录。探针里的绝对路径都指向 /home/tangollvm/.fleet/worktrees/task-1833
bun run import && git status --short
bun run verify:g6:determinism
bunx tsc --noEmit && bun test tests/
bun tools/frozen-k1.ts dist/project.json --out=/var/tmp/fleet/1863/probe/frozen-k1.json

# B1（新）：开场对话期间走动、确认键漏进动作事件、中途走出房间
bun findings/review-task-1862/probe/walktext.ts dist/project.json spyder_bedroom 4 4 down LEFT '{}' 60
bun findings/review-task-1862/probe/confirmleak.ts dist/project.json spyder_bedroom 1 2 left
bun findings/review-task-1862/probe/escape.ts dist/project.json '[["RIGHT",60],["UP",40],["LEFT",12]]'
bun findings/review-task-1862/probe/uiwalk.ts          # 需要 dist/main.{js,pak}（bun run build）

# B2：5 处永久锁，以及 routes 消融
PARTY=1 bun findings/review-task-1862/probe/lockfire2.ts dist/project.json gym_time
ALLDYN=1 PARKED=1 bun findings/review-task-1862/probe/verify-locks-all.ts --out=/var/tmp/x.json
bun findings/review-task-1862/probe/build-cur.ts "<全部图 id>" /var/tmp/full-k1.json K1_IMPORT_OPTIONS

# N-c：真实 kit 的通行判定对照原作
python3 findings/review-task-1862/probe/oracle_export.py && bun findings/review-task-1862/probe/kitsteps.ts dist/project.json

# 性能：按 tools/bench-g6-quickjs.sh 做，但用 /var/tmp/fleet/1863 作临时目录
bun findings/review-task-1862/probe/build-linux-app.ts /var/tmp/fleet/1863/linux-app
```

FAIL
