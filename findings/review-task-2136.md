# Review D2 (task 2136): 昼夜运行时

Reviewer: task 2201 (relay/seed). Reviewed branch `fleet/task-2092` (17 commits, merge-base `b832794`). All gates and verifies re-run by the reviewer; 1 subagent used for the upstream Tuxemon semantics comparison (read-only), its conclusions verified line-by-line by the reviewer.

## 逐条对照规格

### 1. 运行时（纯 reducer，参考 tick 驱动）

**时钟接入、codec 与旧存档迁移 — 成立**

- `ClockState`/`WeatherState` 接进 `TuxemonExtensionState`（`battle/extension.ts:89-92`）；运行态用 v2 packed string（`extension.ts:451-458`），磁盘存档保留 versioned v1 object codec。
- 旧存档迁移：`migrateV1`（`extension.ts:561-581`）——无 clock/weather 的旧档补固定默认起始时刻 `2024-06-15 09:00`；只有其中一个字段的半迁移档**拒绝**而非静默覆盖。测试：`tests/battle-extension.test.ts:349-380`（legacy → 默认 clock + sunny + seed `0x9e3779b9`，丢弃 inventory/money；半迁移抛 "clock and weather must either both be present or both be absent"）。

**60 Hz 参考 tick 推进 — 成立**

- `DEFAULT_TICKS_PER_GAME_MINUTE = 3600`（`battle/time-weather.ts:10`）= 1 游戏分钟/真实分钟。
- 时钟由每张地图末尾追加的 terminal parallel ticker 推进（`importer/project.ts:2642-2718`，事件 id `tux_runtime_time_weather`）；kit 的 `scanTriggers` 每个参考 tick 重启已结束的 parallel fiber（`vendor/pocket-rpgkit/src/engine/interpreter.ts:2084-2087`），fold 顺序为 scanTriggers → parallels（`interpreter.ts:3790-3800`），所以页面选择先于本 tick 的时钟推进。
- 暂停/无帧不走：parallel 只在活动参考 tick fold；fade 与默认冻结的 battle 场景推进参考钟但不推进世界（`session.ts:1249` 附近），测试 `tests/time-weather-session.test.ts:146-170` 验证 fade 3 帧 + battle 3 帧后 refTick 不变、`pausedTicks` 累加。
- 60/30/20/4 Hz 一致：`session.test.ts:131-144`，四种刷新率各跑 2 秒均推进 120 个参考 tick、民事时间 09:02。
- 存档恢复、L 倒带一致：倒带逐字节相等测试 `session.test.ts:172-197`（rewound 3 帧后与 fresh 3 帧 `toEqual`）；codec round-trip 与各 journey 的 save/restore 检查点覆盖存档恢复。

**固定起始时刻、不读墙钟 — 成立**

- effect shell 只在新游戏时采一次墙钟（`main.tsx:49-51` `timeWeatherFromLocalDate(new Date())`）；reducer/render 之后只读状态。
- grep 运行时代码（`battle/`、`ui/`、`importer/`、kit `src/engine/`）：除 `main.tsx:50` 外无任何 `new Date`/`Date.now`/`performance.now` 进入 reducer 状态（`ui/gp1-marks.ts` 的 Date.now 只写开发标记数组）；kit engine 零命中。
- 测试/journey/CI/QuickJS bench 均注入固定 `2024-06-15 09:00`：`main.tsx:46-48` 读 `__pocketTuxemonInitialCivilTime`；`tools/verify-web-journey.ts:103` 与 `tools/g6-quickjs-bench.rs:291-294` 在 bundle eval 前注入同一全局。

**`time_is` 全属性比较 — 成立**

subagent 对照上游 `tuxemon/event/conditions/time_is.py:58-107`、`tuxemon/time_handler.py`、`tuxemon/tools.py:632-690`，主 agent 逐条复核（含直接读上游源码确认边界）：

| 项 | 上游 | 本仓 | 判定 |
| --- | --- | --- | --- |
| 属性集 | 11 个（10 个 TimeSnapshot 字段 + `date`，`time_is.py:58-107`） | 同 11 个（`time-weather.ts:315,349-360`） | 成立 |
| 三路比较 | numeric float / string equals / date tuple（`time_is.py:69-107`） | 同三路（`time-weather.ts:328-370`） | 成立 |
| 操作符 | 六路 `< <= > >= == !=`，未知操作抛错（`tools.py:632-664`） | 同六路、未知抛错（`time-weather.ts:284-294`），测试 `runtime.test.ts:127` | 成立 |
| stage 边界 | dawn[4,8) morning[8,12) afternoon[12,16) dusk[16,20) night 其余（`time_handler.py:125-137`） | 完全一致（`time-weather.ts:266-272`） | 成立 |
| daytime | `6 <= hour < 18`（`time_handler.py:120-123`） | 一致（`time-weather.ts:260,335`） | 成立 |
| 季节 | 北/南半球阈值 81/173/265/356（`time_handler.py:17-20,143-163`） | 一致（`time-weather.ts:241-250,262`） | 成立 |
| weekday | `strftime("%A").lower()`（`time_handler.py:100`） | 小写全名表，1970-01-01=thursday 校验正确（`time-weather.ts:96-98,239`） | 成立 |
| leap_year | `"true"/"false"`，Gregorian 规则（`time_handler.py:101,108-110`） | 一致（`time-weather.ts:120-122,259`） | 成立 |
| day_of_year | 1-based `tm_yday`（`time_handler.py:96`） | 1-based（`time-weather.ts:238`） | 成立 |
| date 元组 | `map(int, split("-"))` → `(month,day)` 字典序比较（`time_is.py:95-107`） | 同月/日字典序（`time-weather.ts:342-348`），测试含 `2-30`/`3-100` 元组语义 | 成立 |
| 页面条件 tick 投影 | —（上游无此概念） | 页面 `time_is` 条件带 `tickOffset:1`（`project.ts:1022-1035`），与本 tick 稍后提交的时钟在同一分钟/阶段边界一致；fiber 内 guard 保持 offset 0 | 设计合理 |

边界差异（非阻断）：上游 `float()` 接受 Python 下划线数字字面量（`"1_8"`），本仓 `parsePythonFloat` 拒绝（`time-weather.ts:311`）；date 路径同理。已 grep 全部 128 条源 `time_is`（tmx+yaml），**0 条**使用下划线字面量，不可达。上游对未知属性/操作记 error 日志，本仓静默返回 false——返回值一致，仅诊断差异。

**`update_time` 变量 — 成立**

- 写上游同一组 8 个字符串变量 `v.hour/v.day_of_year/v.year/v.weekday/v.leap_year/v.daytime/v.stage_of_day/v.season`（`time-weather.ts:373-388`）= 上游 `update_time.py:45-52`；测试 `runtime.test.ts:132-145` 钉住精确值。
- `character` 默认 `"player"`（`importer/time-weather.ts:132`），上游为必填——良性差异：源里 3 条 `update_time` 全部 target player 且全部在不物化的事件里（由 fixture 测试覆盖）。

**天气 — 部分（与 builder 的 Partial 定位一致）**

- 天气表 10 slug 与源 `mods/tuxemon/db/weather/weathers.yaml` 完全一致（reviewer 直接 grep 源文件核对）。
- 独立 RNG：mulberry32 cursor + saved deadline（`time-weather.ts:390-425`），只消费自己的 cursor，不碰 `SessionState.sw.rng`；stepwise 与 batched fold 一致（`advanceTimeWeather` while 循环锚定 saved deadline）。
- 转移机制（在其余 slug 中均匀随机、时长 30–90 游戏分钟）是 **Pocket Tuxemon 的确定性回退策略**，不是上游的 `trigger_chance`/eligibility 模型。subagent 核实：上游战役**从不**调用 `load_weather`/`set_weather`（grep `mods/` 0 命中），`weather_previsions.yaml` 本身是死内容（缺 `transitions:` 包装 + 默认路径 `.yml` 与实际 `.yaml` 不符），上游战役天气恒为默认 `"sunny"`。因此实际游戏内差异为零，builder 的 Partial 定位诚实。
- 限制：回退策略无温度/季节门控（夏天可能下雪）；无粒子（A 级，已推迟）；P1 天气无视觉/玩法效果。
- 小问题：`DEFAULT_WEATHER_SLUGS` 硬编码，没有测试把它和导入的天气表钉在一起（当前一致）。

### 2. 画面（B 级色调）— 成立

- 用组件仓 KS1 的命名 `screenTint` 层 `tux.daylight`（`battle/daylight.ts:5`），5 个 profile（dawn/morning/afternoon/dusk/night），4 秒交叉淡变；扩展只在阶段边界发布 target，tween 由内置 screen-effect reducer 做。
- **与 `set_layer` 互不覆盖**：`set_layer` 降级为 `op:"layer"`、层名 `tux_overlay`（`importer/project.ts:209,1603-1612`），是地图叠层子系统；daylight 走 `screen.tints["tux.daylight"]`（kit `screen.ts:69` 按名存 record，多色叠加 `screen.ts:143`）。两套机制、两个名字，不可能互相覆盖。
- **reviewer 亲自打开两张 golden**：`tests/goldens/daylight-day.png`（09:00）是正常可读的 Paper Town 早晨场景；`daylight-night.png`（21:00）几何与精灵完全相同但明显更暗、罩蓝纱。
- 语义像素断言（`tests/daylight-visual.test.ts:82-85`）：夜晚亮度 < 白天 75%、蓝偏 +20、>75% 像素变暗、>90% 变蓝；测试自己解码 PNG 像素而非只钉哈希。
- 真实地图长时测试：Paper Town 09:00→20:00，白天 Environment 页消失、两个夜晚页出现、environment `grass`→`night_grass`、`tux.daylight` tween 启动（`session.test.ts:199-262`）。

### 3. 不回退 — 成立

- 输入 tape 未变；状态哈希变化是因为 clock/weather 与 daylight 标记进入 canonical state，builder 用原驱动重录、mask/检查点不变。
- reviewer 全部复跑：

| 验证 | 结果 |
| --- | --- |
| `verify:gb6:mainline` | PASS — 109,983 帧、100 战斗、`spyder_route3@4,6`、state `a252d05f…d21d982` |
| `verify:j1:mainline` | PASS — 122,145 帧、17 战斗、state `91219327…e5a816` |
| `verify:gb6:failures` | PASS — 首败/后败均到钉住的恢复端点、后败 state `24e1447a…c35a5` |
| `verify:g6:locks` | PASS — 330 页、334 动态检查、328 解锁、2 传送、0 未决/错误/异常 |
| `verify:g6:determinism` | PASS — 2 roots、4,742 文件、66,734,865 字节、sha256 `f29c8ba5…b1fd` |
| `verify:g6:frozen` | PASS — 263 地图、0 永久锁/fiber/错误 |
| web journey | PASS — 3,793 帧、4 个 state+pixel 检查点、0 console 错误 |

所有数字与 builder 报告一致。

## 门禁复跑（reviewer 本人）

- `bunx tsc --noEmit`：exit 0
- `bun run build:wasm`：exit 0，290,031 字节（已最新）
- `bun run build`：exit 0
- `bun run test`：**277 pass / 0 fail / 102,743 assertions / 47 文件**
- `bun run import` 两遍：无 diff
- `bun.lock`、`vendor/`：相对 base 无改动

## 变异检查（隔离副本，已删除）

在 `/var/tmp/fleet/2201/mut-1`（`git worktree add` 自被审分支 HEAD，独立 node_modules/子模块）各做一次，跑完即删，被审 worktree 始终干净：

1. **dusk 边界 `hour < 20` → `hour < 21`**（`time-weather.ts:270`）：2 个测试变红（"matches upstream daytime and five stage boundaries"、Paper Town 夜晚页测试）。还原。
2. **每 tick `refTick + 1` → `refTick + 2`**（`extension.ts:500`）：3 个测试变红（60/30/20/4 Hz 相等性期望 120 实得 240、L 倒带期望 3 实得 6、Paper Town）。还原。

两个变异都被测试抓住，说明断言有辨识力。

## 性能（QuickJS 走路帧对照复测）

方法：同一 D2 bench 二进制（真实 rquickjs 桌面宿主、`CLOCK_THREAD_CPUTIME_ID` 线程 CPU 时、注入固定 09:00）、同一 3,793 帧 journey、480×272。在临时 worktree 构建 main（`b832794`）bundle，按 main→D2→D2→main 顺序同窗复跑：

| Run | walking mean | walking p95 | all-frame mean |
| --- | ---: | ---: | ---: |
| main 1 | 1.207 ms | 1.703 ms | 3.358 ms |
| D2 1 | 1.306 ms | 1.876 ms | 3.476 ms |
| D2 2 | 1.316 ms | 1.893 ms | 3.480 ms |
| main 2 | 1.201 ms | 1.696 ms | 3.360 ms |

配对均值：main 1.204 ms vs D2 1.311 ms → **+0.107 ms / +8.9%**，占 16.67 ms 帧预算 0.64%。所有帧低于 50 ms CPU 守卫（最高 28.4 ms）；D2 两次的 canonical state sha256 均为 `dd83a4af…cb8b`。

**builder 报告的 +2.40% 不能复现**：其 D2-2（1.249 ms）异常快于自己的 main-2（1.300 ms），reviewer 的 4 次运行显示稳定的 ~0.10 ms 差距。绝对开销很小（0.64% 帧预算、不威胁任何预算），故**非阻断**，但报告数字低估了。可能来源：`packTimeWeatherAdvance` 每个参考 tick 都重建整条 ~2KB envelope 字符串（`extension.ts:538-540`），即使没有跨分钟边界；"仅在变化时重建"的快路径能省掉大部分。

## 原则

- 内容全自动导入：ticker 由导入器对每张地图追加（`project.ts:2642+`），无逐图手改、无特判。
- 无 Tuxemon 专用代码进组件仓：改动全部在游戏仓；kit 子模块指针 `dfbae47` 与 main 相同，未动。
- 未改 `vendor/pocketjs`。
- 公开仓卫生：代码 diff 无本机路径/任务号。

## 文档

- `docs/status.md`："Day and night at run time" 标 Done、"Weather transitions" 标 Partial，描述与实现一致。✓
- `docs/architecture.md`：扩展命令表已更新（`tux.tick_time_weather` 新增、`time_is`/`update_time` 描述改正、占位措辞移除）。✓
- `docs/verification.md`：daylight golden 行已加。✓
- **`docs/importer.md:98` 写 "all 123 materialized uses"，实际是 128 条中 126 条物化（`reports/G1-coverage.md:278,303`：is 66 + not 60 = 126 native，2 条在不物化事件里）。数字过期，应为 126。**

## 阻断项

无。

## 建议（非阻断）

1. 把 `docs/importer.md:98` 的 "123" 改成 "126"。
2. 在 `findings/D2.md` 里写诚实的 QuickJS 数字（+0.107 ms / +8.9%，0.64% 帧预算）；可考虑给每 tick envelope 重建加"仅变化时重建"快路径。
3. 加一个测试把 `DEFAULT_WEATHER_SLUGS` 和导入的天气表钉在一起。
4. （将来）天气真正实现时加季节/温度门控，避免夏天下雪。

subagent 使用：1 个 / 上游 Tuxemon 语义对照（time_is 全属性、update_time 变量、天气激活机制）/ 省了时间——并行读上游源码与本仓实现，结论由主 agent 逐条复核（边界直接读上游源码确认）。

PASS
