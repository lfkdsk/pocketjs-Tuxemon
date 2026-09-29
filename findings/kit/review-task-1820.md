# 审查 R2（task 1801 起头 + 1820 续做）：动画瓦片、16×32 行走角色、`{name}` 占位

审查对象：worktree `~/.fleet/worktrees/task-1801`，分支 `fleet/task-1801`，R1 基线
`4472bbd` 之上 7 个提交（`20c1576` → `09d9435`）。规格 `kit-R2-ui.md`、续做规格
`kit-R2-continue.md`，审查规范 `reviewer-generic.md`。所有门禁、基准、变异都是本次
自己复跑，builder 自述的数字只作对照。

## 结论

**PASS**。三项能力（`GameAssets.animated` + `AnimatedTiles`、16×32 四朝向三步态
行走角色、`{name}` 占位）齐全且是通用能力（无 Tuxemon 专用代码，只有以 Tuxemon 表
布局为默认值的 `TUXEMON_WALKER_LAYOUT`）；门禁全绿；5 张 golden 逐张打开并放大核对；
QuickJS 基准可复现；4 处变异全部被测试抓住；`vendor/pocketjs` 未动；代码与注释无
fleet 任务号。非阻断观察 6 条见 §9。

## 1. 门禁自跑

| 项 | 结果 |
| --- | --- |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build:example` | exit 0；`r2-ui` 26 个 pak entries、8,547,280 B pak、570,184 B JS |
| `bun test` | **579 pass / 0 fail**，454,715 expect，36 files，72.73 s |
| `bun test tests/r2-ui-sim.test.ts` 单独跑 | 4 pass / 0 fail（39 expect），确认不是被 `describe.skip` 跳过 |
| `git diff --check 4472bbd..HEAD` | exit 0 |
| 提交作者 / 尾注 | 7 个提交全部 `lfkdsk <lfkdsk@gmail.com>`，无 Co-Authored-By / AI 尾注 |
| `vendor/pocketjs` | gitlink 仍 `76ae741f`；`git log 4472bbd..HEAD --name-only` 无 `vendor/` 文件；子模块工作树干净 |
| 既有 goldens | `git diff 4472bbd..HEAD --name-status -- tests/goldens` 只有 5 个 `A`（新增），无修改 |
| 夹具生成器字节稳定 | `gen-assets.ts` 连跑两次，产物树聚合 SHA-256 均为 `8d5810724c23…851883`，`git status` 干净 |

## 2. 逐条对照 `kit-R2-ui.md`

| 规格 | 判定 | 证据 |
| --- | --- | --- |
| 1 `GameAssets.animated`（格坐标、上/下层、图集名） | 成立 | `src/ui/game-assets.ts:27-37,78` |
| 1 `AnimatedTiles` 视口 ±1 格挂原生 sprite 节点，帧时长来自 sprites.json，不进 reducer | 成立 | `src/ui/AnimatedTiles.tsx:129`（ring 默认 1）、`:154-156`（绑 atlas 名，JS 不推帧）；imports `:16-32` 无任何 reducer/interpreter 依赖 |
| 1 构建侧 sprites.json 工具函数在 `tools/lib/` | 成立 | `tools/lib/animated.ts:90-149` `cookAnimationAtlases` 返回 `spritesJson`；`:167` `animatedManifestSource` |
| 2 16×32、3 列 × 4 行、站立为中列，朝向/步态来自 `CharState` | 成立 | `tools/lib/bake.ts:224-228`；`src/ui/GameView.tsx:393`、`src/ui/PlayerSprite.tsx:52-54` |
| 2 高于一格时的遮挡与上层关系 | 成立（角色间次序见 §9.2） | z 序 ground → anim-below → NPC → player → upper → anim-above（`GameView.tsx:480-556`）；sim 断言 `tests/r2-ui-sim.test.ts:144,205`；本次像素探针见 §4 |
| 3 `{name}` 替换、进状态与存档、默认可配置 | 成立 | `src/engine/interpreter.ts:98,755,793,879,896`；`session.ts:178`；`save-validate.ts:366-368`；`tests/player-name.test.ts` 9 个用例 |
| 验收：sim + goldens（第 N 帧像素、四朝向） | 成立 | `r2-ui.animation-frame-6.png` + 4 张 `walker-*.png`，SHA-256 与 `findings/R2.md` 表一致 |
| 验收：多 hz 一致 | 成立 | `tests/r2-ui-sim.test.ts:147-168` 60/30/20 Hz 帧缓冲哈希 + 玩家/NPC 状态相等，本次通过 |
| 验收：既有测试全绿、goldens 不变、tsc 0 | 成立 | §1 |
| 验收：QuickJS 每帧耗时（960×544 满屏动画格）写进报告 | 成立且可复现 | §8 |
| 续做：README | 成立 | `README.md:380-448` 新节 |
| 续做：不写任务号、不提交 vendor 类型变更 | 成立 | §6 |

## 3. 额外核对 1：数据形状能否承载 Tuxemon 真实动画

对 `/var/tmp/oss/pocket-tuxemon/data/terrain-animations.json` 的统计（本次自算）：

- 263 个地图键，48 张有动画，**5,785 个 placement**；`above: true` 34 个 / `false` 5,751 个；
  每项都是 `{x, y, above, frames[{tile, durationMs}]}`，与 `AnimatedTile { x, y, above, sprite }` 一一对应，
  `frames` 由 cooker 折成 `sprite` 名 + sprites.json 行。
- 帧数分布：2 帧 132、3 帧 2,981、4 帧 409、5 帧 446、6 帧 952、8 帧 859、22 帧 6。
  等时长序列最多 8 帧 → 图集 128×16；22 帧 → 32 列 = 512×16，仍在 PSP 纹理上限内。
- 时长取值 10/50/100/150/200/250/300/500/600/750/800/1000/1500/1750/2000/3000/5000 ms，
  除 10 ms 外全部是 50 ms 的倍数，`round(ms/1000×60)` 无舍入误差（10 ms → step 1 = 16.7 ms）。
- **不等时长**：100 个 placement、18 条不同序列（1.7%）。

实际换算抽样（cooker `stepFor` 规则 `tools/lib/animated.ts:74-77`）：

| placement | frames | 换算 | 判定 |
| --- | --- | --- | --- |
| `37707_town` (11,13) `above: true` | 4 × 200 ms | cols 4 / frames 4 / step 12 / 64×16 | 精确 |
| `water_end_of_desert` (0,0)（该图 1,488 个 placement） | 3 × 200 ms | cols 4 / frames 3 / step 12 | 精确 |
| `candy_town` (26,26) | 5 × 250 ms | cols 8 / frames 5 / step 15 / 128×16 | 精确 |
| `37707_town_missing` (4,1) | [1000, 500] | step 60，周期 2,000 ms（真实 1,500） | 降级 |
| `37707_town_missing` (9,1) | [1500, 100] | step 90，100 ms 的"闪一下"帧被拉到 1,500 ms | 降级（观感差异明显） |
| `37707_town_missing` (6,7) 等 40 处 | [1000, 10] | step 60，周期 2,000 ms（真实 1,010） | 降级 |
| `37707_town_missing` (10–12,13/14) `above: true` | 22 帧 [3000,1000,2000,100,…] | step 180，周期 66 s（真实 17 s） | 降级 |

降级规则与 Scout S2 §4.5 第 2 条一致（"帧时长不等用第一帧时长"），README `:416` 与
`findings/R2.md` 都明确写出。结论：**形状够用**，等时长序列（98.3%）精确还原；不等时长
序列的更好还原属于 cooker 的可选增强（§9.1），不是本任务的缺口。

## 4. 额外核对 2：16×32 角色

**帧选取与 Tuxemon 表布局一致**（对照 `/var/tmp/tuxemon-src/tuxemon/map/view.py`，不是只信 Scout）：

- `view.py:296-299` `row_map` front=0、left=1、right=2、back=3；`:307` `idle_frame = frames[1]`；
  `:313-317` 行走序列 idle → frames[0] → idle → frames[2]。
- 组件仓 `tools/lib/bake.ts:225-228` `rowForFacing [0, 1, 3, 2]`（引擎 0 下 1 左 2 上 3 右）、
  `idleCol 1`、`walkLCol 0`、`walkRCol 2`；`src/engine/movement.ts:98-105` `walkPose` 的
  phase 2–3 → walkL、6–7 → walkR、其余 idle，正好是 idle→步1→idle→步2。
- `sprites/` 实测 208 张 48×128（3 列 × 4 行 × 16×32）+ 1 张 16×32 `drop_shadow.png`。

**锚定**：`view.py:582` 对高于一格的 surface `rect.y -= h // 2`（32 px 上移 16）；组件仓
`PlayerSprite.tsx:63` 与 `GameView.tsx:510` 用 `insetT: 16 - h` 达到同样的脚底贴格底效果。

**golden 肉眼核对**（原图 480×272 与 ×5 放大裁剪 `/var/tmp/fleet/1825/zoom-*.png`）：

- `walker-down`：玩家红色身体、头部两点"眼睛"（朝下记号），白色 idle 脚部**恰好落在占用格
  底边**，精灵上半身伸进上一格；(19,12) 的 NPC 头部被 (19,11) 紫色 canopy 完全盖住，红色下半身
  与白脚可见；(22,14) 行走 NPC 蓝色（朝右）。
- `walker-up`：玩家黄色、头顶一道横杠（朝上记号）；`walker-left`：绿色、记号在左侧；
  `walker-right`：蓝色、记号在右侧，同时行走 NPC 绿色（朝左）且脚部品红 = walkL 步态。
- `animation-frame-6`：全场由第 0 帧青色切到第 1 帧黄色（step 6，第 6 帧），角色不受影响。

**遮挡（本次额外像素探针，临时 sim 用例，已删除）**：

- 玩家走到 (17,12)，头部在 `above: true` 动画格 (17,11) 之下：头顶像素 `[236,72,104]`
  = 动画第 3 帧色，身体像素 = 朝右色 → `above` 动画确实盖在角色之上。把 above 带提前到
  NPC 容器之前（变异 C）后该探针立即变红（头顶像素变成身体色）。
- 玩家站在行走 NPC 正北 (22,13)、NPC 停在 (22,14) 时，玩家脚部与 NPC 头顶重叠像素为
  `[238,238,244]`（玩家 idle 脚色）→ 玩家（北）画在 NPC（南）之上，**角色之间没有按 y 排序**。
  对照上游：Tuxemon 把 NPC surface 交给 pyscroll，`orthographic.py:486,520` 的 blit 排序键是
  `(layer, 1, x, y, order)`，也不是按底边排序，所以与上游持平。记为观察 §9.2。

## 5. 额外核对 3：动画不进 reducer、确定性

- `AnimatedTiles.tsx:16-32` 只依赖 solid/lifecycle/renderer 与纯函数 `chunkWindow`、`TILE`，
  没有 interpreter/session/movement 导入；帧推进由 core 的 sprite atlas 完成，JS 只在窗口变化时
  绑/解绑节点（`:130` 窗口不变直接返回）。
- 角色帧完全来自存档内状态：`GameView.tsx:393` 用 `CharState.facing/phase`，`PlayerSprite.tsx:52-54`
  用 `move.facing` + `walkPose(move.phase)`；没有宿主时钟。
- 多 hz：`tests/r2-ui-sim.test.ts:147-168` 60/30/20 Hz 各跑 2 s 虚拟时间，帧缓冲 FNV 哈希、玩家
  与行走 NPC 的 `CharState` 全等，本次通过。
- 存档：`playerName` 进 `SwitchState`（`interpreter.ts:98`），`cloneInterp:542` 与
  `createSwitchState:110` 缺省补默认名，`save-validate.ts:366-368` 只在字段存在时校验 1–24 字符，
  旧档无字段可加载；`tests/player-name.test.ts:158-181` 覆盖信封往返与坏名拒收。`{name}` 在 fold
  时替换（不是编译期），`total` 按展开后文本计数（`tests/player-name.test.ts:79-87`）。

## 6. 额外核对 4：任务号与 vendor

- `git diff 4472bbd..HEAD -- . ':!findings'` 的新增行 grep `fleet|task-1|1801|1820|1806`：**0 命中**。
- `findings/R2.md:39,109,120,122` 含 `~/.fleet/worktrees/task-1806/...`、`/var/tmp/fleet/1820/...`
  路径（报告而非代码；R1 报告也有同类路径）。建议合并到公开仓时由 commander 顺手改成相对描述，见 §9.5。
- `vendor/pocketjs`：gitlink 未变、无提交触碰、工作树干净（§1）。

## 7. 变异检查（改坏 → 测试变红 → 还原）

| 变异 | 结果 |
| --- | --- |
| A `bake.ts` `rowForFacing [0,1,3,2] → [0,1,2,3]` | `tests/walker-sheet.test.ts` 1 fail（idle 帧取错行） |
| D `animated.ts` `stepFor` +1 | `tests/animated.test.ts` 2 fail（Expected 12 / Received 13） |
| B `PlayerSprite.tsx` `insetT: 16 - h → 0`（顶部锚定），重建 r2-ui | `tests/r2-ui-sim.test.ts` 2 fail（`pixel (240,120)` 头部像素 + 第 6 帧 golden） |
| C `GameView.tsx` 把 `above` 带 `AnimatedTiles` 挪到 NPC 容器之前，重建 | 树序断言 fail（Expected < 2 / Received 5）+ 本次头顶像素探针 fail |

四处还原后 `git status` 干净，重建后 `r2-ui-sim` + `walker-sheet` + `animated` 共 11 pass / 0 fail。
完整日志 `/var/tmp/fleet/1825/mutations.log`。

## 8. QuickJS 基准复现

同一 harness（`/var/tmp/fleet/1820/host-bench/src/r2_ui_bench.rs`，钉住的 PocketJS `76ae741f`
桌面宿主 `Runtime` + QuickJS `Guest`，960×544、density 2，满屏 below 动画 2,135 格 + 1 个 above，
预热 60 帧、测 600 帧）本次在同机复跑：

| 指标 | builder（`findings/R2.md`） | 本次复现 |
| --- | ---: | ---: |
| boot eval | 39.526 ms | 49.095 ms |
| 首帧 JS / core（创建并绑定 2,136 节点） | 69.253 / 1.521 ms | 75.906 / 2.135 ms |
| 稳态 JS mean / p50 / p95 / p99 / max | 0.142 / 0.138 / 0.164 / 0.200 / 1.000 ms | 0.167 / 0.158 / 0.218 / 0.327 / 1.316 ms |
| 稳态 JS > 16.667 ms | 0 / 600 | 0 / 600 |
| 稳态 core mean / p95 / max | 0.000 / 0.000 / 0.001 ms | 0.000 / 0.000 / 0.002 ms |

数量级一致，结论成立：稳态不随动画格数产生逐格 JS 开销；首帧一次性挂载是可见尖峰。
日志 `/var/tmp/fleet/1825/bench-run1.log`。

## 9. 非阻断观察

1. **不等时长序列的还原度**（§3）：18 条序列中 11 条（54 个 placement）按 GCD 复制帧即可精确
   还原且 ≤ 41 帧（8×8 网格 128×128 px），1 条 `[1000,10]`（40 个 placement）需 101 帧（16×8
   网格可放），6 条 22 帧序列需 341–346 帧只能降级。pak 编译器允许 `frames ≤ cols × rows`
   （`vendor/pocketjs/framework/compiler/pak.ts:247-250`），但 cooker 固定 `rows: 1`
   （`animated.ts:137`）。建议后续给 cooker 加可选 GCD 展开 + 多行网格，由导入器决定阈值。
2. **角色间无 y 排序**（§4）：玩家在 NPC 正北时玩家脚部压在 NPC 头顶上。上游 pyscroll 也不按
   底边排序，属持平；若要更好观感可在 NPC/玩家容器内按 `ty` 重排，不影响本任务验收。
3. **首帧挂载尖峰**：Xeon QuickJS 上 2,136 节点 75.9 ms。真实 480×272 视口 + 1 格 ring 最多
   32×19 = 608 格，线性估算约 22 ms，PSP 更慢；builder 已在报告里提出分帧 mount 预算，接口没有堵死。
4. `src/engine/README.md:89` 描述 `state.sw` 字段（switch/variable/item/gold/RNG）时未提
   `playerName`，顶层 README 与 `src/data/CHANGELOG.md` 已写；建议补一句。
5. `findings/R2.md` 含 fleet 内部路径（§6）。
6. Sunstone JS 预算 320,000 → 326,000 B（实测 323,679 B，`tests/sunstone-game-sim.test.ts:402`），
   余量 0.7%，下次功能进入大概率再调；接受。

## 阻断项

无

PASS
