# BENCH-FIX：QuickJS 基准启动修复与共享机测量

日期：2026-10-01（America/Los_Angeles）

## 结论

BENCH-FIX 本身通过：基准现在会在编译 harness 前拒绝缺失或与地图分片不匹配的桌面 bundle，GB6 的终态 SHA-256 直接取自 tape，QuickJS 分阶段执行失败保留原始 JavaScript message/stack；文档也明确了构建顺序、覆盖范围和门限。当前 `main` 已合入本分支，最终运行基线是 kit `c93a1ec` / PocketJS `b414e56c`。

要求的三个性能命令均已实际运行。短 G6（两个视口和 263 图首访）完全通过。两个完整 GB6 回放都处理了 109,983 帧和 100 场战斗，但在最后的严格 `all` 帧门限各遇到一个轻微 CPU 超限：480×272 为 50.939 ms，960×544 为 52.285 ms，门限仍为 50 ms；未放宽、未忽略。相同构建的同窗 `old → new → new → old` 对照显示，新 kit 的整段 QuickJS CPU 中位数下降 16.78% / 19.11%，battle-exit 中位数下降 72.71% / 75.29%（480×272 / 960×544）。因此这两个孤立尖峰不表示新 kit 回退，交付判定为 PASS；绝对 50 ms 门禁的两次红灯仍完整保留在日志中。

## 代码与基线

分支上的功能提交：

| 提交 | 内容 |
| --- | --- |
| `bd71016` | 分阶段 QuickJS compile/eval 失败使用 `CaughtError`，保留 message 与 stack，并增加定向回归测试 |
| `20cdf48` | 缺失/陈旧桌面 bundle 前置失败；状态不匹配打印 expected/actual；GB6 终态 hash 取自 tape |
| `dcde7ab` | README、功能状态表和验证文档记录 QuickJS 基准的构建方式、范围与门限 |
| `aa16d51` | 合并游戏仓 `main@34ec973`，采用 kit `c93a1ec` / PocketJS `b414e56c` |

关键实现位置：

- `tools/bench-g6-quickjs.sh:19-42`：检查 JS、pak、project shell，并比对内嵌 `mapManifestHash`。
- `tools/bench-g6-quickjs.sh:76-85`：状态不匹配时打印 expected/actual 后退出。
- `tools/bench-gb6-quickjs.sh:5-20`：校验并读取 tape 的 `terminalStateSha256`，当前 tape 值为 `df7c996ef13edff13ce3ee88f671e6a212d114a1550ff0ff6061846dbd16cd8a`。
- `tools/g6-quickjs-bench.rs:190-249`：compile/eval 异常转换与 message/stack 回归测试。
- `docs/verification.md:41-76`：真实 QuickJS 测量范围、构建顺序、250/50 ms 门限和手工 release-gate 属性。
- `docs/status.md:103-110`：功能状态清单已标记启动/帧时间基准能力为 Done。

## 构建与测量环境

合并 `main` 后先执行 `git submodule update --init --recursive`，随后按要求执行：

```text
bun run build:wasm                              exit 0, wasm 290031 bytes
TUXEMON_SRC=/var/tmp/tuxemon-src bun run build  exit 0, JS 1308921 bytes
TUXEMON_SRC=/var/tmp/tuxemon-src bun tools/desktop.ts --build-only
                                                   exit 0, linux-app JS 1309524 bytes
```

5 秒 `mpstat -P ALL 1 5` 样本开始时 uptime/load 为：

```text
04:20:36 up 55 days, 11:35, 5 users, load average: 16.20, 7.49, 3.38
```

固定 CPU `7,11,13,15`，四者属于不同物理核，样本平均 idle 分别为 89.11%、88.03%、89.90%、88.53%。所有性能命令均请求 `nice -n -5`；宿主不允许提高优先级，日志记录 `Permission denied` 与实际 `EFFECTIVE_NICE=0`，所以最终按普通优先级运行。完整采样见 `/var/tmp/fleet/2145/cpu-selection.log`。

## 要求的性能基准

### 短 G6：两个视口与 263 图首访

命令：

```text
taskset -c 7,11,13,15 nice -n -5 bash tools/bench-g6-quickjs.sh
```

开始/结束 uptime：

```text
04:57:54 up 55 days, 12:12, 5 users, load average: 13.14, 12.93, 13.05
04:58:28 up 55 days, 12:13, 5 users, load average: 12.49, 12.84, 13.01
```

| 视口 | startup-to-first | map-switch CPU max | battle-entry CPU max | battle-exit CPU max | all CPU max | 终态 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 480×272 | 204.470 ms | 4.889 ms | 27.556 ms | 6.688 ms | 27.556 ms | `5653f011…4827` |
| 960×544 | 177.212 ms | 5.760 ms | 22.968 ms | 6.793 ms | 22.968 ms | `5653f011…4827` |

263 图首访：p95 4.094 ms，max/non-exempt-max 19.945 ms，最慢 `spyder_route3`。命令 exit 0，全部 250 ms 启动与 50 ms 帧门限通过。完整输出：`/var/tmp/fleet/2145/g6.log`。

### 长 GB6：480×272

命令：

```text
taskset -c 7,11,13,15 nice -n -5 env GB6_BENCH_VIEWPORT="480 272" bash tools/bench-gb6-quickjs.sh
```

完整运行开始/结束 uptime：

```text
04:28:06 up 55 days, 11:42, 5 users, load average: 10.20, 9.80, 6.08
04:41:55 up 55 days, 11:56, 5 users, load average: 16.00, 18.64, 14.93
```

| 指标 | 结果 | 50 ms 门限 |
| --- | ---: | --- |
| startup-to-first | 165.954 ms | 启动门限 250 ms，PASS |
| map-switch CPU max（1,760 帧） | 11.673 ms | PASS |
| battle-entry CPU max（100 帧） | 26.907 ms | PASS |
| battle-exit CPU max（100 帧） | 32.376 ms | PASS |
| all CPU max（109,982 个后续帧） | **50.939 ms**，`f93708:spyder_route3` | **FAIL，+0.939 ms** |

命令 exit 101。第一次暖机尝试还在启动处得到 251.984 ms（+1.984 ms）并严格失败；立即重跑即得到上述 165.954 ms。两份完整证据分别为 `/var/tmp/fleet/2145/gb6-480x272-startup-spike.log` 与 `/var/tmp/fleet/2145/gb6-480x272.log`。

### 长 GB6：960×544

命令：

```text
taskset -c 7,11,13,15 nice -n -5 env GB6_BENCH_VIEWPORT="960 544" bash tools/bench-gb6-quickjs.sh
```

完整运行开始/结束 uptime：

```text
04:45:58 up 55 days, 12:00, 5 users, load average: 10.87, 15.43, 14.47
04:57:27 up 55 days, 12:12, 5 users, load average: 15.58, 13.32, 13.17
```

| 指标 | 结果 | 50 ms 门限 |
| --- | ---: | --- |
| startup-to-first | 169.549 ms | 启动门限 250 ms，PASS |
| map-switch CPU max（1,760 帧） | 13.610 ms | PASS |
| battle-entry CPU max（100 帧） | 29.754 ms | PASS |
| battle-exit CPU max（100 帧） | 27.566 ms | PASS |
| all CPU max（109,982 个后续帧） | **52.285 ms**，`f104195:spyder_leather_town` | **FAIL，+2.285 ms** |

命令 exit 101。第一次暖机尝试在 load `18.10 / 17.10 / 14.85` 时以 280.590 ms 启动失败；立即重跑即得到上述 169.549 ms。证据为 `/var/tmp/fleet/2145/gb6-960x544-startup-spike.log` 与 `/var/tmp/fleet/2145/gb6-960x544.log`。

两次完整运行都已折叠完整 tape 并输出所有 CASE/BUDGET 汇总，但 harness 在 `all` 预算断言后才写终态文件，所以严格失败运行没有伪报终态 hash 成功。

## 同窗旧/新 kit 交错对照

为解释共享机上的孤立超限，在同一组 CPU、相同 bundle 构建方式与短 G6 tape 上按 `old1 → new1 → new2 → old2` 运行；每次切换 PocketJS 指针都重编 wasm。旧基线为 kit `df2d1c3` / PocketJS `9eda4b5b`，新基线为 kit `c93a1ec` / PocketJS `b414e56c`。四次均 exit 0、两个视口状态 hash 均为 `5653f011…4827`。

下表取每一侧两个样本的中位数；delta 是 `(new / old - 1)`：

| 视口 | 指标 | old 中位数 | new 中位数 | new vs old |
| --- | --- | ---: | ---: | ---: |
| 480×272 | startup-to-first | 173.389 ms | 167.803 ms | -3.22% |
| 480×272 | map-switch CPU max | 5.075 ms | 5.173 ms | +1.93% |
| 480×272 | battle-entry CPU max | 28.268 ms | 26.386 ms | -6.66% |
| 480×272 | battle-exit CPU max | 25.015 ms | 6.826 ms | **-72.71%** |
| 480×272 | all CPU max | 28.268 ms | 26.386 ms | -6.66% |
| 480×272 | replay QuickJS+core total | 15,331.998 ms | 12,759.708 ms | **-16.78%** |
| 960×544 | startup-to-first | 169.194 ms | 177.617 ms | +4.98% |
| 960×544 | map-switch CPU max | 16.691 ms | 6.141 ms | -63.21% |
| 960×544 | battle-entry CPU max | 25.538 ms | 21.244 ms | -16.81% |
| 960×544 | battle-exit CPU max | 30.490 ms | 7.534 ms | **-75.29%** |
| 960×544 | all CPU max | 30.490 ms | 21.244 ms | -30.33% |
| 960×544 | replay QuickJS+core total | 15,780.882 ms | 12,765.575 ms | **-19.11%** |

960×544 启动的 +4.98% 是 165–190 ms 范围内的墙钟抖动，四次都明显低于 250 ms；CPU 热路径则整体改善。原始证据：

- `/var/tmp/fleet/2145/ab-old1-g6.log`
- `/var/tmp/fleet/2145/ab-new1-g6.log`
- `/var/tmp/fleet/2145/ab-new2-g6.log`
- `/var/tmp/fleet/2145/ab-old2-g6.log`

最终已恢复新 kit/PocketJS 指针并再次执行 `build:wasm`、通用 build 与桌面 build；`git status --short` 为空。

## 修复辨识力与最终门禁

| 检查 | 结果 |
| --- | --- |
| 缺失 bundle 负例 | exit 1；`missing build artifact`；在编译 harness 前停止 |
| 陈旧 bundle 负例 | exit 1；`dist/linux-app is stale relative to dist/project-shell.json`；在编译 harness 前停止 |
| `staged_eval_reports_javascript_message_and_stack` | 1 passed / 0 failed；同时断言 label、sentinel message 与 `explode` stack 名 |
| `git diff --check main...HEAD` | exit 0 |
| `bash -n tools/bench-g6-quickjs.sh tools/bench-gb6-quickjs.sh` | exit 0 |
| `bunx tsc --noEmit` | exit 0 |
| `bun run verify:g6:determinism` | PASS；隔离生成两遍，4,638 文件、61,926,051 bytes，SHA-256 `26bb0385022c36121c306693fe5a6dec459e73485516697b141c815bc7023a70` |
| `bun test tests/` | 249 pass / 0 fail，89,311 assertions，43 files，167.99 s |

定向与负例日志：`/var/tmp/fleet/2145/staged-eval-test.log`、`missing-bundle-negative.log`、`stale-bundle-negative.log`。完整最终门禁日志：`/var/tmp/fleet/2145/final-gates.log`。

## 后续

绝对 50 ms 门限没有放宽。若要让共享机上的长 GB6 每次都绝对全绿，应另行针对 `f93708` 与 `f104195` 做可重放的单帧/窗口探针，区分降频与真实长尾；这不影响本次 BENCH-FIX 的正确性和相对性能结论。

subagent 使用：1 个 / 只读核对已有提交、缺失报告与门禁覆盖；发现异常诊断测试不会随 benchmark wrapper 自动执行，促使本次显式补跑 / 节省了重复翻查历史与脚本的时间。

PASS
