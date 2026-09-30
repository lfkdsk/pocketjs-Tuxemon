# KC1：扩展驱动的动态选择框

## 能力设计（实现前冻结）

### 项目命令

新增通用 `extChoice` 命令：

```json
{
  "op": "extChoice",
  "call": "game.party_member",
  "args": { "purpose": "trade" },
  "prompt": "Choose a creature",
  "cancel": true,
  "write": {
    "index": "choice.index",
    "key": "choice.key",
    "cancelled": "choice.cancelled"
  }
}
```

`call` 使用与 `ext` 相同的命名空间规则；`args` 是 JSON；`prompt`
支持现有 `{name}` 替换；`cancel` 缺省为 `false`。`write` 的三个可选值
都是变量 id。选择时分别写入 0-based 下标、稳定键和 `0`；取消时分别写入
`-1`、空字符串和 `1`，因此旧结果不会残留。调用方也可完全省略 `write`，
只通过扩展回调处理结果。

### 扩展契约

`ExtensionOptions.choices[call]` 注册一个纯处理器：

```ts
interface ExtensionChoiceHandler {
  options(context: ExtensionReadContext, args: JsonValue):
    readonly { key: string; label: string; enabled?: boolean; data?: JsonValue }[];
  resolve?(
    context: ExtensionCommandContext,
    args: JsonValue,
    result:
      | { kind: "select"; index: number; key: string; data: JsonValue }
      | { kind: "cancel" },
  ): ExtensionCommandResult | void;
}
```

`options` 不接收随机源，避免一个仅因重绘/等待而发生的求值消耗 RNG。它读取
克隆的 `ext` 和只读内建 bank，并在每个 reducer reference tick 重新求值。
`resolve` 只在有效选择或取消时调用，可使用存档中的 RNG，并复用 `ext`
命令的 `ext` / `writes` / `items` / `gold` 原子结果校验与归一化。选择结果中的
`data` 是当前行附加数据的深拷贝；行未给 `data` 时传 `null`。

处理器输出必须是数组；每行必须有非空且唯一的稳定 `key`、非空 `label`、
布尔 `enabled`（缺省 `true`）和有限 JSON `data`。可取消的列表允许为空；
不可取消的列表必须至少有一个可用行，避免制造无法退出的 modal。处理器返回
非法形状属于注册游戏代码的契约错误，与现有 `ext` 回调一致地抛错。预览模式
`allowUnknown` 对未注册的 `extChoice` 直接跳过。

`write.index` / `write.key` / `write.cancelled` 的目标必须彼此不同，并且不能与
`resolve().writes` 的目标重复；冲突属于契约错误。这样选择结果与 resolver 的
`ExtensionCommandResult` 可以先整体校验，再在同一条指令完成、后续指令运行
之前原子发布，不引入隐藏的覆盖优先级。

### reducer 与动态列表语义

编译后的指令保留 `call`、克隆的 `args`、`prompt`、`cancel` 和 `write`；fiber
也复用现有 `choices` mode，并按当前编译指令的 op 分派。modal 复用现有
`kind: "choices"`，在原有
`options` 文本数组旁增加动态选择才会设置的可选 `keys` / `enabled` 数组；不把
函数注册表或附加数据放入 reducer 状态。复用 modal kind 也让 GameView action、
输入捕获和 attract 的 choice-like 展示节奏自动保持一致。

列表每 tick 从当前 `SessionState.ext`、变量、背包和钱包重建。刷新时优先用
原选中行的稳定 `key` 找回光标；该键消失时把旧下标 clamp 到新列表范围，并在
该 tick 抑制确认输入，先把新光标展示给玩家，避免确认到尚未看见的替代行。
上下键像现有商店一样可停在灰显行；在 `enabled:false` 行确认是严格 no-op。
确认有效行时使用本 tick 刚求出的下标、键和附加数据调用 `resolve`，写回结果，
关闭 modal，并在同一 tick 继续执行后续命令。取消只有 `cancel:true` 时生效。

选项数组顺序完全由扩展提供，不做 locale 排序或集合重排；同一输入状态得到
同一数组即得到同一 reducer 结果。所有回调和状态写入都在 reducer 内同步完成，
无 Promise、主机时钟或 UI 本地状态。

### 存档、倒带、多 hz 与 worldIdle

本修订明确不允许在动态选择框打开时建立持久存档。这沿用 v1 的统一 safe-point：
现有 text、choices、shop 也要求没有 blocking fiber 且 `modal === null`。
关闭选择框后，变量和 `ext` 结果照常进入 save codec、checksum 与 restore。

attract 的进程内 rewind 快照不是持久存档，会完整保留 modal、fiber、`ext`、
变量与 RNG；回放重新逐 reference tick 求值选项，因而能跨选择与回调字节一致地
refold。时间只来自固定 reference tick，`options` 不消耗 RNG，所以 60/30/20/4
Hz 主机得到相同状态。

`worldIdle` 已把所有非空 modal 视为 busy；复用 choices modal 后动态选择天然是
模态阻塞。session 会像静态 choices 一样捕获 d-pad，GameView 只在
`cancel:true` 时暴露 back action。parallel fiber 打开的动态选择框同样冻结
玩家移动，但其他 parallel/autorun 执行顺序保持现状。

### UI

不新增另一套面板。`DialogBox` 的现有 choices Panel 直接读取可选 `enabled`
数组，继续使用 4 行 `windowStart` 滚动窗口和 `truncateLabel`。普通行使用 ink，
当前可用行使用 accent，任何 `enabled:false` 行（包括当前光标所在行）使用 dim；
光标前缀仍可见。静态 choices 没有该数组，保持全部可用和原有像素输出。

面板保持 248×96、右 12、下 98 的逻辑像素布局：480×272 时位于
`[220,468) × [78,174)`，960×544 时位于
`[700,948) × [350,446)`。这与现有响应式 viewport 的右下锚定策略一致，并用
两个 viewport 的 sim 语义像素断言覆盖选中高亮、灰显、滚动和位置。

## 实现与验证记录

### 已落地能力

- `ExtensionOptions.choices` / `ExtensionRuntime.choices` 注册动态列表；公开的
  `ExtensionChoiceOption`、`ExtensionChoiceResult` 和
  `ExtensionChoiceHandler` 把只读 provider 与可变更 resolver 分离。
- 编译器、inline/sharded map 注册扫描、深层存档 validator 和 v1 JSON schema
  都识别 `extChoice`。schema identity 更新为
  `96239876deaca61c4db65417c05a3e5c009c7141aae100276bbf853845670d5b`，
  编辑器内嵌 schema 同步生成。
- reducer 每个 reference tick 校验并刷新行，按 stable key 保持光标；键消失或
  空列表刚出现第一行时会先展示一帧再允许确认。provider 没有 RNG，resolver
  与 `ext` 共享 saved-RNG、有限整数归一化以及 ext/variables/items/gold 的
  先校验后发布路径。
- modal 仍是 `kind:"choices"`，只为动态列表附带 `keys` / `enabled`。因此没有
  新增 SessionState 字段，静态 choices 的 JSON 和像素保持不变；clone 与
  `modalChanged` 对两个数组做内容级处理。
- `DialogBox` 继续用同一个四行窗口；disabled 优先于 selected 的 accent，
  因而灰显行仍显示光标但不能被误认成可确认项。
- 打开的动态 modal 继续遵循统一 safe-point：持久存档被拒绝；关闭后的结果可
  保存和恢复。attract rewind 则可跨 modal 边界重新 refold。

### 测试覆盖

扩展夹具不含 Tuxemon 数据，覆盖实时增删/重排、stable key、键消失时的确认抑制、
disabled 行、空可取消列表、取消哨兵、直接写回、resolver 修改 `ext`、写目标冲突
与原子失败、非法 provider/row/data、未注册与 preview no-op。状态测试覆盖 modal
打开时拒存、关闭后 save/restore、倒带恢复 modal/光标/ext/RNG、60/30/20/4 Hz
语义一致、attract 展示边界和 `worldIdle` blocker；clone/modalChanged 也有独立
回归用例。

UI fixture 使用八行动态列表，把第六行设为 disabled 且选中。480×272 与
960×544 的 sim 测试同时断言四行滚动窗口、长标签截断、边框定位、dim 像素存在
且 accent 像素为零。另生成、登记并肉眼打开：

- `ext-choice-480.png`
- `ext-choice-960.png`

两张图均显示 `Scholar / > A label… / Hermit / Wanderer` 四行；禁用长标签带光标、
颜色明显比可用行暗，960×544 仍为 248×96 固定逻辑尺寸并贴右下锚点，没有裁切
或错位。

### 验收结果

- `bun run build:example`：exit 0，全部 examples、editor 与 fixtures 构建完成；
  `bun run build:wasm` 生成 289,510-byte wasm 后 UI sim 未再跳过。
- `bun test`：960 pass、0 fail、469,446 次 expect，62 个文件；现有 golden pins
  全部通过，未改任何既有 golden。
- `bunx tsc --noEmit`：exit 0。
- `tools/pr1-equivalence.sh`：`PASS scenarios=37 states=12376`。
- `bun editor/gen-assets.ts` 连跑两次，`editor/engine/projects.ts` 三次 SHA-256 均为
  `c22defd462be698a44dd9810d953e4bfed38b2dab676b97cc3a10f8cbf709025`。
- Sunstone 的共享 JS 因通用 interpreter/modal 路径从 440,370 增至 449,037 bytes；
  battle UI 特征字符串仍全部缺席，并把预算保留为 `<456,000` 的窄上限。
- `bun.lock`、`vendor/pocketjs` 和游戏仓均未修改；没有 push。

## Tuxemon 接入指引

这里的映射只描述后续游戏仓应如何消费通用能力；本改动不包含 Tuxemon 专用
状态、翻译或 UI。

### `choice_monster`

上游当前 action 实际读取参数里的冒号分隔物种 slug，翻译标签后把选中的 slug
写入变量（`choice_monster.py:43-63`）；两个现存 callsite 也都是静态 starter
列表。因此纯行为可以继续用普通 `choices`。若希望统一怪物专用提供器，可用
`extChoice` 返回 `{key: speciesSlug, label: translatedName,
data:{species:speciesSlug}}`，`cancel:false`，再由 resolver 写入 importer 现有的
枚举编码；直接写 `key` 会改变现有条件所比较的值。通用文字列表不显示原作的
怪物动画头像/图鉴入口，应记为视觉降级。

真正从玩家当前队伍挑实例的是 `get_player_monster`：它按实例属性过滤，成功写
`instance_id.hex`，取消/无候选分别写 `no_choice` / `no_options`
（`get_player_monster.py:137-174`）。这个 action 可直接以实例 UUID 为 stable
key，`data` 携带 UUID，并根据过滤结果设置 `enabled`；它才是动态队伍选择的
主要接入点。

### `choice_npc`

上游也从冒号分隔的参数列表产生选项并写回所选 NPC slug；可选 `label` 会让
所有行显示同一翻译文本（`choice_npc.py:47-67`）。后续 provider 可返回
`{key:npcSlug,label:translate(label ?? npcSlug),data:{npc:npcSlug}}`，并用 resolver
维持 importer 已使用的枚举编码。现有唯一场景是静态外观列表，普通 `choices`
也足以实现行为；文字列表不保留原作 NPC 图片，属于视觉降级。

### `open_shop` 的怪物交易

上游区分 item/monster 的 buy、sell、both，以及 train/heal 八种模式
（`open_shop.py:48-57,92-133`）。已有 item shop 继续走内建 `shop`；怪物交易
则由 provider 从 `ext` 中的经济库存、玩家 party 与钱包生成动态行：

- 购买行 key 用稳定的 economy/species 标识，label 显示翻译名与价格/库存；
- `enabled` 反映库存、余额和队伍容量，`data` 只携带交易所需稳定 id/价格；
- resolver 必须基于当前 context 再校验这些条件，然后一次性返回新 party、库存
  与 `gold`，不能把 UI 的灰显当作唯一业务校验；
- 出售时按怪物实例 UUID 生成行，resolver 从准确 owner/party 删除该实例并增加
  钱包。

一次 `extChoice` 完成一次交易并关闭；要连续交易可让玩家再次互动，或由后续
游戏层另做循环商店场景。`both_monster` 先用普通 choices 选 Buy/Sell，再调用
对应动态列表。训练/治疗模式仍需要各自扩展，不应假装由一次买卖覆盖。

### `remove_monster`

上游参数是保存实例 UUID 的变量名；它校验 UUID、查找怪物及 owner，再从该
owner 的 party 删除（`remove_monster.py:37-60`）。因此它自身应继续映射成即时
`ext`，从 `ctx.variables[args.variable]` 读取 UUID，非法/找不到时 no-op，成功时
更新真实 `ext.party`。若剧情先让玩家选队伍成员，则先用上述
`get_player_monster` 动态选择把实例 key 写入变量，再执行 `remove_monster`。

subagent 使用：4 个 / 分别核对 Tuxemon 上游与文档、引擎契约与错误面、存档倒带多 Hz 测试、UI 列表与双分辨率像素测试 / 独立部分并行完成，节省了时间；主 agent 逐项整合、复查并串行跑全部重门禁。
