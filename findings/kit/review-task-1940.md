# Review task 1940：KR1-hz

- 审查范围：`b927ca8..bcaab2588b2a0f246a84722f3115c0d7acdcf8df`
- 规格：`/var/tmp/fleet-specs/pocket-tuxemon/kit-KR1-hz-test.md`
- 审查日期：2026-09-30
- 结论：**PASS**

## 阻断项

无。

## 逐条规格核对

| 要求 | 结果 | 证据 |
|---|---|---|
| 同一淡出传送在 60/30/20/4 Hz 记录准备调用次数与参考 tick | 成立 | `tests/map-repository.test.ts:284-330` 分别运行四档 hz 并按宿主帧记录 `meta` / `step` / `acquire`；`:338-398` 按 `ticksPerFrame` 将有序调用重建到参考 tick；`:407-430` 得到并比较四档 profile。 |
| 四档轨迹完全相同，且钉住具体准备单元 tick | 成立 | `tests/map-repository.test.ts:420-430` 对每档断言 `stepTicks === [1, 2]`、`prepares === 12`、`metas === 13`，再去掉 `hz` 后要求序列化 profile 只有一种。这里比较的是 repository 调用轨迹，不只是最终 reducer 状态。 |
| fade 期间不发生整帧 `acquire` | 成立 | `tests/map-repository.test.ts:297-306` 区分整图 `acquire` 与分步 `acquireStep`；`:426` 对每档断言 `fullAcquires === 0`。追踪在 `startSession` 之后才启用，因此初始地图载入不会污染计数，而传送 swap 的 fallback 会被计入。 |
| 复现 `sess.hz >= 30` 门控变异 | 成立 | 本次审查实改 `src/engine/session.ts:968` 为 `if (transfer && sess.hz >= 30)`；定向测试 exit 1：`error: hz 20 frame 0 tick 1: expected meta, saw nothing (frame trace [])`，`0 pass / 1 fail / 5 expect() calls`。 |
| 复现每宿主帧只准备一次的变异 | 成立 | 本次审查把准备调用从 `stepReferenceTick` 移至 `stepSession` 的 tick 循环前；定向测试 exit 1：`error: hz 30 frame 0 tick 1: expected meta, saw nothing (frame trace [])`，`0 pass / 1 fail / 3 expect() calls`。 |
| 独立第三变异 | 成立 | 本次审查把每参考 tick 的调用次数改为 `sess.ticksPerFrame` 次；定向测试 exit 1：`error: hz 30 frame 0: 2 unexpected event(s) [\"meta\",\"step\"]`，`0 pass / 1 fail / 3 expect() calls`。这直接验证了测试能抓住“准备单元数依赖宿主 hz”的另一种实现错误。 |
| 变异全部还原，原测试恢复为绿 | 成立 | 还原后执行 `bun test tests/map-repository.test.ts -t "reference ticks at every host hz"`：`1 pass / 0 fail / 26 expect() calls`；随后 `git diff --exit-code -- src/engine/session.ts` 为 exit 0。 |
| 不改实现 | 成立 | `git diff --name-status b927ca8..bcaab25` 只输出 `A findings/KR1-hz.md` 与 `M tests/map-repository.test.ts`；`git diff --exit-code b927ca8..bcaab25 -- src` 为 exit 0。 |

## 测试设计审阅

新增测试确实断言了调度轨迹。包装 repository 把每个宿主帧内的调用保留为有序事件；恢复器逐个参考 tick 消耗这些事件，所以把准备移出参考 tick 循环、按 hz 门控，或按 `ticksPerFrame` 重复准备，都会在具体 tick 上产生缺失或额外事件。最终地图断言（`tests/map-repository.test.ts:409-410`）只是辅助检查，不是该测试判断正确性的唯一依据。

有一项非阻断的脆弱性意见：`reconstruct` 在 `tests/map-repository.test.ts:338-398` 复制了当前 fade 状态机，并把“每个 fade-out tick 一次 manifest `meta`、前两次调用 `acquireStep`、swap 再一次 `meta`”写死。因此，下列保持产品不变量的合法重构也可能让测试误报：缓存 `meta`、改变 repository 内部分步数量、准备完成后停止空的 `prepareSessionMapStep` 调用，或调整 fade 内部阶段而仍让四档在相同参考 tick 执行相同准备。当前任务明确要求钉住参考 tick，现有实现也与这些精确断言一致，所以不要求本任务修改；后续若重构加载器，宜给调度器增加测试专用 trace seam，直接记录参考 tick 与“准备一个单元”，减少对 repository 内部调用形状的代理依赖。

另一个小的文档元数据偏差不影响验收：`findings/KR1-hz.md:5` 把分支 HEAD 写为 `ad509f5`、称两个提交；实际被审 HEAD 是新增报告提交后的 `bcaab25`，范围内共三个提交。功能提交与报告内容本身均在审查范围内。

## 门禁复跑

严格按要求先构建 example 和 wasm，再运行全测：

```text
$ bun run build:example
... PocketJS build: done
exit 0

$ bun run build:wasm
$ bun vendor/pocketjs/tools/wasm.ts
Finished `release` profile [optimized] target(s) in 0.01s
PocketJS wasm: hosts/web/pocketjs.wasm (289560 bytes, 282.8 KiB)
exit 0

$ bun test
905 pass
0 fail
467558 expect() calls
Ran 905 tests across 60 files. [96.56s]
exit 0

$ bunx tsc --noEmit
(no output)
exit 0
```

`bun test` 输出没有 skip 项或 skip 汇总，故为 0 skip；作者报告的 905 pass / 0 skip 得到复现。新增用例在全测中单独显示为 pass。

## 范围与仓库卫生

- `git diff --exit-code b927ca8..bcaab25 -- src bun.lock vendor`：exit 0；实现、`bun.lock` 与 `vendor/` 均未改。
- `git submodule status --recursive`：`vendor/pocketjs` 为 `76ae741fb8fcda8da89ef65b4af7db654670ce9e`。
- 三条提交信息分别为 `test: pin fade-out preparation scheduling to reference ticks across host hz`、`test: fix fade replay narrowing in hz scheduling test`、`docs: report on hz-independent fade-out preparation test`；无 fleet 任务号、AI 尾注或 Co-Authored-By。
- `git diff --check b927ca8..bcaab25`：exit 0。
- 本任务只加单元测试与文字报告；无性能指标、渲染产物、导入产物或 Tuxemon 专用组件代码，因此通用审查模板的 QuickJS、肉眼画面、自动导入三项不适用。

PASS
