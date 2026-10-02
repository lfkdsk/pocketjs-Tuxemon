# GI-1b 修复 1 复审

被审：游戏仓分支 `fleet/task-2081`，HEAD `c9256bd`（修复提交 `39a9bb2`、`f66c293`、
`7c4ec69`、`a07f401`，以及其后的重录/文档提交）。规格：GI-1b 修复 1（B1–B7）；
上一轮审查 `findings/review-task-2135.md`。所有命令都设置了
`TUXEMON_SRC=/var/tmp/tuxemon-src`。重活串行执行；变异和合并都在隔离副本里做
（`/var/tmp/fleet/2224/mut` 是去掉 `.git` 的独立拷贝，`/var/tmp/fleet/2224/merge`
是临时 detached worktree）。被审 worktree 全程保持 clean。

## 结论

FAIL。B1、B2、B4 已按规格修复或如实降级，四个修复各自的变异都能被测试杀死。
QuickJS 实测数字与报告同量级；web journey 的新对话检查点正确；GB6、J1、J2、
failures、locks、determinism、frozen 都通过。但有三处没有过关：

1. **分支 HEAD 上 `verify:chapters` 失败**（这是 CI 的一步）。报告却写它 PASS。
2. **B3 的真实用例仍然什么都没做**。报告说 Nimrod 事件“现在真正删除了 argon 的第一只
   怪物”，这一说法不成立。
3. **B5 文档仍有多处与实现或数据不符。**

## 阻断项

### F1 — `verify:chapters` 在被审 HEAD 上失败

```text
$ bun run verify:chapters
CHAPTERS STALE: a chapter snapshot or thumbnail hash in data/chapters.json changed
Rebake with: bun tools/bake-chapters.ts
error: script "verify:chapters" exited with code 1
```

原因有两层：

- 章节快照在 `afb0e31` 烘焙，J2 tape 却在之后的 `1bf3b44` 重录（多等了 60 帧）。
  所以 `data/chapters.json` 仍写着 `j2.frames: 50110`、`frames: 171949`，而 tape
  已经是 50,170 / 172,009。
- 在独立副本里重新跑 `bun tools/bake-chapters.ts`，13 张缩略图全部改变：整帧有
  ≤12/255 的色偏，例如 hospital-cure 主色差 `(12,10,6)`，与昼夜色调吻合。
  也就是说，提交的缩略图也不是当前构建产物烘出来的。

重烘焙后，同一副本的 `verify:chapters` 通过：

```text
CHAPTERS PASS 13 chapters, 172009 combined tape frames, snapshots and thumbnails
byte-identical; 13 chapter suffix replays all reach terminal b17279fb5eec
```

修法就是重烘焙并提交。但这是规格 B7 和验收里明确列出的门禁，而 `findings/GI1b.md`
的 Determinism 一节写着 “`verify:chapters` PASS”，与事实不符。

### F2 — B3：NPC owner 的真实流程是空操作，报告说法不实

- **代码本身正确。** `tux.get_party_monsters`（`battle/extension.ts:982-993`）写
  `v.iid_slot_N`；`remove_monster`（`:967-971`）在玩家队伍和 kennel 之后还会搜
  `npcParties`。导入产物里两者是同一变量 `v.iid_slot_0`。
- **但真实内容中 `npcParties` 在这些命令执行时几乎总是空的：**
  - 只有带 NPC 角色的 `tux.add_monster` 会写入它（`battle/extension.ts:634-650`）；
    训练师战斗开始时又把对手那一项删掉（`battle/runtime.ts:332-334`、`:721`）。
  - 而 NPC 的 `add_monster` 大多被折叠进 battle `setup.party`。
- **Nimrod 的具体情况。** 上游 `Talk Argon` 先 `add_monster chrome_robo,...,spyder_nimrod_argon`
  再开战（`spyder_nimrod_middle.tmx:166-168`、`:199-208`），上游 NPC 战后仍保有这只
  怪物，所以 `Zircon Back`（`:339-353`）的 `get_party_monster` + `remove_monster`
  会删掉它。对 `dist/maps/*.json` 全量扫描的结果是：argon 唯一的
  `tux.add_monster{character:"spyder_nimrod_argon"}` 只出现在之后才触发的
  `Post Flashback` 里。因此在我们的运行时里，`Zircon Back` 写不出任何 iid，
  `remove_monster` 也什么都不删。
- **其余 7 次 `get_party_monster`（`spyder_dojo2` ×3、`spyder_leather_gym` ×4）同理**
  写不出 iid。

对玩家可见的结果碰巧与上游一致：argon 最后都只有一只 chrome_robo，NPC 对 NPC 的
战斗本来就是占位。但规格要求的是“支持 NPC owner，或把不支持的调用按可达上下文准确
降级/丢弃”，以及“覆盖率与状态清单如实”。现在的情况是：

- 覆盖率记 `get_party_monster` Native 8；
- `docs/status.md:68` 写 remove 能从 “an NPC party” 删除；
- `findings/GI1b.md` 的 B3 写 “now deletes argon's first monster for real”。

这些说法在真实内容里都不成立。唯一能证明删除的测试
（`tests/battle-extension.test.ts:526`）是先人为用 `tux.add_monster` 给 argon 建了
队伍，并不是真实流程。

### F3 — B5：文档仍与实现或数据不符

规格点名的几处已改对：wander RNG、`char_position` 插值、冻结扫描在
`status.md`/`GI1b.md` 中的措辞，以及 `status.md` 的三段帧数。下面这些仍然不对：

- **`docs/importer.md` 的分类表放错了组：**
  - `choice_monster`（Native 2）和 `choice_npc`（Degraded 1）在 “Placeholder
    examples”（`:95-96`）；
  - `char_stop`（Native 88）在 “Degraded examples”（`:80`）。
- **`reports/G1-coverage.md:55-57` 的生成文字仍写 “`choice_npc` … and
  `remove_monster` are Native”**，与同一文件里的表（`:154` choice_npc Degraded 1，
  `:189` remove_monster 有 Dropped 1）矛盾。这段文字来自 `importer/index.ts:104-106`。
- **`docs/status.md` 有三处不一致：**
  - `:36` 把 `char_run` 标为 Partial，但两次使用全部 Dropped。按 `:6` 的定义，
    Partial 是“能在限制内工作”。
  - `:34`、`:35`、`:37` 把 wander/speed/position 标 Done，没写限制，而覆盖率是
    Degraded（frequency/speed 量化到 grade，越界坐标 clamp，上游会抛错）。
  - `:68` 见 F2。
- **`findings/GI1b.md` 内部前后不一：**
  - `:78`、`:95` 仍是 J2 50,110 帧（`:285` 和数据都是 50,170）；
  - `:66-78` 的 tape 变更表里，哈希 `37c9cb0b…`→`0aaa2947…` 等在任何数据文件里都
    查不到；kit 写成 `c93a1ec`，实际子模块是 `dfbae47`；
  - `:295` 说 `choice_monster` 也退回到按名字区分，但实现只对 `choice_npc` 这样做
    （`importer/project.ts:1487-1508`）。
- **本分支重录了 tape，但这些公开文档的帧数仍是旧值：**
  - `README.md:27,40`：172,060 和 109,983；
  - `docs/verification.md:23,25,26,72,94,97,98`：109,983 / 122,145 / 172,060 /
    12,162 / 49,915；
  - `docs/ci.md:64,66`。
- **冻结扫描的过度表述仍在：** `docs/ci.md:69` 写 “No map can freeze the player”，
  `docs/verification.md:22` 写 “No imported map can permanently freeze the player”。
  这正是规格 B5 要求删掉的那类说法。前者来自 main，但 B5 要求把仓库文档按真实行为
  改对。

### 修复所需（供下一轮）

1. 重跑 `bun tools/bake-chapters.ts`，提交 `data/chapters.json` 和
   `docs/screenshots/chapters/*`。
2. B3 二选一：
   - 让 NPC 战斗队伍在战后仍保留在 `npcParties` 里（与上游一致）；
   - 或者把 `get_party_monster` 记为 Degraded 或 Dropped，并说明它在当前可达内容里
     写不出 iid；同时改正 `status.md:68` 和 `GI1b.md` 的 B3 描述。
3. 按 F3 逐条改文档，包括 `importer/index.ts` 里生成覆盖率文字的那段，改完重新导入。

## 逐项核对

| 项 | 结论 | 证据 |
|---|---|---|
| B1 `choice_npc` | 成立，Degraded 如实 | `dist/maps/start_tuxemon.json` 六项为 “Select (White male)” … “Select (Whatever)”，互不相同，最长 21 字符，24 字符截断不触发；覆盖率 `choice_npc` Degraded 1。上游 `choice_npc.py` 共享 label、`states/choice_npc.py` 靠立绘区分，降级说明属实。“需要组件仓提供的能力”已单列 |
| B2 `char_run` | 成立，Dropped 如实 | 上游 `entity/entity.py:126-129`：只在 `body.is_moving` 时才设绝对 `player_runrate`；`set_state(IDLE)`（`:140-152`）复位为 walkrate。route1 christie 在 `char_move` 结束后已 idle，所以上游是 no-op；`spyder_route1` 的 bjorn 是 wander 单格移动，加速在下一次 `move()` 前就会被 IDLE 复位，实际也近乎 no-op（报告说“可能丢失瞬时加速”，偏保守但方向安全）。覆盖率 Dropped 2 |
| B3 `remove_monster` / `get_party_monster` | **不成立**（见 F2） | 代码层的 NPC owner 搜索正确；真实流程是空操作；报告与状态清单失实 |
| B4 position + face | 成立 | 唯一的 `char_position`（`spyder_paper_rival_downstairs.yaml:94-95`）导入为 `{"op":"place","target":"player","x":6,"y":8,"dir":"left"}`；测试驱动真实导入事件，断言 facing=1 且下一帧保持。kit 的 `place` 对玩家（`session.ts:1693-1699`）和 NPC（`chars.ts` 中 `placeChar`）都会应用 `dir` |
| B5 文档 | **部分**（见 F3） | |
| B6 QuickJS | 基本成立（见下文） | 完整 app 的数字是本分支自己实测的，我复跑同量级；wander 边际成本是引用上一轮审查的数字，没有自测，也没有 before/after 的完整 app 对照 |
| B7 合并 / 重录 / web | **部分** | GB6/J1/J2/failures/locks/determinism/frozen 与 web journey 均 PASS，新对话帧正确；`verify:chapters` 失败（F1） |

上游语义抽查的依据：

- `remove_monster.py:37-60`：全局按 IID 查找，再从 owner 删除；
- `get_party_monsters.py`：`iid_slot_{i}` 写进玩家变量，不清理更高的槽位，我们的
  实现与之一致；
- `char_position.py`：瞬时放置；
- `choice_npc.py` / `states/choice_npc.py`：共享 label，靠立绘区分。

## 变异检查（隔离副本 `/var/tmp/fleet/2224/mut`，跑完已还原）

| 变异（撤掉修复） | 目标测试 | 结果 |
|---|---|---|
| M1：label 退回只用共享 `commonLabel` | `choice_npc keeps every appearance option distinguishable` | 0 pass / 1 fail（`new Set(labels).size` 期望 6） |
| M2：恢复发出 `moveControl run` 且记为 T1 | `ImportOptions.moveControl emits KM1 …` | 0 pass / 1 fail（`kind==="run"` 期望 false，实际 true） |
| M3：`remove_monster` 不再搜索 `npcParties` | `remove_monster removes an NPC-owned monster by iid` | 0 pass / 1 fail（argon 队伍未清空） |
| M4：关闭 position+face 折叠 | `char_position followed by char_face folds the facing…` | 0 pass / 1 fail（`place.dir` 为 undefined） |

基线：这些测试未变异时为 3 + 1 全部 pass。

## 门禁（被审分支，串行）

| 命令 | 结果 |
|---|---|
| `bun run import` 两遍 | exit 0；`dist/` 与 `reports/G1-coverage.md` 内容哈希两遍都是 `7a4d1210…`；worktree 仍然 clean |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` / `bun run build:wasm` | exit 0 / exit 0 |
| `bun run test` | 301 pass / 0 fail，48 个文件 |
| `verify:chapters` | **FAIL**（F1） |
| `verify:gb6:mainline` | PASS，109,654 帧，100 战，`ad9717bb…` |
| `verify:j1:mainline` | PASS，合计 121,839 帧，17 战，`c8b62692…` |
| `verify:j2:mainline` | PASS，段 50,170 / 合计 172,009 帧，56 战（50 训练师 + 6 野生），`b17279fb…` |
| `verify:gb6:failures` | PASS，first `8424d9bc…`，later `f6eec2d4…` |
| `verify:g6:locks` | PASS，330 页 / 334 锁，0 unresolved / 0 error |
| `verify:g6:determinism` | PASS，`9c9f29c5…` |
| `verify:g6:frozen` | PASS，263 图，0 永久锁 / 0 阻塞 fiber / 0 错误 |
| `bun run web && bun tools/verify-web-journey.ts` | WEB JOURNEY PASS，console errors 0 |
| `bun.lock` | 未改动 |

## B6：QuickJS 复测（同机，`uptime` 负载 7.4–8.6）

**完整 app**（`tools/bench-g6-quickjs.sh`，真实 rquickjs 桌面宿主，960×544；
canonical state `846ca161…` 一致）：

| 指标 | 报告 | 本次复测 |
|---|---:|---:|
| 启动（boot / startup-to-first） | 180.1 / 182.3 ms | 178.3 / 180.6 ms |
| 战前走路 mean / p95 / max | 1.131 / 1.749 / 2.258 ms | 1.098 / 1.698 / 2.126 ms |
| 战后走路 mean / p95 / max | 1.630 / 1.988 / 2.372 ms | 1.617 / 1.884 / 2.641 ms |
| 切图 max | 6.051 ms | 6.080 ms |
| 战斗入口（全帧最大） | 20.664 ms | 20.639 ms |
| 首访 263 图 p95 / max | 4.042 / 17.969 ms | 3.997 / 16.650 ms（最差都是 `spyder_routec`） |

**wander 边际成本**：同一 QuickJS 程序里轮转 0/2/4/6 个 runtime wander override，
每档 5 次 × 600 帧，独立跑 3 遍。

- 用的是真实的 `spyder_scoop4` 分片、真实 Tuxemon 扩展和真实 session reducer，
  不含 UI 渲染；脚本在 `/var/tmp/fleet/2224/wb/wander-qjs.ts`。
- 档位确实生效：第 0 遍里位置变化帧数分别为 0/18/27/35。

| 遍 | 0 个 | 6 个 | 边际（ms / wanderer / frame） |
|---|---:|---:|---:|
| 1 | 0.4924 | 0.5177 | 0.0042 |
| 2 | 0.4971 | 0.5217 | 0.0041 |
| 3 | 0.4961 | 0.5269 | 0.0051 |

我测的只是引擎部分，约 0.004–0.005 ms；上一轮审查测的是含 UI 渲染的完整生产 UI，
0.017–0.025 ms。两者都是微秒级，前者理应更低，与报告量级一致，没有帧预算风险。

报告这一节的不足（不阻断）：

- wander 边际数字直接引自审查，不是 builder 自己测的；
- 完整 app 只有 after，没有规格要求的 before/after 对照；
- `GI1b.md:152` 写 “16.7 ms budget”，而本仓与 bench 的预算口径是 50 ms。

## B7：画面与 golden

- **web 原生密度对话检查点（@1565）。** 打开 `tests/goldens/web-density-paper-dialog.2x.png`：
  画面是 Paper Town 的 Gold Pass 对话（“I recognize you, you're the kid who hasn't
  got a Gold Pass.”），文字清晰，对话框完整。golden 文件本身与 main 一致
  （哈希 `f15eb461…`），只是检查帧从 1537 移到了 1565，理由成立。
- **章节缩略图**（重烘焙后，打开了 3 张）：
  - `bedroom`：卧室，带“Do you want to skip the intro”对话；
  - `hospital-cure`：病房，人物和桌子位置正常；
  - `candy-town`：城镇入口，玩家在地图上沿。
  - 另外把 `route-3-north` 的旧图和新图并排看过：构图相同，只有轻微色调差。
- **golden 重钉（`1bf3b44`）逐项看：**
  - J2/GB6 的逐像素比较放宽到每通道 ±12：理由是昼夜色调，与我量到的缩略图色偏
    `(12,10,6)` 吻合，成立。
  - `hospital-password` 不再比玩家像素、地板计数阈值从 22,000 降到 1,000：打开
    480 与 960 两张 golden，确实是 torchlight 叠层（上游 `spyder_candy_hospital2.tmx:101`
    的 `set_layer gfx/ui/overlay/torchlight.png`），玩家位置仍由 state 钉住，理由成立。
    附带观察：960×544 下叠层的椭圆不随视口放大，可视区很小。这属于 main 的
    `set_layer` 呈现问题，不是本分支引入的。
  - GB6 允许最多 30 个玩家像素不匹配（前景遮挡），理由可接受，但辨识力有所下降。

## 与当前 main 的临时合并（`/var/tmp/fleet/2224/merge`，不改被审分支）

main 当前为 `bf79f29`（新增 compact map shards / indexed battle art，kit 指针
`2e10436`，PocketJS `fb29b45`）。

- **冲突**：只有 `data/g6-assets-report.json` 一个（生成数据）。取 main 一侧后由
  `bun run import` 重新生成。
- **构建与测试**：指针变了，先 `build:wasm`；import 两遍字节稳定；`tsc` 0；`build` 0；
  `bun run test` 302 pass / 0 fail。
- **journey**：GB6/J1/J2 mainline、failures、locks、determinism、frozen 全部 PASS，
  终态哈希与被审分支一致；web journey PASS。
- **`verify:chapters`** 与被审分支一样是 STALE。在合并副本里执行
  `bun tools/bake-chapters.ts` 后，`verify:chapters` PASS（13 章，172,009 帧，
  终态 `b17279fb5eec`）。合并副本烘出的 `data/chapters.json` 和 13 张缩略图，与在
  被审分支副本里重烘的结果逐字节相同。
- **结论**：合并本身可解，只有 1 个生成数据冲突。重烘焙章节后全绿；不重烘焙则不是全绿。

## 非阻断的新发现（上一轮未覆盖，早于本分支）

- **NPC 放置会吞掉同一 tick 排队的路线。** kit 先安装 pending route 再应用
  placement；`placeChar` 会清掉角色的 route 并释放 waiter（GI-1b 基线的 kit
  `df2d1c3` 已经如此）。`create_npc` 都会降为 `place`，扫描到 41 张图中有 105 处
  “NPC `place` 后同 tick 接该 NPC 的路线”。例如 `Zircon Back`：我用 reducer 探针
  复现，zircon 在 `create_npc 16,3` 之后，第一条 `pathfind 15,9` 被吞，整段第一句
  对话里都停在 (16,3)，直到第二条 pathfind 才走过来。B4 只修了玩家的
  `char_position` 那一处，`GI1b.md` 说 “placement no longer swallows the facing”
  只对这一处成立。建议另开任务处理（导入器折叠或 kit 调整执行顺序）。

## 子代理使用

2 个，并行只读：

- 一个核对上游语义并用真实导入内容复现 B1–B4，发现了 F2 和 NPC 放置吞路线；
- 一个核对 B5 文档与覆盖率、数据的一致性，发现了 F3。

它们的结论我都亲自复核过（重跑 zircon 探针、全量扫描 `dist/maps`、逐行看文档和
上游源码）。变异、全部门禁、QuickJS 测量、画面检查、合并和最终判定都由主 agent
串行完成。并行调研大约省了 10 分钟，同时多查出一个 F1 之外的阻断（F2）。

FAIL
