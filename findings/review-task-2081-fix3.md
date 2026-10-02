# GI-1b 修复 3 复审

被审：游戏仓分支 `fleet/task-2081`，复审起点 HEAD `db1c9d8`。

依据：

- 通用审查规格：`reviewer-generic.md`；
- 修复规格：`game-GI1b-fix3.md`；
- 上一轮复审：`findings/review-task-2081-fix2.md`；
- builder 记录：`findings/GI1b.md`「修复 3」节。

所有需要 Tuxemon 源的命令均设置
`TUXEMON_SRC=/var/tmp/tuxemon-src`。三组只读/隔离变异审查结束后，
全量测试、构建、verify 和网页旅程均由主 agent 串行复跑。

## 结论

FAIL。

修复后的 GB6/J1/J2 六场 Billie 队伍与上游基准逐项一致，Marion
败后重赛也不再翻倍；R2 的覆盖率汇总 `1 Native / 7 Degraded /
1 Dropped` 正确；R3 要求的帧数、战斗数和覆盖率百分比都已刷新，
并且全部规定门禁通过。

仍有两个规格内阻断项：

1. R1 没有在换图时清理非持久 NPC 队伍，只在该 NPC 下次
   `create_npc` 或 `remove_npc` 时清；最终章节存档仍携带 35 支离图
   NPC 队伍。
2. R2 的 gym 四处虽应 Degraded，但“NPC party 为空”的理由不实，
   `findings/GI1b.md` 也仍同时保留 Native 8 与 Native 1 / Degraded 7
   两套互相矛盾的当前说法。

二者都在本轮 R1/R2 的明确收敛范围内；R1 还直接改变保存的数据，
不能按“新发现的非玩家可见问题”降为建议。

## 阻断项

### R1 — 没有按上游在 transfer 时结束 NPC party 生命周期

**已修好的玩家可见战斗队伍。** 我直接读取三条 journey 的
`battles[]`，并用与上一轮相同的方法和 `87f16be` 对比。帧号因后续
合并和重录不同，敌方成员逐项相同：

| Journey / 战斗 | 当前记录 | `87f16be` |
|---|---|---|
| GB6 Paper Town f2177 | `[1] budaye@5` | 相同 |
| GB6 Route 2 f10302 | `[3] budaye@6, eyenemy@6, cardiling@3` | 相同 |
| J1 Route 4 f4031 | `[3] budaye@18, cardiwing@16, eyesore@16` | 相同 |
| J1 Route A f7594 | `[4] budaye@20, cardiwing@17, eyesore@17, viviphyta@17` | 相同 |
| J2 Dojo 4 f20877 | `[4] bamboon@34, eyesore@30, cardiwing@30, viviphyta@30` | 相同 |
| J2 Route 6 f38220 | `[4] bamboon@40, eyesore@40, cardiwing@40, viviphyta@40` | 相同 |

GB6 里 Marion 的正常战斗也是两只 `aardorn@7`，与 `87f16be` 和上游
一致。败后重赛没有第二条 journey battle 记录；生产导入事件回放测试
`tests/npc-party-lifecycle.test.ts:148` 证明重进 Route 2 后仍是同两只，
不是四只。

**但生命周期本身未按规格实现。** 当前代码是：

- `battle/extension.ts:1089-1104` 的 `tux.clear_npc_party` 能删除指定
  NPC 的队伍；
- `importer/project.ts:1878-1887` 只在新鲜 `create_npc`（对应
  `local.npc.* == 0`）前清指定 NPC；
- `importer/project.ts:1897-1900` 在 `remove_npc` 时清指定 NPC；
- `importer/project.ts:1964-2009` 的 `transition_teleport` 只发出
  `transfer`，没有清理当前所有非持久 NPC 的命令；全仓
  `clear_npc_party` 调用点也只有 create/remove 两处。

上游恰恰在每次换图时清：

- `/var/tmp/tuxemon-src/tuxemon/map/transition.py:38-43,83-85`：
  `change_map` 先调用 `npc_manager.clear_npcs()`；
- `/var/tmp/tuxemon-src/tuxemon/npc_manager.py:60-67,150-152`：只保留
  `persistence` NPC；
- NPC 默认 `persistence=false`，`rg -l persistence
  /var/tmp/tuxemon-src/mods/tuxemon` 没有结果。

这不是只占内存的理论差异。对 `data/chapters.json` 中序列化 snapshot
执行：

```sh
jq -r '(.chapters // .)[] |
  [.id, (.snapshot|fromjson|.state.map),
   ((.snapshot|fromjson|.state.ext.state.npcParties|keys|length)|tostring)] |
  @tsv' data/chapters.json
```

后半程输出为：

```text
city-park          spyder_citypark          1
route-3-north      spyder_route3            4
flower-city        spyder_flower_city       7
captain-returns    spyder_mansion          11
candy-town         spyder_candy_town       29
greenwash-aardant  spyder_greenwash        35
hospital-cure      spyder_candy_hospital3  35
```

也就是人在 Candy Hospital 时，存档仍保存 35 支已离开地图的 NPC
队伍。`docs/status.md:68` 与 `findings/GI1b.md:491-497` 已承认这个限制；
但修复规格要求的是“换图时（以及 `remove_npc`）清掉非持久 NPC 的
`npcParties`”，文档化偏差不能代替实现。

**测试辨识力及缺口。** 隔离 worktree 中删掉 `create_npc` 的 guarded
clear、保留 `remove_npc` clear，再跑 `tests/npc-party-lifecycle.test.ts`：

```text
Billie Route 2 expected [budaye@6, eyenemy@6, cardiling@3]
received [budaye@5, budaye@6, eyenemy@6, cardiling@3]

Marion rematch expected [aardorn@7, aardorn@7]
received [aardorn@7, aardorn@7, aardorn@7, aardorn@7]

1 pass / 2 fail
```

因此测试能杀死“下次 create 前不清”的回退，也能抓住 Billie 累积与
Marion 翻倍。不过 `tests/npc-party-lifecycle.test.ts:104-106` 的
`enter()` 只删除 `local.*` 变量，不执行真实 transfer，也不断言换图后
立刻清空 `npcParties`；仓库里不存在可供规格要求的“去掉换图清理”
变异，因为换图清理本身尚未实现。

### R2 — disposition 总数正确，但降级理由和报告仍不如实

builder 选择的是“如实降级”方案，而不是让 dojo 顺序生效。以下部分
成立：

- 上游 dojo 三处均为 `add_monster` → `get_party_monster` →
  `add_tech` → `start_battle`；当前 importer 把前面的怪物折进后面的
  battle setup，所以 `get_party_monster` 执行时尚无该场队伍；
- `add_tech` 的 12 处全部 Dropped；
- Nimrod `Zircon Back` 一处 Native；章节里的
  `v.iid_slot_0=txmn-000044` 对应已删除怪物，Argon 当前队伍是随后加入
  的 `txmn-000046:chrome_robo`；
- `reports/G1-coverage.md:177` 与 `dist/import-report.json` 都是
  `get_party_monster = 1 Native / 7 Degraded / 0 Placeholder /
  1 Dropped`。

**gym 的理由错误。** 上游
`mods/tuxemon/maps/spyder_leather_gym.yaml:50-72` 的 Create Brad/Chad
分别有 `add_monster sumchon` 和 `add_monster boxali`。生成的
`dist/project.json` 中 `e004_create_bradfort`、`e005_create_chad` 也各有：

```text
tux.clear_npc_party
tux.add_monster character=spyder_leathergym_brad/chad
```

`battle/extension.ts:665-699` 会把这些怪物写入 `npcParties`，而
`battle/extension.ts:1110-1123` 的 `get_party_monsters` 会从该队伍写出
`iid_slot_*`。隔离探针直接执行两段生成命令后得到：

```text
spyder_leathergym_brad {"writes":{"v.iid_slot_0":"txmn-000001"}}
spyder_leathergym_chad {"writes":{"v.iid_slot_0":"txmn-000002"}}
battle_last_winner unset
```

正常剧情中四处 Points 调用确实不会写 iid，但真实原因是：

- `importer/project.ts:2051-2054` 把 NPC-vs-NPC battle 变成纯文本，
  不写 `v.battle_last_winner`；
- 生成的 `e011_points_brad` / `e012_points_chad` 分别要求 winner enum
  122 / 123，因此页面不可达。

当前 `importer/project.ts:187-194,2154-2156`、生成的 import report、
`docs/importer.md:97` 和 `findings/GI1b.md:555-557` 却说它们的 party
为空。Degraded 结论可以保留，但必须把理由改成缺失 NPC battle winner
导致 Points 页不可达。

**GI1b 报告仍自相矛盾。** `findings/GI1b.md:27` 的总表仍写
`Native (8) + Dropped (1)`，`:230-233` 的 B3 也仍写 Native 8；只有
`:559-564` 的修复 3 节写 `1 Native / 7 Degraded / 1 Dropped`。与
明确标了 “Superseded by 修复 3” 的旧 F2 不同，这两处没有标成历史或
废弃。修复规格明确要求覆盖率、生成说明、status 和 `findings/GI1b.md`
一致，所以 R2 仍未收敛。

隔离变异把两类 Degraded 都误记为 Native 后，目标 importer 测试按
预期失败：

```text
Expected: native 1, degraded 7
Received: native 8, degraded 0
(fail) get_party_monster is Native only where the NPC's party exists when it runs
0 pass / 1 fail
```

这证明汇总数量的测试有辨识力；它没有检查 gym 的真实降级原因或报告
内部一致性。

## R3 — 核心数字成立

上一轮指出的帧数、战斗数和百分比都已更新。我从 JSON 直接读取，并
用本轮 verify 输出复核：

| Tape | Frames | Battles |
|---|---:|---:|
| G6 opening | 3,369 | 1（失败 tape 不存 `battles[]`；正常 G6 由故事/测试 pin） |
| GB6 mainline | 108,225 | 100（22 trainer, 78 wild） |
| J1 segment | 12,629；combined 120,854 | 17（10 trainer, 7 wild） |
| J2 segment | 50,014；combined 170,868 | 56（50 trainer, 6 wild） |
| GB6 first loss | 3,154 | 1 |
| GB6 later loss | 64,611 | 1 loss + prefix |

三段主线合计 173 场（82 trainer、91 wild），与 README 一致。
`docs/status.md:107-109`、`docs/verification.md:23-26,93-98`、
`README.md:27-40,70-73` 和 `findings/GI1b.md:570-582,641-645`
使用同一组当前数字。

覆盖率 JSON 为：

```text
Actions    13617 total, 12437 Native, 594 Degraded, 12 Placeholder,
           574 Dropped, 91.3% Native, 95.8% executable
Conditions  8663 total,  8183 Native,   2 Degraded,  1 Placeholder,
           477 Dropped, 94.5% Native, 94.5% executable
```

README、status 和生成报告的百分比均一致。额外复跑当前 GB6 tape 的
`verify:gb6:rates`，60/30/20 Hz 三次都到达同一个
`93db6e4a…` 终态，因此 `docs/status.md:107` 的多 hz 说法也成立。

## 非阻断建议（按收敛规则）

以下不是 R1/R2 阻断的替代项，也不影响当前玩家可见内容或游戏数据；
记录给后续维护：

1. `reports/G1-coverage.md:18-21` 写 “-109 / -116 uses below the S1
   baselines”，但实际 6,355 比 6,246 高 109、4,707 比 4,591 高 116，
   `dist/import-report.json` 也标 `meetsBaseline=true`。根因是
   `importer/index.ts:26-27` 算 `required - actual`，`:73-74` 固定拼
   “below”。`git blame` 显示错误文字来自当前 main，而非本轮修复；
   应改为带方向的差值。
2. `tools/bench-g6-quickjs.sh:13` 的默认 G6 终态 pin 仍是
   `3042ff15…`，当前同一 tape 的 canonical pin 已是
   `4bc48ecf…`（`tests/g7-repository.test.ts:37-40`）。脚本会在
   `:76-82` 的 state 比较处失败。fix3 规格没有要求重跑 QuickJS，且
   README/status 已诚实注明性能数字来自旧 tape，因此本轮仅记为维护
   建议；下一次性能门禁前应更新或从 tape/共享常量读取。

## 逐项核对

| 规格项 | 判定 | 证据 |
|---|---|---|
| 1. 合并当前 main | 成立 | `84c488e` 是被审 HEAD 祖先；见临时合并节 |
| 2. R1：换图及 remove 清 NPC party；Billie/Marion 与上游一致 | **部分** | 六场 Billie 与 Marion 重赛队伍正确；remove 正确；但没有 transfer 清理，章节存档残留 35 支队伍（R1） |
| 3. R2：dojo 真命中或覆盖率/文档如实降级 | **部分** | 1/7/1 数量正确、dojo 正确降级；gym 理由不实且 GI1b 自相矛盾（R2） |
| 4. R3：帧数、战斗数、覆盖率与最终输出一致 | 成立 | 当前 JSON、verify、README/status/verification 的核心数字一致；60/30/20 Hz 额外复跑通过 |
| 5. 最后重录、烘焙章节 | 成立 | tape 提交 `9d4b121` 早于章节重烘焙 `4742d89`；`verify:chapters` PASS |
| 验收门禁 | 成立 | 全部规定命令和网页旅程 PASS，见下表 |
| 状态清单 | **部分** | R3 数字与 Partial 标记已刷新；`:68` 诚实披露 R1 的残留限制，但该限制本身违反 R1，且 R2 详细理由仍不实 |

## 门禁（被审 HEAD `db1c9d8`，主 agent 串行）

| 命令 | 本轮结果 |
|---|---|
| `bun run import` ×2 | PASS；现有 `dist` 树 4,117 文件，两次摘要均 `b7b539b5…`，coverage/report 摘要也逐字相同，工作树 clean |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | exit 0；pak 4,813 entries |
| `bun run build:wasm` | exit 0；web wasm 357,528 B |
| `bun run test` | **339 pass / 0 fail**（55 files，172.63 s） |
| `verify:audio` | PASS；all hashes match |
| `verify:chapters` | PASS；13 chapters，170,868 combined frames，terminal `b809956636aa` |
| `verify:gb6:mainline` | PASS；108,225 frames，100 battles（22 trainer, 78 wild），terminal `93db6e4a…` |
| `verify:j1:mainline` | PASS；120,854 combined，17 battles（10 trainer, 7 wild），terminal `a9791f34…` |
| `verify:j2:mainline` | PASS；170,868 combined，56 battles（50 trainer, 6 wild），terminal `b8099566…` |
| `verify:gb6:failures` | PASS；first 3,154 frames / 1 battle / `5bedca90…`；later 64,611 / Wanda loss / `fb98b783…` |
| `verify:g6:locks` | PASS；330 pages，334 checks，0 unresolved / 0 errors |
| `verify:g6:determinism` | PASS；2 isolated roots，4,742 files，SHA `0555315c…` |
| `verify:g6:frozen` | PASS；263 maps，0 permanent locks，0 blocking fibers，0 errors |
| `bun run web` + `tools/verify-web-journey.ts` | **WEB JOURNEY PASS**；3,369 frames，所有 checkpoint/pixels 匹配，console errors 0 |
| 额外 `verify:gb6:rates` | PASS；60/30/20 Hz 均到达 `93db6e4a…` |
| `bun.lock` / kit 指针 | 相对 current main 均未改 |

门禁全绿只说明当前被记录的行为自洽；R1 的测试没有断言规格要求的
transfer 时清理，R2 的测试也没有断言降级理由和累计报告的一致性。

## 临时合并当前 main

在独立 detached worktree `/var/tmp/fleet/2270/merge` 执行，不改被审
分支：

```text
MERGE_BEFORE head=db1c9d8 main=84c488e main_is_ancestor=yes
Already up to date.
MERGE_AFTER tree=c75f7a0edce7f8a1906ba628f86218a2550b9272
reviewed_tree=c75f7a0edce7f8a1906ba628f86218a2550b9272
MERGE_STATUS_BEGIN
MERGE_STATUS_END
MERGED_TREE_IDENTICAL_TO_TESTED_HEAD PASS
```

冲突为 **0**。合并结果树与本轮已跑完全套门禁的树逐字相同，所以临时
合并态同样全绿；临时 worktree 已删除。

## 画面肉眼检查

- `docs/screenshots/chapters/before-billie-480x272.png`：Paper Town 医院
  与围栏区、玩家、NPC、路牌和植被均正常，没有空白或错层；
- `tests/goldens/j1-route-4-billie.480x272.png`：Route 4 林地、作物带、
  玩家和多名 NPC 清晰可见，窄地图两侧黑边符合地图宽度；
- `tests/goldens/j2-hospital-cure.480x272.png`：Candy Hospital 实验室
  地砖、书架、设备和角色位置正常；
- `dist/web-journey/end.png`：网页 Route 1 终帧、2× 像素画面、控件和
  音量栏均正常。

画面没有发现回退；R1/R2 是保存数据、导入语义和说明一致性问题。

## 原则与仓库卫生

- 改动仍由 importer 自动生成，没有逐地图手改导入产物；
- Tuxemon 专用逻辑留在游戏仓，没有写入通用组件仓；
- `vendor/pocket-rpgkit` / 嵌套 PocketJS 指针未变，`bun.lock` 未变；
- fix3 功能提交信息没有任务号，未发现 push/PR 或外部状态改动；
- 两个 mutation worktree 与临时 merge worktree 均已删除，被审分支在
  写本复审报告前保持 clean。

## 修复所需

1. 在真实 map transfer 生命周期清掉全部非持久 NPC party（本 corpus
   没有 persistent NPC）；为真实 transfer 加“离图后立即为空”的测试，
   继续保留 same-map 已存在 NPC 的 no-op 与 `remove_npc` 测试。重录受
   影响 journey、最后重烘焙章节。
2. 保留 `get_party_monster` 的 1/7/1 数量，但把 gym 四处的理由改为
   “NPC-vs-NPC placeholder 不写 winner，Points 页不可达”；同步生成
   report、`docs/importer.md` 与 `findings/GI1b.md`，并把总表/B3 的
   Native 8 标为历史或更新为当前 disposition。

## Subagent 使用

3 个，并行：R1 子代理核对上游生命周期、journey 队伍并做隔离变异；
R2 子代理核对 dojo/gym 顺序、覆盖率并做 disposition 变异；R3 子代理
交叉核对 journey/coverage 文档数字和 status。主 agent 亲自复核关键
文件/JSON、复跑所有重门禁、临时合并和画面检查。并行把三组独立的
逐项审查压缩到同一时段，约节省 20–30 分钟。

FAIL
