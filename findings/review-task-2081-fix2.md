# GI-1b 修复 2 复审

被审：游戏仓分支 `fleet/task-2081`，HEAD `710b05a`。本轮的修复提交是：

- `bd00883`、`ce97a93`（F2）；
- `389ae6b`（重录）、`6d1a326`（重烘焙）；
- `2562d79`、`d3b9078`、`889c841`、`710b05a`（文档和 pin）；
- 另有两次合并 main（`8f0c02b`、`71fd191`）。

依据：

- 规格：`game-GI1b-fix2.md`；
- 上一轮：`findings/review-task-2081-fix1.md`（F1–F3）；
- builder 记录：`findings/GI1b.md`「修复 2」节。

执行方式：

- 所有命令都设置了 `TUXEMON_SRC=/var/tmp/tuxemon-src`，重活由主 agent 串行执行；
- 变异在隔离副本 `/var/tmp/fleet/2256/mut` 里做（rsync 后删掉 `.git`，再 `git init`）；
- 合并在临时 detached worktree `/var/tmp/fleet/2256/merge` 里做；
- 两者用完都已删除，被审 worktree 全程 clean。

## 结论

FAIL。

**已过关的部分：**

- F1 已修好：章节在最后一次 tape 变化之后烘焙，`verify:chapters` PASS。
- 全部门禁串行 PASS，网页旅程 PASS，导入两遍字节一致。
- 四个变异都被测试杀死。
- Nimrod 的 `Zircon Back` 在真实 J2 旅程里确实写出了 iid，也确实删掉了怪物。

**没过关的部分：**

- F2 选的方案 (a) 引入了新的玩法回归。NPC 队伍跨地图、跨战斗累积，Billie 后几场对战变成她早期 3–18 级的旧队伍；上游在 30–40 级。builder 声称“与上游一致”“autoplay 路径不变”，两句都不成立，测试还把错误行为钉成了规格。
- `get_party_monster` 的 8 处 Native 里只有 1 处（Zircon Back）真正起作用。
- F3 还剩几处帧数和覆盖率数字是旧值。

## 阻断项

### R1 — NPC 队伍跨战斗累积：重赛的敌方队伍错误，偏离上游（F2 引入）

**实现。** `battle/runtime.ts:717-750`：

- `staged = ext.npcParties[opponent]`，也就是上一场持久化下来的整支队伍；
- 本场的 `setup.party` 接在后面，截到 `PARTY_LIMIT`；
- 合起来的整支队伍就是敌方，再写回 `npcParties`；
- 没有任何地方清掉 `npcParties`（换图、`remove_npc` 都不清）。

**上游。** 每张图上的 Billie 都是新建的 NPC，队伍只有该图 `add_monster` 加的那几只：

- `tuxemon/map/transition.py:43,83-85` 换图时调用 `npc_manager.clear_npcs()`；
- `tuxemon/npc_manager.py:60-67,150-152` 只保留 `persistence` 为真的 NPC；
- `tuxemon/db.py:2154-2156` 中 `persistence` 默认是 False，mods 里没有任何地方设置它（`grep -rln persistence mods/` 为空）；
- `spyder_billie` 在 db 里没有自带怪物（`mods/tuxemon/db/npc/spyder_unique_npcs.yaml:31-39`）。

**真实旅程对比。** 我自己写的 `/var/tmp/fleet/2256/me/billie.ts` 读取 `data/*journey*.json` 里的 battle 记录，对比 `87f16be`（修复前）与 HEAD：

| 旅程 / 战斗 | HEAD 敌方 | 修复前（与上游一致） |
|---|---|---|
| GB6 f11189（route2） | [4] budaye@5, budaye@6, eyenemy@6, cardiling@3 | [3] budaye@6, eyenemy@6, cardiling@3 |
| J1 f4399（route4） | [6] 上面 4 只 + budaye@18, cardiwing@16 | [3] budaye@18, cardiwing@16, eyesore@16 |
| J1 f8409（routea） | [6] 同上 6 只 | [4] budaye@20, cardiwing@17, eyesore@17, viviphyta@17 |
| J2 f21776（dojo4） | [6] 同上 6 只 | [4] bamboon@34, eyesore@30, cardiwing@30, viviphyta@30 |
| J2 f39310（route6） | [6] 同上 6 只 | [4] bamboon@40, eyesore@40, cardiwing@40, viviphyta@40 |

**影响：**

- 队伍累积到 6 只之后就冻结，之后每场 Billie 都打这 6 只 3–18 级的怪，本图真正的队伍被截掉；
- 最终章节快照里 `spyder_billie` 也是这 6 只；
- 三条旅程是在这个错误之上重录的，所以终态差异并不是 builder 说的“只因 GM1 计时”；
- 子代理的探针（`/var/tmp/fleet/2256/sa1/probe.ts`，用真实 `dist/maps` 命令）还显示：输给 Marion 后再打，敌方从 2 只变成 4 只。也就是说，任何“输了重打”的训练师都会加倍。

**与报告的说法对照：**

- `findings/GI1b.md`「修复 2」F2 写 “matching upstream (an NPC keeps its monsters after a battle)”：上游 NPC 只在本图内保有怪物。
- 同节写 “The autoplay path is unchanged … no condition reads npcParties”：开战本身就读 `npcParties`。另外 `party_size`/`has_monster` 经由 `partyFor` 读它（`battle/extension.ts:815-816`），并不是不读它的占位。
- `importer/index.ts:107-108`、`reports/G1-coverage.md:58-60`、`docs/status.md:68` 的说法同上。

**测试把错误钉成了规格。** `tests/battle-runtime.test.ts:348-370` 的 “a trainer fought twice keeps its persisted party capped at the party limit” 断言第二场时 4+4 截成 6，注释还写 “Billie … each battle's setup.party joins the persisted NPC party”。

**修法方向（供 builder 参考）：**

- 按上游生命周期清 NPC 队伍：换图（非 persistent NPC）或 `remove_npc` 时清掉 `npcParties[npc]`；
- 或者开战时不把上一场持久化的队伍当作 staged。

改完要重录旅程，并改正上面那个测试。

### R2 — `get_party_monster` 的 Native 8 中只有 1 处真正生效，说法仍不实

- **Zircon Back：成立。** HEAD 的章节快照 `greenwash-aardant` / `hospital-cure` 里有 `v.iid_slot_0 = txmn-00003y`，argon 的战斗怪物已被删除，之后 `Post Flashback` 又加了一只 `txmn-000040`。`87f16be` 的快照里没有 `iid_slot_0`。
- **dojo：不成立。**
  - 上游 `spyder_dojo2.tmx:134-147`（Talk Iroh）的顺序是：`add_monster` ×5 → `get_party_monster` → `add_tech iid_slot_0..4` → `start_battle`。
  - 我们这边 `add_monster` 被折进 battle setup，`npcParties` 要到开战时才写，而 `get_party_monster` 在开战之前（`/var/tmp/fleet/2256/me/dojo.ts` 输出 `tux.get_party_monsters{"character":"spyder_dojo_kataro"} -> battle:spyder_dojo_kataro`，iroh、wan 同样）。
  - 结果是第一次挑战写不出 iid；重赛时拿到的是上一场的旧队伍。
  - builder 说的 “three point calls after the kataro/iroh/wan battles” 与事实相反。
- **gym：不成立。** `spyder_leather_gym.yaml:112-136` 是 brad 对 chad 的 NPC 对 NPC 战之后的 `get_party_monster`。这类战斗在我们这里是可见的跳过占位，不走 runtime，所以 brad、chad 的 `npcParties` 永远是空的。
- **结论：** 覆盖率 `reports/G1-coverage.md:168` 记 Native 8，生成文字（`importer/index.ts:107-109`）和 `docs/status.md:68` 写 “the dojo/gym point calls address real monster iids”，与事实不符。只有 1/8 在可达内容里生效；其余 7 处应记为 Degraded，或者在说明里写清限制。

### R3 — F3 仍有残留（子代理列出后，我逐条亲自核对）

**已改对的：**

- `docs/importer.md` 分类表（`:68-72`、`:91`、`:100-102`），每一行都与覆盖率一致；
- `status.md` 中 `char_run` 改为 Planned（`:36`），wander/speed/position 改为 Partial 并写了限制（`:34-37`）；
- `choice_monster` 的说法；
- 冻结过度表述（`docs/ci.md:69`、`docs/verification.md:22` 改成“解释器活性，不证明不会被空间阻挡”）；
- README 的 `:27`、`:35-40`，`verification.md` 的 `:23-26`、`:72`、`:93-98`（除 `:95-96`），`ci.md` 的 `:64`、`:66`。

**仍不对的：**

- **`docs/status.md:106-108` 还是修复 1 的数字：**
  - 写的是 109,654 帧 / 100 场、121,839 / 17、172,009 / 56（50 trainer, 6 wild）；
  - 实际是 110,575 / 97、124,062 / 18、175,540 / 54（50 trainer, 4 wild），见本轮复跑的 verify 输出。
- **`docs/status.md:117` 还写着 “109,983-frame replay”。**
- **`docs/verification.md:95-96` 失败 tape 的帧数是 main 的旧值：**
  - 写的是 3,254 和 65,515；
  - 本分支数据是 3,281 和 65,435（`data/gb6-first-loss-journey.json`、`data/gb6-later-loss-journey.json`），本轮 `verify:gb6:failures` 输出相同。
- **覆盖率百分比是 main 的旧值：**
  - `README.md:66-67` 和 `docs/status.md:24` 写 action 90.5% native / 95.2% executable；
  - HEAD 的 `reports/G1-coverage.md:13,23-26` 是 12444/13617 = 91.4% 和 95.6%。
- **把旧测量换到了新 tape 的名下：**
  - `README.md:63` 把 “109,983-frame, 100-battle” 改成了 “110,575-frame, 97-battle”，但保留了旧的测量值（0.265 / 7.642 / 3.155 / 32.489 ms），本轮也没有重新跑 bench；
  - `README.md:189` 写 3,820 帧的 PSP 旅程在 PPSSPP 下通过，而 `status.md:116` 仍是 3,793 帧，PSP 测量也是在 3,793 帧的 tape 上做的。
  - 应该要么重新测量，要么注明这些数字测的是哪条 tape。

**上一轮审查自身的错误（我方责任，不计入 builder 阻断）：**

- 上一轮 F3 说 `GI1b.md:68` 的 kit 号 `c93a1ec` 是错的、`:78` 应改为 50,170。这两点我当时判断错了：
  - 那张表描述的是 `8b76116`/`bc7182b` 时的快照；
  - `git ls-tree 8b76116 vendor/pocket-rpgkit` 的结果是 `c93a1ec`；
  - `bc7182b` 时 J2 是 50,110 帧，终态 `50ecaa6a…`。
- builder 按我的意见改了，结果现在 `:68` 写成 `dfbae47`，`:78` 把 50,170 帧和 `50ecaa6a…` 配在一起，反而错了。
- 应该改回去，并在表头注明是 `bc7182b` 时的快照。

## 逐项核对（对照规格）

| 规格项 | 判定 | 证据 |
|---|---|---|
| 1. 合并 main、指针取 main、build:wasm、import ×2、重录、最后烘焙、verify:chapters | **成立**（以 builder 合并时的 main `87f16be` 为准） | kit 指针 `58ee468` 与 `87f16be` 相同；本轮 import ×2 的 3,934 个文件 sha 一致；章节提交 `6d1a326` 晚于最后一次 tape 提交 `389ae6b`；`6d1a326..HEAD` 只改了文档、报告文字和 `verify-j2` 的 pin，没有改 tape；`verify:chapters` PASS |
| 2. F2 方案 (a)：真实内容证明删除生效、说明终态差异 | **部分** | Zircon Back 在真实 J2 里生效；但 R1（重赛累积，偏离上游，终态差异的理由不实）、R2（dojo/gym 不生效） |
| 3. F3 文档逐条 | **部分** | 见 R3 |
| 4. 不处理“放置吞路线” | 成立 | 没有相关改动 |
| 验收：门禁、`bun.lock` 不改、提交信息不写任务号 | 成立 | 见下文门禁表；`git diff 87f16be..HEAD -- bun.lock` 为空；提交信息里只有 git 默认生成的 “Merge branch 'main' into fleet/task-2081” 带分支名，main 历史中已有同类合并提交 |
| 状态清单 | **部分** | `status.md:34-37`、`:66-68` 已更新，但 `:68` 的说法不实（R1、R2），`:24`、`:106-108`、`:116-117` 的数字过期（R3） |

## 门禁（被审分支 HEAD `710b05a`，串行）

| 命令 | 结果 |
|---|---|
| `bun run import` ×2 | dist 中 3,934 个文件 sha256 完全一致；跑完 `git status` 仍 clean |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | exit 0（pak 4,812 条目） |
| `bun run build:wasm` | exit 0 |
| `bun run test` | **327 pass / 0 fail**（52 个文件，176.9 s） |
| `verify:chapters` | PASS：13 章，175,540 帧，终态 `2fc635e34ab5` |
| `verify:gb6:mainline` | PASS：110,575 帧，97 场（22 trainer、75 wild），`e5a1dd27…` |
| `verify:j1:mainline` | PASS：合计 124,062 帧，18 场，`0a4a07e1…` |
| `verify:j2:mainline` | PASS：合计 175,540 帧，54 场（50 trainer、4 wild），`2fc635e3…` |
| `verify:gb6:failures` | PASS：first 3,281 帧 `3b79c196…`；later 65,435 帧 |
| `verify:g6:locks` | PASS：330 页，334 处锁，0 unresolved |
| `verify:g6:determinism` | PASS：`baecbe13…` |
| `verify:g6:frozen` | PASS：263 张图，0 永久锁，0 阻塞 fiber |
| `verify:audio` | PASS：all hashes match |
| `bun run web` + `tools/verify-web-journey.ts` | WEB JOURNEY PASS，console errors 0 |

门禁全绿，但 R1 说明钉住的终态本身就建立在错误行为上。

## 变异检查（隔离副本，跑 `battle-runtime` 和 `battle-extension` 两个测试文件，基线 36/36）

| 变异 | 结果 |
|---|---|
| M1：开战时不持久化 NPC 队伍（恢复为删除） | 3 fail（Zircon Back flow、fought twice、wins a trainer battle） |
| M2：去掉 `PARTY_LIMIT` 截断 | 1 fail（fought twice） |
| M3：`get_party_monsters` 忽略 NPC 队伍 | 3 fail |
| M4：重赛不继承上一场的队伍（接近上游的做法） | 2 fail（fought twice、wins a trainer battle） |

测试有辨识力。但 M4 说明，接近上游的正确行为反而会被现有测试判红，这一点对应 R1。

## 画面

- `docs/screenshots/chapters/before-billie-480x272.png`：Paper Town 中心区，玩家在医院右侧，地块和建筑正常。
- `dist/web-journey/end.png`：网页终帧，Route 1 草地，玩家在栅栏左端，页面控件正常。
- `tests/goldens/j1-route-4-billie.480x272.png`：Route 4 树林，有 NPC 和玩家，构图正常。
- 画面上没有发现问题。R1 是战斗数据层面的问题，从地图截图看不出来。

## 与当前 main（`84c488e`）的临时合并

在临时 worktree 里做，不改被审分支。

**冲突：42 个文件。**

- **真正的代码语义冲突只有 1 处，在 `importer/project.ts` 的 `get_player_monster`：**
  - main 新增了“紧跟 `rename_monster` 时用 `tux.monsterPicker` 选怪”的分支，其他情况一律 T3-dropped；
  - 本分支加的是通用的 KC1 `extChoice` 选择；
  - 两边必须合并：rename 分支在前，其余情况走 extChoice。我在副本里就是这样合的；
  - 另外 main 把 `open_journal` 从 dropped 组里拿出来了，以 main 为准。
- **其余是测试和 verify 的 pin、生成数据、文档、golden 和截图**（两边都重录过旅程）：
  - `verify-web-journey.ts` 保留本分支的 `WEB_DIALOG_UPDATE` 机制，帧号取 main 的 1594；
  - 其余文件取 main 一侧；
  - `tests/goldens/g6-route-1.3819.png` 被 main 删除，`g6-downstairs-mom.1349.png` 本分支删了而 main 改了。

**合并后：**

- import ×2 字节一致；
- `tsc` 0；
- `build` 0；
- `bun run test` **320 pass / 14 fail**，全是旅程或导入的 pin（GB6 route goldens、import 字节 pin、G6/GP1 repository、G6 bundle replay、J1 goldens、GB5 battle fixture 中 “journey prefix never reached the first battle menu” 共 7 项）；
- `verify:gb6:mainline` 在 f1407 就分叉了（`paper_town diverged … spyder_downstairs@4,6`）。

**结论：** 合并是能解开的，但不全绿。两边都改了会话状态，必须重录全部旅程，再重钉 golden 和 import pin，最后重烘焙章节。R1 修好后本来也要重录，建议放在同一轮做。

## 修复所需（供下一轮）

1. **R1**：NPC 队伍按上游生命周期清理（换图或 `remove_npc` 时清掉，或者开战时不继承上一场的队伍），改正 `tests/battle-runtime.test.ts:348-370`，重录旅程，并确认 Billie 五场的敌方与 `87f16be` 一致。
2. **R2**：dojo/gym 的 `get_party_monster` 要么让它真正生效（例如不把紧跟 `get_party_monster` 的 `add_monster` 折进 setup，而是在加的时候就写入 `npcParties`），要么记为 Degraded 并写明限制；同时改正 `importer/index.ts` 的生成文字、`status.md:68` 和 `GI1b.md`。
3. **R3**：更新 `status.md:24,106-108,116-117`、`verification.md:95-96`、`README.md:63,66-67,189`；`GI1b.md:68,78` 改回快照值，并在表头注明快照。
4. 合并当前 main `84c488e`：解 `get_player_monster` 的语义冲突，重录、重钉 pin，最后重烘焙章节。

## 子代理使用

2 个，并行、只读：

- **SA1：上游语义和真实内容。** 发现并量化了 R1（Billie 重赛累积、Marion 重打加倍），指出 dojo/gym 不生效（R2），并找到 `partyFor` 读 `npcParties`。我亲自复核了以下几处：重新写脚本对比 Billie 五场的数据、读上游 `transition.py`、`npc_manager.py` 和 `db.py`、跑 dojo 命令顺序脚本、读 gym 的 yaml、读章节快照里的 `iid_slot_0`。
- **SA2：文档逐条核对。** 列出了 R3，并指出上一轮审查自身的两处错误。我亲自核对了 `status.md`、`verification.md`、`README` 的对应行，以及 `git ls-tree 8b76116` 和 `bc7182b` 时的 J2 数据。

门禁、变异、合并、画面和最终判定都由主 agent 串行完成。并行调研省下大约 10–15 分钟；R1 是本轮最关键的发现，来自 SA1 的数据对比。

FAIL
