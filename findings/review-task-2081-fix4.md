# GI-1b 修复 4 复审

被审：游戏仓分支 `fleet/task-2081`，复审起点 HEAD
`5875a1847a1ce63a462f25faa72b9a2eb76bb95f`。

依据：

- 通用审查规格 `reviewer-generic.md`；
- 修复规格 `game-GI1b-fix4.md`；
- 上一轮 `findings/review-task-2081-fix3.md`；
- builder 的 `findings/GI1b.md`「修复 4」节。

所有需要源数据的命令都设置了
`TUXEMON_SRC=/var/tmp/tuxemon-src`。只读核对和隔离变异结束后，主
agent 串行重跑完整门禁；变异和临时合并都没有改被审 worktree。

## 结论

PASS。

上一轮唯一阻断已经收敛：普通 transfer、跨图战败 transfer，以及不经
导入 transfer 的入口都会清掉非持久 NPC 的 `npcParties`；同图生命周期
内的队伍仍保留，`remove_npc` 仍删除对应队伍。13 个章节快照中没有离图
NPC 队伍，去掉换图清理的隔离变异使目标测试 4 项变红。

GB6/J1/J2 的六场 Billie 与一场 Marion 的敌方队伍逐项不变，完整 journey
的玩家可见记录也不变。规定门禁和网页旅程全部通过；当前 `main` 在被审
HEAD 的历史中，临时合并无冲突且得到与已完整测试 HEAD 相同的树。

## 1. 换图时收束 NPC party 生命周期

### 实现与上游语义

- `battle/extension.ts:1108-1127` 的 `tux.clear_npc_parties {keep}`
  保留显式 persistent slug、删除其余全部 NPC party，空操作时不改状态；
  `battle/extension.ts:1266-1269` 注册该命令。
- `importer/project.ts:420-444` 从 NPC DB 的 `persistence` 字段生成
  `PERSISTENT_NPCS`；当前 corpus 没有一名 NPC 设置该字段。
- `importer/project.ts:1990-2020` 在每个普通导入 transfer 紧前发出清理；
  `importer/project.ts:2452-2482` 对跨图 `teleport_faint` 做同样处理。
- `importer/project.ts:3102-3123` 给每张地图生成一次性
  `e000_npc_parties` parallel 入口页，覆盖 demo warp 等不经导入
  transfer 的入口。
- `importer/project.ts:1879-1910` 原有 `create_npc` guard 与
  `remove_npc` 的单 NPC 清理未变，因此同一次地图访问内重建现存 NPC
  仍是 no-op。

对 `dist/project.json` 递归核对得到：

```json
{
  "transfers": 1152,
  "immediately_preceded_by_clear": 1152,
  "misses": []
}
```

全工程共有 1,415 个全局 clear，恰为 1,152 个 transfer clear 加 263 张
地图的入口 clear。原始结果见
`/var/tmp/fleet/2280/snapshot-review/transfer-clear-coverage.json`。

实现位置没有采用规格偏好的通用运行时 map-change hook，而是导入 transfer
加入口页双保险；但它覆盖了全部生成 transfer 和非 transfer 入口，并在
transfer 当帧清理，从而关闭了新地图首个解释器 tick 前仍可保存旧队伍的
窗口。这里的“优先”不是绝对验收条件，当前做法没有玩家行为或存档正确性
回退，按本轮收敛规则不阻断。

### 章节快照的 `jq` 复现

运行上一轮同一命令：

```sh
jq -r '(.chapters // .)[] |
  [.id, (.snapshot|fromjson|.state.map),
   ((.snapshot|fromjson|.state.ext.state.npcParties|keys|length)|tostring),
   ((.snapshot|fromjson|.state.ext.state.npcParties|keys|join(",")))] |
  @tsv' data/chapters.json
```

实际输出：

```text
bedroom             spyder_bedroom          0
paper-town          spyder_paper_town       0
before-billie       spyder_paper_town       0
starter             spyder_paper_town       0
route-1             spyder_route1           0
cotton-town         spyder_cotton_town      0
city-park           spyder_citypark         0
route-3-north       spyder_route3           0
flower-city         spyder_flower_city      0
captain-returns     spyder_mansion          0
candy-town          spyder_candy_town       0
greenwash-aardant   spyder_greenwash        1  spyder_greenwash_looten
hospital-cure       spyder_candy_hospital3  0
```

修复前 `01a71d8:data/chapters.json` 的后七章依次为
`1, 4, 7, 11, 29, 35, 35` 支队伍；现在 12/13 章为空。唯一非空的
Greenwash 快照同时满足：

```text
map=spyder_greenwash
local.npc.spyder_greenwash_looten=1
placement=npc_spyder_greenwash_looten
npcParties key=spyder_greenwash_looten
```

即它是当前地图仍在场的 Looten，不是离图残留。对 13 章逐 key 交叉检查
当前 `local.npc.*` 和 placement，全部为 `only_current_map=true`；证据见
`/var/tmp/fleet/2280/snapshot-review/chapter-npc-party-membership.tsv`。

### 正向测试与隔离变异

目标文件正向运行：

```text
TUXEMON_SRC=/var/tmp/tuxemon-src bun test tests/npc-party-lifecycle.test.ts
5 pass / 0 fail / 25 expect()
```

`tests/npc-party-lifecycle.test.ts:125-192` 覆盖 Billie 跨地图、Marion
败后返回、同 visit 保留及 `remove_npc`；`:194-228` 通过真实 Route 2
→ Cotton Town transfer 断言旧队伍在新图首帧已空；`:230-245` 覆盖
demo warp。连续启动同一 NPC 的第二场战斗另由
`tests/battle-runtime.test.ts:348-382` 直接覆盖（定向运行 1 pass）。

在 detached 副本 `/var/tmp/fleet/2280/mut-clear` 中，仅删除普通 transfer、
跨图战败 transfer 和入口页的全局 clear，完整保留 create/remove 的单
NPC 清理。运行同一生命周期测试实际退出 1：

```text
4 fail / 1 pass / 16 expect()
Billie：期望 {}，收到遗留 budaye@5
Marion：重进期望 undefined，收到 aardorn@7, aardorn@7
真实 transfer：期望 {}，收到 Marion 两只
demo warp：期望 undefined，收到 aardorn@7
```

唯一通过的是同图保留/`remove_npc`，说明断言既能杀死“换图不清”的回退，
也不会误杀要求保留的同图行为。变异 diff 与完整输出在
`/var/tmp/fleet/2280/mut-clear.diff`、
`/var/tmp/fleet/2280/mut-clear-test.log`；副本已删除，`bun.lock` 前后均为
`8ccfa9937302846daca5f829c3ef706f1cfa7d3e521c2fad9076842f6ab306e2`。

## 2. 玩家可见行为不变

从三个当前 journey 的 `battles[]` 读取并与上一轮 HEAD `db1c9d8` 做
规范化逐对象比较，三份摘要分别完全相同；与上一轮引用的上游基准
`87f16be` 的 `enemy[]` 也相同：

| Journey / 对手 | 当前敌方队伍 | 与上一轮 |
|---|---|---|
| GB6 Billie f2177 | `budaye@5` | 相同 |
| GB6 Billie f10302 | `budaye@6, eyenemy@6, cardiling@3` | 相同 |
| GB6 Marion f38003 | `aardorn@7, aardorn@7` | 相同 |
| J1 Billie f4031 | `budaye@18, cardiwing@16, eyesore@16` | 相同 |
| J1 Billie f7594 | `budaye@20, cardiwing@17, eyesore@17, viviphyta@17` | 相同 |
| J2 Billie f20877 | `bamboon@34, eyesore@30, cardiwing@30, viviphyta@30` | 相同 |
| J2 Billie f38220 | `bamboon@40, eyesore@40, cardiwing@40, viviphyta@40` | 相同 |

直接比较命令的结果为：

```text
FIX3_HEAD_vs_FIX4_HEAD enemy[]: IDENTICAL
87f16be_vs_FIX4_HEAD enemy[]: IDENTICAL
```

再从 G6、GB6 mainline、GB6 first/later loss、J1、J2 六份 JSON 中只移除
允许变化的 terminal/initial snapshot hash 后比较完整 JSON，六份均为
`IDENTICAL`。因此输入、地图序列、战斗、剧情与玩家队伍没有变化，变化
只在规格预期的保存状态哈希。`git diff --name-only db1c9d8..HEAD --
tests/goldens docs/screenshots` 也没有输出。

肉眼打开了本轮网页回放的 `dist/web-journey/end.png`、
`docs/screenshots/chapters/greenwash-aardant-480x272.png` 和
`docs/screenshots/chapters/hospital-cure-480x272.png`：Route 1 水面、树林、
作物与玩家均完整；Greenwash 室内地板、家具、NPC 和遮挡层正常；医院
实验室地砖、书架、设备和玩家合成正常，没有空白、错层或缩放异常。

## 3. 文档、生成原则与仓库卫生

- `docs/status.md:68` 已改为“每次换图删除全部 NPC party，本数据无
  persistent NPC”，并说明 save 只含当前地图 NPC party；功能仍以
  Partial 标识，是因为另外七个 `get_party_monster` 使用的既有降级，
  不是生命周期限制。
- `docs/importer.md:65,68,72,97` 如实说明 transfer/入口 clear、NPC
  lifetime，以及 gym Points 页因跳过的 NPC-vs-NPC battle 不写 winner
  而不可达。
- `findings/GI1b.md:670-845` 记录实现、快照、终态哈希和门禁；旧限制在
  `:497-499` 明确标为由修复 4 supersede，不再与当前状态矛盾。
- 规则由 importer 全量生成，没有逐地图手改；Tuxemon 专用扩展只在游戏仓，
  没有写进组件仓或 PocketJS。
- 相对当前 `main`，`bun.lock`、`.gitmodules`、`vendor/pocket-rpgkit` 和
  嵌套 PocketJS 指针均无 diff；最终 worktree clean。
- 修复提交作者均为 `lfkdsk <lfkdsk@gmail.com>`，功能提交信息未写任务号，
  没有 Co-Authored-By 尾注。

## 4. 完整门禁（主 agent，串行）

| 命令 | 本轮实跑结果 |
|---|---|
| `bun run import` ×2 | PASS；两次 tracked-tree SHA-256 均为 `10c2359fccb3…`，两次均 clean |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | exit 0；pak 4,813 entries / 46,805,824 B |
| `bun run build:wasm` | exit 0；357,528 B |
| `bun run test` | **341 pass / 0 fail**，55 files，175.89 s |
| `verify:audio` | PASS；all hashes match |
| `verify:chapters` | PASS；13 chapters，170,868 combined frames，terminal `eec0900cf35c…` |
| `verify:gb6:mainline` | PASS；108,225 frames，100 battles（22 trainer / 78 wild），terminal `eb81c416…` |
| `verify:j1:mainline` | PASS；120,854 combined，17 battles（10 trainer / 7 wild），terminal `6a47dd83…` |
| `verify:j2:mainline` | PASS；170,868 combined，56 battles（50 trainer / 6 wild），terminal `eec0900c…` |
| `verify:gb6:failures` | PASS；first 3,154 / `5bedca90…`；later 64,611 / `78a84c84…` |
| `verify:g6:locks` | PASS；330 pages，334 checks，0 unresolved / 0 errors |
| `verify:g6:determinism` | PASS；2 isolated roots，4,742 files，63,396,341 B，`ef80fef6…` |
| `verify:g6:frozen` | PASS；263 maps，0 permanent locks，0 blocking fibers，0 errors |
| `bun run web` + `bun tools/verify-web-journey.ts` | **WEB JOURNEY PASS**；3,369 frames，四个 checkpoint 与 pixels 匹配，2× mismatch 0，console errors 0 |

## 5. 临时合并当前 `main`

在独立 detached worktree `/var/tmp/fleet/2280/merge` 执行，没有修改被审
分支：

```text
MERGE_BEFORE_HEAD=5875a1847a1ce63a462f25faa72b9a2eb76bb95f
MERGE_BEFORE_MAIN=84c488ebe0061169c4a90db87775159c9051dc16
MAIN_IS_ANCESTOR=yes
Already up to date.
MERGE_AFTER_TREE=3d132c147bfaa519737b06efd391f9554f1207f7
REVIEWED_TREE=3d132c147bfaa519737b06efd391f9554f1207f7
MERGE_STATUS_BEGIN
MERGE_STATUS_END
MERGED_TREE_IDENTICAL_TO_FULLY_TESTED_HEAD=PASS
```

冲突为 0。合并结果树与上述完整门禁所测树逐字相同，因此临时合并态同样
全绿；临时 worktree 已删除。

## 逐项核对

| 规格项 | 判定 | 证据 |
|---|---|---|
| 任意换图（含战败）清非持久 `npcParties`；同图与 remove 现状不变 | 成立 | 1,152/1,152 transfer 紧前 clear；入口页兜底；真实 transfer、warp、同图/remove 测试通过 |
| 章节只含当前地图 NPC；去掉换图清理测试变红 | 成立 | 13 章 membership 全 true；隔离变异 4 fail / 1 pass |
| Billie / Marion 玩家可见队伍不变 | 成立 | 七场逐成员、逐顺序与 `db1c9d8` 相同；六份可见 journey 记录相同 |
| 重录受影响 journey，最后重烘焙章节 | 成立 | 只有预期状态 hash 改变；`verify:chapters`、GB6/J1/J2/failures 全 PASS |
| status 与 GI1b 删除当前限制 | 成立 | `docs/status.md:68`；`findings/GI1b.md:670-845`，旧段明确 superseded |
| 合并当前 main | 成立 | main 是被审 HEAD 祖先；临时合并无冲突、结果树等于完整测试树 |
| 全部门禁、网页旅程、锁文件与指针 | 成立 | 见门禁表；工作树 clean，锁文件与子模块无 diff |

## 阻断项

无。

## 非阻断建议（按收敛规则）

1. 若组件仓将来提供通用 map-change hook，可把 transfer 命令与每图入口页的
   双保险收束到一处；当前方案已经覆盖所有入口且解决可保存帧窗口，不影响
   本轮玩家可见正确性或存档数据。
2. “同图连续开启第二场战斗”的直接测试现位于
   `tests/battle-runtime.test.ts:348-382`，生命周期文件只直接断言同图空转/
   重复 create 不清。覆盖本身充分；后续可把一个真实 rematch 断言也放进
   `tests/npc-party-lifecycle.test.ts` 以让规格意图更集中。

subagent 使用：3 个 / 分别核对章节快照与生成 transfer 覆盖、逐场比较 Billie/Marion 与完整可见 journey、在隔离 worktree 做去清理变异 / 三路并行约节省 20–30 分钟，最终门禁、视觉检查、临时合并与判定由主 agent 完成。

PASS
