# 审查 GB5（task 1938）

被审 worktree：`~/.fleet/worktrees/task-1938`，分支 `fleet/task-1938`，游戏仓基线 `e905824`，规格 `game-GB5-skin.md`。本报告复跑了全部门禁、逐张打开了 12 张 golden + README 截图、对照了 Tuxemon 原作源码与 Scout S4 mock、做了一次变异测试。

## 阻断项

### B1：根指令菜单把不可用指令直接丢弃，只留 `-` 占位，不符合原作也不符合本任务引用的 S4 mock

**现象**：训练师首战（Billie，`spyder_billie`）的主菜单只显示 `Fight`，其余三格是裸 `-`（`tests/goldens/gb5-battle-main-menu.960x544.png`，以及全部 12 张 golden 和 `docs/screenshots/battle.png` 用的就是这一战）。

**根因**（两层）：
1. `battle/runtime.ts:434-439` 的 `battleMenuEntries()` 只在 `itemEntries(false).length > 0` / `swapEntries().length > 0` / `canRun(...)` 为真时才把 `item` / `capture` / `run` / `replacement` 推入 `state.menu`；不可用时**整条 entry 都不生成**，而不是生成一条 `disabled` 的 entry。
2. `ui/battle-scene.tsx:188-193` 的 `commandCells()` 对 `rootEntries()` 里凑不齐的格子填 `{ label: "-", disabled: true }` —— 一个没有任何原始指令名的占位符。

**为什么是缺陷而不是设计选择**：
- 组件仓 `vendor/pocket-rpgkit/src/ui/battle/CommandGrid.tsx` 本身**已经支持** `CommandCell.disabled`，并用 `theme().dim` 画出灰色但仍可读的文字（见其 `colour()` 计算）。GB5 拿到了这个能力却没有在"指令当前不可用"这个场景下使用它——它把 `disabled: true` 用在了根本没有指令名的占位符上，而不是用在"Item / Swap 这个指令存在但当前不可选"上。
- 对照原作 `/var/tmp/tuxemon-src/tuxemon/combat/menu_visibility.py`：训练师战的 `default_trainer_battle()` 默认 `menu_fight/menu_monster/menu_item` 三个都是 `visible: True`（`menu_forfeit` 默认 `False`，只有对方认输才显示，替代野外战的 `menu_run`）。`combat_menus.py:131-161` 的 `initialize_items()` **总是**为 `menu_map` 里的每一项 `yield MenuItem(...)`，只是把 `visible/enabled` 传进去；`ItemFilter`/`can_swap_any` 只会把 `visibility_map["menu_item"]`/`["menu_monster"]` 设为 `False`。`tuxemon/menu/interface.py:186-260` 的 `MenuItem` 在 `enabled=False` 时只是弱化视觉（`update_image` 里 `if not self._enabled: pass  # Add dimming...`，配合 `combat_menus.py` 传入的 `unavailable_color`），**从不隐藏 label**。也就是说原作任何时候都能看到 `ITEM`/`MONSTER` 字样，只是变灰不可选。
- 更直接的证据：本任务规格明确引用的参照图 `~/.fleet/worktrees/task-1865/findings/scout-S4/ui/mock-480x272.png` 本身画的就是 `FIGHT / ITEM / TUXEMON / RUN` 四个**始终可见**的文字格。GB5 的实现连它自己被要求对照的 mock 都没有做到。
- commander 提出的验收口径是"Capture/Run 不可用可以禁用显示但应有文字或按原作隐藏"——GB5 的 `-` 占位符既没有文字，也没有按原作隐藏（原作从不隐藏，只是变灰），是一个第三种、两边都不满足的行为。

**影响范围**：这不是仅在这一张 golden 里出现的取景巧合——`battleMenuEntries()` 是通用的根菜单构造函数，任何时刻只要玩家没有可用道具/没有可换的搭档/不能逃跑，对应格子就会永久丢失指令名，训练师战尤其常见（`Run` 在训练师战里本就不可用，且首个训练师战没有道具、只有一只队友，三格同时消失）。

**结论**：缺陷，判**阻断**。修复方式应是：`battleMenuEntries()` 在 `root` 模式下对四个可选指令固定按顺序（Fight 常驻 / Item / Capture / Run 或 trainer 战的 Forfeit / Swap）生成 entry 并带 `available` 标志，UI 层把 `available: false` 的格子渲染成 `CommandGrid` 已有的 `disabled` 态（保留指令名，变灰），而不是替换成 `-`。

## 逐条核对

### 1. 画面对照原作（S4 §4.4 布局）
成立（除 B1 外）。逐张打开 12 张 golden + `docs/screenshots/battle.png`：
- 对手 HUD 左上（`Budaye Lv5 F`，HP 条、queue 托盘）、我方 HUD 右中（`Nut Lv5 -`，HP 数字 `101/101`、XP 条）与 `ui/battle-layout.ts:17-33` 的 `enemyHud{x:20,y:0}` / `playerHud{x:274,y:90}` 一致，也与 `scout-S4/ui/mock-480x272.png` 的整体构图（对手 HUD 空白框左上、猫形怪物右上、我方岩石怪物左下、我方 HUD 右中带 XP 条）一致。
- 对手怪物（前视图，右上，`R.enemyMonster{x:296,y:0}`）、我方怪物（背视图，左下，`R.playerMonster{x:80,y:88}`）朝向和位置正确；捕获球在 `gb5-battle-capture-shake.960x544.png` 里落在**对手**怪物身上（购买的是敌方，符合"抓的是对方"的游戏逻辑）。
- 960×544 是 480×272 的整数 2×：`ui/battle-layout.ts` `battleSceneLayout()` 用 `Math.min(width/480, height/272)` 做统一缩放，960/480=544/272=2 精确成立；README 截图由 `tools/update-gb5-battle-goldens.ts` 的 `nearestTwoX()` 做严格最近邻 2×，SHA-256 复算为 `7acb2c6f198d3762c4b17b2b3e49a1c3d3edcedc714b7e2d62f9db2d269dd24d`，与 `findings/GB5.md` 声称的一致。
- **commander 的疑点已确认为缺陷**，见 B1。

### 2. 演出由状态驱动
成立。`battle/presentation.ts` 头部注释与实现都只读 `state.eventCursor`/`state.eventTicks`/`state.battle`/`state.visuals`；`vendor/pocket-rpgkit/src/ui/battle/effects.ts` 的 `progress()`/`tweenAt()`/`shakeOffsetX()` 等全部是 `(startTick, duration, nowTick) -> number` 纯函数。`grep -rn "Date.now\|performance.now\|setInterval\|requestAnimationFrame"` 在 `vendor/pocket-rpgkit/src/ui/battle/`、`ui/battle-scene.tsx`、`battle/presentation.ts` 下零命中。

**变异测试**：在 `effects.ts` 的 `progress()` 里加入一个模块级调用计数器 `__mutationCallCounter`，让返回值依赖"这是第几次调用"而非纯粹的 `(startTick,duration,nowTick)`（模拟组件持有本地状态/计时）。复跑：
```
bun test tests/battle-presentation.test.ts tests/battle-presentation-sim.test.ts tests/battle-scene.test.ts
```
结果：`9 pass / 3 fail`——`reconstructs field occupancy...`（`trainerPresentation` 期望 `offsetX:150` 实得 `147`）、`tweens HP and rewards...`（期望 `50` 实得 `49`）、GB5 语义像素测试的 HP 条边界颜色断言全部变红。已撤销该改动，`git diff --stat vendor/pocket-rpgkit` 为空，子模块指针仍是 `b927ca8`。测试对"组件/纯函数偷偷带状态"的敏感度是真实的。

倒带一致性：`tests/battle-presentation-sim.test.ts` 里 `rewoundHit` 的字节级比较（由 `tools/gb5-battle-fixture.ts` 的 `replaceSceneState`+`rewindState.eventTicks--` 驱动）随 `bun test` 复跑通过。60/30/20/4 Hz 由 `battle/runtime.ts` 里 `advancePresentation()` 的 `battleEventDuration`/`presentationEventSkippable` 驱动，帧率无关；`GB5.md` 表格里胜/败线在四种 Hz 下终态一致，`tools/verify-web-journey.ts` 复跑同样在 3,793 帧内命中全部 4 个检查点（见下）。

### 3. 语义像素断言
成立，有辨识力。`tests/battle-presentation-sim.test.ts` 读取真实渲染出的 `rgba` 缓冲区并：
- 用 `hpBarWidth(current, maximum, width)` 独立算出期望填充宽度后与像素边界比对（`rgb(hit.rgba, 480, R.enemyHp.x + fill - 1, ...)` 命中填充色，`fill` 处命中背景色，见 `battle-presentation-sim.test.ts:159-164`），不是产物对产物。
- 上面的变异测试证明这类断言在数值被污染时确实会跟着变红，不是钉死的哈希对自己生效。

### 4. journey 重录
成立。`data/g6-journey.json` 的四个检查点帧号（bedroom 1064 / downstairs 1292 / Paper Town 1367 / Route 1 3792）与 `docs`/报告一致；golden `tests/goldens/{g6-route-1.2787.png => g6-route-1.3792.png}` 确认重命名而非新增/遗留旧文件。复跑：
```
bun run web && bun tools/verify-web-journey.ts
```
输出 `WEB JOURNEY PASS`，`boot 303 ms; replayed 3793 frames in 1610 ms`，4/4 检查点（state + pixel 哈希）全部命中，`console errors: 0`——与 `findings/GB5.md` 表格一致（末尾状态 SHA 见 §5）。

### 5. 性能（QuickJS）
数字可复现。`bash tools/bench-g6-quickjs.sh`（PATH 需要加 `~/.cargo/bin`，worktree 默认 shell 没有 cargo）独立复跑：

| 视口 | battle-steady p95 | battle-steady max | battle-entry | battle-exit | 终态 SHA-256 |
| --- | ---: | ---: | ---: | ---: | --- |
| 480×272 | 12.170 ms | 16.586 ms | 22.779 ms | 41.585 ms | `5653f011…` |
| 960×544 | 12.259 ms | 15.648 ms | 23.591 ms | 48.105 ms | `5653f011…` |

两个视口终态哈希均为 `5653f0110656dd4e0a930ff1908c833c9f9fc221c9cfd3a90d22b138ef8d4827`，与 `findings/GB5.md` 一致；`battle-steady` 结构操作 `STRUCTURE ... structural=0` 两个视口都独立确认为 0；进/出战斗两个视口都 < 50 ms（960×544 exit 48.1 ms 余量只有 ~2 ms，值得注意但未超预算）。

**构成与预算判断**：GB4 时约 6.8 ms、GB5 约 12.2 ms，翻倍的量级与"从最简方框换成完整原作皮肤"一致——新增了 HUD 框图、双方队伍球托盘（6+6 格）、站台/环境背景、可裁剪的怪物/训练师精灵槽、技能动画帧条、HP/XP 条等一整套每帧都要重新求值样式的节点，比 GB4 的极简实现节点数多一个数量级，12 ms 的翻倍在此规模下不算异常。60 Hz 的帧预算是 16.67 ms；`battle-steady` 的 p95（~12.2 ms）留有余量，但 `qjs_max`（480×272 上 16.586 ms）已经贴着 60 Hz 预算的边缘，说明战斗画面在 QuickJS 上偶尔会掉到 60 Hz 以下（非阻断，但后续如果继续往战斗场景里加内容需要盯住这个上限）。复核代码没有发现明显浪费（没有重复计算、没有不必要的每帧分配模式），但本次审查没有做逐函数级别的 profiling，不能排除更细粒度的优化空间。

### 6. 门禁复跑
全部独立复跑，结果与 `findings/GB5.md` 一致：

| 门禁 | 复跑结果 |
| --- | --- |
| `bun run import` ×2 | 两次均 `0 diff`（`git status --porcelain` 为空） |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build && bun run build:wasm` | 均成功，pak 3,221 entries / 60,591,968 bytes，wasm 289,808 bytes |
| `bun test tests/` | `138 pass, 0 fail, 63771 expect() calls`，与报告数字一致 |
| `bun run verify:g6:determinism` | `PASS isolatedRoots=2 files=3234 bytes=59696934 sha256=691c03a7…`，与报告一致 |
| `bun run web && bun tools/verify-web-journey.ts` | `WEB JOURNEY PASS`，4/4 检查点命中，0 console errors |
| G6 locks / frozen 扫描 | 包含在 `bun test`（`tests/g6-locks.test.ts`、`tests/frozen-k1.test.ts`），随上面 138 项全绿 |
| 8,560 与 GB3 golden | `git diff e905824 --stat` 显示除新增 GB5 golden 与 `g6-route-1.*` 重命名外，没有任何既有 golden 文件被改动字节，符合"0 差异" |
| `bun.lock` | `git diff e905824 -- bun.lock` 为空 |
| `vendor/pocketjs`（子模块的子模块，钉死项） | 未改动；`vendor/pocket-rpgkit` 按规格从 `a124186` 升到 `b927ca8d752b8e8c91d10cc24b02e95c7d6c22f5`，与规格要求的指针精确一致 |
| fleet 任务号 | `grep -rniE "task[ -]?19[0-9]{2}\|fleet[_ -]?task"` 在改动的 `.ts/.tsx` 源码中零命中；`git log e905824..HEAD` 的全部提交信息里也没有任务号 |

### 其他核对
- **全自动导入**：`importer/battle.ts` 的改动是通用字段投影（给 `techniques`/`statuses`/`items` 增加 `messages`/`animation`/`captureSprite`/`icon` 等字段，给 `runtimeBattleDb` 增加 `npcs`/`ui` 投影），没有任何按 slug/按图片特判的手改逻辑，符合"内容一律自动导入"的硬规矩。
- 没有修改 `vendor/pocketjs`，没有 push。

## 阻断项小结
- B1：根指令菜单丢弃不可用指令、只留 `-` 占位，既不符合原作（原作始终显示全部指令名，仅变灰不可选），也不符合本任务被要求对照的 S4 mock（该 mock 画的就是四个常驻可见的指令文字）。已获得 fleet_claim 记录，证据：`ui/battle-scene.tsx:188-193`、`battle/runtime.ts:434-439`、`vendor/pocket-rpgkit/src/ui/battle/CommandGrid.tsx`、`/var/tmp/tuxemon-src/tuxemon/combat/menu_visibility.py:8-22`、`/var/tmp/tuxemon-src/tuxemon/states/combat_menus.py:131-161`、`~/.fleet/worktrees/task-1865/findings/scout-S4/ui/mock-480x272.png`、`tests/goldens/gb5-battle-main-menu.960x544.png`。

FAIL
