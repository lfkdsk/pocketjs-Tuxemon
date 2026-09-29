# 审查 KR1（task 1864）：地图仓库——按图懒加载

- 被审分支：`~/.fleet/worktrees/task-1864`，HEAD `b893355`，基线 `4dfb651`（8 个提交，23 个文件，+1817/−119）。
- 规格：`kit-KR1-map-repository.md`；审查要求：`reviewer-generic.md` + `review-KR1-extra.md`。
- 审查方式：全部门禁自己复跑；QuickJS 数字用 builder 留下的 release 宿主与 dist 复跑一组，并另建一份宿主拷贝逐项量出切图成本；写了独立的「内联 vs 骨架逐字节一致」测试；做了 5 个变异；打开了 golden PNG。
- 临时产物在 `/var/tmp/fleet/1869/`（未进仓）。

## 结论摘要

1. **KR1 规格的 5 条「要做的」与全部「验收」项成立**（§1）。门禁复跑：`build:example` exit 0，`bun test` 684 pass / 0 fail（基线 676 + 新增 8），`bunx tsc --noEmit` exit 0（§2）。
2. **确定性与存档成立**：缓存/加载/释放全部在 `Session` 派生字段里，不进 `SessionState`、不进 canonicalJson 哈希、事件条件读不到。我写的独立 parity 测试证明骨架会话与内联会话在 24 图夹具的 2400 帧（含 39 次传送与被驱逐地图的回访）**每一帧 canonicalJson 逐字节相同**；在已释放地图上读档与内联读档结果逐字节相同；60/30/20/4 Hz 每一档骨架=内联且跨档语义哈希一致；263 张 Tuxemon 真图回放 G6 journey 1,684 帧每帧一致，终态 FNV-64 `f146882ce7e66055` 与 builder 的 QuickJS 两个变体一致（§3）。
3. **变异**：改坏释放顺序、不释放、跳过校验和、跳过内容身份校验，builder 的测试都变红；**「把缓存命中写进状态」builder 的新测试文件不会变红**（只有我的 parity 测试和既有 sunstone attract 测试偶然抓到），属于测试缺口，不是实现缺陷（§3.3）。
4. **向后兼容成立**：全部示例仍内联；schema `oneOf` 同时接受 `maps` / `mapIndex`；sunstone 生成器重跑无 diff（§4）。
5. **切图卡顿（重点）**：复跑得到最坏切图帧 109.499 ms（`spyder_downstairs → spyder_paper_town`，与报告 109.516 一致）。逐项量得该图 acquire 的 102 ms 里：**SHA-256 48.1 ms（47%）、schema 全量校验 27.1 ms（26%）、读文件 18.4 ms（18%，其中 9.2 ms 是框架 JS 侧 UTF-8 解码）、为算哈希再 UTF-8 编码 6.9 ms、JSON.parse 1.0、createWorld 0.5、buildPassage 0.3**；真正的解释器编译与通行表合计 < 1 ms。按图大小线性外推，成本 ≈ 1.9 ms/KB；Tuxemon 最大的正式地图 `buddha_mountain`（212 KB）单次 acquire 363 ms。**在「P1 切图最坏 ≤ 50 ms」下本分支不达标（2.2×）**。但三项不改变确定性/存档、只碰仓库读取路径的降法（本地包跳过运行时 SHA-256、以轻量结构校验替代全量 schema、ASCII 快速解码）可把 journey 最坏帧从 109 ms 降到约 21 ms，263 图里除 `buddha_mountain`（估 ≈ 57 ms，需再叠加淡出期分步或宿主原生读取）外都进 50 ms（§5）。
6. **卫生**：新增代码/注释无 fleet 任务号；`bun.lock`、`vendor/pocketjs` 无改动；8 个提交作者均为 `lfkdsk <lfkdsk@gmail.com>`，无 AI 尾注（§6）。
7. **判断**：对 KR1 规格 **PASS**；切图成本**不阻断合并**（正确性、确定性、兼容性都成立，且降法局限在 `map-repository.ts` / 读取回调，不触及 reducer），但**阻断 P1 验收**——必须开一个 KR1-perf 后继任务，已用 `fleet_spawn` 提议（§9）。

## 1. 逐条对照规格

| 规格条目 | 结论 | 证据 |
| --- | --- | --- |
| 1. 向后兼容的地图仓库：内联 `project.maps` 照旧；大工程传 `mapIndex` 骨架 + `MapRepository(meta/acquire/releaseExcept)`；`createSession` 只取起始图；传送时取目的地（校验 schema/校验和）、建解释器世界与通行表、进入、按确定性策略释放 | 成立 | `src/engine/types.ts:280-313`（`MapIndexEntry`/`ProjectShell`/`MapRepository`）；`src/engine/session.ts:227-297` `createSession(project, hz, maps?)` 骨架分支只 `acquireSessionMap(start.map)` 后 `releaseSessionMapsExcept([start])`（:260-261）；`applyTransfer` :645-657 先 acquire 再 `enterMap` 再 `releaseSessionMapsExcept(sess,[mapId])`（保留集 = 当前图，纯函数于访问序列）；仓库 `acquire` :199-221 校验 SHA-256 → JSON → `$defs.map` schema + 行主/索引边界 → 元数据一致。测试 `tests/map-repository.test.ts:133-150` 断言起始只读 1 个条目、每次传送后三张缓存表都只剩当前图、回访重读。 |
| 2. 加载在 reducer 之外：缓存/MapDef/渲染节点不进存档、不进哈希、不被事件读取；存档只存 map id + 现有状态；内容不匹配拒绝读档 | 成立 | `SessionState`（session.ts:137-146）没有任何缓存字段；缓存在 `Session.maps/worlds/tables/repository`（:162-174）。存档 `content` 是信封元数据（save.ts:115），`checksum` 只覆盖 `state`（:199）。读档 `decodeEnvelopeText(text, expectedContent)` 在读任何地图之前拒绝清单/schema 哈希不符（save.ts:335-345；`restoreSessionEnvelope` save-restore.ts:131）。我的 parity 测试验证骨架/内联存档 `checksum` 相同、`content` 只在骨架信封出现。 |
| 3. 本地包同步取；网页留「异步准备 → 暂停输入/tick → 同一逻辑帧恢复」钩子，网络时序不进模拟状态 | 成立 | `MapEntrySource.read` 返回 `undefined` → `MapNotReadyError`（map-repository.ts:177,204）；`prepareSessionMap`（session.ts:207）在 reducer 外准备并编译；`GameView` 的 `blocked` 屏障（GameView.tsx:444-506）不消费 tick、原样重放同一输入帧；`AttractController.step` 对可 `prepare` 的仓库做整帧检查点回滚（attract.ts:460-509）。测试 :190-246 覆盖实时帧与 4 Hz 折叠帧。 |
| 4. GameView/资产侧只为当前图（与缓存窗口内）准备渲染数据；与 R1 流式块、KF1 角色平面配合 | 成立 | `mapsById = session.maps`（GameView.tsx:342）；`currentSlots()` 只为驻留图建槽位并清掉非驻留缓存（:355-371）；`GameAssets.maxActors` 由 cooker 生成（tools/lib/chunks.ts:180-184）；`OccludingUpperLayer` 用 `worldWidth` 而不再遍历所有 MapDef。 |
| 5. 构建侧 `tools/lib/` 拆「骨架 + 每图条目」，字节稳定，示例保持内联 | 成立 | `tools/lib/map-project.ts:42-88` `splitProjectMaps`；我在真夹具上跑两遍（第二遍先把 `maps` 逆序）`filesIdentical: true`，shell SHA-256 `cd066106…`（59,910 B）、首条目 `b5daec41…`，与 builder 报告一致；`sha256sum` 独立核对三个文件哈希与 JS 实现一致。四个示例的 `assets-game.ts` / 工程仍是内联。 |
| 验收：现有测试全绿（先 build:example）、goldens 不变、tsc 0 | 成立 | §2；diff 里没有任何 `tests/goldens/*.png`。 |
| 验收：≥20 图夹具的新测试（只加载起始图、传送加载/释放、回访、跨图存档、在已释放图读档、多 hz、两遍哈希、内容不匹配拒绝） | 成立 | `tests/map-repository.test.ts` 24 图，8 个用例覆盖上述每一项（:133-150 加载/释放/回访；:152-176 已释放图读档 + 另一构建拒绝且**不发生任何读取**；:178-192 60/30/20/4 Hz + 两遍）。 |
| 验收：QuickJS 启动到首帧、开机堆、切图最坏帧（对照内联），给 Tuxemon 规模推算 | 成立（直接在 263 图上量） | builder 原始输出 `/var/tmp/fleet/kr1-map-repository-final/results.txt`；我复跑一组见 §5.1。 |
| 验收：README、`src/data/CHANGELOG.md`、无任务号、`bun.lock` 不改、每步提交、报告 + claim、不 push | 成立 | README.md:243-285；CHANGELOG v1 amendment 2026-09-29；8 个提交；§6。 |

## 2. 门禁复跑

```
$ bun run build:example          → PocketJS build: done, build_exit=0
$ bun test                        → 684 pass / 0 fail / 457103 expect() calls, 43 files [80.96s], test_exit=0
$ bunx tsc --noEmit               → tsc_exit=0
```
（日志：`/var/tmp/fleet/1869/{build-example,bun-test,tsc}.log`。）

## 3. 确定性与存档

### 3.1 代码核对
- 唯一读取地图缓存的地方都以 `s.mapId` 为键（session.ts:467,515,530,563,756），没有条件/命令能观察缓存是否命中；`acquireSessionMap` 先把 `createWorld`/`buildPassage` 编到局部变量再发布（:196-201），失败时缓存与状态都不变。
- `releaseSessionMapsExcept` 对内联工程直接返回（:219），对骨架按插入序遍历三张 Map 并转发 `repository.releaseExcept`，是访问序列的纯函数。
- `restoreSessionSnapshot`（save-restore.ts:105-126）：先 acquire 保存的图，再 `restoreProblem` 校验，再重建 `chars`，最后只保留该图；`frame = floor(interp.frame / ticksPerFrame)` 比参照作品 alpine-post 直接用 `snap.interp.frame` 更正确（多 hz 下宿主帧 = 参考 tick / 折叠数），且 `frame` 本身非语义（builder 的多 hz 测试也剔掉它）。
- 骨架 `mapSchemaHash` 固定为 `MAP_SCHEMA_HASH` 字面量（map-repository.ts:108），测试 `tests/map-repository.test.ts:106` 断言它等于 `sha256(canonicalJson(schema.json))`，schema 一改就红。

### 3.2 我写的独立 parity 测试（`/var/tmp/fleet/1869/parity.test.ts`，4 个用例全绿）
```
$ bun test /var/tmp/fleet/1869/parity.test.ts
journey maps: spyder_bedroom -> spyder_paper_scoop -> spyder_bedroom -> spyder_downstairs -> spyder_paper_town -> spyder_route1
  state_fnv64 f146882ce7e66055 inline_fnv64 f146882ce7e66055
 4 pass / 0 fail / 4103 expect() calls [2.22s]
```
- 24 图 5×5 夹具（门 + 随机移动 NPC + variable/switch 命令），60 Hz 2400 帧，每秒按门传送并在两次之间走一格再走回：39 次传送、24 张图全部到访（含被驱逐后回访 `map_00`），**每帧** `canonicalJson(state)` 内联 == 骨架，且骨架缓存每帧只剩当前图。
- 第 7 秒存档（骨架信封带 `content`，内联不带；两者 `checksum` 相同），继续走 5 秒让该图被驱逐，`restoreSessionEnvelope` 与内联 `restoreSessionSnapshot` 结果逐字节相同，之后 600 帧继续一致；内联信封喂给骨架会话 → `content identity` 拒绝；另一内容构建的信封 → `manifest hash` 拒绝。
- 60/30/20/4 Hz：每档骨架 == 内联（含 `frame`），四档剔除 `frame` 后语义哈希相同。
- Tuxemon 263 图 + G6 journey 1,684 帧：内联与骨架每帧一致，5 次传送路径同 QuickJS，终态 `JSON.stringify` 的 FNV-1a-64 = `f146882ce7e66055`，与 builder 在 QuickJS 上两个变体（`results.txt`）与我的复跑（§5.1）完全一致。

### 3.3 变异（`/var/tmp/fleet/1869/mutations/run.py`，每次改完 `git checkout -- src/` 还原，最终 worktree clean）

| 变异 | 跑的测试 | 结果 |
| --- | --- | --- |
| M1 `applyTransfer` 里 `s.cacheHit = sess.maps.has(mapId)`（缓存命中写进状态） | builder `map-repository.test.ts` + 我的 parity | builder 的 8 个用例**全绿**；我的 3 个 parity 用例红 |
| M1 同上 | 全套 `bun test tests/` | 683 pass / **1 fail**（只有 `sunstone-attract` 的 built-in tape 复放偶然抓到） |
| M2 先 `releaseSessionMapsExcept` 再 `acquireSessionMap`（改坏释放顺序） | 同上 fast 集 | 红：`an async source pauses before transfer and retries the same input frame` |
| M2b 传送后不释放 | fast 集 | 红：7 个用例（builder 4 个 + parity 3 个） |
| M3 跳过 SHA-256 校验 | fast 集 | 红：`schema, metadata and checksum corruption are rejected before entry` |
| M4 跳过 manifest 身份校验 | fast 集 | 红：`a save restores onto an already released map and rejects another build` + parity 1 个 |

结论：释放策略、校验和、内容身份三条防线都有测试守着；**「缓存状态漏进 reducer」这条最关键的确定性性质在 builder 的新测试里没有直接断言**（多 hz 测试只比骨架自身，且确定性的泄漏跨 hz 也一致），建议把 parity 测试并入 `tests/`（非阻断，性质本身成立）。

## 4. 向后兼容
- `src/data/schema.json:8-12` 顶层 `required` 去掉 `maps`，`oneOf: [{required:[maps]},{required:[mapIndex]}]`——两者都有或都没有都被拒；`editor/engine/projects.ts` 的副本同步更新，`tests/editor-model.test.ts:64` 断言两者 `toEqual`。
- `createSession(project, hz)` 老签名不变；`startSession` 对内联工程多出的 `acquireSessionMap`/`releaseSessionMapsExcept` 分别是缓存命中与空操作。
- 四个示例（meadow/sunstone/grow/wander）与编辑器 bundle 仍内联；`bun examples/sunstone/gen-assets.ts` 重跑后 `git status` 无 diff，即提交的 `maxActors: 7` 就是 cooker 现算的值；cooker（`npcSrc` 键）与运行时 `spritePaints`（walker 或有 src）对 sunstone 13 个精灵的判定一致，最大槽位都算得 7（`/var/tmp/fleet/1869/sprite-consistency.ts`）。
- `schema-validate.ts` 重写为可复用子 schema 校验 + `oneOf` 判别键短路：短路只在所有分支都声明 `op`/`kind` 的 const/enum 且恰好一个分支匹配时收窄候选，语义与遍历全部分支等价；报错格式（`$.a[3].b`）不变；`validateSchema(root, instance)` 二参调用不变。

## 5. 切图卡顿（重点）

### 5.1 复跑 builder 的 QuickJS A/B（release 宿主，同一 dist，`/var/tmp/fleet/1869/journey-rerun.txt`）
```
sharded: startup_first_ms=184.627 qjs_used_mib=6.197 reads=1
  frame=18   spyder_bedroom → spyder_paper_scoop  total_ms=46.485
  frame=578  spyder_paper_scoop → spyder_bedroom  total_ms=17.745   (回访，已被驱逐 → 重读)
  frame=660  spyder_bedroom → spyder_downstairs   total_ms=25.410
  frame=830  spyder_downstairs → spyder_paper_town total_ms=109.499  ← 最坏
  frame=1674 spyder_paper_town → spyder_route1    total_ms=71.919
  END state_fnv64=f146882ce7e66055 reads=6
inline:  startup_first_ms=836.240 qjs_used_mib=34.562 ; 五次传送 2.005–3.778 ms ; END state_fnv64=f146882ce7e66055
```
与报告一致（109.516 / 3.670）。

### 5.2 逐项分解（QuickJS，Xeon w5-3435X；`/var/tmp/fleet/1869/breakdown-full2.txt`，每图 5 次取中位数，ms）

方法：另拷一份宿主 crate（`/var/tmp/fleet/1869/quickjs-host/src/kr1-breakdown.rs`），bundle 里把 `read`/`utf8Encode`/`sha256Bytes`/`JSON.parse`/`validateMapDef`/`createWorld`/`buildPassage`/`acquireSessionMap` 挂到 `globalThis.__kr1`，Rust `Instant` 包住每段极短的 `ctx.eval`；`full_acquire` 是同一会话上完整的 `acquireSessionMap`（缓存已清空）。

| 图 | 字节 | 页/格 | read(utf8) | =read_bytes+decode_js | utf8Encode | SHA-256 | JSON.parse | schema 校验 | 结构校验 | createWorld | buildPassage | **full acquire** | 各段之和 |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| spyder_bedroom | 7,247 | 10/63 | 2.62 | 1.20+1.36 | 0.90 | 6.00 | 0.15 | 3.96 | 0.02 | 0.10 | 0.04 | **14.04** | 13.8 |
| spyder_downstairs | 11,071 | 10/63 | 4.18 | 1.91+2.09 | 1.46 | 10.14 | 0.26 | 6.48 | 0.02 | 0.14 | 0.05 | **22.52** | 22.7 |
| spyder_paper_scoop | 21,095 | 26/143 | 7.45 | 3.50+3.42 | 2.72 | 18.52 | 0.40 | 11.42 | 0.03 | 0.27 | 0.06 | **40.21** | 40.8 |
| spyder_route1 | 38,144 | 28/800 | 12.04 | 5.53+5.94 | 4.91 | 34.46 | 0.67 | 18.43 | 0.09 | 2.14 | 0.30 | **71.36** | 73.0 |
| **spyder_paper_town** | 53,140 | 56/800 | 18.40 | 8.76+9.23 | 6.90 | **48.05** | 1.00 | **27.05** | 0.10 | 0.54 | 0.29 | **102.14** | 102.2 |
| taba_town | 134,560 | 73/3840 | 45.85 | 21.66+22.61 | 17.29 | 121.79 | 1.75 | 56.79 | 0.39 | 0.63 | 1.23 | **240.39** | 244 |
| buddha_mountain | 212,567 | 2/10000 | 69.52 | 34.38+36.18 | 27.34 | 190.49 | 1.54 | 76.90 | 0.69 | 0.05 | 2.01 | **362.63** | 368 |
| test_npcs（测试图） | 285,698 | 501/1600 | 96.82 | 46.72+48.60 | 37.01 | 258.30 | 4.58 | 122.46 | 0.35 | 7.96 | 0.39 | **525.12** | 527 |

（第一轮独立运行的 `spyder_paper_town` full acquire 中位 94.49 ms，两轮都落在 journey 三次样本 93–110 ms 的区间；表内其余列两轮一致到 ±10%。）

读数：
- 最坏 journey 帧 109.5 ms = acquire ≈ 94–102 ms + 进图/视图重建/GC ≈ 7–15 ms（同一张图内联传送帧 3.4 ms）。
- **acquire 里 47% 是纯 JS SHA-256（≈0.9 ms/KB，约 1.1 MB/s）**，26% 是全量 schema 校验（≈0.5 ms/KB；地表每格一个 `pattern` 正则 + 每条命令 `oneOf`），18% 是读文件（其中一半是 PocketJS `readFileSync(path,"utf8")` 在 JS 里逐字节做 UTF-8 解码，`framework/src/fs-api.ts:236` → `bytes.ts:76`；另一半是 `readAll` 本身 ≈ 6 MB/s），7% 是为了喂 SHA 把字符串再编码成字节。**真正「编译」的部分（createWorld + buildPassage）合计 0.8 ms，JSON.parse 1.0 ms。**
- 成本随字节线性 ≈ 1.9 ms/KB：Tuxemon 263 图中位 27 KB（≈ 50 ms），最大正式图 `buddha_mountain` 212 KB → 363 ms；`test_npcs` 是测试图。

### 5.3 降法评估（对 `spyder_paper_town` 的 109.5 ms 帧；估算直接用上表分量）

| 降法 | 估计收益（该图） | 对确定性 / 安全性的影响 | 备注 |
| --- | ---: | --- | --- |
| A. 本地包跳过运行时 SHA-256（连带省掉 `utf8Encode`）：`createJsonMapRepository` 加 `verify` 选项，本地 `data.fs` 源默认 off，可 `prepare` 的网页源默认 on | −55.0 → **≈ 54 ms** | 确定性无关（校验不改状态）。安全性：本地条目与 JS bundle 同一信任级（bundle 本来也不做运行时哈希）；坏 JSON 仍被 `JSON.parse`/结构校验挡住；存档身份仍绑 `mapManifestHash`（索引里的 sha256 是构建期算的，不依赖运行时复算）。网页源保留校验。 | 约 10 行 |
| B. 以轻量结构校验替代运行时全量 schema（id/width/height/ground 长度与元素类型/upper·passage 索引边界/events·pages·commands 为数组），全量 schema 移到构建期：`splitProjectMaps` 目前**不校验**（map-project.ts:58 直接 canonicalJson），应在拆分时对每张图跑 `validateMapDef` | −27.0（结构校验 0.10）→ 单用 ≈ 82；**A+B ≈ 28 ms** | 确定性无关。安全性：运行时只保证「不会越界索引」，命令形状由构建期把关；解释器 `compile` 遇到坏命令会抛错而非静默。 | 约 40 行 |
| C. ASCII 快速解码：读字节 + 8 KB 分块 `String.fromCharCode.apply`，遇到 >0x7F 回退框架解码（8 张图均为纯 ASCII，输出逐字符相同 `ascii_same=true`；快 3×：9.23 → 3.03） | −6.2 → **A+B+C ≈ 21 ms** | 无。若拆分器把非 ASCII 转义成 `\uXXXX`（JSON 等价，字节稳定），可保证所有条目走快路径。 | 放在游戏侧 `read` 回调即可，不必改组件仓 |
| D. 淡出期按确定性工作单元分步：`transfer` 命令执行时目的地已知，`applyTransfer` 在 fade 中点才发生；Tuxemon 1,047 次传送里 868 次 fade 0.3 s（中点前 9 个参考 tick）、171 次 0.5 s。可按逻辑 tick 切成 读+解码+parse / 校验 / 编译 三个单元 | 最坏帧 → 最大单元 ≈ 读+解码+parse ≈ 13 ms（叠加 C） | 单元只产出派生数据、状态切换仍在黑屏 tick 发生 → 确定性不变（S3 §「Determinism」要求的正是逐 tick 定额而非毫秒预算）。4 Hz 一帧 15 tick 会把单元合回一帧，但 4 Hz 只是测试速率。fade 0 的传送无窗口，仍是整帧成本。 | 改 session.ts，复杂度中 |
| E. 确定性 LRU 窗口（保留最近 N 张，N 为常量） | 回访 → ≈ 3 ms（journey 第 2、3 次传送） | 保留集仍是访问序列的纯函数；存档无关；堆 +N×(MapDef+World+Table)，Tuxemon 均值级别每张 ≈ 0.2–0.3 MiB | 首访无收益 |
| F. 邻居预取（进图后按 tick 定额 acquire 本图 transfer 目标） | 首访多数命中 | 确定性同 D；但不做分块的话预取单元会在行走中造成 50–100 ms 顿挫，比黑屏里更糟 → 需与 D 同做 | 依赖 D |
| G. 宿主原生 SHA-256 / 文本解码 / 单次读文件（PocketJS 框架改动，`vendor/pocketjs` 钉死，本任务不能做） | SHA 48 → <1；解码 9 → ≈0；`readAll` 6 MB/s 也可提速 | 保留完整性校验又不付 JS 成本；是长期最优解 | 需要上游 PocketJS 任务 |
| H. 地表改二进制（每图调色板 + Uint16 索引）而非每格字符串 | 大图字节 ↓5–10× | 格式变更（v2 或备用条目编码） | 远期 |

对最大正式图的估算（A+B+C 后 acquire）：taba_town ≈ 33 ms（+进图 ≈ 40）、**buddha_mountain ≈ 51 ms（+进图 ≈ 57，仍超）**、test_npcs ≈ 76 ms（测试图）；buddha_mountain 需再叠加 D 或 G。

### 5.4 判断
- 以「P1 切图最坏 ≤ 50 ms（桌面 QuickJS）」衡量，**本分支不达标**：journey 最坏 109.5 ms（2.2×），263 图按 1.9 ms/KB 估约有 60 张（> 26 KB）首访会超 50 ms，最大正式图 363 ms。
- **不构成对 KR1 合并的阻断**：(1) KR1 规格要求的是「量出切图最坏帧并给推算」，builder 如实量出并写明是同步加载的取舍；(2) 正确性、确定性、存档、兼容性全部成立；(3) 降法 A+B+C 局限在 `createJsonMapRepository` 与游戏侧 `read` 回调，不碰 reducer、不改存档格式，即可把 journey 最坏帧降到 ≈ 21 ms、除 `buddha_mountain` 外全部进 50 ms；(4) 游戏仓导入器（拆分/骨架）依赖本分支合并后才能开工。
- **构成对 P1 验收的阻断**：必须开 KR1-perf 后继任务（A+B+C 必做，D 为 buddha_mountain 级别的大图兜底，G 作为 PocketJS 侧提议），并把 §3.2 的 parity 测试并入组件仓。

## 6. 卫生
- `git diff 4dfb651..HEAD` 新增行中 grep `task[- _]?\d{3,4}|1864|1869|fleet` 无匹配（只在 `findings/` 下出现 KR1 规格代号）。
- `git diff 4dfb651..HEAD --stat -- bun.lock vendor/pocketjs` 为空；`git submodule status` = `76ae741f`。
- `git log 4dfb651..HEAD`：8 个提交，作者 `lfkdsk <lfkdsk@gmail.com>`，无 Co-Authored-By / Generated 尾注，信息符合 `feat(engine)/feat(ui)/fix/perf/docs/bench` 风格。
- 审查过程中的所有源改动（变异、sunstone 重生成）均已还原，`git status --short` 为空。

## 7. 画面
打开并核对了 `tests/goldens/streamed.switch.png`（切图后的流式地图：左半紫色区块、右半蓝色区块、玩家白色方块在 (40,136) 附近，非退化）与 `tests/goldens/r2-ui.occlusion-reference.png`（960×544 深色网格上多个走路者/上层遮挡参考，深度关系正常）。这些 golden 在本分支未改动且由 `expect(frame).toEqual(expected)` 逐像素比对，684 个测试全绿即渲染与基线逐像素一致。`streamed-game-sim.test.ts` 同时保留语义像素断言（`expectPixel`）。

## 8. 其它发现（均非阻断）
1. **测试缺口**：无「骨架 vs 内联逐字节一致」断言（§3.3 M1）。建议把 `/var/tmp/fleet/1869/parity.test.ts` 改成相对导入并入 `tests/`。
2. **`src/host/save-fs.ts:55-83`** 的 `saveSlotFs/loadSlotFs/listSlotsFs` 没有 `content` 参数：骨架工程若直接用这组宿主辅助函数，写出的信封不带内容身份、读取/列槽也不校验，规格第 2 条的「拒绝」只在调用 `encodeEnvelope(snap, session.content)` + `restoreSessionEnvelope` 时成立。建议给三者加可选 `content`，README 里点明。
3. **`splitProjectMaps` 不做 schema 校验**（map-project.ts:58）：目前运行时校验是唯一防线；若按 §5.3-B 放宽运行时校验，必须先把 `validateMapDef` 加到拆分器/导入器。
4. **attract 回滚对「读后即丢字节」的网页源不健壮**：`step()` 回滚时对 `residentMaps` 逐个 `acquireSessionMap`（attract.ts:482,505）。同一宿主帧内若 tick k 已传送并驱逐了旧图、tick k+n 才遇到 `MapNotReadyError`，重取旧图需要源仍能同步给出其字节；`createJsonMapRepository` 的解析缓存已被 `releaseExcept` 清掉。测试用的源只增不减所以通过。建议 README 注明「可 `prepare` 的源须保证已驻留地图的字节可同步重读」，或回滚时容忍缺失。
5. `acquireSessionMap` 对内联工程找不到地图时报 `map repository: unknown map`，措辞略误导（内联没有仓库）；纯文案。
6. `MapNotReadyError` 对没有 `prepare` 的本地源（文件缺失）会以「not ready」而非「missing」冒泡（GameView.tsx:494 直接重抛）；纯文案。

## 阻断项
无（针对 KR1 规格）。切图成本对 **P1 目标**构成阻断，处理方式见 §5.4 与 §9。

## 9. 建议的后继任务（已 `fleet_spawn` 提议）
- **KR1-perf（组件仓）**：`createJsonMapRepository` 增加 `verify`/`validate` 选项（本地默认结构校验 + 不复算 SHA，网页源默认全量）；`splitProjectMaps` 构建期 `validateMapDef`；README 给出 ASCII 快速解码的 `read` 写法；淡出期分步（D）作为大图兜底；并入 parity 测试；用 §5.2 的方法复量 journey 最坏帧（目标 ≤ 50 ms，全部 263 图首访 ≤ 50 ms 或列出例外）。
- **PocketJS 侧（提议，非本 goal）**：`fs` 提供原生 UTF-8 解码 / 单次读取；可选原生 SHA-256。

PASS
