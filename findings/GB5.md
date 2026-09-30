# GB5：Tuxemon 战斗皮肤、演出与动画

## 结果

GB5 已把 GB4 的可玩但极简战斗画面升级为使用 Tuxemon 原作素材的完整战斗场景，并把训练师登场、放出怪物、技能命中、HP/XP 补间、倒下、补位、升级、捕获与结束文字都接到可序列化的 60 Hz reference tick。画面不读取 wall clock，也不在组件里保存动画时钟；同一 `eventCursor + eventTicks` 在重放或倒带后得到同一像素。

组件子模块从游戏基线的 `a124186` 升到 `b927ca8d752b8e8c91d10cc24b02e95c7d6c22f5`，使用其中 `pocket-rpgkit/ui/battle` 的 `MessageBand`、`CommandGrid`、`ListMenu`、`StatBar`、`SpriteSlot`、`FrameStrip` 与纯 tick 效果数学。没有修改 `vendor/pocketjs`，没有手改导入素材或地图，没有修改 `bun.lock`，也没有 push。

![Tuxemon battle scene](../docs/screenshots/battle.png)

## 1. 原作布局与皮肤

场景以 480×272 为逻辑画布：上方 216 px 把原作 256×108 战场放大 2× 后左右各裁 16 px，下方 56 px 是 Kit 的消息/菜单带；960×544 对整个画布做精确 2× 布局。原作环境配置决定背景和双方站台，怪物脚底与 HUD 位置依照 S4 布局；双方 HUD 使用原作框、名字、等级、性别、状态图标和六格队伍球，我方额外显示 HP 数字与 XP 条。

导入器继续从固定 Tuxemon 源自动生成所有显示资料。这一批保留并接入了：

- 环境背景、站台、单双人 HUD、队伍托盘与球图标；
- 玩家和对手训练师图；
- 怪物正面/背面图、状态图标；
- 技能和道具的原作消息、动画 atlas 页面、帧数与时长；
- 捕获装置的投掷球图。

当前默认 Spyder 战斗投影为 257 个怪物、245 个技能、578 张战斗纹理；完整导入连续运行两次后工作树均无差异。

根指令菜单按原作 profile 固定保留指令名：训练师战为 Fight、Swap、Item、Forfeit，野战为 Fight、Swap、Item、Capture、Run（Capture 是本运行时从原作 Item 中拆出的野战专用入口）。当前不可用的项保留文字、使用 dim 色且不可选；技能、道具、捕获装置和队伍选择使用统一滚动列表。菜单固定保留两个非空文本槽，使 Solid/PocketJS 在菜单切换和逐字显示时只替换文本，不创建或销毁节点。

## 2. 确定性演出

`battle/presentation.ts` 是纯投影层。它只读取 reducer 场景中的 `eventCursor`、`eventTicks`、事件、战斗快照和导入的视觉描述，计算当前场上怪物、训练师/怪物位置、不透明度、抖动、HP、XP、等级、球轨迹与动画帧。关键时间点均为 reference ticks：

| 演出 | 起点 / 时长 |
| --- | ---: |
| 放出怪物显现 | tick 22，10 ticks |
| 技能冲撞/命中 | tick 14，20 ticks |
| HP 补间 | tick 20，20 ticks |
| 倒下下沉/淡出 | tick 4，30 ticks |
| XP/升级 | tick 36，20 ticks |
| 捕获抛球 | 18 ticks |
| 每次捕获摇晃 | 12 ticks，次数直接读取 reducer 的 `event.shakes` |

技能动画按导入的页、帧数和毫秒时长换算为 reference ticks。由于 Kit 的 `FrameStrip` 接受离散图片 key，而 Tuxemon 动画以 atlas 页保存，场景重复传入该页 key，再用同一个确定性帧索引平移 atlas 到裁剪窗口；没有接入宿主 vblank 动画。

确认键仅可略过 `round` / `decision` 这种记账 beat；有可见动作的 send-out、technique、faint、capture、reward 和 end 都播放到各自的 tick 终点。奖励发生后 reducer 的最终怪物状态已经改变，因此 runtime 同时保存 reward 前后等级、总经验和最大 HP 快照，避免较晚状态泄漏到较早画面。

## 3. 关键帧、语义像素与倒带

真实构建后的 `GameView` 被驱动到六个检查点：主菜单、技能菜单、受击、倒下、捕获摇晃、升级。每个检查点都提交了 480×272 与 960×544 两张 PNG，共 12 张；manifest 固定 host frame、事件游标/reference tick、RGBA FNV-1a 与 PNG SHA-256。

我逐张打开并肉眼核对了全部 12 张 PNG：背景/站台、双方怪物与 HUD、训练师、菜单选中、技能特效、受击姿态、下沉淡出、捕获球以及升级文字均位于预期位置且可读。`docs/screenshots/battle.png` 是 480×272 技能菜单帧的严格最近邻 2×，尺寸 960×544，SHA-256 为 `7acb2c6f198d3762c4b17b2b3e49a1c3d3edcedc714b7e2d62f9db2d269dd24d`。

自动测试除逐字节 golden 外还检查：

- HP 条填充终点与 `current / max` 计算宽度一致；
- 当前菜单项使用选中色；
- 捕获球位置、摇晃和 RGBA4444 量化后的源像素一致；
- 技能 atlas 的页、裁剪偏移和帧索引有效；
- 同一个已挂载场景从后续帧倒回受击游标后，480×272 与 960×544 的 RGBA 都逐像素恢复；
- 覆盖 send-out、两种菜单、decision、technique、status、round、faint、capture 的 500 多个 steady frames 中，`createNode` / `destroyNode` / `insertBefore` / `removeChild` 全部为 0。

960×544 由 PocketJS 在目标分辨率重栅格化字体和透明边缘，不承诺每个通道都是 480 画面的机械复制；测试要求超过 97% 的 2× block 完全相同且平均通道误差小于 0.6。README 截图则由生成器做精确最近邻 2×，并逐字节验证。

## 4. Journey 与频率一致性

演出时长改变后，维护的首战胜线已重录为 3,793 个 60 Hz host frames，四个视觉检查点更新到 bedroom 1064、downstairs 1292、Paper Town 1367、Route 1 3792。胜线与独立败线分别在 60 / 30 / 20 / 4 Hz 重放：

| 路线 | 60 Hz | 30 Hz | 20 Hz | 4 Hz | 最终位置 |
| --- | ---: | ---: | ---: | ---: | --- |
| Win | 3,793 | 1,992 | 1,391 | 484 | `spyder_route1 [14,19]` |
| Lose | 3,370 | 1,768 | 1,238 | 441 | `spyder_route1 [14,19]` |

八次运行都保留相应胜/败语义、与 reducer 重放逐状态一致；每次都能倒带到活动战斗中段，再重放到与未倒带基线相同的终态。维护胜线和两种 QuickJS 视口的 canonical 终态 SHA-256 均为 `5653f0110656dd4e0a930ff1908c833c9f9fc221c9cfd3a90d22b138ef8d4827`。

网页构建上的最终复跑启动为 332 ms，3,793 帧用 1,521 ms；bedroom、downstairs、Paper Town、Route 1 四个状态/像素检查点全部命中，最终 scene 为 `null`，console errors 为 0。

## 5. QuickJS 性能

性能数据来自 `bun tools/desktop.ts --build-only` 后的 PocketJS desktop host / QuickJS，而不是 Bun/JSC。基准重放完整维护 journey，并在真实战斗 steady frames 上统计 JS 与整帧耗时以及结构操作：

| 视口 | battle p95 | battle max | 结构操作 | 进入战斗总耗时 | 退出战斗总耗时 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 480×272 | 12.139 ms | 13.587 ms | 0 | 20.050 ms | 38.200 ms |
| 960×544 | 12.234 ms | 17.774 ms | 0 | 22.259 ms | 45.164 ms |

两种视口的进/出战斗帧均小于 50 ms；steady battle 每帧结构操作为 0。

## 6. 修复 1：根指令完整显示与禁用态

`menu_visibility.py` 的 profile 顺序是 Fight、Monster、Item、Forfeit/Run；`combat_menus.py` 对 profile 中每个键都构造 `MenuItem`，可用性只传入 `enabled`，不会删除 label。运行时现在按同一规则投影：

- 训练师战固定生成 Fight、Swap、Item、Forfeit；Forfeit 对应上游默认 `False`，当前 reducer 没有“对手提出认输”状态，因此保留为灰色禁用项。
- 野战固定生成 Fight、Swap、Item、Capture、Run；Capture 是既有运行时从原作 Item 菜单拆出的入口，只在野战出现。
- 每个 `BattleMenuEntry` 都带 `available`。根菜单以可用道具、可换队员、捕获装置及 `canRun` 计算该值；UI 把 `available: false` 直接交给 `CommandGrid.disabled`，不再生成 `-`。
- 上下移动沿菜单循环寻找下一项可用指令，连续禁用项会被跳过；确认键也独立拒绝禁用项。首项 Fight 及其导航没有变化，所以维护 journey tape 无需重录，基线到最终提交的 `data/g6-journey.json` 字节零差异。

新增运行时测试逐项钉住两种战型的 kind、slug、顺序和 available，并验证野战从 Fight 向下会越过三个禁用项落到 Run，再环回 Fight。真实首战的 480×272 语义像素断言同时验证：Fight 的 accent 精确色像素为 25 个，Swap、Item、Forfeit 的 dim 精确色像素分别为 13、15、24 个，三个禁用格的 accent 均为 0，且当前索引始终指向可用项。

变异验证把根菜单返回值临时改为 `entries.filter((entry) => entry.available)`；`bun test tests/battle-runtime.test.ts` 立即变为 `10 pass / 2 fail`，明确报出训练师 Forfeit 与野战 Swap/Item 缺失。撤销变异后，运行时与画面专项合跑为 `18 pass / 0 fail / 1,680 assertions`。

golden 生成器重跑后，只有两张主菜单图发生字节变化：480×272 PNG SHA-256 为 `0ffdb5ef7c57e10e4bd4e2ce6f78dcb0990e7472642734d1be840a6dd1baa760`，960×544 为 `46c6ccc117464b97b067b38b1f8bcadf5551189033fe6e8cd2c0a7a500a17430`。其余十张演出 golden 与 `docs/screenshots/battle.png`（生成器重写后仍为 `7acb2c6f198d3762c4b17b2b3e49a1c3d3edcedc714b7e2d62f9db2d269dd24d`）字节未变。我逐张打开了 12 张 golden 和文档截图，确认四个训练师指令均可读、三个不可用项为灰色、只有 Fight 高亮，且技能、受击、倒下、捕获、升级画面仍正常。

## 7. 最终验收

| 门禁 | 结果 |
| --- | --- |
| `bun run import` 连跑两次 | 两次均 exit 0；第二次 0 diff，工作树干净 |
| `bun run verify:g6:determinism` | PASS；2 个隔离根，3,234 files，59,696,934 bytes，SHA-256 `691c03a751d944f10e1393af4092489517c99937ccfd0b5b2e548bd438c9b9f7` |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | exit 0；3,221-entry pak，60,591,968 bytes；JS 2,807,278 bytes |
| `bun run build:wasm` | exit 0；289,808-byte wasm |
| `bun test tests/` | 139 pass，0 fail，63,783 assertions，28 files；未跳过 built-bundle replay |
| GB2 / GB3 回归 | 8,560-case differential 通过；GB3 capture/item/run/progression/double goldens 全通过 |
| GB5 场景回归 | 12 张双分辨率 goldens、语义像素、倒带、结构零操作全部通过 |
| G6 locks | 329 pages，333 lock commands/checks；327 unlocked、2 transferred、0 unresolved、0 errors |
| G6 frozen | 263 maps；0 permanent locks、0 permanent blocking fibers、0 errors |
| `bun run web && bun tools/verify-web-journey.ts` | `WEB JOURNEY PASS`；4/4 状态与像素检查点命中，0 console errors |
| `bun.lock` / `vendor/pocketjs` | 无改动 |

## 8. 提交

原 GB5 实现按可测批次提交；本次修复也拆为运行时/UI、测试/golden、最终报告三个提交。没有 push。

PASS
