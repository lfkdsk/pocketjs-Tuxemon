# D1 修复 1 复审

审查对象：`fleet/task-2003-fwd`，HEAD `7dbc780`；合入基线
`170e2c4`。依据 `reviewer-generic.md`、D1 原规格、前移规格、两份修复规格及本次复审规格。

结论：**FAIL**。上一轮 R1/R2 已实质修复，J1/GB6 重钉和全部产品门禁也通过；但本轮仍有
两个验收阻断：提交信息泄漏任务号，以及 `runtimeMaxActors` 来源报告把“当前共有三个时间事件”
误写成“三个都是新增”。后者不影响 `207` 这个数值，却使规格点名要求复核的来源证据不成立。

所有导入、构建、测试、journey 和 Chrome 回放均由主审执行，并显式设置
`TUXEMON_SRC=/var/tmp/tuxemon-src`。四个 subagent 只做只读静态核对。

## 阻断项

### B1：两个 merge commit 标题包含任务号

本次规格明确要求“无本机路径/任务号进代码与提交”。`170e2c4..HEAD` 的代码新增行（排除
规格允许的 `findings/**`）没有本机路径、任务号或内网地址，但两个提交标题仍包含
`fleet/task-2003-fwd`：

```text
caa261f Merge branch 'main' into fleet/task-2003-fwd
4aa0d27 Merge branch 'main' into fleet/task-2003-fwd
```

复现命令：

```sh
git log --format='%H%x09%s' 170e2c4..HEAD |
  rg 'fleet|task-[0-9]+|/home/|/var/tmp|\.fleet'
```

这不是 `findings/` 内容例外，而是公开历史的 commit subject，故工作区卫生验收不成立。需要在
交付分支上改写这两个 merge message（或以不含任务号的等价干净历史重新交付），再重审最终 SHA。

### B2：`runtimeMaxActors` 数值正确，但报告的来源账错误

`runtimeMaxActors=207` 本身成立：`gen-assets.ts:88-95` 对非 `test_*` 地图取全部事件数最大值，
当前峰值确为 `spyder_dryadsgrove`。主审对基线和当前生成 shard 直接统计：

```text
baseline [205,["Environment Day"]]
current  [207,["Environment Day","Environment Night","Night Day Cycle Outside"]]
actor reports 205
207
```

因此净新增是两个事件：`Environment Night` 和 `Night Day Cycle Outside`。`Environment Day`
在基线已经存在；其 `not time_is ... night` 在固定 morning 语义下为真。当前三个事件只是都带
`tux.time_is`，不能说三个都从基线的 const-false 中新物化。

`findings/D1.md:284-287` 却明确写“多出的是三个时间事件”，并声称三个在 main 上都被
`const-false` 丢弃；`tests/g6-assets.test.ts:28-31` 的注释也会产生相同误读。报告应改为：
当前共有三个时间事件，其中一个基线已有，D1 净新增两个，所以 `205 + 2 = 207`。

同一账目还使 `findings/D1.md:224` 把 map repository 的全部 `56,066` 字节增量归为
“同上（事件数 +2）”不成立；D1 在许多地图上保留 `time_is` / `set_layer` ext 形状和事件编号，
并非只有该地图的两个新事件。数值 pin 和 actor 池逻辑无需回退，但交付报告与测试注释必须更正。

## 上一轮阻断项

### R1：codec 版本校验——已修复

`decodeTimeWeather` 在 `importer/time-weather.ts:207-228` 用 `"format" in state` 区分裸
snapshot 和显式 wrapper；字段存在时严格要求
`pocket-tuxemon/time-weather/v1`。测试覆盖 v2、无关字符串、空串、`null`、数字及
present-but-`undefined`，见 `tests/time-weather-schema.test.ts:56-95`。

主审在隔离 git worktree 中把校验恢复成 `if (false)`，定向测试实际结果：

```text
24 pass
2 fail
56 expect() calls
```

失败恰为显式非法 format 与 present-but-undefined 两项，说明修复有辨识力。

### R2：`update_time` 正向夹具——已修复

隔离源 TMX 的 `update_time player` 经子进程设置独立 `TUXEMON_SRC`，调用生产
`buildProject`，再走 `convertMap/convertActions`。测试对完整命令
`{op:"ext", call:"tux.update_time", args:{character:"player"}}`、action trigger 页及
`Placeholder / D2` 理由作断言，见
`tests/time-weather-update-time-fixture.test.ts:22-40,79-109`。真实源仍保持
`3 total / 0 Placeholder / 3 Dropped`，见 `tests/time-weather-import.test.ts:163-176`。

主审在同一隔离副本删掉 `importer/project.ts` 的 ext `out.push`，实际结果：

```text
0 pass
3 fail
5 expect() calls
```

三条断言全部变红。副本随后删除，被审 worktree 未做变异。

### 天气错误传播建议——已落实

`timeWeatherProblem` 现在会在 clock 合法后继续返回 weather 问题，相关直接断言见
`tests/time-weather-schema.test.ts:171-201`。主审删除 weather 校验后实际为
`24 pass / 2 fail / 69 expect()`；失败是组合校验传播和 decode 抛错，补上了上一轮发现的
接线缺口。

## J1 与 GB6 重钉

正式 verifier 的新鲜重放结果：

| 路径 | 帧数 | 当前终态 SHA-256 | 结果 |
|---|---:|---|---|
| GB6 mainline | 109,983 | `df7c996ef13edff13ce3ee88f671e6a212d114a1550ff0ff6061846dbd16cd8a` | PASS，100 场战斗，`spyder_route3@4,6` |
| GB6 first-loss | 3,254 | `d321b2173aca055d0e0fdc39df6127f57ebad93a4cd3e758d7695c04e44f7aab` | PASS |
| GB6 later-loss | 65,515 | `4a969987524faddfa7b0be4acad5c8bfae16729d95cf3960f9fe67ec62fc4ccb` | PASS |
| J1 combined | 122,145 | `88c3c6914356dd4bf98c64e54ade36da6aaca6fd94a31e393181fa73c2a10ab2` | mainline 与 segment 均 PASS |

J1 文件的父边界 pin 已正确更新为 `df7c996e…`，见
`data/j1-captainreturns-journey.json:7-14`；J1 自身终态 `88c3c691…` 不变。

为避免只信已提交 pin，主审用基线 `170e2c4` 和当前 HEAD 各自的引擎、项目和 tape 新生成八份
终态。原 D1 字段脚本实跑结果：

| 路径 | 基线 → 当前 | 原脚本结论 |
|---|---|---|
| mainline | `d62d1465… → df7c996e…` | `PURE-RENUMBER`，顶层/RNG/行为值相同 |
| later-loss | `2e76caf0… → 4a969987…` | `PURE-RENUMBER`，顶层/RNG/行为值相同 |
| first-loss | `d321b217… → d321b217…` | 完全不变 |
| J1 | `88c3c691… → 88c3c691…` | 完全不变 |

原脚本按“去掉 id 后的行为值 multiset”分组，仍会把重复值合并，所以显示 21/10 个改名。主审又用
稳定事件 suffix 做严格一对一比较，拒绝角色增删、交换值、嵌入 id 错配和其它字段变化，得到
mainline **22**、later-loss **12**、first-loss **0**、J1 **0** 个纯改名，四条均
`STRICT-PASS`。这与上一轮审查的纠正数字一致，并再次确认重钉没有掩盖状态值变化。

## `set_layer` 范围

本轮范围说明成立：

- `battle/extension.ts:589-594` 的 `tux.set_layer` handler 只有注释，无读取、写入或返回值，
  是严格 no-op。
- `importer/project.ts:1573-1579` 仍输出 ext 命令并登记 `T3-placeholder`。
- `reports/G1-coverage.md:213` 为 `79 total / 70 Placeholder / 9 Dropped`。
- `tests/time-weather-import.test.ts:217-222` 对 clear/color/image 三种调用均断言
  `undefined`；本轮全量测试已实际执行并通过。

GI-1a 以后用组件仓 KV1 的原生屏幕叠层映射替换并删除该占位，不是本轮阻断项。

## 工作区与仓库边界

| 检查 | 结果 |
|---|---|
| `vendor/pocket-rpgkit` | 实体目录；索引与 HEAD 均为 `7c16a281166b5629ab086d22612f10c82b9642bb` |
| nested PocketJS | 实体目录，`9eda4b5bc3a253682e223e522de170bf9fd9b155`，干净 |
| `node_modules` | 实体目录，不是软链 |
| `bun.lock` | `170e2c4` 与 HEAD blob 均为 `ab32fb7029af1e6788fd841d544bac8d63f5e330` |
| 被审 worktree | 最终仅本复审报告待提交；子模块无本地修改 |
| 非 findings 新增代码卫生 | 无本机路径、任务号、localhost/RFC1918 地址 |
| commit subject 卫生 | **失败**，见 B1 |

组件仓和 nested PocketJS 在被审范围没有修改；D1 逻辑位于游戏仓 importer/extension，未把
Tuxemon 专用能力写进通用组件。天气表、地图事件和覆盖率均由完整导入生成，没有逐图手改产物。
本任务没有组件热路径改动或 QuickJS 性能承诺，因此闲置性能基准不适用。

## 门禁复跑

| 命令 | 主审结果 |
|---|---|
| `bun run import` 两遍 + 每遍 `git diff --exit-code` | 两次均 exit 0；263 图、430 TILESET、map bytes 7,960,101 |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build && bun run build:wasm` | exit 0 |
| `bun run test` | 第二次完整运行 **244 pass / 0 fail / 0 skip**，42 文件、80,531 断言 |
| `verify:g6:locks` | 330 pages、334 commands；328 unlocked、2 transferred、0 unresolved/error/exceptions |
| `verify:g6:determinism` | PASS；2 个隔离根、4,638 文件、61,926,051 bytes，同一 SHA-256 |
| `verify:g6:frozen` | 263 图；0 永久输入锁、0 永久阻塞 fiber、0 error |
| `verify:gb6:mainline` | PASS，见上表 |
| `verify:gb6:failures` | 首败与中途败 PASS，见上表 |
| `verify:j1:mainline` | PASS，122,145 帧，终态 `88c3c691…` |
| `verify:j1:segment`（额外复跑） | PASS，12,162 帧，终态同上 |
| `bun run web && bun tools/verify-web-journey.ts` | PASS；3,793 帧、4 检查点状态/像素一致、console errors 0 |

第一次全量测试曾因并行静态核对期间宿主负载，使
`g7-repository` 的 4-hz attract case 超过单测 30 秒上限（243 pass / 1 timeout）；该文件随后
原参数单独复跑为 3/3 pass、最慢 20.17 秒。所有 subagent 完成后第二次完整原命令为
244/244 pass、172.84 秒。因此记录为一次资源竞争型 timeout，不把第一次失败隐去，也不把它判为
产品回归。

## 画面核对

主审打开本次真实 Chrome 生成的 `dist/web-journey/end.png`：Route 1 水岸、岩石、树林、作物、
围栏、NPC 与蓝帽玩家完整，未见空白、大块错色或异常 overlay。另打开
`dist/web/pocket-tuxemon/preview.png`：Paper Town 的房屋、沙路、水岸、树林和蓝顶商店清楚，
玩家/NPC 正常。四个 Chrome 检查点像素哈希为 `00af3e6f / d39d7b7e / 4380c25c / aa358549`，
均与 golden 相同；不是只核对文件哈希。

## 非阻断说明

- 原 `field-diff.py` 的 21/10 是行为值分组数，不是严格事件 key 改名数；正确数字仍为 22/12。
  本轮同时保留原脚本复跑与严格对照，避免重复上一轮证据缺口。
- `findings/D1.md:231-244` 的“J1 无需重钉”只适用于 J1 自身终态；J1 文件中的 GB6
  `base.terminalStateSha256` 实际已在 `9091c16` 重钉。当前数据和 verifier 正确，措辞可一并澄清。
- `findings/J1.md` 仍记载旧父边界 `d62d1465…`；它是历史报告，不影响当前 pin，但建议在后续
  文档整理时注明现值。

## 交付

自制 J1 dump 与严格比较脚本、八份新鲜终态、两张目视截图和本报告均按 fleet artifact 协议登记。
审查未修改产品代码、生成数据、lockfile 或子模块；提交只包含本报告。

subagent 使用：4 个 / R1-R2 与测试辨识力静态核对；actor 205→207 来源账；GB6/J1 pin 与脚本；工作区/提交卫生及 set_layer 范围 / 是，四路只读审查与主审串行门禁并行，节省了静态核查时间。

FAIL
