# DEMO-G1（含前移）审查

## 结论

**FAIL。** 数据生成、画面、导入确定性、测试、三段主线与网页门禁本身全部通过，
但仍有三个规格层面的阻断项：章节的公开 `snapshot + tape` 合同没有携带恢复
确定性所需的全局时间轴；出生点只避开 `blocks:true` 事件体，而不是规格原文所说的
所有事件实体；J2 前移后多份现行文档仍互相矛盾。

审查 tip 为 `d898f3431cec2458edf8e053b90d2551b24f1144`。前移 merge
`acc479e` 的第二父为规格指定的 `34ec973`，之后的章节数据提交为 `c97187d`、
文档提交为 `d898f34`。

## 阻断项

### B1：`snapshot + tape` 直接恢复不能到达逐字节相同的终态

13 个信封本身都有效：独立脚本逐个执行 `decodeEnvelopeText`、地图感知
`restoreSessionSnapshot`、再快照 canonical 比较，并核对位置、held、`canSave`、
无 modal / battle / input lock / fade，全部通过。烘焙器使用同一校验链，见
`tools/bake-chapters.ts:357-381`；安全点谓词见 `tools/bake-chapters.ts:137-144`。

问题在于信封只保存地图解释器时钟 `interp.frame`。组件仓恢复时用它重建
`SessionState.frame`，见 `vendor/pocket-rpgkit/src/engine/save-restore.ts:134-145`；
进图后该时钟并不等于合并 tape 的全局帧。例如实际恢复值为：

- `paper-town`: `0`，而章节 `timelineFrame=1360`；
- `captain-returns`: `192`，而章节 `timelineFrame=122145`；
- `greenwash-aardant`: `1037`，而章节 `timelineFrame=170670`；
- `hospital-cure`: `369`，而章节 `timelineFrame=172049`。

如果审查脚本额外执行 `state.frame = chapter.timelineFrame`，所选早/中/晚三章都能
续播到同一冻结终态：

```text
SUFFIX PASS paper-town start=1360 frames=170700 terminal=spyder_candy_hospital3@5,7 sha256=519154d646891afd2a6378ff20b80e02bcd9190b8c1d8814778cd09adea6a3c4
SUFFIX PASS captain-returns start=122145 frames=49915 terminal=spyder_candy_hospital3@5,7 sha256=519154d646891afd2a6378ff20b80e02bcd9190b8c1d8814778cd09adea6a3c4
SUFFIX PASS greenwash-aardant start=170670 frames=1390 terminal=spyder_candy_hospital3@5,7 sha256=519154d646891afd2a6378ff20b80e02bcd9190b8c1d8814778cd09adea6a3c4
```

但按组件仓演示菜单规格的公开形状
`chapters: [{id, title, snapshot, tape?}]` 直接恢复、没有注入外层字段时，同一个
Greenwash 后缀虽到达相同地图坐标，时间轴和完整状态哈希不同：

```text
SUFFIX RAW greenwash-aardant start=170670 frames=1390 terminal=spyder_candy_hospital3@5,7 timeline=2427 sha256=bf294d682502b77027ebe3553777aaf8c339568f524e34c88554b361953acdd6 matchesPinned=false
```

`ChapterRecord` 确实另存了 `timelineFrame`（`tools/bake-chapters.ts:64-74,382-390`），
但组件仓待接入的通用配置没有该字段；注释还误称它是 envelope metadata。
`verify:chapters` 只重烘焙并比较 JSON/PNG（`tools/verify-chapters.ts:28-70`），也没有
做 suffix 续播。因此当前数据还不能按既定通用接口直接接线。修复应二选一：让通用
章节恢复合同显式携带并恢复 timeline，或生成无需带外赋值即可续播的快照；并把已提交
章节的恢复 + 后缀终态纳入自动测试。

### B2：出生点没有满足“不在事件实体上”的原文要求

实现和测试把要求收窄为“不压 `blocks:true` 事件体”：`importer/warp.ts:40-60`
只收集 blocking 页，`tests/warp-spawns.test.ts:40-64` 也只断言这个集合。独立按同一
引擎 `buildPassage` 复算 263 张图，在该收窄合同下 `bad=[]`、阻挡事件重叠为 0；
但按所有 `GameEvent` 的 `x/y/w/h` 区域复算，有 144 张索引记录落在事件区域中，
其中 143 张是可用 spawn（139 transfer + 4 fallback），另 1 张是 blocked marker。

10 张独立抽样如下；`阻挡重叠` 全为 0，但其中 5 张落在非阻挡事件区域：

| 地图 | 尺寸 | 来源与坐标 | 地形 solid | 阻挡重叠 | 任意事件区域 |
| --- | ---: | --- | ---: | ---: | --- |
| `bedroom_test` | 9×7 | transfer 8,2 | 0 | 0 | 无 |
| `cotton_cathedral` | 13×11 | transfer 6,10 | 0 | 0 | `e001_go_outside_r001` |
| `spyder_mansion` | 18×18 | transfer 1,15 | 0 | 0 | `e026_track_mansion_r021` |
| `spyder_paper_town` | 40×20 | transfer 39,7 | 0 | 0 | `e047_teleport_to_brideswood_b_r009` |
| `spyder_route4` | 20×40 | transfer 0,5 | 0 | 0 | `e003_teleport_to_flower_city_r014` |
| `taba_town` | 64×60 | transfer 40,11 | 0 | 0 | `e057_teleport_to_house2_r012` |
| `buddha_mountain` | 100×100 | transfer 3,89 | 0 | 0 | 无 |
| `gadget_store1` | 20×13 | fallback 0,3 | 0 | 0 | 无 |
| `rubberduck_cave_01` | 80×71 | fallback 0,0 | 0 | 0 | 无 |
| `test_npcs` | 40×40 | fallback 13,1 | 0 | 0 | 无 |

这些重叠多数是出口/追踪触发区，不是碰撞体；当前 `playerTouch` 只在移动入格边沿触发，
所以静止跳转不会立刻弹回，运行时风险低。可是规格 `game-DEMO-chapters.md:8-9`
和本审查清单都写的是“不在事件实体上”，没有 `blocks:true` 限定。需要让数据满足原文，
或由规格所有者明确把合同改成“blocking event body”；不能由实现和测试自行缩窄。

唯一 `from:"blocked"` 的 `classic_route_4` 是诚实标记：40×20 共 800 格，
`terrainFree=0`，全部 passage index 都是 `block`，确实整图不可站。

### B3：J2 前移后的文档不一致

实际 CI 正确包含 7 条 journey legs（GB6、J1、J2、failures、locks、frozen、chapters），
见 `.github/workflows/ci.yml:78-108`；`docs/status.md:88-102` 和
`docs/verification.md:21-25,98-127` 的章节主表也已写到 13 章 / 172,060 帧。
但现行文档仍有以下冲突：

- `docs/ci.md:3-6,57-72` 仍写 6 条 journey、12 个 runner、10 个章节，漏掉
  `verify:j2:mainline` 和 `verify:j2:full`；`docs/ci.md:128-134` 的本地命令也漏 J2；
- `docs/ci.md:50` 写 rest 为 35 个文件，实际 44 个测试文件减 7 个显式文件 = 37；
- `docs/verification.md:30-40,69-71` 仍称“两大 verifier”并漏掉 J2 verifier；
- `README.md:102-105` 把仅 3,793 帧、到 Route 1 的浏览器 smoke 称为 “whole
  maintained journey”，`README.md:119-122` 的常用主线命令也漏 J2；
- `findings/DEMO-G1.md:18-50,69-76,95` 的正文仍写 10 章、122,145 帧、68 KB，
  而同一报告顶部与后面的“前移”段写 13 章、172,060 帧；实际
  `data/chapters.json` 为 163,098 bytes；
- `docs/verification.md:16` 仍写完整确定性导入 4,637 个文件，本次实跑为 4,638。

审查规格明确要求“文档一致”，所以这不是仅建议补充详细说明，而是阻断项。

## 逐条验收

| 规格项 | 判定 | 证据 |
| --- | --- | --- |
| 前移到 `34ec973` / kit `c93a1ec`，加入 J2 三章 | 成立 | merge `acc479e`；`data/chapters.json` 共 13 章，J2 三章帧为 164388 / 170670 / 172049 |
| 每个快照过 save validator | 成立 | 13/13 decode、map-aware restore、再快照一致；烘焙实现 `tools/bake-chapters.ts:368-381` |
| 检查点不在对话、战斗、输入锁、fade 中途 | 成立 | 13/13 `canSave=true`，modal/scene/inputLocked/fade 均空；安全谓词 `tools/bake-chapters.ts:137-144` |
| 从快照续播后缀到同一终态 | 部分 / 不成立 | 注入外层 timeline 后抽查 3 章全过；按既定 `snapshot+tape` 接口直接恢复时 Greenwash 完整状态哈希不一致（B1） |
| `verify:chapters` 抓住过期快照 | 成立 | 隔离副本将 bedroom checksum `e71008c2→f71008c2` 后返回 `CHAPTERS STALE`、重烘焙命令、exit 1 |
| 263 图出生点可站且不压事件实体 | 部分 / 不成立 | 263/263 地形可站并避开 blocking body；但 143 个可用 spawn 压在非阻挡事件区域（B2） |
| blocked 图确实全图不可站 | 成立 | `classic_route_4` 800/800 格 solid，0 可站格 |
| 13 张缩略图逐字节可复现并肉眼正常 | 成立 | `verify:chapters` PASS；逐张原始分辨率打开，见下节 |
| CI matrix 含 J2 与 chapters | 成立 | `.github/workflows/ci.yml:89-108` 共 7 条 |
| 功能状态清单更新 | 成立 | `docs/status.md:88-102` 标 Partial 且写明 13 章与接线限制 |
| 文档一致 | 不成立 | B3 |

## 缩略图肉眼检查

13 张均为 480×272，文件 SHA-256 与 manifest 一致，13 个完整哈希各不相同；没有
黑屏、错误扩边或异常裁剪。

| 章节 | 肉眼所见 |
| --- | --- |
| bedroom | 居中卧室、玩家与完整的 skip-intro 对话框；黑边来自小地图居中 |
| paper-town | 路口、住宅、蓝顶商店、树林、水岸与玩家完整 |
| before-billie | 商店旁围栏/箱子区域；玩家与 NPC 状态可见 |
| starter | 同一区域但朝向/NPC 状态与上一张不同，不是重复图 |
| route-1 | 湖岸、树林、草丛与底边玩家，构图完整 |
| cotton-town | 喷泉、诊所、商店、道路与底边玩家完整 |
| city-park | 花圃、长椅、围栏、树阵与玩家完整 |
| route-3-north | 岩路、房屋、长椅、NPC、植被与玩家完整 |
| flower-city | 大楼、诊所、道路、树阵；边缘建筑裁切符合相机位置 |
| captain-returns | Mansion 走廊、多个房间/NPC；左右黑边来自窄室内图 |
| candy-town | 河道、树林、道路、雕像与顶部玩家完整 |
| greenwash-aardant | 木地板、柜台/机器、盆栽、角色；窄图黑边对称 |
| hospital-cure | 浅蓝实验室、扫描设备、书架与玩家；窄图黑边对称 |

`greenwash-aardant` 与 `hospital-cure` 还分别同对应 J2 480×272 golden 字节一致，
进一步排除了侧边黑区是渲染错误。

## 变异检查

两个变异都在独立 worktree 中执行，随后 worktree 已删除；被审工作树始终未被改坏。

| 变异 | 预期辨识力 | 实际结果 |
| --- | --- | --- |
| bedroom snapshot checksum 单字节 `e→f` | `verify:chapters` 必须拒绝过期 JSON | `CHAPTERS STALE: a chapter snapshot or thumbnail hash ... changed`，提示 `bun tools/bake-chapters.ts`，exit 1 |
| `standable()` 忽略 blocking event set | warp 测试必须发现生成规则退化 | 2 pass / 1 fail；逐字节重建断言指出 `spyder_dojo4`、`spyder_route4`、`test_npcs` 坐标/来源变化 |

## 门禁复跑

全部在被审 tip 上运行，`TUXEMON_SRC` 指向固定上游 checkout：

| 命令 | 结果 |
| --- | --- |
| `bun run import` ×2 + `git diff --exit-code` | 两次通过，工作树无 diff；263 maps / 430 TILESET entries |
| `bun run verify:g6:determinism` | PASS；2 roots，4,638 files，61,926,051 bytes，aggregate `26bb0385…` |
| `bun run verify:terrain:determinism` | PASS；每次 961 files / 33,075,984 bytes，identical=true |
| `bun run verify:terrain:collision` | 11 maps / 56,176 directed steps / 0 mismatches |
| `bun run build && bun run build:wasm` | 0；`main.js` / pak 完成，Wasm 289,981 bytes |
| `bunx tsc --noEmit` | 0 |
| `bun run test` | 252 pass / 0 fail / 0 skip；91,421 assertions，44 files |
| `bun run verify:chapters` | `CHAPTERS PASS 13 chapters, 172060 ... byte-identical` |
| `bun run verify:gb6:mainline` | PASS；109,983 frames，100 battles（22 trainer / 78 wild） |
| `bun run verify:j1:mainline` | PASS；122,145 combined frames，17 battles（10 / 7） |
| `bun run verify:j2:mainline` | PASS；172,060 combined frames，56 battles（50 / 6），hash `519154d6…` |
| `bun run verify:gb6:failures` | PASS；首败 3,254 帧、后败 65,515 帧，恢复顺序成立 |
| `bun run verify:g6:locks` | 330 pages / 334 checks；328 unlocked / 2 transferred / 0 unresolved / 0 error |
| `bun run verify:g6:frozen` | 263 maps；0 permanent locks / 0 blocking fibers / 0 errors |
| `bun run web` | 0 |
| `bun tools/verify-web-journey.ts` | WEB JOURNEY PASS；3,793 帧，4 个状态/像素检查点，0 console error |

## 自动生成、范围与仓库卫生

- `gen-assets.ts` 统一调用 `buildWarpIndex`；`importer/warp.ts:62-150` 统一遍历全部
  map/event/page/command，没有按地图写生成特判。章节也由一份 reducer 回放与一份
  bundle 回放生成；唯一特殊处理是 frame-0 bedroom 为避免空 surface 而 idle 60 帧
  截缩略图，快照仍是 frame 0。
- 相对前移基线 `34ec973`，`bun.lock` 和 `vendor/` 无 diff；没有直接修改 PocketJS。
- `git diff --check 34ec973..HEAD` 为 0；功能增量新增行未发现本机路径、任务号、
  内网地址或署名尾注；相关提交均为 `lfkdsk <lfkdsk@gmail.com>`。
- 审查期间主仓 `main` 又前进到 `0b9b46b`，不属于本规格指定的 `34ec973` 前移范围；
  后续合入时仍应按新基线再跑一次门禁。

## 非阻断建议

- 章节 `safe()` 再要求 `state.playerRoute === null`。恢复会无条件清空 playerRoute
  （`save-restore.ts:142`），当前 round-trip 无法发现未来检查点恰好落在异步路线中。
- 给三个 J2 selector 加显式 segment 下界/顺序断言，避免未来较早访问同地图时静默
  抓到错误章节。
- `verify:chapters` 最好自动恢复并续播全部 13 个已提交 envelope，而不只验证
  snapshot round-trip 与重烘焙字节。

subagent 使用：4 个 / 分别审章节与存档契约、独立复算出生点、逐张观图与文档、提交历史与仓库卫生；并行只读核查明显节省时间，所有重门禁、变异复跑与最终判定均由主 agent 完成。

FAIL
