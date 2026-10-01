# 审查：W1（task 2002）`.world` 无缝世界 world index

基线 `main` = `4486f35`；被审分支 `fleet/task-2002`（4 个提交：`734ff47` world index、
`b32532d` handoff 分类、`94f676a` 别名解析、`7f7c337` 报告，作者
`lfkdsk <lfkdsk@gmail.com>`，无 AI 尾注，无 fleet 任务号泄漏）。规格
`/var/tmp/fleet-specs/pocket-tuxemon/game-W1-world-index.md`，依据
`findings/scout-S5-p3.md` §3。

审查方法：3 个只读 subagent 并行核对源数据（接缝/尺寸/schema），主 agent 复跑全部门禁、
亲自做变异、亲自做前向合并，并独立抽验了旗舰接缝与 S5 点名负例。

## 1. 逐条对照规格

### 1.1 接缝判定 — 成立

- **可信接缝**：subagent A 用独立 Python 解析器（镜像 `importer/world.ts` 的
  `touchingSides`/`portalEvidence`/`seamOpening` 语义）从 `.world` 摆放 + TMX 根尺寸
  重算了**全部 71 条**接缝的几何（sideA/sideB/spanA/spanB/offset），0 条不一致；深查
  11 条（覆盖 4 种 handoff 模式，含规格点名的 Classic Route 1↔Hearthrock、Normal
  citypark↔leather_town、2 条 Eclipse direction-only、4 条 Spyder），每条证据
  （transition_teleport 物件 id/边缘接触/目标地图，或 cardinal 属性 + 别名解析）逐条在
  TMX 中定位属实。我本人复算 Classic Route 1↔Hearthrock：`.world` 摆放
  route_1=(1104,1024,640×320)、hearthrock=(1104,1344,640×320)，共边 40 格；两侧
  传送门事件 rect 均为 48×16px（3 格宽）、落点 (33,0)/(33,19) 在正确边缘行上，
  `fixed-destination` 判定正确（3 格入口汇到 1 格），seam 模式 portal-only 与
  `tests/world-import.test.ts:68-91` 一致。
- **边缘通行**：subagent A 解析了两侧 TMX `Collisions` objectgroup 的碰撞矩形沿接缝
  跨度的覆盖：通行模式一致（墙 + 门洞正好在传送门行）。值得记录的保守判定：
  route1↔route1_sanglorian 的 route1 侧整边被 944×64px 碰撞矩形封死（40/40），
  3 个传送落点都在 y=4（`wrong-target-edge`），index 正确标 portal-only——它是传送走廊，
  不是可走接缝，与 S5「portal ≠ 空间接缝」的警告一致。
- **20 个假接触全部核实**：17 个 unsupported-contact（对间确无对齐传送/方位链接）、
  1 个 portal-away-from-edge（route1↔taba_town：4 个传送门在 route1 x=50、taba x=8，
  均为 INTERIOR，不碰共享 E/W 边——我本人独立复算确认）、2 个 wrong-side-direction
  （diamond_hill 的 `west` token 指向其东侧邻居）。Spyder 12 个假接触与 S5
  `findings/scout-S5-p3.md:147-152` 列表逐字相等。
- **handoff 分类**：5 条接缝 36 个 opening 逐字段重算（sourceSpan/expectedTargetSpan/
  actualTarget/issues/compatibility）全部一致；唯一的 mixed（flower_city↔routea）
  的单个 offset-mismatch（routea:45 期望切向 13、实际 12）手工确认。
- **与 S5 71 条逐条对照**：S5 枚举了每世界计数（15/9/15/32=71）、91 几何接触
  （15/14/18/44）、Spyder 23 图连通分量、12 假接触——全部精确复现；S5 未枚举单条接缝，
  无更多可逐条对照项。

### 1.2 尺寸修正 — 成立

49/49 条修正经 subagent B 独立核对：declaredPixels 与 `.world` 条目一致、actualPixels
与 TMX `width×tilewidth × height×tileheight` 一致。46 条 zero-size + 3 条 stale-size
（`spyder_paper_rival_bedroom` 128×128→112×112、`spyder_paper_rival_downstairs`
176×208→176×192、`spyder_routeb` 256×640→320×640=TMX 20×40 格）；20 条户外。
普查同时确认：139 成员/67 户外/72 `inside=true`、每世界 15/15、12/12、17/17、23/95、
452 个户外 TMX 传送（37/0/173/242，逐 id 一致；`leather_town.tmx` 用单数 objectgroup
名 "Event" 与 `act10` 编号，导入器两种都正确处理）、bbox 280×120/120×240/200×341/
180×200、0 重叠、67/67 原点 16 对齐、Eclipse 唯一歧义（obsidian_town east=lion_mountain
有 3 个别名候选且 0 个东侧几何对齐）。

### 1.3 schema 与确定性 — 成立

- `importer/world-schema.ts`（745 行）的校验是**关系型重算**而非形状检查：矩形关系
  （`:550,690,729`）、局部 span（`:553-554`）、offset（`:556`）、portal touchingSides
  （`:528-531`）、完整证据集（`:586-604`）、handoff（`:605-613`）、adjacency
  （`:617-622`）、歧义（`:639-642`）、linked-gap 完整性（`:735-737`）、尺寸修正
  （`:628-638`）、content hash（`:743`），并保证每条边恰被接受或拒绝一次（`:731`）。
  足够给 W2 当消费契约；`portal.targetMap` 合法指向室内图（59 个），校验只要求非空字符串，
  且这类 portal 永远无法认证接缝（`:404-405`）。
- 确定性：两遍 `bun run import` 产物字节一致（world-index/import-report/pak.json/
  G1-coverage 四个 hash 两遍相同），导入后 `git status` 干净——**提交的产物与现跑导入
  字节相同**。文件 SHA-256 `daba4583c444da9a8ef06ab14a8b3887abc351afb3fa10eb15f347baa40a2a25`、
  contentHash `c681c230fe432bbbf8809fe11a5bbc42fc8eb4f62c2ec1a6be141fd0c35f2143`，
  与 `findings/W1.md` 一致；subagent C 独立重算 hash 一致。
- **变异（主 agent 亲自做，隔离副本 `/var/tmp/fleet/2018/mut-1`，用完已还原）**：
  - M1 把假接触 route1↔taba_town 强行放进 allowlist（同时放开证据长度断言）：
    **4 个测试变红**（S5 普查、portal-shaped 负例、20 假接触 pin、关系 corruption）。
  - M2 把 content hash 改成不覆盖 `sourceRevision`：**恰好 1 个测试变红**
    （`is byte/hash stable and rejects stale content hashes`），证明 hash 守卫锐利。
- 低危备注（不阻断）：全仓排序用无显式 locale 的 `localeCompare`，操作数全 ASCII，
  同机两遍确定性已过；跨机消费者建议改码点比较。

### 1.4 前向合并 — 成立（1 处预期冲突，已验证解法）

在临时 worktree（`/var/tmp/fleet/2018/merge`，被审分支未动）`git merge main`（`4c5cae4`，
含 GW1 worldIdle + C1 + 重录 tape）：

- **唯一冲突**：`tests/importer.test.ts` 的字节 pin 哈希行（两侧都改了 `ImportBuild`
  形状）。这是预期冲突：合并后的 build 同时含 W1 的 worldIndex 与 GW1 的 worldIdle，
  正确哈希是重算值 `03ceb6cecbfc329f80fa3e930366b29d2ec3bc45ab20a6cad14e752db6b0f77c`
  （与两侧都不同）。`importer/project.ts` 两侧改动自动合并干净（GW1 的 worldIdle
  与 W1 的 world index 互不干扰，证实 W1「只加一处调用、不动 current_state/worldIdle」
  的边界守住了）。
- 合并后重跑 `bun run import`：**world-index 字节不变**（contentHash `c681c230…`、
  文件 SHA `daba4583…`、71 seams/452 portals）。
- `bunx tsc --noEmit`：PASS（注：我最初把被审分支的 node_modules  symlink 过去，
  因 main bump 了 pocket-rpgkit/pocketjs 而缺 vue/octane 依赖报错；在合并副本里
  `bun install --frozen-lockfile`（公共 registry，bun.lock 未改写）后通过——这是我
  测试环境的陈旧问题，不是合并冲突）。
- 聚焦测试 `tests/importer.test.ts tests/world-import.test.ts`：36 pass / 0 fail。
- `bun run verify:gb6:mainline`：**PASS**，109,983 帧、100 场战斗、终态
  `d62d1465492219071b0dfcb14e6ba59571c1fed91ce176bb4ccfb749821d3413`
  （与 main 重录 tape 自带的 `terminalStateSha256` 一致；验证器比对的是 journey
  自带期望哈希，`tools/verify-gb6-mainline.ts:347`）。

### 1.5 门禁 — 成立（主 agent 全量复跑）

| 门禁 | 结果 |
|---|---|
| `bun run import` ×2 | exit 0；world-index/import-report/pak.json/G1-coverage 四 hash 两遍相同；`git status` 干净 |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | PASS（生产 pak 4,623 条 / 62,728,864 字节） |
| `bun run build:wasm` | PASS（289,758 字节） |
| `bun test`（全量） | **177 pass / 0 fail / 0 skip**，71,095 assertions，36 文件 |
| `verify:g6:locks` | 333/333 动态检查，327 unlocked、2 transferred、0 unresolved/error/exception |
| `verify:g6:g6:determinism` | PASS，双隔离根 4,637 文件 / 61,672,769 字节，SHA `976e5c57…` |
| `verify:gb6:mainline` | PASS，109,981 帧、100 战，终态 `bd3616c7…`（与 W1 报告一致） |
| `verify:gb6:failures` | PASS，首败/后败两路，终态 `d321b217…` / `d87ba6c0…`（与 W1 报告一致） |
| `bun.lock` / `vendor/` | 分支 diff 无改动 |
| fleet 任务号 | 分支 diff 0 处 |

性能：W1 是数据/诊断任务，规格无 QuickJS 性能指标；S5 §3.3 的 QuickJS 预算是 scout
产物，不在本任务验收范围。画面：本任务无新渲染 PNG；既有语义/golden 渲染测试在全量
`bun test` 内通过。

### 1.6 原则 — 成立

world index 全部由 `importer/world.ts` 从钉死的 Tuxemon 源自动生成，无手改产物、无
逐图特判（测试里的计数 pin 是验收断言不是特判）；组件仓零改动（分支 diff 全在游戏仓）；
`vendor/pocketjs` 未动；新逻辑隔离在 `importer/world.ts` + `importer/world-schema.ts`，
`project.ts` 仅一处调用（`importer/project.ts:2181`）、零删除行。

## 2. 阻断项

无。

## 3. 非阻断备注

1. `localeCompare` 无显式 locale（全 ASCII 操作数，同机确定性已验证）；W2 跨机消费前
   可改码点比较。
2. 指向室内图的 portal 目标坐标不做（也无法普遍做）校验——portal 保持权威传送语义，
   W2 应依赖 `handoff` 门控而非重推目标几何。
3. route1↔route1_sanglorian 被接受为拓扑接缝但整边封死、纯传送走廊——index 已正确标
   portal-only；W2 实现 halo 时不要把它当可走接缝。

## 4. subagent 使用

3 个（relay 一层，并行）：A=接缝/假接触/handoff 对 TMX 源数据核对（11 深查 + 20 全查 +
71 几何重算）；B=49 尺寸修正与普查核对；C=schema/测试辨识力/集成边界/确定性审计。
省时间：三者并行约 11 分钟墙钟完成，主 agent 同时跑门禁；A/B/C 的关键结论（旗舰接缝、
route1/taba 负例、49 修正、hash、变异预测）均经主 agent 独立复核后才写入本报告。

PASS
