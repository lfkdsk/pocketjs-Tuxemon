# GP1 修复 2 复审（被审任务 1955）

## 结论

**FAIL。** B2 保活测试和 B3 QuickJS 分段已按规格修复；与 `main@ba32513` 同窗交替的
QuickJS 首帧样本没有性能回退，切图、进出战斗和战斗稳态结构操作门禁也通过。合并后
当前的 battle runtime shell 确实已经补齐 `npcs` / `ui`，12 张 GB5 golden 与 main
逐字节一致，完整导入、编译、测试、锁/冻结/确定性及网页 journey 门禁均通过。

仍有一个阻断项：修复通过三处手写字段清单补回 `npcs` / `ui`，却没有添加“完整 inline
runtime DB 与 reconstructed sharded DB 全量相等”的回归测试。删掉重建结果中现有的
`sourceRevision` 后，TypeScript 和 `tests/battle-repository.test.ts` 仍全绿。这意味着以后
runtime DB 再增加一个不被现有 journey 读取的顶层字段时，仍可重演本次静默漏字段。

审查基线与范围：

```text
main baseline: ba325132c1044173c3bda1db59af89edcee605a7
reviewed HEAD: 3b15f42f71664e5a5a9491d516c5dd461c4405e1
merge commit:  bee9ede merge main: GB5 battle skin/presentation, kit bump to b778aa0
```

本轮按任务说明不再把 225 ms 中位目标作为 GP1 的放行条件；它已移交组件仓 KP1。本轮
只判断相对 `main@ba32513` 是否回退。

## 逐条验收

| 项目 | 结果 | 摘要 |
| --- | --- | --- |
| B2：分片反推引用、双向 Set equality、无硬编码数量、文件存在 | 成立 | 专项测试通过，删项与加项变异均变红 |
| B3：宿主 compile/eval 边界、时钟、完整加和、marker 形状 | 成立 | 裸 QuickJS FFI + Rust `Instant`；错误 marker 变异直接 panic |
| 合并 main、整体重生成、当前 `npcs` / `ui` 字段修复 | 当前结果成立 | 当前 runtime/shell 顶层集合一致；生成核心数据与 main 一致 |
| 防止未来 battle shell 再漏字段 | **不成立** | 完整字段删项变异仍通过现有专项测试，见阻断项 |
| GB5 12 张 golden 与 main 一致 | 成立 | 两边各 12 张，逐文件 Git blob id 一致 |
| 相对 main 的启动性能不回退 | 成立 | 两视口各 10 对同窗交替样本，HEAD 在 20/20 配对中更快 |
| 切图/进出战斗 ≤50 ms、战斗稳态结构操作为 0 | 成立 | 两视口完整 QuickJS journey 均通过 |
| 完整门禁与仓库卫生 | 成立 | import 两遍稳定；tsc/build/wasm/tests/locks/frozen/determinism/web 全绿；未改 lock/vendor |

## 阻断项

### R1. battle runtime shell 没有完整字段等价回归测试

合并后的当前产物已经修对。独立比较 `data/battle-runtime-db.json` 与
`dist/battle-runtime-shell.json`，排除有意分片的
`monsters` / `techniques` / `items` / `statuses` 及对应 `*Index` 后，输出为：

```json
{
  "runtimeInline": [
    "elementOrder", "elements", "encounters", "environments", "format",
    "npcs", "rules", "scope", "shapes", "sourceRevision", "tasteOrder",
    "tastes", "ui"
  ],
  "shellInline": [
    "elementOrder", "elements", "encounters", "environments", "format",
    "npcs", "rules", "scope", "shapes", "sourceRevision", "tasteOrder",
    "tastes", "ui"
  ],
  "runtimeOnly": [],
  "shellOnly": []
}
```

三处实现目前也一致：`BattleRuntimeShell` 在 `importer/battle-schema.ts:264-281` 声明
`npcs` / `ui`，`splitBattleRuntimeDb` 在 `importer/battle.ts:971-988` 写入，
`createTuxemonBattleDbProvider` 在 `battle/battle-repository.ts:89-107` 重建。因此当前 GB5
战斗不再在 `db.ui.hpBar` 崩溃。

但该一致性只来自三份手写列表，没有测试锁定。现有
`tests/battle-repository.test.ts:40-46` 先把两边投影成 reducer rules DB 后比较，会丢掉
不被该适配器使用的顶层字段；`:48-80` 只比较维护 journey 实际访问后的会话状态，也不能
证明完整 DB 对象相等。`battle/battle-repository.ts:89-107` 最后还通过
`as unknown as BattleDb` 绕过结构完整性检查。

我做了直接变异：临时从 `createTuxemonBattleDbProvider().load()` 构造的对象里删除
`sourceRevision: shell.sourceRevision`，然后运行：

```text
$ bunx tsc --noEmit && bun test tests/battle-repository.test.ts
2 pass
0 fail
3797 expect() calls
```

这不是未来字段的假设性争论：已存在的必需顶层字段被漏掉，当前针对该 repository 的全部
测试仍然放行。变异随后恢复，工作树回到无差异状态。

放行所需修复很小：在 `tests/battle-repository.test.ts` 直接对
`readShardedBattleDb(ROOT).load()` 与 `readInlineBattleDb(ROOT)` 做 canonical 全量等价比较
（必要时先枚举四张 lazy 表以触发加载），并重复一个非分片顶层字段删项变异确认会失败。
这会同时保护已有字段及以后新增字段，而不是继续钉另一份字段名清单。

## B2：保活清单双向测试

`tests/g6-keepalive.test.ts:23-85` 满足本轮要求：

- 直接 `readdirSync` 遍历 `dist/npc-src/*.json`、`dist/animated/*.json` 和
  `dist/terrain-stream/{ground,upper}/*.json`，没有经同一生成过程产出的 index 间接自证；
- 用 `collectNpcSrcAssetPaths`、`collectAnimatedAtlasNames`、`collectStreamRefKeys` 从实际分片
  内容反推引用；
- 对 `missing` 和 `extra` 两个方向比较 Set，不钉条目数量；
- NPC/animated 检查源文件存在，terrain 检查对应 pak TILESET 条目及其文件存在。

恢复态专项运行：

```text
$ bun test tests/g6-keepalive.test.ts
3 pass
0 fail
2369 expect() calls
```

两次独立变异均能证明断言不是形式上的：

```text
删除 ui/npc-src-assets.ts 中真实项
assets/characters/npc-npc-xerogrunt-walk-r-3.png
=> 1 fail，差异明确列入 missing

向 ui/animated-assets.ts 加入不存在于分片引用的
assets/anim/terrain-extra.png
=> 1 fail，差异明确列入 extra
```

两次变异后均恢复；最终 `git diff --exit-code` 为 0。

## B3：可信 QuickJS 分段

### FFI 与边界

实现采用规格给出的“在宿主边界拆 compile/eval”路径：

- `tools/g6-quickjs-bench.rs:86-122` 在实际 QuickJS context 中先调用带
  `JS_EVAL_FLAG_COMPILE_ONLY` 的 `JS_Eval`，再调用消费 compiled value 的
  `JS_EvalFunction`；成功路径只释放返回值，没有二次释放已被消费的 compiled value；
- `:136-200` 复制实际 `Runtime::boot` 边界，仅将原来合并的 `guest.eval` 换成上述两步；
  surface、pak、offload、data.fs、supervisor 与产品 host 相同，没有改 `vendor/`；
- host-init、compile、eval、host-finish 都用 Rust `Instant`；只有 eval 内四段 marker 仍用
  QuickJS `Date.now()`，所以显示为整数毫秒。实现明确保留这个分辨率限制，没有伪造小数精度；
- `:37-54` 强制 marker 名称、顺序和数量恰好为
  `module-start → engine → json-literals → battle-registration → mount`，并额外断言时间非递减。

### 真实分段与加和

从已编译的相同 QuickJS host 取一组双视口审查样本；为了不重复完整 3,793 帧 journey，
审查目录里的临时副本只把 250 ms assert 放宽并在首帧后 return，分段实现和被测产品
bundle 未改，仓库源码未改：

| 段（ms） | 480×272 | 960×544 |
| --- | ---: | ---: |
| host init | 147.608 | 144.990 |
| compile | 49.594 | 47.564 |
| eval before module-start | 1.996 | 2.185 |
| module-start | 0.000 | 0.000 |
| engine | 1.000 | 0.000 |
| json literals | 1.000 | 1.000 |
| battle registration | 1.000 | 1.000 |
| mount | 113.000 | 125.000 |
| host finish | 0.015 | 0.015 |
| **分段合计** | **315.212** | **321.753** |
| `boot_ms` | 316.283 | 322.803 |
| boot 未计入误差 | 1.071 | 1.050 |
| 首帧 total | 2.132 | 2.206 |
| `startup_to_first` | 318.673 | 325.260 |
| `startup_to_first - (分段合计 + 首帧)` | 1.329 | 1.301 |

每个视口的完整分段加首帧与 `startup_to_first` 都在 1.4 ms 内闭合；差值包含
`boot_start` 外层与各内部 `Instant` 之间的调用间隙，以及首帧前后未放入
`first_total` 的少量 benchmark  bookkeeping。另一次较安静的原始正式样本也给出：

```text
480: accounted=224.430 boot=225.069 unaccounted=0.640 first_total=1.502 startup_to_first=226.720
960: accounted=251.565 boot=252.286 unaccounted=0.721 first_total=1.731 startup_to_first=254.199
```

所以 960 的提交版 250 ms 绝对断言在该次样本会失败；按本轮明确修正，这不是 GP1 的
阻断项，绝对启动目标由 KP1 负责，本轮只做下面的相对不回退判断。

marker 变异也真实经过 Rust/QuickJS host：把期望数组最后一项临时改为 `WRONG` 后，输出：

```text
assertion `left == right` failed
left:  ["module-start", "engine", "json-literals", "battle-registration", "mount"]
right: ["module-start", "engine", "json-literals", "battle-registration", "WRONG"]
test result: FAILED
```

随后恢复，`git diff --exit-code -- tools/g6-quickjs-bench.rs` 为 0。

## 合并 main 与 GB5

`bee9ede` 合并 `main@ba32513`。两份冲突的生成报告由 `bun run import` 整体重生成，
没有手拼 JSON；`tools/g6-quickjs-bench.rs:652-660` 的顺序是先执行 `boot_staged`、报告
marker，再安装 GB5 structural counter，最后渲染首帧，符合上一轮前瞻。

独立比较确认：

- `data/battle-runtime-db.json`、`data/battle-db.json`、`ui/battle-assets.ts` 与 main 无差异；
- 两份 assets report 的差异是合并 GP1 repository 统计后的整体生成结果；
- `tests/goldens/gb5-battle-*.png` 在 HEAD 与 main 都是 12 张，每一张的 Git blob id 一致；
- terminal expected hash 已更新为
  `5653f0110656dd4e0a930ff1908c833c9f9fc221c9cfd3a90d22b138ef8d4827`；
- `tests/battle-repository.test.ts:80` 的 60 s timeout 与 main 对同一条 3,793 帧逐帧 replay
  使用的 timeout 一致；实际运行只需数秒，没有掩盖死锁或无限循环。

GB2、GB3、怪物生成和 GB5 的恢复态聚焦复跑为：

```text
$ bun test tests/battle-golden.test.ts \
    tests/battle-gb3-golden.test.ts \
    tests/battle-gb3-double-golden.test.ts \
    tests/battle-gb3-progression-golden.test.ts \
    tests/battle-spawn.test.ts \
    tests/battle-presentation-sim.test.ts \
    tests/battle-presentation.test.ts
29 pass
0 fail
2578 expect() calls
```

其中真实 GB5 scene 测试明确跑完六个 checkpoint 的双分辨率 12 张图、2× composition、
语义像素、rewind 像素恢复和 steady-frame 零 lifecycle 操作。

## QuickJS 性能与结构操作

### 与 main 同窗交替的启动对比

在 detached `/var/tmp/fleet/1958/main-ba32513` 重新 build main，并让 HEAD/main 复用同一版
release QuickJS host。每个视口做 10 轮 HEAD→main 同窗交替；每轮前记录 `uptime`，各构建
使用各自的 `G6_BENCH_ROOT`，测量窗口的一分钟 load average 约为 9–11。重复采样用临时
benchmark 副本只放宽 250 ms assert 并在首帧后返回，未修改仓库或任一被测 bundle。

| 构建 | 视口 | n | min | median | p90 | max |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| HEAD（分片） | 480×272 | 10 | 241.136 | 298.476 | 316.043 | 327.115 ms |
| main（未分片） | 480×272 | 10 | 336.672 | 361.249 | 379.098 | 385.840 ms |
| HEAD（分片） | 960×544 | 10 | 223.539 | 228.780 | 251.143 | 254.204 ms |
| main（未分片） | 960×544 | 10 | 281.076 | 299.142 | 310.735 | 311.638 ms |

不仅四项分布统计更快，20/20 个配对样本中 HEAD 的 `startup_to_first` 都小于紧邻的
main 样本，足以支持本轮要求的“相对 main 不回退”。HEAD 自身 mount 段分布为：

| 视口 | min | median | p90 | max |
| --- | ---: | ---: | ---: | ---: |
| 480×272 | 98 | 108 | 115 | 122 ms |
| 960×544 | 102 | 104.5 | 116 | 118 ms |

绝对 225/250 ms 在共享机器上并不稳定，但本轮规格明确将该绝对优化交给 KP1，不能把
它重新作为本修复的失败理由。

### 完整 journey 单帧预算

恢复完整 journey 的 QuickJS host，在两个视口都走完 3,793 帧并命中相同终态哈希：

| 指标 | 480×272 | 960×544 | 验收 |
| --- | ---: | ---: | --- |
| map-switch max | 12.999 ms | 14.733 ms | ≤50 ms |
| battle-entry | 22.011 ms | 23.124 ms | ≤50 ms |
| battle-exit | 34.219 ms | 38.193 ms | ≤50 ms |
| battle steady | 1,132 帧 / structural 0 | 1,132 帧 / structural 0 | 通过 |

所有预算均有明显余量；structural counter 覆盖 create/destroy/insert/remove 四类操作。

## 完整门禁

所有关键变异恢复后独立复跑：

| 命令 | 结果 |
| --- | --- |
| `bun run import` 两遍，每遍后 `git diff --exit-code` | 两遍均成功，0 tracked diff |
| 三次产物 SHA-256 | runtime DB `c13f7811…`；shell `b3aaefda…`；G6 report `07410a9a…`，三轮一致 |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build && bun run build:wasm` | exit 0；wasm 289,758 bytes |
| `bun test` | 154 pass，0 fail，70,915 assertions，0 skip |
| 上述 GB2/GB3/monster/GB5 聚焦套件 | 29 pass，0 fail，2,578 assertions |
| `bun run verify:g6:locks` | 329 pages / 333 checks；327 unlocked、2 transferred、0 unresolved、0 error |
| `bun run verify:g6:frozen` | 263 maps；0 permanent locks、0 blocking fibers、0 errors |
| `bun run verify:g6:determinism` | PASS；2 roots、4,636 files、61,054,321 bytes；SHA-256 `3a87d1d328c09b4cc11a209ec30b11f26e8092d616889308834215768f8fb70c` |
| `bun run web && bun tools/verify-web-journey.ts` | `WEB JOURNEY PASS`；3,793 frames，4/4 state+pixel checkpoints，0 console errors |

## 画面人工核对

实际以原始分辨率打开了以下 committed PNG，而不是只核对哈希：

- `tests/goldens/gb5-battle-hit.480x272.png`：森林背景、双方 HUD/HP、Nut、命中特效和
  “Nut used Bullet!” 文本均可见，边界无裁切；
- `tests/goldens/gb5-battle-hit.960x544.png`：与 480 版本保持相同构图和清晰的 2× 像素缩放；
- `tests/goldens/g6-route-1.3792.png`：水面、岩石、树线、草地、花、路牌、围栏、NPC 与玩家
  都在预期层级，没有空白块、错层或明显裁切。

## 仓库卫生与原则检查

- `git diff ba32513..HEAD -- bun.lock vendor` 无输出；组件子模块为 `b778aa0`，其记录的
  PocketJS 子模块为 `d48962e8`，没有本任务额外修改；
- `git diff --check` 通过；所有审查变异均已恢复；
- 排除 findings、vendor 和生成数据后，源码以及 `ba32513..HEAD` 提交信息均无 `1955` / `1958`
  等 fleet 任务号；
- B2 产物继续由 importer 全量生成，没有逐图手改；本轮没有把 Tuxemon 专用逻辑写入组件仓。

## 放行条件

添加一条完整 runtime DB parity 测试：让 sharded provider 重建出的全部 `BattleDb` 与
`data/battle-runtime-db.json` canonical 等价，并通过删除任一非分片顶层字段的变异。其余本轮
要求已满足。

FAIL
