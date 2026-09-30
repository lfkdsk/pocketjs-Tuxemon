# K4 修复 2（task 1900）复审

审查范围：修复前 `8849d1e`，被审 HEAD `31cfdf1`，提交
`28b3158..31cfdf1`。结论为 **FAIL**。要求点名的运行时命令、商店收支、项目
`initialGold`、说明/schema/hash、综合 economy 测试、变异敏感度和仓库卫生基本成立；但
“所有写进可保存数值状态的点都经过 `clampFiniteVar`”仍有一个生产 API 入口和一个恢复入口
遗漏：`createSwitchState(init)` 及 `cloneInterp` 原样复制四个数值 bank。因此公共初始状态和正式
存档恢复仍可带入远超安全整数范围的值，README 声明的共享不变量不成立。

## 阻断项

### B1 — 公共初始状态与恢复克隆仍绕过共享有限安全整数规范化

`createSwitchState(init)` 是公开的数值状态构造入口，但 `items`、`variables`、`shopStock` 直接
`keyedRecord(init?....)`，`gold` 直接取 `init?.gold ?? 0`，没有一项调用 `clampFiniteVar`
（`src/engine/interpreter.ts:113`–`:123`）。`createInterpState(sw)` 随后仍通过这个构造器建立初始
bank（`:657`–`:662`），而 `startSession(..., sw0)` 正式接受该状态（`src/engine/session.ts:300`–
`:315`）。此外，正式恢复在 `restoreSessionSnapshot` 中调用 `cloneInterp`；该函数又在
`src/engine/interpreter.ts:768`–`:776` 原样复制四个 bank。save validator 只要求普通 bank 是
finite number、库存是非负 integer，并未要求 safe integer，所以恢复入口也不会补上这个遗漏。

独立复现把 `1e308` 从 `createSwitchState` 同时种入四个 bank，再走
`startSession` → `createSnapshot` → `encodeEnvelope` → `decodeEnvelopeText` →
`restoreSessionEnvelope`。实际输出：

```text
{"values":[1e+308,1e+308,1e+308,1e+308],"safe":[false,false,false,false],"decodedGold":1e+308,"restoredGold":1e+308}
```

这不是只在测试 helper 里可见：`createSwitchState` / `createInterpState` 是导出的运行时 API，
`startSession` 与正式 restore 都经过上述路径。它还直接反驳 `src/engine/README.md:119`–`:126`
“每个写入都经过 `clampFiniteVar`”的新增不变量说明。最小修复是让 state 构造/克隆入口也用同一
normalizer 逐项复制四个数值 bank（或者在等价的单一入口强制 safe integer），并加入公共初始
状态及 checksum-valid 旧存档恢复的回归。修后应继续保持 `shopStock` 的非负约束。

## 1. 共享有限整数写入：部分成立

本轮新接入的运行时写点本身正确：

- `clampFiniteVar` 在 `src/engine/interpreter.ts:1026` 导出，把 NaN 归零、向下取整并夹到
  `±Number.MAX_SAFE_INTEGER`；
- `variable` 三条写入在 `:1042`、`:1052`、`:1062` 经过它；
- `gold` / `item` 命令在 `:1074`、`:1077` 经过它；
- 商店买卖的金币、道具、库存扣减与回补在 `:1298`–`:1314` 经过它；
- 新游戏的 `Project.initialGold` 在 `src/engine/session.ts:326` 经过它。

上一轮点名的三类项目/命令路径均通过。两份目标测试实跑为：

```text
bun test tests/k4-variable-ops.test.ts tests/k4-shop-economy.test.ts
23 pass / 0 fail / 401 expect() calls
```

其中 `tests/k4-shop-economy.test.ts:249`–`:296` 用 schema 合法的
`initialGold: 1e308` + `sellPrice: 1e308` 卖出一件，经过正式 snapshot/envelope/session restore，
最终金币为 `Number.MAX_SAFE_INTEGER`。我另写 stdin 探针，让两次 `gold add 1e308` 与两次
`item add 1e308` 在同一真实 session 中执行，再走
`createSnapshot`/`encodeEnvelope`/decode/restore，实际输出：

```text
{"live":{"gold":9007199254740991,"gem":9007199254740991},
 "decoded":{"gold":9007199254740991,"gem":9007199254740991},
 "restored":{"gold":9007199254740991,"gem":9007199254740991},
 "finite":true,"safe":true}
```

但 B1 的构造/恢复入口遗漏使“每一处”这一验收项只能判部分成立，且为本次唯一阻断项。

## 2. 说明、schema 副本与 hash：成立

- schema、编辑器内嵌副本与类型注释现在都写“除零/模零保持变量不变”
  （`src/data/schema.json:401`、`editor/engine/projects.ts:430`、
  `src/engine/types.ts:107`–`:112`），与 CHANGELOG
  （`src/data/CHANGELOG.md:167`–`:171`）一致；仓库内已无旧的 `resolve to 0` 文案。
- 独立计算得到：

```text
{"MAP_SCHEMA_HASH":"9b9fa50504d9549201de1f1cb8fed94e06756b104146ff46ec46e296e280a453",
 "computed":"9b9fa50504d9549201de1f1cb8fed94e06756b104146ff46ec46e296e280a453",
 "equal":true}
```

  `tests/map-repository.test.ts:105`–`:110` 直接守住该等式；编辑器 schema deep-equal 测试也在
  全测中通过。针对 schema/hash/editor 的筛选复跑为 6 pass / 0 fail。

## 3. economy 综合回归：成立

新增 `tests/k4-shop-economy.test.ts` 与上一轮独立夹具的关键数据和期望逐项一致：

- 同一 `potion` 在两家店的回收价是 50 / 5（`:58`–`:72`、`:154`–`:169`）；
- `daytime` 条件行在 false 时隐藏、true 时出现（`:61`–`:66`、`:200`–`:204`、
  `:224`–`:233`）；
- `tm_avalanche` 库存 1→0 后，在 `:208`–`:215` 走正式 snapshot/envelope/restore，且同一
  checkpoint 重放两次相等；卖回后库存 0→1（`:172`–`:177`）；
- `:243`–`:246` 从头跑 60/30/20/4 Hz，均等于固定的 `EXPECTED_SUMMARY`
  （`:132`–`:140`）；最终值与上一轮夹具一致：`finalGold=3455`、`finalStock=1`、两件道具均 0、
  最终地图为 south。

两类指定变异都能让这个新增文件单独变红，随后均以反向补丁还原：

| 变异 | 命令与实际结果 |
|---|---|
| 买入时库存不减（`row.stock - 1` 改成 `row.stock`） | `bun test tests/k4-shop-economy.test.ts` → **3 pass / 2 fail**；期望 0，收到 1 |
| 条件行总显示 | 同命令 → **3 pass / 2 fail**；false 时列表意外多出 `tuxeball_diurnal` |

额外把 `gold` 命令写入改回裸加法，运行
`bun test tests/k4-variable-ops.test.ts -t 'gold add'` 为 **0 pass / 1 fail**，期望 finite=true、
实际 false。三次变异还原后，`git diff -- src/engine/interpreter.ts` 为空。

## 4. 编号、提交与仓库卫生：成立

- 对最终新增 TS 行（排除审查报告）及六个提交的标题/正文搜索
  `fleet|review-task|1876|1888|1900`，均无命中；`findings/k4-fix1-render.ts:1`–`:2` 已只保留
  语义性的 B1/B4 说明。
- 六个提交作者均为 `lfkdsk <lfkdsk@gmail.com>`，提交按共享 clamp、说明/hash、economy 回归、
  注释清理和报告拆分；没有 push 痕迹需要本地审查处理。
- `git diff --name-only 8849d1e..HEAD -- bun.lock package.json vendor` 无输出；子模块仍为
  `76ae741f`。golden/PNG 路径差异为空，`git diff --check` 通过，最终工作树在写报告前洁净。
- 运行时代码仍是通用 numeric-bank/shop 能力；没有 importer，也没有按 Tuxemon 地图/道具 id
  写入组件运行时的特判。Tuxemon 名称只用于综合测试夹具与语义说明。

## 5. bundle、画面与门禁

独立临时 worktree 重建修复前 `8849d1e`、共享 clamp 提交 `28b3158`，并与当前 HEAD 对照：

```text
8849d1e dist/sunstone.js = 394875 bytes
28b3158 dist/sunstone.js = 395078 bytes
HEAD    dist/sunstone.js = 395078 bytes
delta = +203 bytes
```

`sunstone.pak` 两端均为 3,308,336 bytes，`cmp` exit 0，SHA-256 都是
`fc07b7ad6a98e8e41fa264253ccbddb85584eb9b9811164efd0af7acf2257b1e`。因此 +203 B 在
`28b3158` 的共享 clamp/调用点进入 bundle 时一次产生；后续 schema/hash、测试、说明与注释提交
没有继续增加 Sunstone bundle，也没有资产增量。当前 bundle 仍低于 405,000 B 上界。

最终门禁严格串行执行：

```text
bun run build:example
exit 0; DIST_STABILITY=PASS files=18

bun test
768 pass
0 fail
458583 expect() calls
Ran 768 tests across 49 files. [82.46s]

bunx tsc --noEmit
exit 0
```

渲染脚本复跑后语义断言全部通过，两个 PNG 与已提交 golden 字节一致：买入页肉眼可见 Iron Key
`10g (3)`、Torch `5g (0)` 灰显；卖出页 Iron Key 为黄色选中，Rope `0g` 灰显，无裁切。
SHA-256 仍分别为 `884c177a...f057c` 与 `a5098e9e...ecf7`。

## 建议的最小修复集

1. 让 `createSwitchState(init)` 对 `gold` 及三个 record 的每个值调用 `clampFiniteVar`，并让
   `cloneInterp` 复用这个规范化复制入口；若旧存档策略选择拒绝而非迁移，则 save validator 必须
   明确要求 safe integer，不能继续静默恢复 `1e308`。
2. 加一份回归：四个 bank 由公共构造器种入 `1e308` 后均为 safe integer；另构造一份 checksum
   正确、bank 含 `1e308` 的 envelope，钉住 restore 的预期策略（规范化或带 typed error 拒绝）。

FAIL
