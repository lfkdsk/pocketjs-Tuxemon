# 审查 task 1966（KR2：倒带关键帧）

被审分支 `fleet/task-1966`，基线 `e569315`，规格 `/var/tmp/fleet-specs/pocket-tuxemon/kit-KR2-rewind-keyframes.md`。

## 逐条对照

### 1. 关键帧不被污染 — 成立

- `captureKeyframe`（`src/engine/attract.ts:535-574`）对 `SessionState` 用 `deepClone`（`src/engine/clone.ts:10-29`，真正递归深拷贝，非浅拷贝）后再存入 payload；`held mask`（`lastFolded`）、`firstDivergence`、`demoFrame`、`endHold`、`readHold`、`displayTicks`、`pacingTicks`、`stage` 都是基本类型字段，按值存储，不存在引用别名问题。
- 做了别名变异（把 `deepClone(this.state)` 改成裸引用 `this.state`，`src/engine/attract.ts:540`）后 `bun test tests/attract-keyframe.test.ts` 仍 7/7 全绿——不是本任务的漏洞，而是组件仓早先 PR#1 的写时复制（`session.ts:896-926`、`chars.ts:204-227` 的 `OWNED`/`ownChar`）本身保证了跨帧从不就地修改旧状态的可变子结构，所以即使不做防御性深拷贝也不会污染。`deepClone` 是合理的防御性选择，但据此确认「关键帧污染」这一类风险在当前引擎设计下已被更底层的不变式挡住，不算本任务独有的正确性依据；已改回验证结论不受影响。
- 还原路径 `restoreTimeline`（`src/engine/attract.ts:630-675`）逐字段显式还原 `sourceFrame`/`demoFrame`/`endHold`/`displayTicks`/`pacingTicks`/`stage`/`lastFolded`/`firstDivergence`/`readHold`，字段列表与 `AttractKeyframe` 接口（`src/engine/attract.ts:203-213`）一一对应，未发现遗漏字段。

### 2. 等价测试的辨识力 — **部分成立，发现一个真实覆盖缺口**

`tests/attract-keyframe.test.ts` 的整体设计是对的：oracle 用 `keyframeMaxBytes: 0` 强制从零重折叠（`create()` 帮助函数，:60-74），`observable()`（:78-87）比较完整 canonical state + `status()`（含 `rewindNotice`/`controlNotice`/`idle`/`loopReset`/`rewound`）+ `presentedModal()` + `foldedMask()` + `inputLog`；覆盖了 60/30/20/4 Hz、真实 Sunstone tape、takeover 后连续两次倒带、地图/战斗边界、字节淘汰后回退到 frame 0——这些都复核为真（见下方“复跑结果”）。

但是**采样目标帧从未落在“恰好等于某个保留关键帧的 `timelineFrame`”这一点**（即 `lastRefoldFrames === 0` 的空后缀倒带）。用变异验证：

- 删掉 `restoreTimeline` 里唯一一行 `this.lastFolded = keyframe?.lastFolded ?? 0;`（`src/engine/attract.ts:639`），`bunx tsc --noEmit` 仍 0 错误，`bun test tests/attract-keyframe.test.ts` 仍 **7 pass / 0 fail**（复跑两次确认）。
- 用独立探测脚本证实这是一个可观察的真实回归，只是现有测试从未命中：构造 tape 使 `mask[0..9]=BTN_UP`、`mask[10..)=BTN_DOWN`，`keyframeIntervalFrames=10`、`rewindSeconds=10/60`（=10 帧），在 `length=20` 时按 L：目标 `target=10` 恰好等于关键帧的 `timelineFrame`（后缀长度 0）。
  - 原始代码（含该行）：`foldedMask()` 倒带后 = `16`（BTN_UP，正确，等于关键帧保存时的 `lastFolded`）。
  - 删除该行后：`foldedMask()` 倒带后 = `64`（BTN_DOWN，倒带前的残留值，**错误**）。
  - 命令与输出见下方“变异复现”。
- 根因：`restoreTimeline` 循环体里 `if ((flags & T_SOURCE) || !(flags & T_DISPLAY)) { this.lastFolded = this.logBuf[i]!; ... }` 和 `this.stage = (flags >>> 5) as PresentationStage;` 是**无条件覆盖**，只要后缀非空就会用循环里的值把任何错误的初始值“自我纠正”掉；只有后缀长度为 0（目标恰好落在关键帧那一帧）时，`restoreTimeline` 开头那行显式赋值才是唯一的真相来源。现有 8 个测试里的所有倒带目标都被特意选成“触发点 - rewindFrames”落在保留窗口内部而非边界（`503/811/...` 这类质数式选点，`keyframeIntervalFrames` 用 97/29/23/37/2/1000 等，两者从未对齐）。
- 结论：这不是已发运行时代码里的功能缺陷（当前 `attract.ts:639` 那行确实存在且正确），而是**等价测试对“关键帧边界 ±0”这一规格明确要求的场景没有辨识力**——规格与审查指引都点名要求覆盖“关键帧边界前后 ±1”，而该套件在“后缀长度恰为 0”这一点上不会变红，等价于没有测到。若未来重构不小心删掉这一行（或类似的“仅在空后缀才生效”的初始化），当前测试矩阵不会捕获。

### 3. 内存预算 — 成立

- `keyframeMaxBytes` 默认 8 MiB（`ATTRACT_KEYFRAME_MAX_BYTES`，:86），FIFO 最旧优先淘汰（`captureKeyframe`，:560-573），淘汰后目标早于保留窗口显式回退到 frame 0（`refold`/`keyframeAtOrBefore`，:576-602，`keyframe` 为 `undefined` 时用 `startSession` 从零开始）。
- 淘汰策略确定：给定同一输入序列与预算，`captureKeyframe` 只依据 `sourceFrame`/字节估算做决定，与 hz/机器无关；`tests/attract-keyframe.test.ts:107-129` 用 60/30/20/4 Hz 验证同一 tape 产生完全相同的关键帧 `sourceFrame`/`timelineFrame`/`interval` 序列，复跑确认通过。
- README/CHANGELOG 准确描述了 8 MiB 默认值、FIFO 淘汰与 frame-0 回退（见下方门禁复跑）。
- 存档格式未改：`grep keyframe src/engine/save.ts src/host/save-fs.ts` 无命中；`SAVE_FORMAT = "rpgkit-save/v1"` 未变。

### 4. 性能复测（QuickJS）— 成立，数字可复现

本机装了 rustup 工具链（`~/.cargo/bin` 未在默认 PATH，手动加入后可用），实际跑了 `tools/kr2-quickjs-bench.sh`（真实 rquickjs 桌面宿主，非 Bun/JSC）：

```
KR2_QJS_REWIND case=short rounds=7 ... refold_frames=197 keyframes=1 keyframe_bytes=1022 median_ms=16.088 max_ms=16.236
KR2_QJS_REWIND case=long  rounds=7 ... refold_frames=2620 keyframes=27 keyframe_bytes=25478 median_ms=67.051 max_ms=68.597
KR2_QJS_FRAME frames=240 keyed_steady_mean_ms=0.0327 keyed_steady_max_ms=0.0405 keyframe_spike_ms=0.1947
```

与报告数字（短 tape median 14.121 ms、长 tape median 67.093 ms、尖峰 0.1778 ms）同量级、误差在正常的机器抖动范围内；长 tape 后缀 2,620 帧 < 3,600 帧门槛，尖峰 0.1947 ms < 5 ms 门槛，两条验收目标复核为真。scratch 路径确认使用 `${XDG_CACHE_HOME:-$HOME/.cache}/pocket-rpgkit-bench/kr2-quickjs`，未写死本机路径。

### 5. 门禁 — 全部复跑通过

- `bun run build:example`：成功（所有 fixture 构建完成）。
- `bun test`：**922 pass, 0 fail, 467865 expect() calls**，无 skip，与报告一致。
- `bunx tsc --noEmit`：exit 0。
- `tools/pr1-equivalence.sh`：`PR1_EQUIV PASS scenarios=37 states=12376`。
- goldens：`git diff e569315 --name-only | grep -i golden` 无输出，framebuffer golden 未变。
- README/CHANGELOG：核对了 `README.md`、`src/engine/README.md`、`src/data/CHANGELOG.md` 的新增段落，内容与实现（8 MiB 默认值、3,600 帧间隔、地图/战斗边界捕获、FIFO 淘汰、frame-0 回退、keyframe 不进存档）一致，无夸大或过时描述。
- `bun.lock`：`git diff e569315 --stat -- bun.lock` 无输出，未改。
- 无 fleet 任务号、无本机路径写死：`grep -rniE "task-19|/home/tangollvm|fleet.task"` 在 src/tools/findings/README 中无命中。
- 提交：4 个功能/文档提交，逐步提交、信息符合仓库风格，无 Co-Authored-By 尾注。
- 无 Tuxemon 专用代码：diff 中出现的 "Tuxemon" 字样均为基线已有的历史注释（`interpreter.ts`/`types.ts`/`pathfind.ts` 等），KR2 本身未新增任何 Tuxemon 特化代码；`vendor/pocketjs` 未改（`git diff e569315 --stat` 中不含该路径）。

## 变异复现（可重复执行）

```bash
# 1) 删除 restoreTimeline 里的 held-mask 还原行
sed -n '636,640p' src/engine/attract.ts
#   this.pacingTicks = keyframe?.pacingTicks ?? 0;
#   this.stage = keyframe?.stage ?? 0;
#   this.lastFolded = keyframe?.lastFolded ?? 0;   <- 删除这一行
#   this.firstDivergence = keyframe?.firstDivergence ?? Infinity;

bunx tsc --noEmit                       # exit 0（类型仍然过）
bun test tests/attract-keyframe.test.ts # 7 pass, 0 fail —— 未变红
```

独立探测（构造精确落在关键帧边界的倒带目标，绕开仓库测试的采样盲区）复现了 `foldedMask()` 从正确的 `16` 变成错误的 `64`；命令与完整输出已在上方“等价测试的辨识力”一节给出。复现后已用 `git checkout -- src/engine/attract.ts` 还原，`git status --short` 确认工作区干净、无残留改动。

## 阻断项

1. **等价测试对“空后缀（目标恰落在关键帧 `timelineFrame`）”这一规格明确要求的边界场景没有辨识力。** `restoreTimeline` 中 `lastFolded`（以及同结构的 `stage`）的恢复只有在后缀长度为 0 时才依赖关键帧里保存的值，其余情况会被循环体的无条件赋值自我纠正；现有 8 个用例的倒带触发点与 `keyframeIntervalFrames` 全部刻意/巧合地错开，从未采样到这一点。用删除该行的变异验证：`bunx tsc --noEmit` 通过、`bun test` 全绿，说明该场景对当前代码的回归没有检测能力。当前已发代码在这一行上是正确的，不是功能缺陷，但不满足规格第 2 条与审查指引要求的“采样目标帧覆盖关键帧边界前后 ±1”。建议补一个显式用例：`rewindSeconds` 精确等于 `keyframeIntervalFrames / tapeHz`（或用等价手段构造后缀长度恰为 0 的倒带），断言 `keyframeStats().lastRefoldFrames === 0` 且 `foldedMask()`/`presentedModal()` 与 oracle 一致。

## 其余观察（非阻断）

- `deepClone` 深拷贝关键帧的 `SessionState` 是合理的防御性设计，但经变异验证，当前状态模型的写时复制不变式（PR#1）已经保证了即使不做深拷贝也不会污染——这本身是好消息，但也说明“关键帧不被污染”这条验收更多是在验证既有不变式，而非 KR2 新增的保护；建议在 README 里补一句这层依赖关系，便于未来改动 chars/interp 的写时复制实现时意识到关键帧也依赖它。

FAIL
