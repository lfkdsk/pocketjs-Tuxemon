# K4 修复 1（task 1888）复审

审查范围：修复前 `fc74820`，被审 HEAD `a93f380`，提交 `6175ea3..a93f380`。严格先运行
`bun run build:example`，再运行 `bun test`。结论为 **FAIL**：B1 的运行时数据形状与状态语义、
B2、B4 都成立，B3 的 `variable` 命令本身也已修正；但新增审查要求明确点名的商店金币等数值写入
仍可制造不可读存档，B5 又在新增渲染脚本中重新写入了审查号。此外，规格要求的 census 形状综合
回归没有进入自动测试。

## 阻断项

### B3 — 有限整数规范化没有覆盖商店金币等数值写入点

`clampVar` 本身正确，`random`、变量引用运算、字面量运算三个 `variables[...]` 写入都经过它
（`src/engine/interpreter.ts:1020`、`:1037`、`:1047`、`:1057`）。但是同一可保存状态里的其他
数值银行仍直接算术：`gold`/`item` 命令在 `src/engine/interpreter.ts:1069`、`:1072`，商店买卖在
`:1291`、`:1292`、`:1301`、`:1302`，库存回补在 `:1307`。这不满足本轮额外要求“所有写入点，
包括随机、商店金钱，经过同一有限整数规范化”。

独立复现使用 schema 合法的 `initialGold: 1e308` 与 `sellPrice: 1e308`，卖出一件后关闭商店并走
真实 envelope：

```text
{"schemaErrors":0,"gold":"Infinity","finite":false,"canSave":true,"decode":"SaveError: save state is invalid: state.interp.sw.gold: finite number required"}
```

直接连续执行 `gold add 1e308`、`item add 1e308` 也得到：

```text
{"gold":"Infinity","goldFinite":false,"item":"Infinity","itemFinite":false}
```

因此合法项目仍能让 `canSave` 错误返回 true，而写出的存档无法读回。应把有限整数规范化提成所有
数值状态写入共用的函数，并至少覆盖初始化、`gold`、`item`、商店收支/库存及以后战果/ext 回写。

同一修复的权威说明也不一致：CHANGELOG 正确写“除零/模零保持不变”
（`src/data/CHANGELOG.md:160`），但规范 schema 仍写“resolve to 0”
（`src/data/schema.json:401`），生成给编辑器的副本同样错误（`editor/engine/projects.ts:430`），
TypeScript 类型注释也仍写“resolve to 0”（`src/engine/types.ts:110`）。

### B5 — 新增代码注释仍含审查号

对 `fc74820..HEAD` 的新增行搜索只命中一处，但已经足以使 B5 不成立：
`findings/k4-fix1-render.ts:1` 新增注释包含 `review-task-1876.md`。实际命令输出：

```text
38:+// Reviewer-only visual proof for K4 fix 1 (review-task-1876.md B1 stock /
```

四个新提交的标题/正文没有 fleet 任务号；问题只在这条新增代码注释。

### B1-test — 缺少规格要求的综合自动回归夹具

运行时通过了我写的真实形状夹具（见下节），但被审提交没有加入规格要求的“至少两家店、同一道具
不同回收价、有限库存、条件货品、正式读档”的综合自动测试。`tests/k4-shop.test.ts:212`、`:240`、
`:280` 分别用单店小用例覆盖字段；`:269` 只对一个 `InterpState` 做原始 JSON 往返；`:368` 的
多 hz/中途 JSON 用例没有库存、条件或第二家店。搜索结果为：

```text
save_api_refs=0 multi_shop_markers=0
```

即该测试文件没有 `createSnapshot` / `encodeEnvelope` / `decodeEnvelopeText` /
`restoreSessionEnvelope`，也没有多店场景。独立审查脚本能证明当前实现工作，但不是 `bun test` 会自动
执行的回归，不能替代验收要求。

## B1：Tuxemon economy census 对照

上一轮 census 的 14 个 economy、75 个道具行、6 个有限库存行、4 个条件行、18 个
`cost != floor(price/2)` 行以及单店最多 19 项，都能由新通用形状直接承载：

| 上游事实 | 新形状 / 状态 | 判定 |
|---|---|---|
| 14 个 economy，库存按 economy + item 持久 | `shop.id` + `SwitchState.shopStock`（`src/engine/types.ts:156`、`src/engine/interpreter.ts:1096`） | 成立 |
| 75 行、单店最多 19 项 | `goods: ShopGood[]` 无 19 项上限（`src/data/schema.json:560`） | 成立 |
| 每店买价与 18 个特殊回收价 | `price` + 每店 `sellPrice`（`src/data/schema.json:569`） | 成立 |
| 6 个有限库存行 | `stock`；买减、卖回同店加（`src/engine/interpreter.ts:1293`、`:1303`） | 成立 |
| 4 个 `daytime=true/false` 条件行 | `condition` 复用 `PageCondition` / `condition.all`（`src/data/schema.json:572`） | 成立 |
| 只回收 resellable 道具 | `Item.sellable` + `sellList:"hide"`（`src/engine/interpreter.ts:1168`） | 成立 |
| bag 最多 99 种，已有种类继续叠加 | `system.inventory.maxKinds` / `maxPerItem`（`src/data/schema.json:34`） | 可配置；成立 |
| bag 满转 locker | 组件不实现；`findings/K4.md:114` 明确要求游戏 importer 在覆盖率报告中记降级 | 已写清的游戏侧降级 |

独立夹具 `findings/review-task-1888-economy.ts` 直接采用真实 census 形状：

- `spyder_cotton_tech` 的 `tm_avalanche`：`price=2000`、`sellPrice=400`、`stock=1`；
- `spyder_cotton_scoop` / `tuxe_mart_taba` 形状下，同一 `potion` 的回收价分别为 50 / 5；
- `tuxeball_diurnal` 用 `daytime=true` 条件；
- 买入把库存 1→0，关闭商店后用 `createSnapshot` + `encodeEnvelope` +
  `restoreSessionEnvelope` 正式恢复仍为 0，卖回后 0→1；同一 save checkpoint 重放两次相同；
- 60/30/20/4 Hz 四次结果完全一致：
  `{savedStock:0,southPotionSellPrice:5,northPotionSellPrice:50,finalStock:1,finalGold:3455,
  finalItems:{potion:0,tm_avalanche:0},finalMap:"south"}`。

这说明 B1 的运行时代码能无损承载当前 P1 道具 economy；阻断是缺少同形状的自动门禁，而不是形状
本身失败。

## B2：选项标签

成立。规范与编辑器副本都把 `choices.options[].text.maxLength` 提到 64
（`src/data/schema.json:364`）；`bun test tests/k4-choices.test.ts` 为 **7 pass / 0 fail**，明确验证
64 可过、65 被拒，以及 33 字真实标签 `Tuxemon: Spyder and the Cathedral` 可过
（`tests/k4-choices.test.ts:104`、`:114`）。UI 仍在 24 字显示预算处加省略号，不截断导入文本。

## B3：变量命令本体

变量命令的目标语义成立：

- `1e308 * 1e308` 夹到 `Number.MAX_SAFE_INTEGER`，并通过真实
  `createSnapshot` / `encodeEnvelope` / `decodeEnvelopeText` 往返
  （`tests/k4-variable-ops.test.ts:149`、`:160`）；
- `-7 / 2 = -4`（`src/engine/interpreter.ts:1052`）；
- 除零/模零保留左值（`:1052`、`:1053`）；
- grep 得到的三处运行时 `variables[...] =` 都调用 `clampVar`。

还原全部变异后，`bun test tests/k4-shop.test.ts tests/k4-variable-ops.test.ts` 为
**51 pass / 0 fail / 177 assertions**。但上面的 B3 阻断说明“整个数值状态都可保存”的目标仍未达到。

## B4：不可售道具与 UI 肉眼验收

成立。有效卖价 ≤0 或 `Item.sellable:false` 会产生 `sellable:false` 行；默认 `disable` 保留并禁用，
`hide` 省略，卖出确认先检查 `row.sellable`（`src/engine/interpreter.ts:1164`、`:1168`、`:1300`）。
目标测试覆盖 0g 确认后金币/数量不变、hide 不挂行、显式 false（`tests/k4-shop.test.ts:295`）。

我在本次构建后重新运行 `bun findings/k4-fix1-render.ts` 并亲自打开两张 480×272 PNG：

- `findings/k4-fix1-artifacts/shop-buy-stock.png`：右下 248×96 面板清楚显示 Iron Key
  `10g (3)`；Torch `5g (0)` 为灰色，行内无裁切；
- `findings/k4-fix1-artifacts/shop-sell-disabled.png`：Iron Key 为黄色选中行，Rope `0g` 为灰色
  禁用行，Back 与提示行清楚。

语义断言实测：售罄行 24 个 dim 像素；正常卖出行 33 个 accent 像素；不可售行 19 个 dim、0 个
accent 像素。两张 PNG SHA-256 分别为
`884c177ab591282159247e699673dcb4a7088f1fc2674f0ad9302d73593f057c`、
`a5098e9e1fb4163f19f823cd51d9abda1c8502a749d47966c61fd39ff029ecf7`。

## 变异检查

四类指定变异逐个应用、运行目标测试、再用反向 patch 还原：

| 变异 | 命令 | 实际结果 |
|---|---|---|
| 买入不写 `shopStock`（库存不持久） | `bun test tests/k4-shop.test.ts -t 'finite stock'` | 0 pass / 3 fail；库存仍为 2/1，`north:key` 为 undefined |
| 条件行总显示 | `bun test tests/k4-shop.test.ts -t 'condition-gated goods rows'` | 0 pass / 1 fail；未解锁时多出 torch |
| 除零/模零写回 0 | `bun test tests/k4-variable-ops.test.ts -t 'division.*modulo.*0'` | 0 pass / 2 fail；期望 7/12，收到 0 |
| 忽略 `row.sellable` | `bun test tests/k4-shop.test.ts -t 'unsellable rows'` | 2 pass / 1 fail；note 数量 1→0 |

还原后 `git diff -- src/engine/interpreter.ts` 为空，随后两份目标测试 51/51 通过。

## 门禁、schema、体积与卫生

- 顺序门禁：`bun run build:example` exit 0；随后 `bun test` 为
  **761 pass / 0 fail / 458,224 assertions / 48 files**；`bunx tsc --noEmit` exit 0。
- 连续两次构建比较全部 `dist/*.js` / `dist/*.pak`：**18 个文件逐字节一致**。
- canonical schema SHA-256 的字面量与独立计算值一致：
  `d45807ca0aa01cdf72d43a122ef0ef26b8d21a0369ac5b1b1c2dbd2467b06d9f`；
  `tests/map-repository.test.ts:109` 直接守住该等式。编辑器 schema 副本也随构建/全测通过。
- 上轮修复前构建的 Sunstone JS 为 391,790 B（`findings/review-task-1876.md:82`）；本次为
  394,875 B，增量 **3,085 B**，距 405,000 上界还有 10,125 B。`sunstone.pak=3,308,336 B`、
  `grow.pak=799,264 B`（与上轮一致）；tracked golden 没有改动。增量对应
  interpreter/shop/save-validator/DialogBox 的
  323 additions / 52 deletions；`package.json`、lock、vendor 均无变化，没有新增依赖或资产进入包。
- `MAP_SCHEMA_HASH` 外没有 golden 文件变化；全套 framebuffer golden 测试通过。
- `git diff --check` 通过；`bun.lock`、`package.json`、`vendor/` 未改；子模块仍为 `76ae741f`；
  四个提交作者都是 `lfkdsk <lfkdsk@gmail.com>`，运行时没有 Tuxemon 专用分支。
- “每条修复单独提交”未严格做到：`70e17c0` 同时包含 B1、B4、B5 清理与 schema/hash/UI/tests；
  `findings/K4.md:175` 声称每条修复单独提交并不准确。鉴于 commander 会 squash，这项单列为流程偏差，
  不另作功能阻断。

## 建议的最小修复集

1. 提供一个共享的有限安全整数写入函数，把 `gold`、`item`、商店金币/库存和未来外部结果回写接入，
   加入 schema 合法的商店溢出 → 正式 save/load 回归；同时修正 schema、编辑器副本与类型注释的除零说明。
2. 删除 `findings/k4-fix1-render.ts:1` 的审查号。
3. 把本次独立 economy 脚本的关键场景变成 `bun test` 自动运行的综合用例：两店同物不同回收价、
   条件行、有限库存正式存档恢复、卖回补货、60/30/20/4 Hz 与 checkpoint 重放。

FAIL
