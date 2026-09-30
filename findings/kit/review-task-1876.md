# K4（商店 / 多选项 / 变量运算）审查

审查范围：基线 `08880fa`，被审 HEAD `7f36590`，提交 `71dc752..7f36590`。结论为 **FAIL**：基础 K4 行为、UI、确定性、预算和校验器回归均有扎实实现与测试，但仍有五类必须修复的问题，其中前三类直接阻止 Tuxemon 内容的无损自动导入或破坏合法状态的可保存性。

## 阻断项

### B1 — `shop` 不能直接表达当前 Tuxemon 道具经济

K4 的公开形状只有 `{ item, price? }[]` 与 `sell?`（`src/engine/types.ts:138`、`src/data/schema.json:537`）；买价覆盖有效，但卖价固定取全局 `Item.price / 2`（`src/engine/interpreter.ts:1016`、`src/engine/interpreter.ts:1044`）。这不足以无损映射上游经济：

- 独立 census 得到 14 个 economy、75 个道具货单行、单店最多 19 项；其中 6 行有限库存、4 行受变量条件控制、18 行的 `cost != floor(price/2)`。
- `potion`、`tuxeball`、`revive` 各自在不同店有不同 `cost`，因此即使 importer 把全局 `Item.price` 改造成某个卖价，也不可能同时表达所有店的回收价。
- 上游库存按 `economy:item` 持久保存并在买卖时递减/递增（`/var/tmp/tuxemon-src/tuxemon/economy/shop_manager.py:19`、`:100`、`:125`），货品可按变量隐藏（`/var/tmp/tuxemon-src/tuxemon/economy/applier.py:55`），卖价优先取 economy 行的 `cost`（`/var/tmp/tuxemon-src/tuxemon/economy/economy.py:110`）。K4 的行没有这些状态/字段。
- 28 个 `open_shop` 中 21 个是 P1 需要的 `both_item`，不是只属于后续战斗范围的边缘数据；另 7 个 `buy_monster` 可留到 P2。
- K4 的 `SHOP_ITEM_CAP=99` 是“每个 id 最多 99 个”（`src/engine/interpreter.ts:439`），而 Tuxemon 是最多 99 种道具，已有种类的数量继续累加、装不下的新种类转 locker（`/var/tmp/tuxemon-src/tuxemon/platform/const/sizes.py:88`、`/var/tmp/tuxemon-src/tuxemon/entity/bag.py:45`、`:62`）。这是另一处无法直接映射的背包语义。

必须扩展通用商店数据/状态，使每店回收价、有限库存与条件货品可表达（或给出等价且自动生成的通用降级结构），并把背包策略与 Tuxemon importer 的明确降级写入覆盖率报告；当前版本按题目“不能直接映射就是阻断”的规则不成立。

### B2 — 选项数上限够用，但 32 字符 schema 上限拒绝真实开场选项

完整事件 census（`translated_dialog_choice`、`choice_monster`、`choice_npc`）为 152 次；选项数直方图是 `2:112, 3:24, 4:4, 5:7, 6:1, 8:4`，最大正好 8，因此 `maxItems: 8` 覆盖数量。可是 `start_tuxemon.yaml:6` 的 `spyder_campaign` 在 `base.po:5016` 翻译为 `Tuxemon: Spyder and the Cathedral`，长度 33；K4 明确把 33 拒绝（`src/data/schema.json:348`、`tests/k4-choices.test.ts:103`）。

这发生在开局剧本选择，不是可忽略支线。UI 已经会安全省略显示，authoring schema 不应迫使 importer 手改/截断源文本；需至少允许这条真实标签。

### B3 — 合法项目可通过乘法产生 `Infinity`，写出的存档随即不可读

`schema.json` 的整数没有数值上界（`src/data/schema.json:380`），变量引用乘法直接执行 `a * b`，没有有限数检查（`src/engine/interpreter.ts:971`）。独立最小项目先合法设置两个 `1e308`，再相乘：schema 错误数为 0，结果为 `Infinity`，`canSave` 返回 true；编码时 JSON 把它变成 `null`，随后加载被 `save-validate` 的“finite number required”拒绝（该闸门见 `src/engine/save-validate.ts:438`）。

这不只是与 MV 的边界差异，而是运行时接受的合法命令把本来可保存的会话变成无法恢复的存档。应在每个算术写入点统一保证有限整数（明确夹取、fatal error 或其他确定性策略），并补 overflow→save round-trip 测试。

### B4 — 不可售/无价格道具会被以 0 金币销毁

卖出列表枚举所有持有物，缺价格时取 0，并不禁用该行（`src/engine/interpreter.ts:1044`）；确认仍减掉道具并加 0 金币（`src/engine/interpreter.ts:1174`）。独立运行得到 `before.price=0, afterGold=7, afterQty=0`。RPG Maker MV 的 `Window_ShopSell.isEnabled` 明确要求 `item.price > 0`；Tuxemon 则只列出 `behaviors.resellable` 的道具（`/var/tmp/tuxemon-src/tuxemon/economy/applier.py:143`）。K4 既没有 `resellable`，也没有零价保护，容易让无价剧情道具永久消失。至少应让零价/不可售条目不可确认，并建模通用的可售属性。

### B5 — 新增代码注释和提交正文含 fleet 任务号

硬规矩要求代码、注释、提交信息无 fleet 任务号。`git diff 08880fa..HEAD -- ':!findings/**'` 找到 `tests/schema-validate-depth.test.ts` 新增注释/describe 中的 `task 1828`、`task 1864`、`review-task-1823`；提交 `f350cce` 的正文也含 `G1 review 1828`。需清除代码中的这些编号，并重写/整理该提交说明后再交付。

## 逐项规格核对

| 规格 | 判定 | 独立核对 |
|---|---|---|
| T2-10 商店 | 部分成立 | 价格覆盖、买/卖、金钱不足、每栈 99 上限、滚动 UI 均工作；但 B1/B4 使真实 Tuxemon 经济不可直接映射。 |
| T2-9 多选项 | 部分成立 | 第 8 项可达且上下环绕；4 行窗口与省略号正确；但 B2 拒绝真实的 33 字开场标签。 |
| T2-16 变量间运算 | 部分成立 | copy/add/sub/mul/div/mod、未设变量读 0、除/模零变 0 均通过；B3 的非有限溢出未封口。 |
| 深嵌套校验器回归 | 成立 | 当前实现在 1,008 层及 263×40 事件的大文档上通过；换回 `4dfb651` 的旧文件后，大文档用例以 `RangeError: Maximum call stack size exceeded` 失败。 |
| 文档 / v1 修订 | 成立 | README、`src/engine/README.md`、`src/data/CHANGELOG.md` 与 schema 均有对应说明。 |

## 变量语义对照

| 情况 | K4 | RPG Maker MV | Tuxemon |
|---|---|---|---|
| copy/add/sub/mul | 对整数按 JS Number 运算；copy 直接覆盖 | 运算后统一经 `Math.floor` 写入；整数有限范围内等价 | `number_or_variable` 读 float，再调用 Python 运算符 |
| `-7 / 2` | `Math.trunc`，结果 `-3` | `/` 后 `Math.floor`，结果 `-4` | `//`，结果 `-4` |
| 除零 | `0` | 产生 `Infinity`/`-Infinity`/`NaN` 并写入 | `safe_floordiv` 返回左操作数（no-op） |
| 取模零 | `0` | `% 0` 产生 `NaN` | 上游 `variable_math` 没有 `%` |
| 溢出 | 可产生非有限数，见 B3 | JS Number 同样可保留非有限数 | Python float 路径也未夹取，但当前 5 个事件只用 2 次加法和 3 次乘法，值很小 |

MV 证据来自其公开运行时代码：`Game_Interpreter.operateVariable` 对 `/`、`%` 直接运算，`Game_Variables.setValue` 对数字调用 `Math.floor`；卖价是 `Math.floor(item.price / 2)`，每道具上限为 99。K4 的负数除法与除零策略是有意差异，文档与测试一致；真正未处理的是非有限结果与存档不变量冲突。

## UI 肉眼验收

审查脚本 `findings/k4-render-review.ts` 使用真实构建后的 `dist/ui-theme`，而不是手画 mock；它同时检查实际树文本、缺席的窗口外行、边框/纸色/文字色像素与 viewport 相对停靠。已亲自打开以下六张 PNG：

- `review-task-1876-artifacts/shop-buy-480x272.png`、`shop-sell-480x272.png`、`choices-scroll-480x272.png`
- `review-task-1876-artifacts/shop-buy-960x544.png`、`shop-sell-960x544.png`、`choices-scroll-960x544.png`

两种分辨率下，248×96 面板均正确停靠右下；Buy/Sell、`Gold: 42`、左右价格列、选中/禁用配色与提示行清晰；8 选项场景显示正确的中段四行，`A label far too long to…` 有省略号，窗口外的前四项未挂载。未见裁切、越框或叠字。语义断言输出的边框像素数均为 1360，纸色像素数分别为 20,937 / 21,271 / 19,900。

## 门禁、确定性、存档与变异

- 严格按要求先跑 `bun run build:example`，exit 0，再跑 `bun test`：最终为 **735 pass / 0 fail / 458,141 assertions / 48 files**，无 skip 报告。
- `bunx tsc --noEmit`：exit 0。
- 恢复正式源码后连续构建两遍，18 个 `dist/*` 文件 SHA-256 全部一致。
- `tests/k4-shop.test.ts:235` 的完整买两次→卖一次→离店 tape 在 60/30/20/4 Hz 得到同一 `{gold:85, items:{key:1}}`；`:252` 的开店中途原始 SessionState JSON 往返后继续折叠也完全一致。
- 正式存档规则保持既有 modal safe-point：独立运行开店后得到 `{modal:"shop", canSave:false, jsonRoundTrip:true}`。即开店态本身可作 reducer JSON 往返，但和 text/choices 一样不能调用正式 save。
- 三个要求的变异都被测试杀死并已还原：买入不扣钱使 `k4-shop` 4 项失败；移除 `windowStart` 末端夹取使 `list-window` 2 项失败；除零改为抛错使 `k4-variable-ops` 1 项失败。
- 旧校验器验证不是自证：把 `src/engine/schema-validate.ts` 临时替换成 `4dfb651` 版本后，当前 `schema-validate-depth` 为 2 pass / 1 fail，第三项稳定栈溢出；恢复当前版本后全套通过。

## 预算、schema hash 与改动卫生

- 独立构建基线 `08880fa` 与当前 HEAD：Sunstone JS `378,445 → 391,790`（+13,345 B，模块 `92 → 94`）；`grow.pak 799,248 → 799,264`（+16 B）。当前 `<405,000` 还余 13,210 B（约 3.4%）。新增源码主要是 shop reducer/modal、DialogBox 分支与单个 `list-window` 模块；`package.json`/lock/vendor 无变化，因此增量合理，未见无意依赖打包。
- `grow.pak` 的 +16 B 与新 UI 字面量多出的字体字形一致，精确钉值和 `<850,000` 上界仍在 `tests/grow-render.test.ts:259`。
- 独立重算 schema canonical SHA-256，字面量与计算值均为 `2389196dc0d63cc598061be7639d07bfa182f5c61316139ee1882210bd3ff922`；`tests/map-repository.test.ts:105` 会守住后续漂移。
- `git diff --check` 通过；作者均为 `lfkdsk <lfkdsk@gmail.com>`；`bun.lock`、`package.json`、`vendor/` 均未改，submodule 仍为 `76ae741f`；运行时代码保持通用 RPG Maker 风格，没有 Tuxemon 专用分支。
- 唯一卫生失败是 B5 的任务号。被审者共 5 个小步提交，频率符合要求，且未 push。

## 建议复审前最小修复集

1. 为通用商店加入可自动导入的每店卖价、库存与条件/可售性表达；明确 Tuxemon 的 99 种 bag + locker 策略，补真实 economy fixture。
2. 放宽 choice label authoring 上限（UI 继续自行截断），加入 `spyder_campaign` 的 33 字回归。
3. 所有变量写入统一拒绝或规范化非有限结果，并补“schema-valid overflow → save/load”测试。
4. 禁止零价/不可售物品确认卖出。
5. 清除新增代码、测试注释与提交正文中的 fleet 任务号。

FAIL
