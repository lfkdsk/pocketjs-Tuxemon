# KB4 战斗 UI 基件审查（task 1919）

审查对象：`fleet/task-1919`，基线 `fdc54ca017af5edb69b63c47bded77a5f6c02ff7`，被审提交 `42f5a830e668a5ad9a265709c42551934b4b7972`。

结论：**FAIL**。组件的 tick 驱动、真实倒带、多频率一致性、按需打包、类型/测试门禁和 QuickJS 帧耗时均成立；但验收明确要求的“演出中每帧不建/删节点”被真实 QuickJS 宿主否定，实时 `GameView` 又无法向战斗场景交付 `cancelEdge`，且演示的敌方倒下效果会在胜利消息出现时被清除、让敌人重新站起。这三项都是可在本任务范围内修复的实现缺陷，因此不是外部阻塞，判 FAIL。

## 阻断项

### B1. `MessageBand` 在演出中创建并销毁原生文本节点

- 真实 QuickJS/PocketJS desktop Runtime 统计到：480×272 的受击+HP 补间 40 帧内 `create/destroy/insert/remove = 2/2/2/2`，倒下 40 帧内为 `1/1/1/1`；960×544 结果相同。发生抖动的帧是受击第 1、24 帧及倒下第 1 帧，每个抖动帧有 4 个结构操作。
- 原因是 `MessageBand` 的未揭示行和未完成 legend 以空字符串表示；空串与非空串切换时，宿主将文本子节点替换。对应实现见 `src/ui/battle/MessageBand.tsx:36-44,54-57,71-90`。
- 现有测试只在进入受击后的下一帧清零计数，然后测 20 帧（`tests/kb4-battle-sim.test.ts:308-337`），恰好漏掉第 1 帧和第 24 帧，因此其“zero lifecycle ops”并不能覆盖整段演出。
- 审查中临时把未揭示文本/legend 保持为不可见的非空白占位后，同一 QuickJS benchmark 六个 case 的结构操作全部变为 0；随后已还原。最小修法是让 `Text` 的文本子节点在整个打字机生命周期保持存在，并增加覆盖第一帧、换行点、完成点的宿主级回归测试。

这直接违反规格“演出中每帧不建/删节点”，阻断验收。

### B2. 实时 `GameView` 不会产生战斗场景的 `cancelEdge`

- `GameView` 只有 choices/shop 地图 modal 注册 `back`；无 modal 时一律只注册 `confirm`（`src/ui/GameView.tsx:484-499`），但它传给 reducer 的 `cancelEdge` 只来自该 action callback（`src/ui/GameView.tsx:536-540`）。战斗场景存在时 `modal()` 仍为空，所以按 CROSS 不会设置 `edge.cancel`。
- 端到端复现：按键前战斗为 `choice, pending=null`；经实时 `GameView` 按 CROSS 后仍为 `choice, pending=null`，但场景的原始 `lastButtons=16384`，证明按键已到达而 action edge 丢失；把同一状态直接交给 reducer 并传 `cancelEdge:true` 后进入 `animate, pending=escape`。
- KB4 演示已明确绕过契约，直接读取 CROSS 原始位（`tests/fixtures/kb4-battle/rules.ts:252-260`）。这不是可接受的通用 battle input 行为：技能/道具/队伍列表均需要取消/返回，真实 Tuxemon 规则不应各自重写宿主按键映射。
- 最小修法：`scene() !== null` 时在 `useActions` 中同时注册 `confirm` 与 `back`，并加一条通过实时 `GameView` 按 CROSS、断言 `cancelEdge` 生效的宿主级测试。

### B3. 敌方倒下后在胜利消息帧重新完整出现

- 从倒下 beat 转入胜利消息前，规则先无条件清除 `effectSide/effectKind/tweenSide`（`tests/fixtures/kb4-battle/rules.ts:223-230`），随后又以 `effectSide="none", effectKind="none"` 开启 `You win!` beat（同文件 `:236-245`）。因此胜利消息期间敌方精灵回到静止位置和 100% opacity。
- 我逐张打开五张 480×272 golden：intro 是部分揭示的 `A wild Bu`，command 正确高亮 Fight，hit 显示部分 HP 和受击位移，faint 中敌人已经下沉/变暗；`kb4-battle.winmsg.png` 却又显示完整蓝色敌人。golden 测试在 `tests/kb4-battle-sim.test.ts:340-375`，当前 golden 反而固定了该错误。
- 最小修法是把已倒下状态保留到场景退出（或明确隐藏 HP=0 的 battler），然后更新 winmsg golden 并添加“胜利消息中敌人仍不可见/保持终态”的语义像素断言。

这使规格要求的“倒下、胜利消息”演示顺序在视觉上不成立，阻断验收。

## 逐项规格核对

| 规格/验收项 | 判定 | 独立证据 |
| --- | --- | --- |
| `src/ui/battle/` 提供消息带、2×2 指令格、滚动列表、HP/XP 条、精灵槽、帧条播放器 | 成立 | 八个新增模块由 `src/ui/battle/index.ts` 导出；`README.md:478-524` 逐项记录接口和用途。 |
| 组件只读场景状态，无本地时钟/计时器/`onMount` 动画 | 成立 | 对 `src/ui/battle` 搜索 `createSignal/onMount/setInterval/setTimeout/Date.now/performance.now/requestAnimationFrame` 无命中；`SpriteSlot.tsx:28-49`、`StatBar.tsx:30-57`、`FrameStrip.tsx:29-48` 均只由 props/tick 计算。真实倒带与中段多 hz 结果见下节。 |
| 480×272、960×544 与主题支持 | 成立 | 两分辨率均由同一真实场景渲染；现有 pinned hashes 在 `tests/kb4-battle-sim.test.ts:126-147`。组件统一读取 `resolveUiTheme`，两分辨率 QuickJS benchmark 也均成功启动。 |
| 独立入口、未使用游戏不打入 bundle | 成立 | `package.json:8-14` 新增独立 `./ui/battle` export。对真实 `fdc54ca` worktree 重建后，Sunstone/meadow/grow/wander 四个 bundle 均逐字节一致，见“按需打包”。 |
| 玩具场景展示进场、选招、受击+HP 补间、倒下、胜利消息 | 部分 | 流程和组件齐全，但 B2 迫使 demo 读取裸按键，B3 使胜利消息帧复活已倒下敌人。 |
| 必须按顺序 `build:example` → `bun test`，再做类型门禁 | 成立 | 审查者按此顺序重跑：build exit 0；892 pass/0 fail；tsc exit 0，详情见“门禁”。 |
| 新 golden、语义像素断言、人工打开 PNG | 部分 | 五张 golden 全是新增文件，命令选择与 HP 有独立常量锚点，关键断言变异会失败；但 winmsg golden 固定了 B3。 |
| 任意演出帧倒带逐像素一致；60/30/20/4 Hz 同逻辑时刻一致 | 成立 | 真实 L 倒带覆盖受击抖动、HP 补间、倒下；中段而非仅 settled frame 的多 hz 哈希一致，见下节。 |
| QuickJS 帧耗时；演出中每帧不建/删节点 | 部分/不成立 | 帧耗时最大 1.285 ms，性能充足；结构操作违反零抖动要求，见 B1 与 benchmark 表。 |
| README/CHANGELOG | 部分 | README 和 package export 已补；仓库唯一 `src/data/CHANGELOG.md` 未改。该文件是 schema changelog，记为字面验收缺口但不单独阻断。 |
| goldens 只新增不改；`bun.lock`、`vendor/` 不改；无 Tuxemon 专用组件代码；代码/提交信息无任务号 | 成立 | `git diff --name-status fdc54ca..HEAD` 中五张 golden 均为 `A`；`git diff --name-only ... -- bun.lock vendor` 为空；`src/ui/battle` 与 fixture 无 Tuxemon/Fleet/task-1919 命中。 |
| 频繁、小步提交 | 不成立（流程偏差） | `git rev-list --count fdc54ca..HEAD` 输出 `1`；全部 2,379 行功能/测试/报告集中于一个提交。实现作者和邮箱正确，提交信息也符合英文风格。 |

## 必跑门禁

在没有跳过测试的情况下按要求先构建再测试：

```text
$ bun run build:example
exit 0

$ bun test
892 pass
0 fail
466070 expect() calls
Ran 892 tests across 59 files.

$ bunx tsc --noEmit
(no output)
exit 0
```

临时变异、倒带测试与 benchmark 完成后都还原了被审源码，并重新构建了 `dist/kb4-battle.{js,pak}`。

## 状态驱动、真实倒带与多 hz

现有测试的跨 hz 比较只落在已 settled 的 checkpoint（`tests/kb4-battle-sim.test.ts:59-123,295-306`），而“两个独立运行哈希相同”也不是实际 L 倒带。审查补做了两组临时测试并在验证后还原：

1. 给 fixture 临时启用空 attract tape，通过真实 attract controller 按 L 回卷，再向前重放到同一 tick；仅在对比时屏蔽展示性的 REWIND overlay。原帧与重放帧结果：

   | 位置 | 原/重放 FNV | 像素差 | scene state |
   | --- | --- | ---: | --- |
   | 受击抖动 +3 tick | `ce99d80f` / `ce99d80f` | 0 | 相等 |
   | HP 补间 +12 tick | `6b084ed4` / `6b084ed4` | 0 | 相等 |
   | 倒下下沉 +15 tick | `a9596e6c` / `a9596e6c` | 0 | 相等 |

2. 精确落在相同参考 tick 的动画中段，而不是 settled frame：

   | 位置 | 60 / 30 / 20 / 4 Hz |
   | --- | --- |
   | 受击抖动+HP 补间，elapsed +30 | 四者均为 `7ce0fc5f` |
   | 倒下，elapsed +30 | 四者均为 `ff493e6c` |

因此当前画面确实由 reducer state/reference tick 推导，任意抽查的动画中段可倒带且跨 hz 一致。

## 语义像素与变异检查

- 现有 command 断言使用手写的 panel 坐标和主题 RGB 常量（`tests/kb4-battle-sim.test.ts:149-176`），不依赖组件计算。
- 现有 HP、shake、faint 断言分别复用了 `barFillWidth`、`shakeOffsetX`、`faintPose`（同文件 `:178-285`），单独看有“实现数学错、测试一起错”的风险。审查另以常量手算钉住 HP：`4→0`、48 tick、elapsed 4、64 px 得到 59 px；渲染实测填充为 59 px，首个 track pixel 在 `x=451`。
- 临时把 command 选中态颜色改坏，选中项语义断言失败；临时把 HP fill 减 8 px，HP 边界断言失败。两处均还原。
- 临时给 `SpriteSlot` 加本地 `createSignal` 动画游标后，focused sim 为 **7 pass / 3 fail**，失败覆盖 shake、faint 和 golden；说明测试能抓到组件脱离 reducer tick 的像素偏差。变异随后还原。

故语义测试不是纯哈希自证，且至少 command/HP 有独立常量锚点；shake/faint 的 helper 耦合仍值得后续减少，但不构成额外阻断。

## QuickJS 帧耗时与节点操作

可复现 harness：`findings/review-task-1919-quickjs.rs`。它把真实 `dist/kb4-battle.js/.pak` 启动进 PocketJS desktop Runtime，单独计时 `Guest::frame`（QuickJS）与 `UiSurface::tick`，并包裹四个结构 API。运行命令：

```text
CARGO_TARGET_DIR=/var/tmp/kit-scrub-scratch/target \
POCKETJS_DIST=/home/tangollvm/.fleet/worktrees/task-1919/dist \
cargo test --release kb4_quickjs_bench::battle_frame_and_node_churn \
  -- --ignored --exact --nocapture

test result: ok. 1 passed; 0 failed
```

本次复跑实测：

| viewport | case | n | QuickJS mean / p95 / max | create / destroy / insert / remove | max structural/frame |
| --- | --- | ---: | --- | --- | ---: |
| 480×272 | command idle | 120 | 0.374 / 0.411 / 0.513 ms | 0 / 0 / 0 / 0 | 0 |
| 480×272 | shake + HP tween | 40 | 0.370 / 0.396 / 0.485 ms | 2 / 2 / 2 / 2 | 4 |
| 480×272 | faint | 40 | 0.347 / 0.407 / 0.423 ms | 1 / 1 / 1 / 1 | 4 |
| 960×544 | command idle | 120 | 0.372 / 0.399 / 0.410 ms | 0 / 0 / 0 / 0 | 0 |
| 960×544 | shake + HP tween | 40 | 0.386 / 0.745 / 1.285 ms | 2 / 2 / 2 / 2 | 4 |
| 960×544 | faint | 40 | 0.370 / 0.459 / 0.470 ms | 1 / 1 / 1 / 1 | 4 |

`UiSurface::tick` 最大 0.039 ms。QuickJS 时间远低于 60 Hz 的 16.67 ms 帧预算，性能项成立；节点零抖动项不成立（B1）。

## 按需打包与可复现产物

在**真实** `fdc54ca` worktree（初始化其 PocketJS submodule 后）重建基线，避免 symlink 导致解析到被审源码；逐文件 `cmp` 结果：

| bundle | bytes | SHA-256 | 与基线 |
| --- | ---: | --- | --- |
| Sunstone | 424,830 | `cb0919f04c4cc1aa60cc2b30c1ca2e6ceaef174d8f84e0b76ebeeb734d12e8fe` | identical |
| meadow | 341,207 | `c0fcb11c148fa32d9572df9dff0e3e03be48b8f241a44d4b7ed8b3af42670d66` | identical |
| grow | 434,136 | `972169d3781827fc6c2f8f222a8b4a2bcead58d89c671253985b3330fff04613` | identical |
| wander | 447,039 | `ae4a2c4f4cc1b4911acaa3e89d5265ae473c37d24d35f7aa6140d84a32bacb2f` | identical |

KB4 fixture 资产和示例 bundle 连续生成两次后与提交状态逐字节一致，`git diff` 为空。独立入口和 tree-shaking/可达性边界均成立。

## 仓库卫生与文档

- 五个 KB4 golden 均为新增，未改旧 golden；我已按原始分辨率逐张打开，而不只看哈希。
- `bun.lock`、`vendor/`、`src/data/CHANGELOG.md` 均未改；没有逐内容导入或手改导入产物的问题，本任务是通用 UI 与测试 fixture。
- `src/ui/battle/` 和 KB4 fixture 无 Tuxemon 专名或 Fleet/task-1919 标识。README 中已有的 Tuxemon 说明来自基线且与该组件无关。
- `package.json:12` 提供新 export，`README.md:478-524` 有完整使用说明。规格字面要求 CHANGELOG，而仓库仅有 schema 专用 changelog；未写入仍记为非阻断缺口。
- 被审范围仅有一个提交 `42f5a83 feat(ui): state-driven, rewindable battle UI kit (KB4)`；作者 `lfkdsk <lfkdsk@gmail.com>` 正确，但“一次提交 2,379 行”违反尽早、频繁提交的流程要求。

修复 B1、B2、B3 并补相应回归测试/更新 winmsg golden 后，应重新按同一套门禁、QuickJS benchmark、真实 L 倒带和四 bundle 基线比较复审。

FAIL
