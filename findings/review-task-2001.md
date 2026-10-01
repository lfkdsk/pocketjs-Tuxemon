# Review: GB6-F2 修复 1（task 1983 + 2001）

审查范围为 `fbd885d..f14d607`；被审 HEAD 为
`f14d607383aca514aaafc4ee5f78cfe504de8059`，其 merge base 为 `1354ca9`。前向检查使用独立
worktree `独立 worktree`，把当前 `main` `4c5cae41ab6b8133fe0b16d6438e8d3af3ae65dc`
以 `git merge --no-commit main` 合入；无冲突，未修改被审实现。

结论：**FAIL**。线程 CPU 时钟及 CPU/sleep 两种注入的核心思路有效，常规构建、测试和 GB6
journey 也通过；但 Wayfarer 搜索没有实现规格要求的未知 transfer 保守双口径，所谓“冻结”
dry-run 会修改全局剧情变量，旧 369 节点路线也没有逐格核完。与此同时，前向合并后两处硬编码
snapshot 帧已发生静默语义漂移，且本次新增源码、测试和提交正文含 fleet 任务号。

## 1. 规格逐项核对

| 项目 | 结论 | 独立证据摘要 |
| --- | --- | --- |
| Wayfarer 使用运行时页/角色/触发格 | 部分成立 | 使用组件仓 `activePage`、`evalCondition`、`tableWithBodies`，当前测试 11/11 通过；但 104 条动态目标 parallel transfer 被静默丢弃，未按“可用/不可用”双口径处理。 |
| Wayfarer 割集与扰动 | 部分成立 | 当前模型在 f107479 得到开放路径 57、去三人区不可达；`v.rivergoto=2` 后外围路径 262、结论翻转。但 generous 静态 parallel 口径其实可达，报告未披露、测试未断言。 |
| 旧 369 节点路线逐格解释 | 不成立 | 旧路径九个事件格中的 Paper Captain 是 `spyder_paper_town@4,14`，新诊断表漏掉它，却加入不在旧路径上的 Leather/Timber/Flower Captain。 |
| 线程 CPU 计时与注入 | 部分成立 | Linux x86_64 上三段 thread CPU 加和及 50 ms 断言有效；80 ms CPU 注入 exit 101，120 ms sleep 注入 exit 0。ABI/错误处理和报告指标仍有问题，见 §3。 |
| 960×544 长 journey 成本结论 | 原报告结论不成立 | 低负载固定核复测 entry 44.533 ms、exit 62.159 ms；仍有一次真实 50 ms 超限，但 81–111 ms 不是稳定的固有成本，且本分支无运行时代码变化，不能称为回退。 |
| 前向合并 | 不成立 | merge 无冲突且测试/journey 通过，但新 tape 整体 +2 帧后测试仍读取旧 f55839/f107479，已不再是声明的两个语义点。 |
| 常规门禁 | 成立 | tsc、build、wasm、194 项测试、desktop build、两条 GB6 验证均通过。 |
| 仓库卫生 | 不成立 | 功能 diff 未改 `bun.lock`/`vendor/`，无本机绝对路径或 Co-Authored-By；但新增内容有多处 `review-task-1976`，并出现在两个提交正文中。 |

## 2. Wayfarer 状态搜索

### 2.1 成立的部分

实现确实调用组件仓的 `activePage`/`evalCondition`，用 `tableWithBodies` 叠加角色身体，并把
playerTouch/action 的边绑定到 `eventOrigin` 计算出的触发位置。原分支独立测试结果为
`11 pass / 0 fail / 297 expect() calls`。f107479 的直接运行结果为：

- 起点 `spyder_route3@4,4`，开放路径 57，经过 Morningstar、Bravo、Victor；移除三者触发区后
  `northReachableWithoutTrainers=false`；
- `parallelFires=0`、`parallelGuarded=51`；
- `v.rivergoto=2` 后不经三人区可达，外围路径长 262。

三项实现变异是在独立 worktree `独立变异 worktree` 做的，恢复后 tracked tree clean：

- 去掉 `tableWithBodies`：9 pass / 2 fail；
- 把所有 origin 统一偏移一格：6 pass / 5 fail；
- 但把 transfer 页选择从 `activePage(...)` 改成固定 `ev.pages[0]`：11 pass / 0 fail；把
  `eventOrigin` 改为始终使用 authored 坐标也同样 11 pass / 0 fail。

因此测试能辨认身体和粗粒度坐标破坏，却没有 fixture 真正钉住“transfer 采用 active page”以及
“live/placed 触发位置不同于 authored 位置”这两个规格核心。

### 2.2 阻断：未知 transfer 的双口径未实现

`collectStaticTransfers` 只在 `map` 为 string 且 `x/y` 为 number 时收集目标；全项目独立遍历为
`playerTouch:static=986`、`parallel:static=61`、`parallel:dynamic=104`、`action:static=1`。104 条
动态目标均未进入 `parallelFires`、`parallelGuarded` 或任何“unresolved”集合，也没有按规格同时
报告“当作可用/不可用”。当前所谓 generous 口径只把 51 条**已知静态目标但 guard=false** 的边
放回图中；该口径在 f107479 去掉训练师后实际得到 `true`，但 §6.1 只报告严格口径的 `false`，测试
也没有断言 `northReachableWithoutTrainersGuardedUsable`。

这不代表 104 条 faint transfer 一定形成绕路；它表示当前工具没有完成规格要求的未知边处理，因而
不能把结果称为“健全图上的证明”。

### 2.3 阻断：dry-run 并未冻结剧情状态

`dryRunEntry` 从 snapshot 克隆 bank 后对每张地图执行 10 次完整 `stepSession`，并把执行后的 `st.sw`
用于 active page 和角色图。独立比较 f107479 snapshot 与 263 张地图的 entry bank，发现 19 张地图的
非 `local.*` 状态被改写，例如 `spyder_dojo4` 把 `v.billie_choice` 从 3 改成 1，
`spyder_candy_town` 新设 `tracker.candy_town=true` 与 `v.seencandy=1`，`route2` 新设
`v.sadsong=1`、`v.skadoosh=2`。这与报告所称“搜索期间剧情变量冻结”不一致；每张地图还各自在
独立克隆上执行，所得图并不是某个一致的全局状态。

作为保守建模，已确认会强制传送的边与普通步行边并列只会扩大搜索图，本身不损害“在超图中仍
不可达”的方向；问题在于上述未收集边和不一致 bank 既可能漏边也可能额外造/消灭阻挡，方向不再
单调。

### 2.4 旧外围路线没有逐格核完

上一轮 369 节点候选路径实际穿过的九格为 Route 3 的 Connor/boulder/Curie，Paper Town 的
Captain/Silver/Billie，以及 Route 4 的 Wulf/Beck/Rosamund；其中 Captain 是
`spyder_paper_town@4,14`。新工具的 `OUTER_CANDIDATE_TILES` 漏掉该格，改列了
`spyder_leather_town@15,19`、`spyder_timber_town@8,22`、`spyder_flower_city@17,31` 三个并不在
旧路径上的 Captain。测试也只断言 Leather Captain 与 Billie 可通，却在报告中扩写成
“leather/timber/paper/flower Captain”都已核验。因此“对旧 369 节点路线逐格给出原因”不成立。

## 3. QuickJS 线程 CPU 计时

Linux x86_64 审查机上 `CLOCK_THREAD_CPUTIME_ID=3` 和当前 `timespec { i64, i64 }` ABI 可工作；
每帧按 guest、core、draw 三段分别取 CPU 时间，budget 比较的是 `js_cpu_ms + core_cpu_ms` 及采样帧
再加 `draw_cpu_ms`，分段位置与加和合理。独立注入结果：

| 探针 | 结果 |
| --- | --- |
| f2091 注入 80 ms CPU | exit 101；battle-entry CPU 102.753 ms、wall 102.769 ms，50 ms 断言变红 |
| f2091 注入 120 ms sleep | exit 0；battle-entry CPU 25.051 ms、wall 145.115 ms，终态 `5653f011…` |

但有三项实现/报告精度问题：

1. `clock_gettime` 返回值被忽略；失败时零初始化的时间会被当作有效值，CPU 注入 busy loop 甚至可能
   不终止。FFI 的 `timespec`/`clockid_t` 还写死成 `i64`/`i32`，不是 Linux ABI 类型 `c_long`/`c_int`。
2. `CASE`/`BUCKET` 的 `qjs_p95`、`qjs_max` 来自 wall 样本；只有 `BUDGET` 的 max 是 CPU。报告把
   960×544 的 battle-entry/exit p95 45–49 ms 称作 CPU p95，没有对应测量支持。
3. `BUDGET ... wall=` 是“CPU 最大帧的 wall”，而非 wall 最大值；§6.2 表头“max wall”会误导。
   另外状态文件在末尾 budget assertion 前已经写出，故“失败时未写出”也不准确。wrapper 未清理
   继承的 `G6_INJECT_*`，且每帧在计时区内读取/解析四个环境变量，给普通基准加入固定开销。

这些不否定 CPU/sleep 注入证明的核心行为，但当前报告把 wall 分位数当 CPU 数据，并把故障路径和
输出字段解释得过强。

## 4. 960×544 长 journey 低负载复测

正式运行前先完成宿主预编译，然后清除四个 `G6_INJECT_*` 环境变量，并以 `taskset -c 15` 固定到
CPU 15。记录的开始时间为 2026-09-30 17:12:51 PDT；`uptime` 是
`load average: 5.11, 8.26, 8.57`（32 个逻辑 CPU），开始前三秒 CPU 15 平均 97.66% idle、同物理核
sibling 31 平均 95.97% idle。运行中抽查的一分钟 load 为 2.51–5.39，进程保持 99.9% CPU，累计
thread CPU 时间与 elapsed 仅差约一秒。

`GB6_BENCH_VIEWPORT="960 544" bash tools/bench-gb6-quickjs.sh` 完整回放 109,981 帧，用时
709.99 s，结果如下：

| 类别 | n | `CASE` wall p95 | thread CPU max（`BUDGET`） | 同帧 wall | 结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| battle-entry | 100 | 40.583 ms | 44.533 ms | 44.533 ms | PASS |
| battle-exit | 100 | 42.253 ms | 62.159 ms | 62.158 ms | **FAIL**（f94568） |

这次比报告在较高负载下的 81.756/110.972 ms 分别低约 46%/44%，entry 也回到此前干净 GB6 审查的
约 44.9 ms。并且 `fbd885d..f14d607` 没有游戏运行时代码变化，只有审查工具、测试和文档变化；所以
没有证据支持“修复引入真实性能回退”，高负载下的 82–111 ms 主要是共享硬件争用抬高了线程实际
CPU 时间。`CLOCK_THREAD_CPUTIME_ID` 能排除 deschedule，却不能排除降频、缓存和内存带宽争用。

另一方面，低负载下仍有一次 battle-exit 达 62.159 ms，因此 960×544 的 50 ms max 门禁确实不稳定，
不能据本次结果宣称“全都低于 50 ms”。准确结论应是：**没有证实软件回退，旧报告的绝对数值与
“真实视口缩放成本”归因过强，但该视口仍存在偶发的真实 CPU budget 超限，需优化或重新定义预算。**

## 5. 前向合并检查

在隔离副本合入 `main` 无冲突。合并后：

- `bun test tests/wayfarer-state-reach.test.ts`：11 pass / 0 fail；
- `verify:gb6:mainline`：PASS，109,983 帧，100 battles（22 trainer + 78 wild），终态
  `d62d1465492219071b0dfcb14e6ba59571c1fed91ce176bb4ccfb749821d3413`；
- `verify:gb6:failures`：PASS；first 3,254 帧；later 65,515 帧，Wanda battle
  f61897–f65224，blockedExit/healed 均为 true。

不过 Wayfarer 测试通过是**静默漂移**，不是兼容：旧 tape 首个 Route 3 checkpoint 为 f55809，
Wayfarer Inn checkpoint 为 f107480；main 新 tape 分别是 f55811 与 f107482。语义等价 snapshot 应从
f55839/f107479 改到 f55841/f107481，而测试仍写死旧常量，只因附近状态稳定而偶然保持绿色。

修复不应直接把常量写成 `+2`。应从 `journey.maps` 定位首个 `name === "route3"` 且
`position === [7,39]` 的 checkpoint，再等待/判定 NPC create pages settled；进入 Wayfarer 前则定位首个
`name === "wayfarer_inn1"` 且 `position === [11,10]` 并取 `frame - 1`。这样下一次重录不会再次静默
读取错误语义点。

## 6. 门禁、卫生与范围

| 门禁 | 独立结果 |
| --- | --- |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | exit 0；4,622 pak entries / 62,192,144 bytes |
| `bun run build:wasm` | exit 0；289,808 bytes |
| `bun test` | 194 pass / 0 fail / 0 skip；71,374 assertions；37 files；235.30 s |
| `verify:gb6:mainline` | PASS；109,981 帧；100 battles；终态 `bd3616c7…` |
| `verify:gb6:failures` | PASS；first 3,357 帧；later 65,500 帧；blocked exit + healed |
| `bun tools/desktop.ts --build-only` | exit 0；release host 构建成功 |
| 短 QuickJS journey（两视口） | exit 0；480×272 CPU max 21.850 ms，960×544 CPU max 25.796 ms；两者终态 `5653f011…` |
| `bun.lock` / `vendor/` | `fbd885d..f14d607` 无 diff；submodule 仍为 `fb3b319d` / `2d2b333b` |

`git diff fbd885d..f14d607` 没有手工改导入产物，没有修改 PocketJS，也没有新增渲染 PNG，故本次
PNG 肉眼检查不适用。没有本机绝对路径或 Co-Authored-By。

卫生门禁本身失败：新增 diff 中 `review-task-1976` 出现在 `findings/GB6-F2.md`、`findings/GB6.md`、
`tests/wayfarer-state-reach.test.ts`、`tools/wayfarer-state-reach.ts`、`tools/g6-quickjs-bench.rs`，两个提交
正文也直接写入该编号；§7 却错误记录“fleet 任务号 / Co-Authored-By：无”。

## 7. 阻断项

1. Wayfarer 未收集/双口径处理 104 条动态目标 parallel transfer，dry-run 又改动 19 张图的全局剧情
   bank；当前结果不能称为规格要求的健全冻结状态图。
2. 旧 369 节点候选路线漏检 `spyder_paper_town@4,14` 的 Captain，报告与测试宣称的逐格解释不完整。
3. 前向合并后两处硬编码 snapshot 帧语义漂移；测试偶然通过，必须改为按 journey checkpoint/事件定位。
4. 新增源文件、测试、文档和两个提交正文含 fleet 任务号，违反明确卫生门禁。

subagent 使用：4 个；分别审计 Wayfarer 状态搜索、线程 CPU 计时、隔离变异测试、main 前向合并；
并行完成独立代码阅读与轻量验证，节省了约两轮串行审查时间；主 agent 复跑全部重门禁与性能数据。

FAIL
