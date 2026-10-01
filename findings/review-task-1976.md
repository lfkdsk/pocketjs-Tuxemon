# Review: GB6-F2（task 1976）

审查基线为 `1354ca9`，被审分支 HEAD 为 `c617f00`。我逐项阅读了四个提交，独立运行了
边界测试、两项实现变异、Wayfarer 图输入扰动、短/长 QuickJS 基准及全部验收门禁。

结论：**FAIL**。自动战斗测试与分桶仪表本身合格，常规门禁也全部通过；但 Wayfarer
“必经证明”的世界图不是运行时可达状态的保守上界，因而它得到的不可达结论不能构成证明。

## 1. 规格逐项核对

| 项目 | 结论 | 独立证据摘要 |
| --- | --- | --- |
| autoplay 阈值/并列测试 | 成立 | 17/17 通过；回血 0.35、捕获 0.4、换怪 0.2、后备严格 `+0.25` 及技能/道具/后备/捕获球/遗忘招并列均有断言。两项额外变异各使精确的一项测试变红。 |
| autoplay 行为不变 | 成立 | `1354ca9..HEAD` 对 `battle/autoplay.ts` 仅新增 9 行解释并列约定的注释；主线仍通过并得到 `bd3616c7…`。 |
| Wayfarer 图搜索 | **不成立** | 使用了 263 张导入地图和 `buildPassage`，但事件体按“任一页曾经 `blocks`”永久封死，且所有静态 transfer 都被错误绑定到作者坐标；这不是实际状态图，也不是有利于寻找绕路的保守超图。 |
| Wayfarer 输入扰动 | 成立 | 向 `spyder_route3@4,5` 临时加入直达北端的 transfer 后，`northReachableWithoutTrainers` 从 `false` 翻为 `true`，说明 BFS 能响应其已建模的绕路边。 |
| QuickJS 分桶开关/隔离 | 成立 | 仅 `G6_BATTLE_BUCKETS=1` 时读取富状态并打印分桶；读取发生在 `d = Instant::now()` 之后。默认关闭的短基准无 `BUCKET` 行，原断言通过。 |
| p95 解释复现 | 成立（有稳定性警告） | 固定 CPU 的第二次长跑复现了短/长 1v1 接近及 pp=1/3/4/5/6 严格单调；但两次长跑都因不同的 >100 ms 单帧调度尖峰触发旧的 50 ms max 断言，故该 max 门禁在共享宿主上不稳定。 |
| `findings/GB6.md` 跟进 | 成立但继承证明缺陷 | §7.5 和 §10 已补齐，不过 §10 把不健全图模型的结果写成“证明”。 |

## 2. Autoplay 边界与变异

新增测试位于 `tests/battle-autoplay.test.ts:148` 起。测试把最大 HP 钉成 200，明确覆盖：

- 回血 69/70/71 HP 对 0.35 阈值；
- 捕获 79/80/81 HP 对 0.4 阈值；
- 换怪 40/41 HP 对 0.2 阈值，以及后备血比恰好/超过 `+0.25`；
- 相同伤害技能取菜单中较早者；相同有效回复先取标称量较小者，再取源顺序较早者；
- 后备同伤害先取血比更高者、再取队位较早者；捕获球并列取首项；遗忘招并列忘最旧招。

我独立做了两项报告未做的变异，且每次只改实现、不改测试：

1. `autoplayMoveToForget` 的 `score < selectedScore` 改为 `<=`（并列改忘最新）：
   `16 pass / 1 fail`，期望槽位 0、实际槽位 1。
2. 回复物品的 `amount < best.amount` 改为 `<=`（完全并列改取后者）：
   `16 pass / 1 fail`，期望 `cureall`、实际 `mega_potion`。

恢复后该文件 `17 pass / 0 fail`，且 `git diff --exit-code -- battle/autoplay.ts` 成功。实现相对基线
只有注释变化，策略分支没有改动。

## 3. Wayfarer Inn：脚本会搜索，但“证明”不成立

### 3.1 已成立的部分

基线运行得到 263 maps、112,164 standable tiles、104 个跳过的变量 faint transfers、开放路径
58 节点，移除三名训练师触发格后 `northReachableWithoutTrainers=false`。测试文件的 5 项断言通过。
临时加入一条南端到北端的静态 transfer 后结果变为 `true`、路径长 2，证明搜索器会接受它能看到的绕路。

### 3.2 阻断缺陷：事件阻挡体被永久并集

`buildWorldGraph()` 在 `tools/wayfarer-inn-proof.ts:89-104` 对每个事件执行
`ev.pages.some((p) => p.blocks)`，只要任一页会阻挡，就把事件的**作者原点**永久写进 passage table。
它不选择当前 active page，不读取变量，不处理 `place`/`moveRoute` 后的位置，也不处理角色被隐藏或移除。
真实运行时恰恰按 active page 更新 `visible`/`blocks`（`vendor/pocket-rpgkit/src/engine/chars.ts:300-344`）。

这不是纯理论差异：独立重放主线到进入 Wayfarer 前的 f107479，玩家位于
`spyder_route3@4,4`，`v.spyder_boulder=1`，而 `npc_spyder_boulder` 已经
`visible=false, blocks=false`；证明图却仍永久封住其作者格 `spyder_route3@32,7`。

为了观察被永久封格隐藏掉的候选路线，我保留三名 Wayfarer 训练师的触发格和 NPC 身体，只移除
其余事件体的静态 stamp。搜索立即找到一条 369 节点的外围候选路线：Route 3 南段 → Leather Town
→ Timber Town → Paper Town → Flower City → Route 4 → Route 3 北段。该路线穿过 9 个被原脚本永久
封住的事件原点（Connor、boulder、Curie、Captain、Silver、Billie、Wulf、Beck、Rosamund）。这个
扰动**不证明九个格在同一故事状态都可通**；它证明的是原脚本靠过度阻挡排除了候选路线，而没有逐一
证明这些动态阻挡在所需状态确实存在，因此不能从其 `false` 推出运行时不可达。

### 3.3 阻断缺陷：parallel transfer 的源点建模错误

脚本在 `tools/wayfarer-inn-proof.ts:107-137` 遍历所有页面命令，但不看页面 trigger，并把每个静态
transfer 的源端一律设为事件矩形坐标。独立统计 1,152 个 transfer 命令为：
`playerTouch:static=986`、`parallel:static=61`、`parallel:variable=104`、`action:static=1`。最后一条
action transfer 位于阻挡型 NPC `water_outskirts_dude` 上；运行时应从面向 NPC 的相邻格交互，脚本却
把边放在 NPC 自己那个不可站立的格上，等价于漏掉该边。

运行时的 parallel 页不是“玩家走到事件作者坐标才触发”：它们始终进入候选集并在 active page
成立时启动（`vendor/pocket-rpgkit/src/engine/interpreter.ts:1088-1105`、`:1192-1208`）。因此把 61 个
static parallel transfers 锚到事件原点会漏边；跳过 104 个变量 transfer 是否安全也只靠名字/用途说明，
而不是状态可达性证明。对“不存在任何绕路”的结论，这种漏边是决定性的 soundness 缺陷。

要修复，证明应钉住一个明确的前置 `SessionState`，按 active page 和 live character 位置生成阻挡，
并按 trigger/guard 语义加入事件驱动 transfer；或者构造经过论证的保守超图，再证明超图也不可达。
当前 5 个测试只复述当前静态图的结果，没有约束上述完备性。

## 4. QuickJS p95

分桶实现本身合理：开关定义在 `tools/g6-quickjs-bench.rs:793-800`，富状态读取位于帧的计时终点
`d` 之后（`:378-397`），输出也仅在开关开启时发生（`:960-962`）。默认关闭的独立短基准通过，
没有 `BUCKET` 输出，终态仍为 `5653f011…`。

开启分桶后的独立短跑结果：battle-steady n=1,132，p95 11.703 ms；1v1 technique n=673，
p95 11.589 ms；终态 `5653f011…`。

第一次独立长跑完整执行了 109,981 帧并在断言前写出了正确终态 `bd3616c7…`，结果为：

| 桶 | n | p95 |
| --- | ---: | ---: |
| battle-steady（全部） | 44,008 | 21.049 ms |
| pp=1, ep=1, technique | 2,071 | 13.976 ms |
| pp=3, ep=1, technique | 1,791 | 12.507 ms |
| pp=4, ep=1, technique | 3,669 | 14.928 ms |
| pp=5, ep=1, technique | 1,257 | 15.823 ms |
| pp=6, ep=1, technique | 2,643 | 19.578 ms |

它支持“长 journey 混入大队伍高成本帧，故总体约 20 ms”的定性解释，并且 pp=3→6 上升；但
pp=1→3 并不单调，长/短 1v1 technique 相差 2.387 ms，而非报告中的 0.112 ms。另有一个
`sendOut` 帧 f6044 达 101.610 ms，令 `assert_frame_budget("all", ..., 50)` 失败（exit 101）。这更像
共享宿主调度噪声而非确定性回退，但意味着该次审查运行没有原样复现报告中的严格数值结论。

第二次把进程固定到当时空闲的 CPU 15，得到 battle-steady p95 21.217 ms；1v1 technique
p95 11.547 ms，与短跑相差 −0.042 ms。相同 technique/ep=1 桶按 pp=1/3/4/5/6 分别为
11.547/12.420/14.774/15.545/20.496 ms，严格单调，因而任务要求的两项 p95 关系在这次运行中复现。

不过第二次运行又在另一个帧 f92599 出现 136.725 ms QJS/core 尖峰并 exit 101；pp=6/ep=4
technique p95 也从第一次的 28.853 ms 漂到 48.705 ms。两次终态文件均为预期的 `bd3616c7…`，
且常规主线验证通过。因此这里把“约 12→20 ms 主要来自样本构成”判为成立，把绝对 max/细分桶数值
视为共享宿主上的稳定性警告，而不是另一个功能阻断项；这些结果不能用来声称长基准的 50 ms 断言
在审查环境中可稳定通过。

## 5. 门禁与仓库卫生

| 门禁 | 独立结果 |
| --- | --- |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | exit 0；pak 4,622 entries / 62,192,144 bytes |
| `bun run build:wasm` | exit 0；289,808 bytes |
| `bun test` | 183 pass / 0 fail，71,077 assertions，36 files，165.54 s；无 skip |
| `verify:gb6:mainline` | PASS；109,981 帧；终态 `bd3616c750f5aa2b76ba105713c4e921f434d397ab5a0618845e382df62fa0d0` |
| `verify:gb6:failures` | PASS；首战败线 3,357 帧；Wanda 败线 65,500 帧，blocked exit + healed |
| worktree | 写报告前 clean；`git diff --check` 0；`bun.lock`/`vendor/` 相对基线 0 diff |
| 提交卫生 | 四个提交；运行时代码/测试中无 fleet 任务号或本机绝对路径；无 `Co-Authored-By` |

本任务没有新增或改动画面产物，故通用审查中的 PNG 肉眼检查不适用。改动也没有手工编辑导入产物、
没有把 Tuxemon 专用代码写入组件仓，并且没有修改 `vendor/pocketjs`。

## 6. 已登记证据产物

- `本地日志（未入库）`：两项独立变异与恢复后测试。
- `本地日志（未入库）`：基线、绕路边注入、动态 body 扰动、真实 tape 前置状态。
- `本地日志（未入库）`：parallel/action static transfer 样本。
- `本地日志（未入库）`、`本地日志（未入库）`：默认关闭与短 journey 分桶。
- `本地日志（未入库）`：第一次长 journey 分桶及 50 ms 断言失败。
- `本地日志（未入库）`：固定 CPU 的第二次长 journey 分桶、p95 关系复现及另一处 max 尖峰。
- `本地日志（未入库）`：TypeScript、构建、完整测试、两条 GB6 验证和仓库卫生。

## 阻断项

1. **Wayfarer 不可达证明的图模型不健全。** 永久并集所有 page 的 event body 会过度阻挡，按作者
   坐标挂接 parallel transfer 又会漏掉运行时边；因此当前脚本及其五项测试只能证明其自造静态图的
   割集，不能证明导入后真实工程在相应剧情状态无绕路。必须改为明确状态下的 active-page/live-character
   图，或经证明的保守超图，并补回归测试覆盖动态移除/移动 body 与 parallel transfer。

FAIL
