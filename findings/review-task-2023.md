# D1 数据层与前移审查

审查任务：2037；被审提交：`c9463ab`；基线：`588f60b`；分支：`fleet/task-2003-fwd`。
依据 `reviewer-generic.md`、`game-D1-clock-weather-data.md`、`game-D1-forward.md` 与本次审查规格。

结论：**FAIL**。已确认两个验收阻断：codec 不校验显式版本标记，以及规格要求的
`update_time` 导入正向夹具缺失。所有指定命令门禁已由主审复跑通过；三条 tape 的独立逐帧
可观测状态与严格终态对比也通过。修复 R1/R2 后应重审。

被审实现保持为 `c9463ab`；本审查提交仅修改本报告。所有命令显式设置
`TUXEMON_SRC=/var/tmp/tuxemon-src`，临时输出在 `/var/tmp/fleet/2037`，没有使用 `/tmp`。

## 阻断项

### R1：codec 接受显式未知或非法版本

`importer/time-weather.ts:215` 的条件表达式两支均指向同一输入，未拒绝错误 `format`。
独立探针 `/var/tmp/fleet/2037/codec-probe.ts` 对有效 v1 包装、裸快照均成功；将 `format`
改为 `pocket-tuxemon/time-weather/v2`、`unrelated-format`、空字符串、`null` 或 `7`，
五种非法包装也全部成功解码。命令与完整输出见 `/var/tmp/fleet/2037/codec-probe.log`。
应仅在字段缺失时接受裸快照，存在时严格验证 v1 字符串，并补错误版本/类型负例。
当前 codec 尚未接入生产存档；这是 D1 数据格式验收缺陷，不代表现有主线或存档已损坏。

### R2：`update_time` 缺少真正经过导入器的正向夹具

`tests/time-weather-import.test.ts:163` 仅断言三个源调用全为 Dropped，
`tests/time-weather-schema.test.ts:181` 只验证参数辅助函数。隔离副本删掉
`importer/project.ts:1571` 输出 `tux.update_time` 的整条 `out.push` 后，两个 D1 测试文件仍为
34 pass / 0 fail / 99 expect，与未变异副本相同。变异 diff、基线/变异输出分别见
`/var/tmp/fleet/2037/mapping-mutation.diff`、`mapping-baseline-tests.log`、`mapping-mutant-tests.log`。

D1 规格第 4 项要求三类用法均有导入形状夹具，此项未满足。应在隔离源夹具中提供可物化的
`update_time player` 事件，经真实 `buildProject`/`convertActions` 后断言完整 ext 命令和
Placeholder/D2 理由。真实源的三处 Dropped 统计及 GW1 行为应保留。

## 门禁复跑

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `bun run import` 两遍 | 成立：包括 `dist/weather.json` 的 4,638 文件均无变化 | `/var/tmp/fleet/2037/import-1.log`、`import-2.log`、`import-compare.log` |
| `bunx tsc --noEmit` | 成立：exit 0 | `/var/tmp/fleet/2037/tsc.log` |
| `bun run build` / `bun run build:wasm` | 成立：依次 exit 0 | `/var/tmp/fleet/2037/build.log`、`build-wasm.log` |
| 构建后 `bun test` | 成立：216 pass / 0 fail / 0 skip，39 文件 | `/var/tmp/fleet/2037/tests.log` |
| `verify:g6:locks` | 成立：330 pages / 334 commands；328 解锁、2 转移；unresolved/error/exceptions 均 0 | `/var/tmp/fleet/2037/g6-locks.log` |
| `verify:g6:determinism` | 成立：两个隔离根、4,637 清单文件字节一致 | `/var/tmp/fleet/2037/g6-determinism.log` |
| `verify:g6:frozen --out=reports/frozen-k1.json` | 成立：263 图，永久输入锁/永久阻塞 fiber/错误均 0 | `/var/tmp/fleet/2037/g6-frozen.log` |
| `verify:gb6:mainline` | 成立：CI PASS，109,983 帧、100 场战斗，终点 `spyder_route3@4,6` | `/var/tmp/fleet/2037/gb6-mainline.log` |
| `verify:gb6:failures` | 成立：首败/中途败 PASS；faint 传送、治疗前阻挡及恢复顺序通过 | `/var/tmp/fleet/2037/gb6-failures.log` |
| `bun run web` | 成立：exit 0 | `/var/tmp/fleet/2037/web-build.log` |
| `bun tools/verify-web-journey.ts` | 成立：3,793 帧、四检查点状态/像素全过，console errors 0 | `/var/tmp/fleet/2037/web-journey.log` |

以上日志均已注册为 fleet artifact，保存完整命令、实际 stdout/stderr、UTC 起止时间和退出码。
额外负例探针 `codec-probe.log` 的 exit 1 是 R1 的预期复现；隔离变异失败也单独记录，
不与原实现的正式门禁结果混计。唯一中断是下述合并比较命令的执行器时限，随后按单条完成。

## 数据层复核

60 Hz 参考 tick 时钟与独立天气 RNG 字段符合 S5 数据格式要求；真正推进、多 hz 等价与天气
转移仍属于 D2。主审复跑 `/var/tmp/fleet/2037/schema-review.ts`：loader 和 `dist/weather.json`
的 10 条天气、全部五个字段与上游 YAML 相等，modifiers 均为空；78 项坏形状/坏数值拒绝及
真正 JSON 序列化往返通过。证据：`/var/tmp/fleet/2037/schema-primary-check.log`。

## 逐项对照规格

| 规格 | 判定 | 证据与边界 |
| --- | --- | --- |
| 60 Hz 参考 tick 的时钟、天气独立 RNG/deadline 类型 | 成立 | `importer/time-weather.ts:36`、`:55`；此处仅固定格式，D2 才实现推进 |
| JSON codec 往返与校验 | 部分 | 合法 JSON 往返、字段边界通过；显式版本漏验见 R1 |
| 天气表自动生成到 dist 和导入报告 | 成立 | `gen-assets.ts:192`、`importer/project.ts:2378`；10 行五字段源对照通过 |
| `time_is` ext 形状、固定 morning/daytime 占位 | 成立 | `importer/project.ts:662`、`battle/extension.ts:646`、导入夹具通过 |
| `set_layer` ext 形状及 no-op 占位 | 成立 | `importer/time-weather.ts:315`、`battle/extension.ts:589`；clear/color/image 夹具通过 |
| `update_time` ext 形状及 no-op 占位 | 部分 | 命令和 handler 存在；真实源无可物化调用，缺少导入正例见 R2 |
| Placeholder 与后续职责明确 | 成立 | `reports/G1-coverage.md:40`、`:54`、`:57`；整体事件 Dropped 不冒充 Placeholder |
| `set_environment` 与天气、KV1 与 overlay 分工 | 成立 | 原作 set_environment 是战斗背景，set_layer 是透明 overlay；KV1 控制瓦片层 visible/variant，D3 负责 overlay |
| 三类代表性导入夹具 | 部分 | time_is/set_layer 形状覆盖；update_time 只测参数函数/全部 Dropped，R2 |
| 独立模块、GW1/W1 保留 | 成立 | `importer/project.ts` 的 current_state/worldIdle 未改；W1 模块和产物 diff 为空 |
| 基于新历史前移、本地交付 | 成立 | `c9463ab` 的父提交为 `588f60b`，单个前移实现提交；本审查只增加报告提交 |
| 三条 tape 内容未改 | 成立 | `/var/tmp/fleet/2037/tape-payload-diff.json`；仅两条终态 hash 字段改变 |
| 终态严格字段 diff、逐帧重放 | 成立 | 三条独立两版本重放全过；实际改名数 22/12/0，见下节 |
| 导入/编译/构建/测试及其余门禁 | 成立 | 全部指定命令 exit 0，见门禁表 |
| bun.lock/vendor、公开仓卫生 | 成立 | 被审区间 protected-path diff 为空，新增内容和提交信息无本机路径/任务号；findings 为规格允许的例外 |

三个源类型的生产覆盖率：

| 类型 | 源使用数 | Placeholder | Dropped | 解释 |
| --- | ---: | ---: | ---: | --- |
| time_is | 128 | 123 | 5 | 外层固定假守卫丢整段事件，其余保留 ext 与 D2 注明 |
| set_layer | 79 | 70 | 9 | 外层固定假守卫丢整段事件，其余保留 ext 与 D2/D3 注明 |
| update_time | 3 | 0 | 3 | spyder/xero 被 TeleporterState 固定假门挡住，battle_menu 无 TMX |

证据：`/var/tmp/fleet/2037/mapping-source-census.json`；原作对照与详细行号见
`mapping-review.md`。三种 handler 的注释明确标为占位，未宣称已实现真实昼夜/天气。

## tape 重钉的独立验证方法

从 `588f60b` 创建 `/var/tmp/fleet/2037/main-base`，共用同一钉住的只读组件提交 `4bba234`，
在基线重新执行 `bun run import`。两套游戏项目/扩展运行时分别读取自己的产物；没有复用
builder 留下的终态。三条 JSON 的 masks/tapeSha256 和其他内容相同，仅允许的两条终态 pin 改变。

主审执行 `/var/tmp/fleet/2037/tape-compare.ts`：mainline 使用 inline，失败路径使用生产 sharded
loader；初态及每个 tape tick 比较完整世界/战斗/剧情/RNG/玩家/有效 NPC/对话/输入锁等可观测
状态。只规范化明确定义的事件引用；内部 bytecode/parallel fiber 与静止不可见不阻挡事件标记
不用于逐帧画面行为判断，完整豁免规则写入 `tape-results/tape-policy.json`。此结果不等于所有
内部 fiber 字节或每帧 framebuffer 相同，网页与像素测试另做验证。

终态比较不使用逐帧豁免，只允许 `chars.chars` 的唯一事件后缀对应的外键及内嵌 id 改号，
拒绝值交换、角色增删、字段变化、歧义或错误内嵌 id；两侧终态必须分别匹配已钉 hash。
比较器六项正反例自检由主审复跑通过，见 `tape-comparator-selftest.log`。

合并执行三条比较的首次命令触及执行器五分钟总时限：主线已经完整结束并保存全部证据，
后续失败路径按各自 selector 单独执行补齐，不把未完成的部分算通过。
主线已确认：109,983 个输入帧的可观测状态全同，63 个终态角色保留，严格改名数为 22。
`findings/D1.md` §9.2 的 21 是旧脚本按行为值分组后的低估，两个事件具有相同非 id 值被合并
计数；不是状态值改变。两侧终态 hash 分别匹配 `d62d1465…` 与 `df7c996e…`。

| journey | 输入帧数 | 每帧不同 | 严格改名数 | 终态 hash：基线 → D1 |
| --- | ---: | ---: | ---: | --- |
| mainline | 109,983 | 0 | 22 | `d62d1465… → df7c996e…` |
| later-loss | 65,515 | 0 | 12 | `2e76caf0… → 4a969987…` |
| first-loss | 3,254 | 0 | 0 | `d321b217…`，完全不变 |

中途败终态角色为 29 个，两侧相同；原报告的 10 同样因分组计数低估，实际 12 个键改名。
完整 hash、每个改名对、初态加逐帧轨迹均在 `/var/tmp/fleet/2037/tape-results/`，汇总为
`tape-summary.json`。主审也已把六个新终态交给原 D1 `field-diff.py` 的原样副本复跑，
三条均 `PURE-RENUMBER / top_diff=[] / rng_same=True / value_loss=0 / count_mismatch=0`，
见 `/var/tmp/fleet/2037/field-diff-original.log`。严格比较额外排除了旧脚本未拒绝的交换值/新增角色。

GW1 两个 evolution_all 事件直接对照也通过：route1 `e026→e027` 前新增
`e017_environment_night`，Paper Town `e053→e054` 前新增 `e034_environment_night`。
去掉外层事件 id 后，进化事件全部内容相同，原有 worldIdle/锁/战斗断言保留。

## 隔离变异

| 变异 | 原测试结果 | 判定 |
| --- | --- | --- |
| 子分钟上界 `>=` 改 `>` | 20 pass / 1 fail | 被测试抓到 |
| 组合校验吞掉天气错误 | 21 pass / 0 fail | 测试接线缺口；原实现正确，单独不阻断 |
| 删除 `update_time` ext 输出 | 34 pass / 0 fail | R2：缺少规格要求的导入正向夹具 |

变异仅发生在 `/var/tmp/fleet/2037/mut-schema` 与 `mut-mapping`，副本均已清理。
完整命令与输出：`schema-mutations.log`、`mapping-mutant-tests.log`。被审实现未改。

## 非阻断建议及范围

- `verify:g6:determinism` 的 GENERATED 清单尚未包含 `dist/weather.json`。本审查已独立把它
  加入两次导入的字节比较并通过；维护脚本也应补入，防止未来漏检。
- `importer/index.ts:84` 的 Placeholder 总定义仍只写 battle/monster，但后续正文已扩展到 D1；
  建议统一文案。
- 原字段 diff 脚本只比角色值 multiset，会放过身份间值交换和新增角色，且失败不设非零退出码。
  旧 dump 脚本也只保存终态，不能单独证明逐帧一致；本次新比较器用于补齐这些证据。
- 本任务是游戏仓数据层，没有组件仓每帧能力变更或 QuickJS 性能承诺；组件的闲置零开销
  交错基准不适用。测试/脚本的 Bun 耗时不作为产品性能结论。

## 画面核对

主审已打开本次 Chrome 回放生成的 `dist/web-journey/end.png`：Route 1 的水岸、石块、
树林、草地、围栏和蓝帽玩家显示完整，画面没有空白或大块异常遮挡。网页预览
`dist/web/pocket-tuxemon/preview.png` 的 Paper Town 房屋、道路和蓝顶商店也正常。

另外打开既有 `tests/goldens/g6-paper-town.1367.png` 与
`tests/goldens/gb6-mainline-route-3-end.480x272.png`：前者有清楚的十字沙路、树林、商店和人物；
后者有砂地、分层岩壁、石柱、水晶与人物。不是只核对 hash。四张图已注册为 artifact。
本次全量测试也运行了 `tests/g6-golden.test.ts:115` 的房间/人物/地标语义像素断言，以及
`tests/gb6-route-golden.test.ts:134` 起的玩家不透明像素和地图调色/地标断言。
真实 Chrome 四检查点 framebuffer hash 分别为 `00af3e6f / d39d7b7e / 4380c25c / aa358549`，
与各自 golden 相同；D1 仍是明确的昼夜/overlay 占位，没有宣称实现新天气画面。

## 交付与后续

最终代码完整性证据 `/var/tmp/fleet/2037/final-integrity.log` 确认：相对 `c9463ab` 除本报告外
无受跟踪改动；`bun.lock`、组件与 PocketJS 源码/gitlink 无变化。两份变异副本已删除，
独立基线和重放证据保留供复核。后续修复提议已登记给 commander，尚未假定排期。

报告与各条实质结论、命令日志、脚本、终态/逐帧证据、截图及构建产物均按 fleet 协议登记。

临时产物统一在 `/var/tmp/fleet/2037`；初始工作区已有根 `node_modules` 与嵌套 PocketJS
`node_modules` 符号链接，导致 git 显示未跟踪依赖。审查前后比较受跟踪文件与 gitlink，
不把这些既存依赖当作被审提交的更改。

subagent 使用：3 个 / schema 与 codec 原作对照及两项隔离变异；导入映射、覆盖率与一项隔离变异；tape/前移核查及独立比较器 / 是，三路审查与主审串行门禁重叠进行；服务队列重试造成过短暂延迟。全部结论由主审核实后登记。

FAIL
