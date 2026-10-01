# DEMO-G1：章节快照与跳转出生点（数据侧）

## 结论

PASS。网页演示菜单需要的两类数据都已就绪并提交：

- `data/chapters.json` — 沿 GB6+J1+J2 主线的 13 个命名章节（从新游戏卧室到
  医院治愈），每个是一个过组件仓 save validator 的存档信封（`rpgkit-save/v1`）、
  tape 后缀起点（拼接 GB6+J1+J2 masks 的偏移）与 480×272 缩略图哈希；
- `data/warp.json` — 263 张图各一个出生点：135 个取自指向该图的传送落点，
  110 个取第一个可站立且不在任何事件区域内的格，18 张图没有这样的格，标记为
  `blocked`。
- 每个章节从快照起按合并 tape 的后缀续播，都到达整段回放的终态
  （`verify:chapters`）。

演示菜单（章节开局 / 地图跳转 / 自动播放 / URL 深链）的接线在组件仓另做，本任务
只交付数据与校验。

> 阅读说明：下面「章节快照」「跳转出生点」「校验」三节是初版记录（10 章、
> 只避开阻挡型事件、1 张 blocked）。现行结果以「前移」与「修复 1」两节为准：
> 13 章、后缀续播证明、避开全部事件区域、18 张 blocked。

## 章节快照

`tools/bake-chapters.ts` 把 GB6（109,983 帧）与 J1（12,162 帧）拼成 122,145 帧的
合并 tape，用生产 reducer 回放一遍，在安全点（`canSave` 且无输入锁、无转场淡入）
取检查点。每个快照经 `decodeEnvelopeText`（结构校验）+ `restoreSessionSnapshot`
（地图感知恢复契约）+ 再快照往返三重验证；动态角色不进存档（恢复时按事件页重建），
所以等价性用「恢复后再快照与原快照逐字节相同」证明，而不是与在线状态比 digest。

| id | 标题 | 帧 | 位置 | 后缀帧数 |
| --- | --- | ---: | --- | ---: |
| bedroom | Bedroom (new game) | 0 | spyder_bedroom@4,4 | 122,145 |
| paper-town | Paper Town | 1,360 | spyder_paper_town@10,7 | 120,785 |
| before-billie | Before the first Billie battle | 1,868 | spyder_paper_town@26,9 | 120,277 |
| starter | Starter chosen | 3,495 | spyder_paper_town@26,9 | 118,650 |
| route-1 | Route 1 | 3,793 | spyder_route1@14,19 | 118,352 |
| cotton-town | Cotton Town | 6,597 | spyder_cotton_town@21,39 | 115,548 |
| city-park | City Park | 43,116 | spyder_citypark@10,39 | 79,029 |
| route-3-north | Route 3 north end | 109,983 | spyder_route3@4,6 | 12,162 |
| flower-city | Flower City | 114,766 | spyder_flower_city@39,4 | 7,379 |
| captain-returns | Captain's return | 122,145 | spyder_mansion@1,13 | 0 |

两个与规格建议的偏差，都是 tape 实际形状决定的：

- **「选完初始怪」落在首战 Billie 之后。** 原作在 Nut 箱前选完初始怪直接进入
  Billie 战，选择与战斗之间没有安全帧；第一个带怪的安全点是战斗结束后的
  f3,495。章节标题仍为 Starter chosen。
- **「对 Billie 第一战前」= f1,868**，玩家站在 Nut 箱旁（held=确认键），后缀
  自动播放选怪与首战。
- bedroom 是 frame 0（intro 弹窗出现前唯一的安全帧）。sim 宿主在首帧之前画面
  是空白，所以它的缩略图从独立 boot 放 60 帧空闲输入、等 intro 文字打满后截取；
  快照仍属于 frame 0。

缩略图用构建好的游戏 bundle（`dist/main`）在 sim 宿主里渲染，截取时与 reducer
状态核对地图与坐标；10 张已逐张肉眼核对。`data/chapters.json` 共 68 KB（信封
0.8–15 KB/个）。

## 跳转出生点

`importer/warp.ts` 在导入末期（地形应用之后）对最终工程计算：

1. 收集所有 `transfer` 命令的静态落点（变量目标如 faint point 跳过），按
   地图/事件/页/命令的确定顺序，取该图第一个在引擎通行表上可站立的落点；
2. 没有传入传送的图，按行优先扫第一个可站立格；
3. 可站立 = 引擎 `buildPassage` 的 `solid===0` 且不压在任何 `blocks:true`
   事件页上（本仓只有 keyed collision 矩形是 blocks 事件体）。

显示名用导入的地图名（en_US 翻译），没有翻译就用 id（199 张图如此）。
`classic_route_4` 的唯一地面砖带 `surfable:0`，按本仓既有（G5 oracle 对齐的）
语义全图实心，没有可站立格；它仍进索引，`from:"blocked"` 记第一个传送落点
（20,0），测试证明该图确实全实心，标记不掺水。

## 校验

- `tests/warp-spawns.test.ts`（3 个）：索引与工程逐字节重建一致；每个出生点
  在通行表上可站立、不压事件体；263 张图齐全；`blocked` 仅 1 个且全图实心。
- `bun run verify:chapters`（新增 CI journey leg）：内存重烘焙并与已提交的
  `data/chapters.json`、10 张缩略图逐字节比较；过期时报错并给出
  `bun tools/bake-chapters.ts` 重烘焙命令。约 4 分钟（reducer 回放 ~90 s +
  sim 渲染 122k 帧 ~2.5 min）。
- `docs/verification.md` 写了 `verify:chapters` 与重烘焙方法；`docs/ci.md`
  journey 表加第六条腿；`docs/status.md` 「Saving and demos」加 Partial 行。

## 验收

| 项 | 结果 |
| --- | --- |
| `bun run import` 两遍无 diff | 通过（工作树保持干净） |
| `bunx tsc --noEmit` | 0 |
| `bun run build && bun run build:wasm` | 通过 |
| `bun run test` | 247 pass / 0 fail / 0 skip（基线 244，+3 warp 测试） |
| `verify:chapters` 与既有 verify | 全部通过（下表） |
| `bun run web && bun tools/verify-web-journey.ts` | WEB JOURNEY PASS（3,793 帧，0 console error） |
| `bun.lock`、`vendor/` | 无改动 |
| 本机路径 / 任务号 | 代码、数据、提交信息均无 |

验收运行（本机，TUXEMON_SRC 指向钉死的 9e6258ff）：

| 脚本 | 结果 |
| --- | --- |
| `verify:chapters` | CHAPTERS PASS，10 chapters，122,145 合并帧，快照与缩略图逐字节一致（~4 min） |
| `verify:gb6:mainline` | GB6 MAINLINE PASS，109,983 帧，100 战（22 训练师 / 78 野外） |
| `verify:j1:mainline` | J1 MAINLINE PASS，合并 122,145 帧，17 战（10 训练师 / 7 野外） |
| `verify:gb6:failures` | GB6 FAILURE PATHS PASS（首败 + 后败两条线） |
| `verify:g6:locks` | 330 页 334 检查，0 unresolved |
| `verify:g6:frozen` | 263 张图，0 永久锁 / 0 阻塞 fiber / 0 错误 |
| `verify-web-journey` | bedroom / downstairs-mom / paper-town / route-1 四个检查点状态与像素哈希全对，0 console error |

## 提交

- 7135565 feat(importer): per-map warp spawn points for the demo menu
- 7d4ce41 feat(verify): chapter snapshots and thumbnails for the demo menu
- 89126a5 docs: chapter snapshot verification and CI leg
- 3ef0dcd refactor(verify): drop unused helpers from the chapter baker

## 前移（合并 main 34ec973：J2 医院治愈主线 + 组件仓 c93a1ec）

main 合入后（合并提交 acc479e，上一轮中断前已完成），章节数据随组件仓升级
（KB6 战斗保活、KAU1 音频状态）与 J2 主线前移：

- **合并 main**：`acc479e` 已把 main（J2 医院治愈主线 172,060 帧、组件仓指针
  c93a1ec、J2 golden 测试与 CI journey 腿）合入本分支；CI journey matrix 经核对
  已含 `verify:j2:mainline` 与 `verify:chapters`，无需再改。
- **导入确定性**：`bun run import` 两遍，工作树无 diff（组件仓升级不改变导入产物）。
- **章节烘焙器扩到 J2**（`tools/bake-chapters.ts`）：tape 改为拼接
  GB6+J1+J2 三段 masks（172,060 帧），`data/chapters.json` 的 `tape` 段记录三段
  各自的文件/帧数/哈希；`captain-returns` 检查点重新锚定到 GB6+J1 末端
  （f122,145，不再是合并 tape 末端）。新增 3 个 J2 检查点，全部取 `canSave`
  安全点（无输入锁、无淡入）：

  | id | 标题 | 帧 | 位置 | 后缀帧数 |
  | --- | --- | ---: | --- | ---: |
  | candy-town | Candy Town | 164,388 | spyder_candy_town@30,0 | 7,672 |
  | greenwash-aardant | Greenwash (Aardant acquired) | 170,670 | spyder_greenwash@7,31 | 1,390 |
  | hospital-cure | Hospital cure | 172,049 | spyder_candy_hospital3@5,7 | 11 |

- **缩略图**：组件仓升级让 5 张早期缩略图（paper-town / before-billie /
  starter / route-1 / cotton-town）各移动 1–242 个像素（精灵动画相位差，快照
  与检查点帧不变），已重烘焙；3 张 J2 缩略图逐张肉眼核对——greenwash-aardant
  与 hospital-cure 的语义颜色计数与 J2 golden（`tests/goldens/j2-*.480x272.png`）
  逐像素一致（wood 11,565 / purple 4,167、pale 18,148），candy-town 为河畔镇景。
- **文档**：`docs/status.md` 章节数改 13、范围写到医院治愈；`docs/verification.md`
  章节清单与 tape 拼接说明同步。

前移验收运行（本机，TUXEMON_SRC 指向钉死的 9e6258ff）：

| 项 | 结果 |
| --- | --- |
| `bun run import` 两遍无 diff | 通过（工作树保持干净） |
| `bunx tsc --noEmit` | 0 |
| `bun run build && bun run build:wasm` | 通过（wasm 指针变化后重编） |
| `bun run test` | 252 pass / 0 fail / 0 skip（基线 247，+5 为 J2 golden 测试文件） |
| `verify:chapters` | CHAPTERS PASS，13 chapters，172,060 合并帧，快照与缩略图逐字节一致（~4.5 min） |
| `verify:gb6:mainline` | GB6 MAINLINE PASS，109,983 帧，100 战（22 训练师 / 78 野外） |
| `verify:j1:mainline` | J1 MAINLINE PASS，合并 122,145 帧，17 战（10 训练师 / 7 野外） |
| `verify:j2:mainline` | J2 MAINLINE PASS，合并 172,060 帧，56 战（50 训练师 / 6 野外），终点医院治愈 |
| `verify:gb6:failures` | GB6 FAILURE PATHS PASS（首败 + 后败两条线） |
| `bun run web && bun tools/verify-web-journey.ts` | WEB JOURNEY PASS（3,793 帧，0 console error） |
| `bun.lock`、`vendor/` | 无改动 |
| 本机路径 / 任务号 | 代码、数据、提交信息均无 |

前移提交：

- c97187d feat(verify): bake chapter snapshots through the J2 hospital-cure arc

subagent 使用：0 个 / 本任务以串行回放与渲染为主，重活（全量 test、verify、web）
按规矩只在主线程跑，只读探查没有拆给 subagent。

## 修复 1（审查 2157 FAIL → 复验）

审查 2157 判 FAIL，三个阻断项：章节 `snapshot + tape` 续播缺全局时间轴、
出生点只避开 `blocks:true` 事件体、J2 前移后文档互相矛盾。本节记录修复与复验。
基线先合入 main（合并提交 `8bbcc11`，main tip `b832794`，组件仓指针随 main
前移到 `dfbae47`，PocketJS `b414e56c`），再 `bun run build:wasm`。

### B1 章节续播时间轴

**缺的状态**：信封只带 per-map 解释器时钟 `interp.frame`。`enterMap` 每次换图
都把它重置为 0（组件仓 `session.ts:696` → `interpreter.ts:1408`），而全局 reducer
帧 `SessionState.frame` 只增不减、从不进快照。`restoreSessionSnapshot`
用 `Math.floor(interp.frame / ticksPerFrame)` 重建全局帧
（`save-restore.ts:135`），所以恢复出的全局帧是「进图后帧数」，不是合并 tape 的
全局帧（实测 paper-town 恢复为 0 而 `timelineFrame=1360`，hospital-cure 恢复为
369 而 `timelineFrame=172049`）。reducer 内没有任何逻辑读 `SessionState.frame`
做决策（只有 UI 音频驱动的倒带检测和存档槽摘要读它），所以后缀续播的玩法状态
逐帧一致，只差全局帧计数本身，终态全量哈希因此不同。扩展状态（`battle/`）没有
依赖帧号的字段；`scene.pausedTicks` 在安全点为 null；地图动画实例的 `start`
锚定 `interp.frame`，恢复时按图重挂载。**唯一缺的全局时间轴状态就是
`SessionState.frame`。**

**游戏侧修复**：`ChapterRecord.timelineFrame` 不是「envelope metadata」，而是
章节恢复合同的一部分——恢复信封后必须 `state.frame = timelineFrame` 再放后缀。
`tools/bake-chapters.ts` 改正了字段注释与模块头说明，并新增
`verifyChapterSuffixes()`：对 `data/chapters.json` 的每个信封做
`decodeEnvelopeText` → `restoreSessionSnapshot` → 设 `state.frame = timelineFrame`
→ 从 `held` 起放后缀 masks，终态 `sha256(canonicalJson(state))` 必须等于整段
回放的终态哈希（并与 J2 pin `933c8a78…` 对齐）。`verify:chapters` 在字节比对后
调用它，13 个章节全部到达同一终态。

**给 commander 的组件仓待办（另派，不改子模块）**：组件仓 `SaveSnapshot`
应显式携带全局帧（如顶层 `frame: number`），`createSnapshot`/`createSessionSnapshot`
捕获它，`restoreSessionSnapshot` 优先用它、旧存档回退到 `interp.frame` 推导值；
同步 `save-validate.ts`、`schema.json` 与 `MAP_SCHEMA_HASH`。这样存档自身就带
全局时间轴，章节合同不必再靠带外字段。当前游戏侧 `timelineFrame` 注入是等价的
运行时补救。

### B2 出生点避开所有事件区域

合同从「不压 `blocks:true` 事件体」收紧为「不压任何事件的 x/y/w/h 区域」
（`importer/warp.ts`）：优先选可站立且不在任何事件区域上的传送落点；落点都被
事件覆盖时，取离第一个落点最近的可站立无事件格；无传入传送的图取行优先第一个
可站立无事件格；全图没有可站立无事件格才标 `blocked`。

新分布（263 张）：**135 transfer / 110 fallback / 18 blocked**。18 个 blocked =
`classic_route_4`（全图实心）+ 17 张主线图（route1–6、routea–e、citypark、
mansion、tunnel、tunnel_below、dragonscave、dryadsgrove）。这 17 张被 Tuxemon
原作的全图一次性访问追踪区覆盖——原作把「Track route1」写成 640×320（整图）的
playerTouch 传感器（`is char_at player` + `not tracker` → `add_tracker`），
导入器按 K1 矩形区域切分后仍铺满全图。逐格核算：这些图 96%+ 的可站立格只被
tracker 覆盖（如 route1 410 格中 406 格仅 tracker）。它们是无害的一次性传感器
（静止跳转不触发，踏出第一步才置一次 `tracker.<map>` 变量），但按规格原文
「不在事件实体上」只能诚实标 `blocked`。**若规格所有者决定豁免一次性自禁
tracker 传感器，这 17 张即可解封**——这是规格决策，不由实现自行缩窄。
`tests/warp-spawns.test.ts` 断言每个 spawn 不压任何事件区域、blocked 集合恰为
这 18 张、且每张 blocked 图确实没有可站立无事件格。

### B3 文档一致

- `docs/ci.md`：journey 腿 6 → 7（补 `verify:j2:mainline`），runner 12 → 13，
  rest 组 35 → 38 文件，章节表 10 → 13 并写明后缀续播证明，本地命令补 J2，
  release gate 补 `verify:j2:full`；
- `docs/verification.md`：「两种验证」→ 三种（含章节/跳转数据），确定性导入
  4,637 → 4,638 文件，「两大 verifier」→ 三个并补 J2 模式表，`verify:chapters`
  写明后缀续播，warp 段改写为全事件区域合同与 18 blocked；
- `docs/status.md`：章节行写明后缀续播证明与 18 blocked，CI 时长改为由最慢
  journey 腿决定；
- `README.md`：常用命令补 `verify:j2:mainline`。

### 修复 1 验收

| 项 | 结果 |
| --- | --- |
| `bun run import` 两遍无 diff | 通过（工作树保持干净） |
| `bunx tsc --noEmit` | 0 |
| `bun run build && bun run build:wasm` | 通过（wasm 289,981 bytes） |
| `bun run test` | 260 pass / 0 fail / 0 skip（45 文件） |
| `verify:chapters` | CHAPTERS PASS，13 chapters，172,060 合并帧，快照与缩略图逐字节一致；13 个章节后缀续播全部到达终态 `933c8a78…` |
| `verify:gb6:mainline` | GB6 MAINLINE PASS，109,983 帧，100 战（22/78） |
| `verify:j1:mainline` | J1 MAINLINE PASS，合并 122,145 帧，17 战（10/7） |
| `verify:j2:mainline` | J2 MAINLINE PASS，合并 172,060 帧，56 战（50/6），终态 `933c8a78…` |
| `verify:gb6:failures` | GB6 FAILURE PATHS PASS（首败 + 后败两条线） |
| `verify:g6:locks` | 330 页 334 检查，0 unresolved |
| `verify:g6:frozen` | 263 张图，0 永久锁 / 0 阻塞 fiber / 0 错误 |
| `bun run web && bun tools/verify-web-journey.ts` | WEB JOURNEY PASS（3,793 帧，0 console error） |
| `bun.lock`、`vendor/` | 我的修复提交无改动（vendor 指针仅随 main 合并前移到 `dfbae47`） |
| 本机路径 / 任务号 | 代码、数据、提交信息均无 |

修复 1 提交：

- bc9f247 feat(importer): warp spawns avoid every event area, not just blocking ones
- 6e0031b feat(verify): prove every chapter snapshot suffix-replays to the terminal state
- e4a6e57 docs: align chapter, warp and CI docs with the suffix-replay and all-event-area contracts

subagent 使用：0 个 / 修复以串行回放与门禁为主，重活只在主线程跑。

PASS
