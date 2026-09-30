# KB4 修复 1 复审（task 1922）

审查对象：组件仓分支 `fleet/task-1919`，修复前 HEAD `772baa5`，被审范围 `772baa5..3dac997`（`e63fca5` B1、`cc38e7a` B2、`c1d6edf` B3、`3dac997` 文档）。

结论：**FAIL**。B1 的单空格占位确实让真实 QuickJS 演出全程保持零结构操作，B2 的实时 `GameView` 已能交付 `cancelEdge` 且没有污染地图按键，B3 的胜利和失败消息帧在当前实现里也都保持倒下终态；完整 build/test/tsc、真实 L 倒带、动画中段多 Hz 与依赖卫生均通过。但是本轮明确要求的两项变异门禁没有成立：提交的场景根本没有挂载 legend，故单独回退 legend 分支仍全绿；失败方/player 终态也没有回归，单独破坏它仍全绿。另有新增源码、测试和全部四个提交正文包含 Fleet 任务号，直接违反规格的硬验收项。三项均可在当前任务范围内修复，不是外部阻塞。

## 阻断项

### B1-R. 已提交回归没有实际覆盖 legend 完成点

- 正向实现正确：`src/ui/battle/MessageBand.tsx:42-43,89,100` 让行文本和 legend 的空内容都渲染为单空格。提交的 `tools/kb4-quickjs-bench.sh` 以及上一轮相同的 raw Cargo/QuickJS 方法各复跑一次，480×272、960×544 的 command、受击+HP 补间、倒下六种 case 均为 `create/destroy/insert/remove = 0/0/0/0`；本轮观测的 QuickJS 最大帧耗时分别约 `0.454 ms` 和 `0.633 ms`。
- 单空格没有留下可见痕迹：以空串实现和单空格实现分别渲染 reveal=1、换行点 reveal=24、完成点 reveal=38，三处 FNV 均逐一相同：`4746626f`、`0919944e`、`2ef626e0`。肉眼打开 intro/hit/faint/winmsg golden 也未看到背景块、偏移或空白光标。
- 整体把 `orBlank(s)` 回退为 `s` 后，focused sim 为 `11 pass / 2 fail`，两条逐帧结构断言分别在当前测试 `:421`、`:458` 收到 `Received: 1`，说明行文本第一帧/换行已有辨识力。
- 但 `tests/fixtures/kb4-battle/scene.tsx:106-113` 的实际 `MessageBand` 没有传 `legend`；测试虽然在 `tests/kb4-battle-sim.test.ts:394` 的标题和 `:417-428` 的 bookkeeping 中声称覆盖 legend completion，实际只证明 message reveal 到达 total。只把 `MessageBand.tsx:100` 的 legend 分支改回空串，提交的 13 个 KB4 sim 测试仍是 `13 pass / 0 fail`。
- 为确认不是实现碰巧无抖动，我临时给 fixture 传入 `legend="ok"`：当前实现 QuickJS 仍全零；再仅回退 legend 的空格占位，真实 QuickJS 在受击完成帧 38 和倒下完成帧 15 各出现 `1/1/1/1`，`structural_max_per_frame=4`。然而 `tools/kb4-quickjs-bench.rs` 只打印计数、不 assert，最终仍输出 `test result: ok`。

规格与本轮附加要求都明确要求完成点被宿主级回归保护，并要求“改回空串让新回归变红”。当前回归没有做到，阻断验收。最小修法是让提交的真实 fixture 挂载 legend，并让 sim/QuickJS test 对完成帧结构计数作断言。

### B3-R. 失败消息帧的 player 终态没有回归保护

- 实现同时保存了两侧倒下 descriptor（`tests/fixtures/kb4-battle/rules.ts:91-92,247-255`），并在当前 beat 没有本侧 effect 时回退到保存值（同文件 `:343-354`）。真实失败路径实测为 `message="You lost..."`、`playerHp=0`、effect=`faint`、pose=`{sinkY:14, opacity:0}`，player rest rectangle 的非背景像素数为 `0`；所以当前运行时行为本身成立。
- 胜利侧回归有辨识力：`tests/kb4-battle-sim.test.ts:317-360` 扫描敌方整个 rest rectangle。临时恢复旧的每 beat 清空效果后该断言变红，实际读到实体蓝 `[74,150,214]`，而预期背景为 `[16,24,32]`。
- 但提交中没有与之对称的失败/player 断言或 lose-message golden。单独破坏 `playerEffect()` 的 terminal fallback 后，rules + KB4 sim 合计仍为 `32 pass / 0 fail`。因此验收指定的“胜利/失败消息帧倒下一方保持终态”只保护了一半；把失败路径改坏不会变红。

最小修法是增加真实失败流程的状态及语义像素断言（必要时加 losemsg golden），并用 player-only 回退变异确认测试失败。

### H1. 新增代码和提交信息含 Fleet 任务号

- `rg -n "review-task-[0-9]+|fleet/[0-9]+|/var/tmp/fleet/[0-9]+" src tests tools README.md findings/KB4.md` 命中 `findings/KB4.md:104,125`、`tools/kb4-quickjs-bench.rs:2,65`、`tools/kb4-quickjs-bench.sh:3`、`tests/battle-ui-bundle-isolation.test.ts:33`、`tests/kb4-battle-sim.test.ts:311,383,388,469`。其中 `tools/kb4-quickjs-bench.rs:65` 还把 scratch 路径硬编码为 `/var/tmp/fleet/1921-...`。
- `git log --format=fuller 772baa5..HEAD` 显示 `e63fca5`、`cc38e7a`、`c1d6edf`、`3dac997` 四个提交的正文分别包含 `review-task-1919.md B1/B2/B3`；subject 虽无号码，完整提交信息仍有。

规格 `/var/tmp/fleet-specs/pocket-tuxemon/kit-KB4-fix1.md:10-11` 明确要求“代码与提交信息无 fleet 任务号”。当前不成立，单独足以判 FAIL。需移除新增文件中的任务号/任务路径，并重写这四个本地提交正文（不 push）。

## B1：实现、QuickJS 与像素核对

两种要求的方法都使用真实 PocketJS desktop Runtime/QuickJS，而不是 Bun/JSC：

```text
$ tools/kb4-quickjs-bench.sh
480x272 command/hit/faint: create/destroy/insert/remove = 0/0/0/0
960x544 command/hit/faint: create/destroy/insert/remove = 0/0/0/0
maximum observed QuickJS frame ~= 0.454 ms
test result: ok. 1 passed; 0 failed

$ CARGO_TARGET_DIR=... POCKETJS_DIST=... cargo test --release \
    kb4_quickjs_bench::battle_frame_and_node_churn -- --ignored --exact --nocapture
480x272 command/hit/faint: create/destroy/insert/remove = 0/0/0/0
960x544 command/hit/faint: create/destroy/insert/remove = 0/0/0/0
maximum observed QuickJS frame ~= 0.633 ms
test result: ok. 1 passed; 0 failed
```

受击第 1 帧、换行点和完成点，以及倒下第 1 帧到完成点的结构行为在当前实现中均为 0；单空格与空串的关键帧逐像素一致。因此 B1 的**修法成立**，但 B1-R 所述 legend regression/benchmark assertion 不成立。

## B2：实时取消键、地图行为与 bundle

- `src/ui/GameView.tsx:484-510` 在 `scene() !== null` 时注册 `confirm` 与 `back`；`tests/fixtures/kb4-battle/rules.ts:264-268` 的技能菜单只读 `cancelEdge`，不再读 CROSS 裸位。左右方向仍读取原始 LEFT/RIGHT，是既有 `BattleInput` 没有 left/right edge 的设计，不是取消键绕过。
- 端到端测试 `tests/kb4-battle-sim.test.ts:478-493` 通过真实 `GameView` 进入技能菜单再按 CROSS，phase 从 `skills` 返回 `command`。临时删除 `scene()` action 分支后该测试变红：`Expected: "command"; Received: "skills"`，断言有辨识力。
- 地图、无 modal、无 scene 的控制没有扩张：用 KB4 setup `skip:true` 分别注入 CROSS 与空输入，结果为 `equal:true`，两次 `scene/modal` 都为 null，player 均保持 `(1,1)`。因此没有把地图 CROSS 错接成行走或取消。
- 共享 `GameView.tsx` 使 Sunstone 从基线 424,830 bytes 变为 425,077 bytes，基线/current SHA-256 分别为 `cb0919f04c4cc1aa60cc2b30c1ca2e6ceaef174d8f84e0b76ebeeb734d12e8fe` / `c2aced0ba2785be65b193db56479edc8a7841ea78ccf9cb5088b0520a3382773`。diff 的增量精确对应 scene confirm/back 分支，且 bundle 无 KB4 distinctive identifier。
- meadow、grow、wander 与真实基线逐字节相同：分别为 341,207 / 434,136 / 447,039 bytes，SHA-256 `c0fcb11c148fa32d9572df9dff0e3e03be48b8f241a44d4b7ed8b3af42670d66`、`972169d3781827fc6c2f8f222a8b4a2bcead58d89c671253985b3330fff04613`、`ae4a2c4f4cc1b4911acaa3e89d5265ae473c37d24d35f7aa6140d84a32bacb2f`。

本轮附加要求已预期 Sunstone 因共享 `GameView` 合理变化；按该要求，B2 全部成立。

## B3：终态、golden 与画面

- 当前 `tests/goldens/kb4-battle.winmsg.png` SHA-256 为 `0388bd494402f02896b6cad67d483e0a96f89a7fd3dea6dbf245d3d99f7cda51`。我按原始分辨率打开它：画面保留玩家与 `You win!`，敌方区域是纯背景，没有重新出现。
- 为对照视觉缺陷，我从修复前 `772baa5` 渲染并打开 `/var/tmp/fleet/old-winmsg-1923.png`（artifact 26948，SHA-256 `9571d60a4046263a3cabece7d051d8a481890df36be49c635a8ff33dc6046ddd`）：同一帧可见完整蓝色敌方，差异清楚。
- intro/hit/faint 也逐张打开：打字揭示、HP 下降/受击位移、下沉淡出均符合语义，没有发现单空格占位痕迹。

所以当前胜/负终态实现和新 winmsg golden 都正确；阻断仅是 B3-R 的失败路径回归缺失。

## 真实倒带与动画中段多 Hz

给 fixture 临时启用空 attract tape 后，通过真实 L 倒带，再重放到同一 tick；只在帧比较时排除展示性的 REWIND overlay：

| 动画位置 | 原帧/重放 FNV | 像素差 | scene state |
| --- | --- | ---: | --- |
| 受击 +3 tick | `ce99d80f` / `ce99d80f` | 0 | 相等 |
| HP 补间 +12 tick | `6b084ed4` / `6b084ed4` | 0 | 相等 |
| 倒下 +15 tick | `a9596e6c` / `a9596e6c` | 0 | 相等 |

精确落在动画中段而非 settled checkpoint 的跨频率结果：

| 动画位置 | 60 / 30 / 20 / 4 Hz |
| --- | --- |
| hit elapsed 30 | 四者均 `7ce0fc5f` |
| faint elapsed 30 | 四者均 `ff493e6c` |

临时 tape 与测试均已还原。因此“倒带到战斗中任意抽查帧一致”和 60/30/20/4 Hz 一致仍成立。

## 门禁、提交与仓库卫生

按强制顺序在最终洁净实现上重新运行，未跳过：

```text
$ bun run build:example
exit 0

$ bun test
895 pass
0 fail
466960 expect() calls
Ran 895 tests across 59 files. [86.31s]

$ bunx tsc --noEmit
(no output)
exit 0
```

- 所有变异都已用 patch 还原；最终 `git status --short --branch` 仅输出 `## fleet/task-1919`，`git diff --check` 无输出。
- `git diff --name-only 772baa5..HEAD -- bun.lock vendor` 无输出；未修改 `bun.lock`、`vendor/` 或 `vendor/pocketjs`。
- 四条修复/文档提交相互分离，作者和提交者都是 `lfkdsk <lfkdsk@gmail.com>`，无 `Co-Authored-By`，未 push。提交正文的任务号违规见 H1。
- README 已记录 `pocket-rpgkit/ui/battle` 与 scene cancel 行为；`findings/KB4.md` 已有“修复 1”节。
- 本任务是通用 UI/runtime 与测试 fixture，不涉及手改 Tuxemon 导入产物，也没有把 Tuxemon 专用逻辑写进组件仓。

修复 B1-R、B3-R、H1 后，应按相同顺序重跑完整门禁、两种 QuickJS 方法、两项定向变异与最终仓库卫生检查。

FAIL
