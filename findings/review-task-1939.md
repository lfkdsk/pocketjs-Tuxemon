# GP1 启动预算审查（被审任务 1939）

## 结论

**FAIL。** 分片战斗库的实现、纯度、确定性、网页路径、golden 与除启动外的门禁均成立；但规格要求的 QuickJS 桌面启动到首帧在两个视口都必须不超过 250 ms，独立重复测量无法稳定满足。官方门禁命令本身曾以 `265.568 ms` 非零退出，主样本中 480×272 有 4/7 次超限、960×544 有 2/6 次超限。因此 builder 报告中的单次 `237.890/236.387 ms` 不能证明这个硬上界。

审查基线为 `e905824`，被审 HEAD 为 `c2ec606`，提交范围为：

```text
c2ec606 docs: report GP1 startup budget and battle-repository results
afbc85e chore: regenerate import artifacts for the sharded battle repository
e5220ae test: cover the sharded battle repository, fix a structuredClone break
b572d58 build: stage sharded battle data and assert startup budget
7186073 feat(battle): shard the runtime database and load it on demand
```

## 阻断项

1. **QuickJS 启动 ≤250 ms 的硬门禁不稳定且可直接失败。** 在 release 桌面宿主和实际 rquickjs guest 上运行：

   ```text
   $ G6_MAP_REPORT=/dev/null bash tools/bench-g6-quickjs.sh
   ... startup_to_first=265.568ms ...
   assertion failed: startup-to-first 265.568ms > 250.000ms
   exit 1
   ```

   同一构建的重复结果如下；“超限”按规格的 `>250.000 ms` 计算：

   | 视口 | 样本数 | 最小 | 中位数 | 最大 | 超限 |
   | --- | ---: | ---: | ---: | ---: | ---: |
   | 480×272 | 7 | 238.834 ms | 251.970 ms | 265.568 ms | 4/7 |
   | 960×544 | 6 | 239.810 ms | — | 265.941 ms | 2/6 |

   后续在机器有额外负载时还观测到 `299.070–333.257 ms`；这组没有混入上表，也不单独作为判定依据，但说明当前仅约 12 ms 的最佳样本余量对宿主调度很敏感。修复应先按规格补齐分阶段计时，再把正常重复运行留出明显余量，而不是用一次低样本放行。

## 逐条规格核对

| 规格项 | 结论 | 独立证据 |
| --- | --- | --- |
| 1. 先量启动构成 | **部分成立** | builder 给出了总启动时间与 bundle 大小，并正确找到了大 JSON literal；但没有规格要求的“bundle 求值 / JSON 字面量 / 战斗注册 / 首帧渲染”实测分段表。审查的 metafile 复核见下文，只能说明体积组成，不能替代时间分段。 |
| 2. 战斗数据移出 bundle、按需分片 | **成立** | `battle/production.ts:1-24` 只静态导入 shell；`importer/battle.ts:939-973,1334,1388` 生成索引与分片；`find dist/battle -type f -name '*.json' \| wc -l` 输出 `650`；生产 bundle 不含完整 `battle-runtime-db.json`/`battle-db.json`。 |
| 3. 两视口启动断言、战斗/移动预算、golden | **部分成立，验收失败** | `tools/g6-quickjs-bench.rs` 已有 250 ms 硬断言并确实会变红；战斗、走路、切图和全部战斗 golden 通过，但启动重复测量超限。 |
| 4. 网页 journey 与体积 | **成立（有传输语义限定）** | `bun run web && bun tools/verify-web-journey.ts` 通过；web JS `1,525,707 B`、pak `61,267,328 B`。网页通过 `pakGet(entry)` 按条目切片并延迟解析；pak 仍是整文件下载，不是 HTTP range lazy load。 |
| import 两遍稳定、类型、构建、wasm、全测试 | **成立** | 见“完整门禁”。 |
| locks / frozen / determinism | **成立** | 见“完整门禁”。 |
| 首战胜败、L 倒带、读档、多 Hz | **成立** | 生产分片路径的 60/30/20/4 Hz、冷/预热、读档和 L 回滚均得到相同终态哈希，详见“纯度与确定性”。 |
| `bun.lock`、`vendor/` 不改；无新 Fleet 任务号 | **成立** | `git diff --name-only e905824..HEAD` 中没有 `bun.lock` 或 `vendor/`；新增 diff 与五条提交信息没有 `task-1939`/`fleet` 标记。 |

## 实现、纯度与确定性

### 分片路径与缓存边界

- `createTuxemonBattleDbProvider` 在 `battle/battle-repository.ts:34-35` 建立 slug 索引与解析缓存；首次属性读取才在 `:40-50` 读取、解析并缓存对应条目。
- `load()` 的 `db` 闭包在 `battle/battle-repository.ts:85-106`，不是 `SessionState` 字段；存档、canonical hash 和 reducer 输入都没有缓存内容。它只是由 shell 与 pak/data.fs 可重建的派生缓存。
- `battle/from-battle-db.ts:153-177` 的第二层 Proxy 只缓存格式转换结果。实际 reducer 仍按明确 slug 读取物种/技能；小型且需要全局顺序的 `elementOrder` 保留在 eager shell 中。
- `main.tsx:14-22` 让地图与战斗共享同一个 entry reader：桌面 `readFileSync`，网页/主机 `pakGet`。

生产分片路径的独立 replay 矩阵结果：

| 场景 | Hz | 读取分片数 | 终态 SHA-256 |
| --- | --- | ---: | --- |
| 冷 provider | 60 / 30 / 20 / 4 | 每次 11/650 | `7fdc130b0b90fece5f3814d886dad0a4513417ce31e2d59019dd0ce310d8dd64` |
| 反向顺序完全预热 provider | 60 / 30 / 20 / 4 | 每次 650/650 | 同上 |
| 中途存档，换全新 provider 读档继续 | 60 | 恢复后按需 | 与 eager 路径逐字节相同 |
| L 回滚跨回战斗后重新播放 | 60 | 按需 | 同上 |

这证明结果不依赖缓存是否命中、预热顺序、此前是否访问过分片，也不依赖 60/30/20/4 Hz。`tests/battle-repository.test.ts:48-79` 还逐帧比较 eager 与 sharded session，并钉住同一终态哈希。

直接从新分片路径跑既有语料的结果：

```text
GB2 differential: 8,560 cases, 0 differences
GB3 doubles golden: 200 cases, 0 differences
monster spawn golden: 675 cases / 1,431 monsters, 0 differences
```

其余 GB3 reducer/progression golden 也包含在全量 `bun test` 的 130 个通过测试中。

### 两项变异检查

两次都只临时修改实现，取得失败证据后完整还原；还原后 `git diff --exit-code` 为 0。

1. **让冷 miss 与 cache hit 返回不同结果。** 临时把首次读取改成缓存真实值但返回 `undefined`。`tests/battle-repository.test.ts` 立即失败：

   ```text
   battle spawn: unknown monster 'nut'
   ```

   这覆盖了题目指定的“缓存命中与否影响结果”变异。

2. **破坏 Proxy 枚举。** 临时令 source Proxy 的 `ownKeys()` 返回 `[]`。全表 parity 测试立即失败，差异显示 monster/technique 表为空；维护 journey 仍可通过，因为它只按 slug 读取。两者合起来证明 parity 断言能捕获枚举契约破坏，而 journey 没有虚假依赖整表枚举。

### Proxy 语义、枚举与 `structuredClone`

用计数型 `BattleEntrySource` 对 source Proxy 的行为逐项复核：

| 操作 | 结果 | 读取数 |
| --- | --- | ---: |
| `provider.load()` | 建立 db，不读 shard | 0 |
| `'nut' in db.monsters` / 缺失 slug `in` | `true` / `false` | 0 |
| 首次 `db.monsters.nut` | 正确对象 | 1 |
| 再次读取 `nut` | 同一对象 identity | 仍为 1 |
| `Reflect.ownKeys(db.monsters)` | 257 个物种键 | 0 |
| `Object.keys` / `for…in` / `JSON.stringify` | 键与 eager 表一致 | 各会解析全部 257 项 |

最后一行是刻意设计的成本，而不是静默错误：`ownKeys` 给出索引，property descriptor 在枚举需要值时才 resolve。对 reducer 源码的检索显示，整表 `Object.keys/entries` 只用于 eager 的 elements/tastes/shapes/rules 或已加载记录内部的 `genderWeights`、stat modifiers；战斗物种、技能、道具和状态表均按 slug 访问。随机选物种来自 encounter rows，AI 选招来自当前怪物 moves，元素随机选择优先使用 eager `element_order`，因此生产帧不会误触发四张大表的全枚举。

`structuredClone(RULES_DB)` 失败的根因也得到复现：运行时抛出 `DataCloneError: The object can not be cloned.`，因为 JS structured clone 不接受 Proxy。修法没有改生产行为：`tests/battle-spawn.test.ts:96-116` 只复制该测试会修改的 `nut` 记录，保持测试隔离，同时不再克隆整个 lazy 数据库。这一修法范围正确。

## QuickJS 性能复测

所有下面的运行均是 release 桌面宿主中的 rquickjs，不是 Bun/JSC。为在启动断言失败后收集后续阶段，审查曾临时把本地阈值提高到 1000 ms；采样后已恢复 250 ms，未留下 diff。

### 除启动外的预算

| 指标 | 480×272 | 960×544 | 判定 |
| --- | ---: | ---: | --- |
| battle frame p95 | 6.850 ms | 6.597 ms | 通过 |
| 进入战斗总帧 | 7.178 ms | 7.635 ms | ≤50 ms，通过 |
| 退出战斗总帧 | 28.456 ms | 34.396 ms | ≤50 ms，通过 |
| walking p95 | 1.179 ms | 1.151 ms | 无回退 |
| map switch max | 13.377 ms | 13.403 ms | ≤50 ms，通过 |

地图首次访问最差的非豁免项是 `buddha_mountain = 47.955 ms`，仍低于 50 ms。

### Proxy 成本

在同一 QuickJS 宿主上，保持 bundle、tape 和其他代码相同，分别测当前 lazy Proxy adapter 与临时恢复的 GP1 前 eager adapter；每种跑三次后立即还原源码：

| adapter | round-settlement p95（三次） |
| --- | --- |
| Proxy | 0.9508 / 0.9569 / 0.9442 ms |
| eager control | 0.9456 / 0.9305 / 0.8827 ms |

中位数约为 `0.9508` 对 `0.9305 ms`，Proxy 约多 2.2%，绝对值约 `0.020 ms`，分布边缘重叠；结合完整 battle-frame p95，不构成可观测预算回退。

### 退出战斗变慢的归因

builder 报告称退出后的帧才首次读取升级/新怪物数据，因此 28/35 ms 是 lazy parse 的代价；临时分片读取 trace 否定了这个解释：

```text
frame 1868: nut
frame 2091: budaye + 6 techniques/items
frame 2103: 2 statuses
frame 2209: faint
frame 2219: battle exit
frame >=2219: no shard reads
```

退出帧的 host 构成为：

| 视口 | 总计 | QuickJS | core/draw 等其余部分 |
| --- | ---: | ---: | ---: |
| 480×272 | 28.456 ms | 28.159 ms | 约 0.297 ms |
| 960×544 | 34.396 ms | 34.045 ms | 约 0.351 ms |

因此变慢发生在 QuickJS 内，但不是退出时读取/解析 battle shard。更可能的范围是完成战斗、场景拆卸或地图 UI 重挂载；现有计时没有再细分，不能把其中任何一项写成已证实根因。建议后续给 exit frame 内的 reducer completion、scene teardown 和 map remount 加阶段计时，再决定是否优化；不要围绕已排除的 shard parse 做优化。

### bundle 构成

desktop 产物为 JS `1,525,709 B`、pak `61,267,328 B`。metafile 的最大输入包括：

| 输入 | 输入字节 |
| --- | ---: |
| `ui/game-assets.ts` | 460,265 |
| terrain assets | 114,093 |
| `dist/battle-runtime-shell.json` | 113,396 |
| `dist/project-shell.json` | 81,950 |

完整的 `battle-runtime-db.json` 与 `battle-db.json` 均不在产品 bundle 输入中。这支持“完整战斗库已经移出 JS 求值路径”，但 builder 的报告仍缺少规格要求的四阶段实测时间；下一轮性能工作应首先补这一仪表，而不是仅从输入字节推断耗时。

## 网页路径

独立执行：

```text
$ bun run web && bun tools/verify-web-journey.ts
boot: 275 ms
journey: 2,788 frames in 340 ms
state checkpoints: 4/4
pixel checkpoints: 4/4
console errors: 0
WEB JOURNEY PASS
```

实际 web 输出为 `dist/web/pocket-tuxemon/pocket-tuxemon.js = 1,525,707 B`、`pocket-tuxemon.pak = 61,267,328 B`。`main.tsx:20-22` 在无 fs host 时把同一个 `pakGet` reader 传给地图与 battle provider；provider 构造和首帧都不读 shard，首战按 slug 才切片、decode、`JSON.parse`。因此战斗表不会在首帧发生 JS 求值或 JSON 解析。限定是 PocketJS 仍先取得整份 pak；当前设计减少的是 bundle 求值与解析阻塞，不是网络传输字节或 HTTP range 请求。

## 画面人工核对

审查实际打开了以下 PNG，而非只看 hash：

- `tests/goldens/g6-route-1.2787.png`：可见水面、成片农田、树线、栅栏、花与玩家位置，瓦片层级和相邻关系正常。
- `findings/GB4-battle.png`：双方怪物、战斗背景、HUD、HP 条和技能菜单均存在，布局无明显裁切或错位。

对应 built-bundle 像素 golden 也在全量测试中通过。

## 完整门禁

| 命令 | 审查实跑结果 |
| --- | --- |
| `bun run import`（连续两遍） | 两遍后 `git diff` 均为 0；650 个分片稳定 |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build && bun run build:wasm` | 两项成功 |
| `bun test` | 130 pass，0 fail，62,935 assertions |
| `bun run verify:g6:locks` | 329 pages，333 dynamic checks，327 unlocked，2 transferred，0 unresolved/errors |
| `bun run verify:g6:frozen` | 263 maps，0 permanent locks，0 blocking fibers，0 errors |
| `bun run verify:g6:determinism` | PASS；3,885 files，60,271,174 bytes，SHA-256 `5136c0d5ae73dcc1add1bdcb1737927b23740dbc6c8013315ee48d411ca0ded6` |
| `G6_MAP_REPORT=/dev/null bash tools/bench-g6-quickjs.sh` | **FAIL**；曾直接在 480×272 的 `265.568 ms` 启动断言退出 |
| `bun run web && bun tools/verify-web-journey.ts` | PASS；4/4 状态与像素检查，0 console errors |

导入器统一从源数据库生成 shell、索引与全部 shard，没有手改逐条产物或地图特判；变更仅在游戏仓，`vendor/pocket-rpgkit`/`vendor/pocketjs` 均未修改。全部临时性能/变异改动已还原，交付前工作树除本审查报告外无差异。

## 放行条件

保持当前正确性与网页门禁的前提下，使官方 QuickJS 命令在两个视口的重复运行均满足 `startup_to_first <= 250 ms`；建议先补齐 bundle 求值、JSON literal、战斗注册、首帧渲染四段仪表，并给 250 ms 上限留出足够余量。修复后需原样重跑本报告中的启动分布、全量门禁和两项缓存/枚举变异。

FAIL
