# Review task-1806 — G5 地形导入（263 TMX → 流式瓦片块 + 碰撞）

- 被审任务：1806（G5 `game-G5-terrain.md`），分支 `fleet/task-1806`，唯一提交 `a0d0215 feat(importer): stream Tuxemon terrain chunks`。
- 评审任务：1817（跨族评审）。评审者在独立 worktree 复跑全部门禁与验收，未修改任何受版本控制的产物（临时文件均在 `/var/tmp/fleet/1817-review/`，结束时 worktree `git status` 干净）。
- 基线：游戏仓 main = 3139d89（已含 Kit R1 流式块 bump）；Kit 子模块 = `3139d89`，pocketjs = `76ae741f`；Tuxemon 源 = `9e6258ff`。

## 结论速览

G5 的全部**硬性**验收项在评审者机器上独立复现通过：tsc 0、测试 7/7、两遍产物字节一致、6 图 × 2 视口逐像素 0 差异（已肉眼看图）、碰撞独立 oracle 在 11 图 56,176 次定向移动 0 不一致、Spyder 真实地形无头试玩 20/30/60 Hz 全过、QuickJS 性能数字可复现且远低于预算。内容 100% 自动导入，无逐图特判；Kit/pocketjs 无 Tuxemon 专用代码、无改动。变异测试证明三类关键断言非空转。

两处均为**非阻断**遗留（详见末节）：(a) Kit `dirBlock` 不支持非对称边，全语料有 1,161 处「反向过宽」，其中含 10 张 Spyder 主线图——但经评审者全语料分类，**1,161 全部为 over-permissive、0 处 under-permissive，不可能堵死合法路径/主线**，且 builder 已逐数上报并挂了跟进提案 1643；(b) G1 尚未在本分支存在，最终「拼到 G1 文档」一步依赖前置，builder 以经测试的 `applyTerrain` 合并原语 + 片段交接替代并在报告中如实说明。

## 逐条对照规格

### 要做的事

| # | 规格要求 | 判定 | 证据 |
| --- | --- | --- | --- |
| 1 | `importer/terrain.ts`：TMX→每图 ground/upper 合成（S2 规则）→ Kit `stream.ts` 编 TILESET + pak 清单 + `GameAssets.stream` 字面量；动画先烘第一帧 | 成立 | `importer/terrain.ts:804-807` 调 `encodeStreamedLayer`；`writeTerrain` 产出 `pak.json`/`assets/stream/*.pkts`/`ui/terrain-assets.ts`（`terrain.ts:899-919`，字面量头 `export const TERRAIN_STREAM: StreamedGameAssets`）。图层按 pytmx 索引 0..2 在下、>2 在上（`terrain.ts:330-347,776`），翻转为独立变体（`384-415`），动画烘首帧并把完整帧表另存 `data/terrain-animations.json`（`13,792-800,915`）。直/预乘 alpha：合成走 Kit `blitTile`，独立 Python 端用 straight-alpha Porter-Duff over，逐像素一致。 |
| 2 | 碰撞：图块碰撞、碰撞矩形、碰撞线与方向进出属性 → Kit passage（补全 S1 只用矩形的部分） | 成立（含一项已上报的引擎能力缺口，见遗留 a） | 顺序复刻 Tuxemon loader/movement：表面属性→region(enter_from/exit_from/endure)→闭合矩形/多边形包围盒（ties-to-even）→开放折线→同名 YAML 覆盖（`terrain.ts:510-606`）；编译 `passage` block + `dirBlock` mask（`636-722`）。独立 oracle 覆盖多边形（gaming_hall）、384 折线边（buddha_mountain）、方向 region、14 个 label 动态格、21 个 YAML-only 格。 |
| 3 | 接到 G1 地图文档（替换占位地形），`gen-assets` 一条命令出全部资产，跑两遍无 diff | 部分（依赖阻断，非缺陷） | 「一条命令 + 字节稳定」**成立**：`bun run gen-assets` 7.5s 出全部，重跑 0 diff。「拼到 G1」**无法字面满足**：G1 在本分支与 main 上都不存在（main 仅 scaffold+两份 scout+R1 bump）。builder 改交经单测的 `applyTerrain(project,fragment)`（`terrain.ts:922-944`）+ `data/terrain.json` 片段，并在真实地形 Spyder smoke 中实际调用。报告 `G5.md:7` 如实披露。 |

### 验收

| 验收 | 判定 | 证据 |
| --- | --- | --- |
| 与原作逐像素：≥6 图（室内/城镇/最大野外/动画/翻转/上层遮挡）480×272 与 960×544，玩家/NPC 外 0 像素差；自己看 PNG | 成立 | 6 图（taba_house1 室内带上层、taba_town 城镇+动画+遮挡、buddha_mountain 100×100 最大野外、tt_searoute1 969 动画引用 7 层、spyder_timber_town 319 翻转带上层、route3 动画+全翻转）×2 视口 = 12 组，**outsideMask=0**，合计 3,916,800 视口像素。taba_town `markerSame=256` 双向证明上层盖住玩家的绘制序。评审者已逐张打开对比条（见下「画面」）。 |
| pak 总字节 / gzip / QuickJS 每帧与切图最坏帧写进报告（对照 S2 H） | 成立 | 原始 stream 21,544,996 B、packed 21,575,296 B、gzip-9 2,358,327 B（评审者 `find … \| cat \| wc -c` 与独立 gzip 复核同量级：2,348,547 B 为裸拼接，容器另有 ~30KB 头）。QuickJS：480×272 最坏切帧 0.851ms(citypark)，960×544 1.595ms(rubberduck_cave_01)，稳态 ~0.02ms，**0 帧 >16.7ms**，优于 S2 H 的 3.44ms 切图预算。 |
| 碰撞：S1 Spyder 开场无头试玩在真实地形仍通过；抽 10 图做可走性对照 | 成立 | smoke 20/30/60 Hz 全过（帧数 690/911/1626，与报告逐字一致）。可走性对照做了 **11 图**（规格要 10），56,176 次定向移动 0 不一致。另：评审者把 oracle 扩到全 263 图，见遗留 (a)。 |
| tsc 0、测试全绿 | 成立 | `bunx tsc --noEmit` exit 0；`bun test tests/` 7 pass / 0 fail。 |

交付：本地提交、报告 `findings/G5.md`、`fleet_claim`（builder 侧）齐备；未 push、无 PR、无 GitHub 改动。提交作者 `lfkdsk`，无 Co-Authored-By 尾注，符合硬规矩。

## 门禁复跑（评审者亲自执行）

```
$ bunx tsc --noEmit          # TSC_EXIT=0
$ bun test tests/            # 7 pass, 0 fail, 32 expect() calls, 1 file
$ bun run gen-assets         # terrain: 263 maps, 175093 cells, 430 TILESET entries,
                             # 21575296 pak bytes (2358327 gzip), 14 quantized chunks
$ git status --porcelain | wc -l   # 重跑后 0（字节稳定）
$ bun run verify:terrain:determinism
  # filesPerRun 435, bytesPerRun 32796511,
  # aggregateSha256 121cb983…d3b68, identical true（与提交报告一致）
```

## 画面（肉眼核对，非仅钉哈希）

评审者重建独立 Python 参考图与 terrain-preview bundle（真实 PocketJS wasm host + Kit `StreamedChunkLayer` + `loadTileTexture`），打开了下列 `[运行时 | 独立参考 | 差异×8]` 对比条：

- `compare-taba_town-960x544.png`：左右两半城镇（房屋/道路/水系/农田）完全一致，差异面板全黑。
- `compare-buddha_mountain-960x544.png`：最大野外图，地形一致；差异面板仅中央一个白色 16×16 方块＝被排除的玩家标记。
- `compare-spyder_timber_town-480x272.png`：319 处翻转 + 上层建筑，除粉/白玩家标记外无差异。
- `compare-tt_searoute1-480x272.png`：969 处海水动画烘在首帧，运行时与参考一致。
- `compare-taba_house1-480x272.png`：小室内（家具/地板/上层墙沿）一致。
- `compare-route3-480x272.png`：动画 + 翻转组合（卡车/柱/岩石），一致。

结论：看到的是结构清晰、无错位/无紫块/无层序错误的 Tuxemon 原版地形；差异面板除玩家标记外全黑，与机器比对 0 差异吻合。重新生成的 12 张 PNG 与提交版字节一致（仅 G5-pixel-report.json 的绝对路径字段因评审者换了 scratch 目录而不同，已还原）。

## 碰撞 oracle（独立实现，非 builder 自述）

`tools/verify-terrain-collision.py` 用 ElementTree 直接解析 TMX/TSX/YAML，独立复刻 Tuxemon `loader.py`+`movement.py`，不 import TS 实现。

```
$ venv/bin/python tools/verify-terrain-collision.py
  # {"comparedDirectedSteps": 56176, "maps": 11, "mismatches": 0}
  # 输出与 findings/G5-collision-report.json 字节相同
```

覆盖：buddha_mountain 折线边 384、gaming_hall 多边形、spyder_paper_manor YAML-only 21 格、spyder_candy_hospital3/spyder_dryadsgrove 的 label 动态格、方向/endure region。

评审者额外把同一 oracle 跑遍 **全部 263 图**：`{"comparedDirectedSteps":453644,"maps":263,"mismatches":1161}`，与 importer 自报的 `directedEdgeMismatches=1161` 精确一致（独立交叉验证了该计数，不是照抄）。

## 变异检查（2–3 个关键断言，故意改坏→变红→还原）

1. **关掉同名 YAML 碰撞覆盖**（`terrain.ts` tileCollision）：`bun test` → 5 pass / **2 fail**（yamlCollisionCells=21 与 block 格断言）；独立 Python oracle 在 spyder_paper_manor 报 **76 mismatches，exit 1**。双重独立护栏同时变红。
2. **去掉水平翻转合成**（FLIP_H）：真实运行时像素校验在 spyder_timber_town **exit 1**（玩家标记外出现差异）。（注：只去对角 FLIP_D 时该视口恰好无对角翻转可见像素，故改选更普遍的 FLIP_H 以确保护栏可被触发；这也侧面说明 6 图视口对「罕见翻转类型」的覆盖有限，但翻转总数由 `flipCells=1033` 与逐像素比对共同保障。）
3. **不写 `map.passage` block 覆盖**：`bun test` → **1 fail**；oracle 在 taba_house1/gaming_hall/candy_town 报 **4,308 mismatches，exit 1**。

每次变异后均还原备份并重跑 gen-assets，最终 `git status` 0 改动。

## 性能（QuickJS，方法与可复现性）

- 方法正确：`tools/bench-terrain-quickjs.sh` 把**未改动的** vendored 桌面宿主拷到 scratch，include `tools/terrain-quickjs-bench.rs`；bench 用 `Runtime.boot` + rquickjs 的 **QuickJS `Guest`** + 原生 TILESET 解码 + `UiSurface`，JS 段（`guest.frame`）与核心段（`surface.tick`）分别 `Instant` 计时（`terrain-quickjs-bench.rs:63-88`），启动真实 21.6MB pak 并 `assert_eq!(maps.len(),263)`。不是 Bun/JSC 数字。
- 评审者在**独立 target 目录**重新编译宿主并复跑：
  - 480×272：steady js mean 0.020 / p95 0.024 / max 0.034 ms；switch mean 0.204 / p95 0.432 / **max 0.851 ms worst=citypark**；over16.7=0；末态 QuickJS heap 1.23 MiB / 4840 对象。
  - 960×544：steady mean 0.019 ms；switch mean 0.221 / p95 0.551 / **max 1.574（total 1.595）ms worst=rubberduck_cave_01**；over16.7=0；heap 1.30 MiB / 5446 对象。
  - 与提交 `findings/G5-quickjs-report.json`（0.852 / 1.637 ms、heap 1.23/1.30 MiB）在运行噪声内一致。

## 原则核对

- **全自动导入**：是。`importTerrain` 仅按 `readdir().sort()` 遍历，无任何 map-id 分支/逐图特判（`terrain.ts:735-845`）；PNG/TMX/TSX 由自带无依赖解析器读取。无手改产物，重跑整体覆盖。
- **Tuxemon 专用代码是否进组件仓**：否。`grep -ril tuxemon vendor/pocket-rpgkit/{src,tools}` 无结果；所有专用逻辑都在游戏仓 `importer/`、`tools/`、`ui/terrain-assets.ts`。
- **是否改 vendor/pocketjs**：否；Kit 与 pocketjs 子模块工作区均干净，HEAD 与钉版一致。
- **覆盖率/规模透明度**：`data/terrain-report.json` 给出每图 ground/upper 字节、量化、动画、翻转、碰撞各计数，满足「导入器输出覆盖率」的精神（动作/条件覆盖率属后续事件任务，不在 G5 范围）。

## 阻断项

无。

## 非阻断遗留（建议后续任务处理，不影响本任务 PASS）

1. **非对称方向边（Kit 能力缺口，已上报）**：Kit `dirBlock` 是无向物理边，无法表达 Tuxemon 的单向进出。全语料 **1,161 处 over-permissive、0 处 under-permissive**（评审者全 263 图分类，见 claim 11701）。含 10 张 Spyder 主线图（spyder_scoop1 130、spyder_citypark 86、spyder_route1 84、spyder_route3 70、spyder_scoop3/spyder_routea/spyder_route2/spyder_dragonscave/spyder_candy_town/spyder_greenwash）。因全部为「玩家能反向穿过本应阻挡的单向边（如崖/跳点）」、从不关闭合法路径，**不会造成主线软锁**（真实地形 Spyder 试玩已通过），属保真度瑕疵；需由跟进提案 1643 的组件仓「非对称 passage」能力在 P3 主线 journey 验收前补齐。另注：builder 选的 11 图碰撞验收样本恰好不含任一 mismatch 图，虽满足「0 不一致」验收，但建议后续把 spyder_route1/scoop1 等纳入显式回归集以持续盯住该缺口。
2. **G1 拼接待 G1 落地**：合并 G1+G5 的任务需对真实 G1 文档调用 `applyTerrain`（或把 gen-assets 接入其管线），并把 14 个 label 碰撞格（`screen`/`volcoli`）物化为可移除的阻挡事件，以支持 `remove_collision`。原语与片段均已就位并有单测。
3. **14 个 CLUT8 量化块（10 图）有损**：6 张验收图刻意不含量化块、保证验收样本无损；全语料这 14 块沿用 R1 CLUT8 编码器的既有量化（S2 H 方案本就采用 CLUT8）。如需这几张室内图也无损，可在 Kit 侧加非量化回退路径。

PASS
