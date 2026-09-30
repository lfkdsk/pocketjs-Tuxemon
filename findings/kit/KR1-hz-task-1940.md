# KR1-hz：钉住「淡出期分步准备与 hz 无关」

- 任务：1940（组件仓小任务，补 KR1-perf 审查 §4.1 变异 2 发现的测试缺口）
- 基线：`main` = `b927ca8`
- 分支 HEAD：`ad509f5`（2 个提交，仅改 `tests/map-repository.test.ts`，+169 行）
- 日期：2026-09-30

## 结论

新增测试 `tests/map-repository.test.ts` —「fade-out preparation units are scheduled by reference ticks at every host hz」，直接钉住审查发现的缺口：**同一个带淡出的传送，在 60/30/20/4 Hz 下，`acquireStep` 的调用次数与发生的参考 tick 完全相同，且 fade 期间不发生整帧 `acquire`**。两个变异（hz 门控、每宿主帧一次）都让新测试变红，还原后全绿。实现未改（测试没有揭示真实缺陷——调度本来就是对的，缺的只是看守它的测试）。

## 测试怎么工作

1. 构造与既有「a faded transfer prepares fixed units」相同的场景：fixture 第一张图的 action 事件触发 `transfer`，`fade = 0.4`（fadeFrames = 24，half = 12 参考 tick）。
2. 用包装 repository 记录**每个宿主帧内**的有序事件流：`meta`（`prepareSessionMapStep` 每个参考 tick 的清单检查，外加 swap 时 `acquireSessionMap` 的一次）、`step`（一次 `acquireStep` 单元）、`acquire`（整帧 acquire）。
3. 在 60/30/20/4 Hz 各跑一遍（首帧 `confirmEdge`，之后空输入），然后**按规格在事件流上重放淡出状态机**，重建每个 `step` 事件的参考 tick：输入边沿只在每帧第一个参考 tick 送达，所以 transfer 命令在四个 hz 下都执行于 tick 0（用 60 Hz 首帧后 `fade.left === half` 校准证明），淡出状态机从 tick 1 开始；淡出期每 tick 恰好一次 prepare（一次 `meta`），前两次 prepare 各跑一个 `acquireStep` 单元，fade-out 归零的 tick 上 swap（再一次 `meta`）。
4. 断言四档完全一致：
   - `stepTicks` 深等于 `[1, 2]`（两个单元分别在淡出第 1、2 个参考 tick）；
   - `prepares === 12`（淡出 12 个 tick 每 tick 一次）、`metas === 13`（12 次 tick 检查 + 1 次 swap 检查）；
   - `fullAcquires === 0`（fade 期间没有整帧 acquire）；
   - 四档 profile（去掉 `hz` 字段后）JSON 完全相同。

关键：状态 parity 测试抓不住这类变异（fallback 路径产出的字节/MapDef 与分步路径完全相同，状态永远一致），所以本测试断言的是**调度轨迹本身**（哪个参考 tick 发生了哪次 repository 调用），而不是状态。

## 变异（都已还原，`git diff` 干净）

### (a) `sess.hz >= 30` 门控

`session.ts` 淡出分支：`if (transfer && sess.hz >= 30) prepareSessionMapStep(...)`（hz < 30 跳过分步，swap 时退回整帧 acquire）。

```
$ bun test tests/map-repository.test.ts -t "reference ticks at every host hz"
error: hz 20 frame 0 tick 1: expected meta, saw nothing (frame trace [])
 0 pass
 22 filtered out
 1 fail
 5 expect() calls
```

变红位置：hz 20 首帧第二个参考 tick（淡出第一个 prepare 应在此发生，但门控把它跳过了）。60/30 Hz 不受影响（`hz >= 30` 成立），20/4 Hz 变红——测试在 20 Hz 处即失败。

### (b) 每个宿主帧只准备一次

把 per-tick 调用从 `stepReferenceTick` 移到 `stepSession` 的 tick 折叠循环之前（每宿主帧至多一次 prepare）。

```
$ bun test tests/map-repository.test.ts -t "reference ticks at every host hz"
error: hz 30 frame 0 tick 1: expected meta, saw nothing (frame trace [])
 0 pass
 22 filtered out
 1 fail
 3 expect() calls
```

变红位置：hz 30 首帧 tick 1——该帧起始时 fade 尚未设置（transfer 在 tick 0 才执行），整帧没有 prepare，而规格要求 tick 1 就有一次。60 Hz 下每帧即每 tick，轨迹恰好不变（仍绿）；30/20/4 Hz 变红。这正是「单元数只由参考 tick 决定」这条不变量被违反的表现。

## 门禁

```
$ bun run build:example   → exit 0, "PocketJS build: done"
$ bun run build:wasm      → exit 0（sim 测试的 preflight 需要，不 build 会自跳过 144 个）
$ bun test                → 905 pass / 0 fail / 0 skip, 467558 expect() calls, 60 files [87.94s]
$ bunx tsc --noEmit       → exit 0
```

- `bun.lock`：未改（worktree 无 `node_modules`，用 `BUN_CONFIG_REGISTRY=https://registry.npmjs.org/ bun install --frozen-lockfile` 安装，`git diff bun.lock` 为空）。
- `vendor/`：未改。worktree 里 `vendor/pocketjs` 子模块未初始化，从主仓本地 clone 并钉在 `76ae741f`（`.gitmodules` 记录的同一提交）；wasm 构建产物在子模块目录内，父仓不可见。
- 代码与提交信息无 fleet 任务号；提交按仓库风格（`test: …`），无 AI 尾注。
- 实现零改动（`src/` 无 diff）；变异均已还原。

## 提交

- `006f325` test: pin fade-out preparation scheduling to reference ticks across host hz
- `ad509f5` test: fix fade replay narrowing in hz scheduling test

PASS
