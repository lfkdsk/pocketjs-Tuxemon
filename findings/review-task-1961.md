# GP1 修复 3 复审（被审任务 1961）

## 结论

**PASS。** 上轮唯一阻断 R1 已由一条从 inline 库键集合出发的完整 canonical 等价测试封住；
删除非分片顶层字段和改动一个真实怪物分片的两次独立变异都准确变红。组件指针已升级到
`03533e3624532febc7094676a5ee13808df71c88`，落盘外壳在生成、磁盘测试/工具读取和规定的三条
产品构建路径上都有构建期或测试期 freshness 检查；真实落盘篡改变异让 `bun run build` 退出 1。

独立重建桌面包后，官方 Rust/QuickJS journey harness 在两个视口各连续跑 10 次：中位分别为
156.168 ms 和 159.869 ms，最慢分别为 232.271 ms 和 232.815 ms，均满足 median ≤225 ms、
每次 ≤250 ms。20 次完整 journey 的切图、进出战斗、稳态结构操作和终态哈希也全部满足门槛。
完整导入、编译、构建、Wasm、156 项测试、指定 golden、locks/frozen/determinism 和网页 journey
均通过；最终工作树干净。

审查范围：

```text
base:          dfd9a60 docs: review GP1 fix 2 keepalive staging and merge
reviewed HEAD: b0b6672 docs: report GP1 fix 3 parity test, kit 03533e3, and the 10x2 startup acceptance
branch:        fleet/task-1939
component:     b778aa0467df88cd22e3804e12f44fa7da37cb12 -> 03533e3624532febc7094676a5ee13808df71c88
```

## 阻断项

无。

## 逐条验收

| 项目 | 结果 | 独立证据摘要 |
| --- | --- | --- |
| R1：完整 battle runtime DB 等价 | 成立 | 恢复态专项 3 pass；删 `sourceRevision` 与改 `aardart.height` 两次变异分别在键集合和 canonical 全对象断言处失败 |
| KP1 升至 `03533e3` | 成立 | Gitlink 精确指向要求提交；运行时默认返回声明哈希，构建/测试检查重算新鲜度 |
| 所有落盘 ProjectShell 路径受保护 | 成立 | `gen-assets.ts` 写后读回检查；`readShardedProject` 检查；真实磁盘测试检查；build/web/desktop 均先生成；产品入口与 benchmark bundle 均由规定验收中的已检查产物构建 |
| 外壳篡改变异 | 成立 | 构建期将 `title` 落盘改坏而不改哈希，`bun run build` 在 `assertShellManifestFresh` 报 declared/computed mismatch 并退出 1 |
| 启动 median ≤225、全部 ≤250 | 成立 | 480×272 为 156.168/232.271 ms（median/max）；960×544 为 159.869/232.815 ms；20/20 通过硬断言 |
| 切图/进出战斗 ≤50、战斗稳态结构操作 0 | 成立 | 两视口 10 次 worst-of-run 最大分别为 16.255、22.686、38.458 ms；合计 22,640 个稳态帧结构操作为 0 |
| 终态一致 | 成立 | 20/20 为 `5653f0110656dd4e0a930ff1908c833c9f9fc221c9cfd3a90d22b138ef8d4827` |
| 完整门禁、画面与仓库卫生 | 成立 | 见下文；无 skip、无生成 diff、无 lockfile 改动、PocketJS 指针不变 |

## R1：分片战斗库全量等价

### 静态检查

`tests/battle-repository.test.ts:40-51` 的新测试没有再维护第四份字段清单：它先从两边对象本身取得
键集合并比较，再比较完整 canonical JSON。期望侧是 `readInlineBattleDb(ROOT)`，因此 inline 数据库
新增任一顶层字段都会自动进入断言。`canonicalJson` 在
`vendor/pocket-rpgkit/src/engine/save.ts:206-219` 对对象执行递归 `Object.keys(...).sort()` 并读取每个值；
这会触发 `battle/battle-repository.ts:53-69` 的 Proxy `ownKeys` / property descriptor / `get`，强制解析
四张懒表的全部条目，而非只比较索引或 journey 访问过的子集。

独立枚举当前产物得到 17 个完整顶层键；四张表两边的数量均为 monsters 257、techniques 245、
items 113、statuses 35。恢复态运行：

```text
$ bun test tests/battle-repository.test.ts tests/map-shards.test.ts
6 pass
0 fail
4860 expect() calls
```

### 变异 1：删除非分片顶层字段

临时删除 `battle/battle-repository.ts:91` 的
`sourceRevision: shell.sourceRevision`，只跑新测试：

```text
$ bun test tests/battle-repository.test.ts --test-name-pattern 'complete inline battle database'
error: expect(received).toEqual(expected)
    "shapes",
-   "sourceRevision",
    "statuses",
0 pass
1 fail
```

这正好复现上一轮 R1 缺口，并在键集合断言处变红。

### 变异 2：改一个真实怪物分片

临时把 `dist/battle/monsters/aardart.json` 的 `height` 从 185 改成 186，再跑同一测试：

```text
Expected: ... "height":185 ...
Received: ... "height":186 ...
0 pass
1 fail
```

失败发生在 `tests/battle-repository.test.ts:51` 的完整 canonical 比较，证明测试确实解析了怪物分片，
不是只比较顶层键或索引。两次变异均用反向补丁恢复，随后上述 6 项专项测试全绿且相关文件零 diff。

## KP1 升级与外壳新鲜度

### 组件语义与接线

子模块只从 `b778aa0` 升到 `03533e3`，其中功能提交为
`6288766 perf(engine): stop rehashing the packaged map shell at startup`。独立核对：

- `vendor/pocket-rpgkit/src/engine/map-repository.ts:161-170` 对合法的声明哈希默认直接返回，只在
  `verify=true` 时重算；无声明时仍回退到计算；
- `:180-203` 的 `assertShellManifestFresh` 要求合法声明，重算内容并在不一致时同时报告两个摘要；
- `vendor/pocket-rpgkit/src/engine/session.ts:461-466` 只在调用方明确传
  `verifyMapManifest: true` 时要求运行时重算，符合 KP1；
- `gen-assets.ts:168-173` 写完真实 `dist/project-shell.json` 后重新从磁盘读取并检查；
- `tools/generated-project.ts:26-38` 的所有磁盘 sharded-project 工具入口在构建 repository 前检查；
- `tests/map-shards.test.ts:63-73` 检查真实落盘外壳、非哈希字段内存变异和缺声明三种情况。

落盘外壳路径盘点如下：

| 路径 | 保护方式 |
| --- | --- |
| `ui/gp1-data-stage.ts` → `main.tsx` 产品 bundle | `tools/build.ts:9-14` 先运行 `gen-assets.ts`；`tools/desktop.ts:15` 同理；`package.json:27` 的 web 命令也先运行它 |
| `tools/generated-project.ts` → replay/frozen/locks/test 工具 | 读取后立即 `assertShellManifestFresh` |
| `tests/map-shards.test.ts` | 测试载入真实磁盘字节并直接检查 freshness |
| `tools/map-benchmark-entry.tsx` scratch bundle | 不属于交付运行时；规定的启动验收先执行 `desktop --build-only`（会生成并检查），随后从同一已检查产物构建 benchmark |

`main.tsx` 不在 QuickJS 启动时重算，正是 KP1 的性能目标；它依赖所有产品构建入口都先运行生成器。
本轮实际 `bun run build`、`bun run web`、`bun tools/desktop.ts --build-only` 三条输出开头均出现完整
`gen-assets.ts` 生成统计，之后才进入 PocketJS build。

### 变异 3：改真实落盘外壳但保留旧哈希

我临时在生成器写盘与检查之间加入第二次写盘，把真实 `dist/project-shell.json` 的 `title` 改为
`Pocket Tuxemon MUTATED`，保留 splitter 声明的旧 `mapManifestHash`，再执行产品构建：

```text
$ bun run build
error: map repository: shell manifest hash mismatch:
declared 5c37136940b27ce8c4015aad10bd99a1cc8212d5c81226bb9f78eb10eb91515b,
computed f8b956b097b27c58517eefb037d2c73ddadedd8b39a82748569d062b3d60e806
at gen-assets.ts:178:1
error: script "build" exited with code 1
```

反向补丁移除变异并重新 `bun run import` 后，外壳和生成器都回到零 diff，6 项 R1/KP1 专项测试恢复全绿。

## 启动验收：官方 QuickJS 10×2

先执行 `bun tools/desktop.ts --build-only`，成功生成 1,145,632 B 的 linux JS bundle、pak 并编译 release
host。随后把 `tools/g6-quickjs-bench.rs` 按官方 `tools/bench-g6-quickjs.sh:12-25` 的方式 include 到
PocketJS desktop host，在独立的 `G6_BENCH_ROOT=/var/tmp/fleet/1962/bench-root` 编译 release harness。
正式样本串行运行，无 Bun/JSC 计时；每个样本都走完 3,793 帧 journey，而非只测首帧。

### 每次 uptime 与启动值

机器为 32 核。以下是每次启动前记录的系统时间、1 分钟 load average 与
`startup_to_first`；两组各自连续运行，中间没有并发门禁。

| run | 480 时间 | load1 | 480 ms | 960 时间 | load1 | 960 ms |
| ---: | --- | ---: | ---: | --- | ---: | ---: |
| 1 | 05:03:57 | 2.03 | 232.271 | 05:06:20 | 1.72 | 232.815 |
| 2 | 05:04:10 | 2.03 | 146.350 | 05:06:33 | 1.61 | 153.380 |
| 3 | 05:04:23 | 1.96 | 161.265 | 05:06:46 | 1.77 | 165.872 |
| 4 | 05:04:36 | 1.89 | 151.114 | 05:06:59 | 1.72 | 155.247 |
| 5 | 05:04:49 | 1.83 | 160.408 | 05:07:12 | 1.63 | 152.402 |
| 6 | 05:05:01 | 1.80 | 150.392 | 05:07:25 | 1.68 | 167.697 |
| 7 | 05:05:14 | 1.84 | 160.722 | 05:07:38 | 1.67 | 153.330 |
| 8 | 05:05:27 | 2.12 | 151.928 | 05:07:51 | 1.73 | 164.490 |
| 9 | 05:05:40 | 1.95 | 161.959 | 05:08:04 | 1.84 | 153.377 |
| 10 | 05:05:53 | 1.96 | 149.313 | 05:08:17 | 1.87 | 166.850 |

| 视口 | n | min | median | p90 | max | ≤250 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 480×272 | 10 | 146.350 | **156.168** | 161.959 | 232.271 ms | 10/10 |
| 960×544 | 10 | 152.402 | **159.869** | 167.697 | 232.815 ms | 10/10 |

两个首样本的 host-init 分别为 145.406/141.882 ms，之后落到约 77–84 ms；即使保留这两个冷样本，
中位和最大值也都有余量。官方代码 `tools/g6-quickjs-bench.rs:670-674` 自身对每次
`startup_to_first <= 250` 做硬断言，20 次均未触发。

### 分段（10 次 min / median / p90 / max，ms）

| 段 | 480×272 | 960×544 |
| --- | --- | --- |
| host-init | 77.110 / 82.208 / 83.013 / 145.406 | 76.904 / 80.283 / 84.168 / 141.882 |
| compile | 40.260 / 44.025 / 46.026 / 48.282 | 41.455 / 45.180 / 46.474 / 46.632 |
| eval-before-module-start | 0.698 / 1.422 / 1.748 / 2.211 | 0.506 / 1.321 / 1.701 / 2.689 |
| module-start | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| engine | 0 / 0 / 1 / 1 | 0 / 0 / 0 / 1 |
| json-literals | 0 / 1 / 1 / 1 | 1 / 1 / 1 / 2 |
| battle-registration | 0 / 0.5 / 1 / 1 | 0 / 0.5 / 1 / 1 |
| **mount** | **24 / 25.5 / 28 / 31** | **27 / 30 / 32 / 36** |
| host-finish | 0.006 / 0.007 / 0.009 / 0.014 | 0.007 / 0.007 / 0.008 / 0.015 |
| TOTAL accounted | 144.201 / 153.829 / 159.500 / 228.912 | 150.062 / 157.420 / 165.142 / 229.217 |
| boot | 144.796 / 154.494 / 160.193 / 229.985 | 150.695 / 158.067 / 165.802 / 230.244 |
| unaccounted | 0.595 / 0.686 / 0.709 / 1.074 | 0.625 / 0.666 / 0.731 / 1.026 |

mount 中位已从上一轮约 104–108 ms 降到 25.5/30 ms，符合 KP1 不再在启动期 canonicalize + SHA-256
整个外壳的预期；accounted 与 boot 的差在全部样本均约 1.1 ms 以内。

### 完整 journey 帧预算与终态

下表取每个视口 10 次 run 各自 worst-of-run 后的最大值；每次都由同一官方 harness 分类：

| 指标 | 480×272 | 960×544 | 门槛 |
| --- | ---: | ---: | --- |
| map-switch max | 16.255 ms | 14.789 ms | ≤50，PASS |
| battle-entry | 22.077 ms | 22.686 ms | ≤50，PASS |
| battle-exit | 33.977 ms | 38.458 ms | ≤50，PASS |
| battle-steady structural | 0 / 11,320 帧 | 0 / 11,320 帧 | 0，PASS |

20 次都走完 3,793 帧、5 次 transfer 并到达 `spyder_route1`；每次写出的 canonical state SHA-256
均为 `5653f0110656dd4e0a930ff1908c833c9f9fc221c9cfd3a90d22b138ef8d4827`。

## 完整门禁

| 命令 | 独立结果 |
| --- | --- |
| `bun run import` 两遍，每遍 `git diff --exit-code` | 两遍均成功、0 tracked diff；五个核心产物摘要逐字一致 |
| 两轮导入核心摘要 | project `6bcf190e…`；shell `708775e6…`；battle DB `881814d8…`；battle runtime `c13f7811…`；import report `c1acea29…` |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | exit 0；`dist/main.js` 1,145,029 B |
| `bun run build:wasm` | exit 0；289,758 B |
| 字面量 `bun test` | **156 pass, 0 fail, 70,920 assertions，输出无 skip**；33 files，154.72 s |
| GB2/GB3/怪物生成/GB5 指定 7 文件 | **29 pass, 0 fail, 2,578 assertions** |
| `bun run verify:g6:locks` | 329 pages / 333 checks；327 unlocked、2 transferred、0 unresolved、0 error |
| `bun run verify:g6:frozen` | 263 maps；0 permanent locks、0 permanent blocking fibers、0 errors |
| `bun run verify:g6:determinism` | PASS；2 roots、4,636 files、61,054,321 bytes；SHA-256 `3a87d1d328c09b4cc11a209ec30b11f26e8092d616889308834215768f8fb70c` |
| `bun run web && bun tools/verify-web-journey.ts` | `WEB JOURNEY PASS`；3,793 frames，4/4 state+pixel checkpoints，0 console errors |
| `bun tools/desktop.ts --build-only` | exit 0；linux-app bundle 1,145,632 B，release host 成功 |

两轮导入的五个完整 SHA-256 分别为：

```text
6bcf190e89ce8779375454f3ba09053851b12cdac7c727357a66b8af1c536ee2  dist/project.json
708775e67811433db7411f17284669f2a7222768edd7718608c2c16e1e213f90  dist/project-shell.json
881814d8a162ceabd9c6ab6a89d666d12592fa8aa05ec215cd90ad87c7dfb161  data/battle-db.json
c13f7811d938ff413456d353c0b9768077c7d74a21f6746b3180f0dee811b2ca  data/battle-runtime-db.json
c1acea296d645de09e0e8d7c42b13e6e0ebfcb9729f3ed2f17a36bda69bd2e39  dist/import-report.json
```

## 画面人工核对

以原始分辨率实际打开而非只看哈希：

- `tests/goldens/gb5-battle-hit.480x272.png`：森林背景、双方 HUD/HP、玩家怪物、白色命中特效和
  “Nut used Bullet!” 文本可见，边缘没有裁切；
- `tests/goldens/gb5-battle-technique-menu.960x544.png`：Budaye、Nut、双方 HUD 与 Techniques 菜单完整，
  选择箭头停在 Bullet，保持清晰的 2× 像素构图；
- `tests/goldens/g6-route-1.3792.png`：水岸/岩石、树线、农田、草地、花、路牌、围栏、NPC 和玩家均在
  正确层级，没有空白块、错层或明显裁切。

上述 GB5 测试还独立覆盖了 12 张图片逐像素、960 的 2× composition、语义像素、rewind 像素恢复和
稳态零 lifecycle 操作；聚焦运行全部通过。

## 仓库卫生与原则

- 最终 `git status --porcelain=v1` 无输出，`git diff --check` 通过；三次变异均已恢复；
- `git diff dfd9a60..HEAD -- bun.lock` 无输出；`vendor/` 唯一差异是 RPG Kit gitlink
  `b778aa0 -> 03533e3`；新旧组件提交里的嵌套 PocketJS gitlink 都是
  `d48962e82a237cc49719e5a0da72a6dbd45ff5e8`，两个子模块工作树也干净；
- 四个改动源文件及 `dfd9a60..HEAD` 的五条提交信息均不含 fleet 任务号；
- 本轮没有手改导入规则或逐图特判。两轮全量 importer 产物完全稳定；
- 没有把 Tuxemon 专用代码写进组件仓，也没有改 `vendor/pocketjs`；
- `findings/G7-map-first-visits.tsv` 的 263 行只刷新 QuickJS 时间列；基线和 HEAD 的
  map/width/height/bytes/pass 列投影 SHA-256 均为
  `ac14f8ffd18d8bf421094fb749b19195b83ebed7efcb2eb776c79db29d947ec2`。

PASS
