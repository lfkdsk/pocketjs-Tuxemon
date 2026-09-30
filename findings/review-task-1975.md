# 审查：GB6-F1（task 1975）首战败上游顺序

基线 `main` = `1354ca9`；被审分支 `fleet/task-1975`（5 个提交，作者
`lfkdsk <lfkdsk@gmail.com>`，无 AI 尾注，无 fleet 任务号泄漏）。

## 1. 上游 trace 可信

自跑复现命令：

```sh
TUXEMON_SRC=/var/tmp/tuxemon-src SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy \
  /var/tmp/fleet/gb2-oracle-venv/bin/python \
  tools/upstream-first-loss-oracle.py /var/tmp/fleet/1979/upstream-first-loss-trace.jsonl
```

结果：`ticks=5985`，`sha256sum` = `95b66f78bb186d43462e1539176b7e3f800c0a7ded4f517cda7619c79eefd8d9`，
与报告 §1.1 逐字节一致。`milestones` 输出
`firstFightStarted=2749, startBattleAction=3114, battleResultLost=5339,
firstFightLoseStarted=5572, recovered=5984`，与报告表 §1.2 的 tick 列完全一致；
`visibleRecoveryDialogs` 为 `spyder_papertown_firstfight_lose` 1 次、
`spyder_papertown_firstfight_after` 1 次、`heal_before_leave` 0 次，终态
`stateStack=[WorldState, BackgroundState]`、`player.tile=[23,10]`、
`firstfightdue=no`、`firstfightend=no`——与报告「Teleport Faint 启动 0 次、两句文本各 1
次、玩家留在 Paper Town、HP 恢复」逐字段吻合。

脚本本身通过 monkey-patch `tuxemon.event.eventengine.EventEngine`（`_evaluate_and_queue_event`、
`start_event`）、`tuxemon.event.running.RunningEvent.process`、
`tuxemon.event.running.ConditionEvaluator.evaluate`、`tuxemon.event.eventaction.EventAction.on_start`
这些真实上游类（`tools/upstream-first-loss-oracle.py:78-86` 的 import 列表），驱动
`tuxemon.client.LocalPygameClient`，不是自写模拟器；只替换了字体 fallback 与音频播放
（音乐/字体资源已被仓库裁掉，但事件引擎、状态栈、战斗系统全部是钉住的上游代码）。**成立**。

另用源码交叉核对了两个关键事件定义（`/var/tmp/tuxemon-src/mods/tuxemon/maps/spyder_paper_town.tmx`）：

- `First Fight - Start`（obj 224）：`cond1=is variable_set firstfightdue:yes`；
  `act70=start_battle`、`act80=set_variable firstfightdue:no`、
  `act81=set_variable firstfightend:yes`，均在同一事件序列内、战斗结束后执行——解释了
  trace 里 5571 tick 为什么才把两个变量翻到「战斗已结束」状态。
- `First Fight - Lose`（obj 226）：`cond1=not variable_set battle_last_result:won`，
  `cond2=is variable_set firstfightend:yes`；**源事件没有任何 `char_defeated` 条件**——
  证实了修复 §2 删除旧合成 guard（`tux.char_defeated` 否定）是在让导入产物贴合源事件，
  不是引入新行为。
- 全局 `Teleport Faint`（`spyder.yaml:230-238`）：`is char_defeated player`、
  `not location_type clinic`、`is current_state WorldState`。

## 2. 修复的门变量是否精确等价于「首战剧情持有锁期间」

变量时间线（依据上面两个源事件的 act 顺序）：

| 阶段 | firstfightdue | firstfightend | 新 guard（两者都 `no`）|
| --- | --- | --- | --- |
| 开场～战斗开始前 | yes | no（未设置视为非 yes） | 不满足（`firstfightdue≠no`）——但此时玩家不可能 `char_defeated`（尚未有对手可击败玩家），Teleport Faint 的另一个前置条件本来就为 false，guard 加不加不影响可见结果 |
| 战斗进行中 | yes | no | 不满足，正确挡住（此时也不该谈 `char_defeated`，战斗内 HP 变化不经过世界层判定） |
| 战斗结束～`First Fight - Lose` 收尾前（act80/81 已跑，`firstfightend=yes`） | no | yes | 不满足（`firstfightend≠no`）——这正是 trace 5571→5984 之间上游靠 `SinkState` 挡住的窗口，新 guard 精确复现 |
| `First Fight - Lose` 收尾（act70 `set_variable firstfightend:no`）之后 | no | no | 满足；但此时队伍已经在同一事件的 act50/60 被治愈，`char_defeated` 已为 false，Teleport Faint 仍不会触发——guard 打开是安全的 |
| 胜利分支（`First Fight - Win`，同样在 act70 把 `firstfightend` 收回 `no`） | no | yes→no | 全程 `char_defeated` 为 false（玩家赢了），guard 加不加都不影响 Teleport Faint（它的另一个前置条件本来就不成立） |

结论：guard 在「本该挡住」的唯一窗口（战斗结束到首败收尾治愈之间）精确为
false，在其余所有阶段要么 guard 为 true、要么 `char_defeated` 本来就为 false，两者
不会同时成立造成误挡。退出条件是 `firstfightend` 被收尾事件重新置回 `no`
——这在胜、负分支都会发生且只发生一次，此后两个变量永久保持 `no`，guard 永久开放，
不会遗留「Paper Town 以后再也无法送医」的回归。报告 §2 的说法（对齐胜利分支和开场）
经上表复核成立。**成立**。

旧特例（`First Fight - Lose` 的 `tux.char_defeated` 否定 guard）确认已删除
（`importer/project.ts` diff 只剩新增的两行 `var` 子句，未见旧 `ext`/`char_defeated`
子句），且删除后胜利路径不受影响：`verify:gb6:mainline` 自跑 PASS，
`109981 frames / 100 battles`，终态 `bd3616c750f5aa2b76ba105713c4e921f434d397ab5a0618845e382df62fa0d0`，
与报告一致（主线含 100 场战斗，胜负都有，未见异常）。**成立**。

## 3. 重录的首败 tape

- `data/gb6-first-loss-journey.json` 自检：`format="pocket-tuxemon/gb6-first-loss/v1"`，
  `tapeSha256="7007799c3a6a1dbf4fe6ffdfd0fde6b4fb6fc6050bf7ad9f0138daf8f0344556"`，
  `frames=3254`，`hz=60`——与报告表格一致，补齐了此前审查（1963）指出缺失的字段。
- `verify:gb6:failures` 自跑 PASS：`first.frames=3254`，
  `terminalStateSha256=d321b2173aca055d0e0fdc39df6127f57ebad93a4cd3e758d7695c04e44f7aab`，
  `first.end=spyder_route1@14,19`；与报告一致。
- **变异验证**（要求的「去掉新加的两个门变量，测试应变红」）：把
  `importer/project.ts` 里 `m.slug === "spyder_paper_town" && e.name === "Teleport Faint"`
  的分支临时改成 `if (false && ...)`，重跑 `bun run import`：
  - `bun test tests/importer.test.ts -t "faint recovery"` → **FAIL**（`toContainEqual` 的
    `firstfightdue`/`firstfightend` 子句缺失，报错定位到 `tests/importer.test.ts:618`）；
  - `bun tools/verify-gb6-failures.ts` → **FAIL**（`GB6 failure paths: first loss did not
    end on Route 1`，exit 1）。
  还原改动、重跑 `bun run import`，`git status --porcelain` 为空，确认无残留。
  两条断言都如期变红，**测试有辨识力，成立**。
- 60/30/20/4 Hz 断言：`tests/importer.test.ts` 新增对 4 Hz 场景的显式行为断言
  （`FIRST-LOSS spyder_paper_town`、`Teleport Faint stayed suppressed...`，且
  `not toContain("spyder_paper_town -> spyder_bedroom @3,4")`），`bun test` 自跑
  167 pass / 0 fail，覆盖四档速率的同一测试用例。**成立**。

## 4. 受保护产物

`git diff main -- data/g6-journey.json data/gb6-mainline-journey.json` 为空（未改动）；
自算哈希 `g6-journey.json=7d46671d052088ec83f7a8b5223a626d6a447dbddbe31669db4960703e80cde95`、
`gb6-mainline-journey.json=507daa8f4c10d2c904d5e9c06703609a4cd57e2d289cc4afec990960349df043`，
与报告一致；`verify:gb6:mainline` 终态哈希自跑同报告。**成立**。

## 5. 全图同机制审计

- 源码核对 `spyder_radiotower.tmx`：`lock_controls` 在行 105（obj 27 `act11`），
  `start_battle player,spyder_omnichannel_beaverbrook` 在行 120（`act62`），
  `unlock_controls` 在行 136（`act92`）——行号与报告 §4「:105…:120…:136」完全一致，该事件
  也把 `cond4=not char_defeated player` 放在触发条件而非收尾守卫里，结构与首战相同
  （锁输入 → 战斗 → 长段收尾 → 解锁），是合理的下一步真跑候选，报告未夸大也未虚构行号。
- `Evolution all` / `Teleport Faint` 均确认存在于 `spyder.yaml`（第 93、230 行），是全局
  公共事件；报告称「94 个 Teleport Faint、179 个 Evolution all」未逐一复核数量，但样本点
  （Radiotower 行号）经核实可信，且报告明确把其余结论标注为「静态候选，未宣称可见结果一定
  不同」，未做越权断言。**基本成立**（数量未独立复核，但抽查样本可信，报告措辞克制）。

## 6. 门禁复跑（全部独立自跑，非转述 builder 数字）

| 门禁 | 结果 |
| --- | --- |
| `bun run import` ×2 | 两次 exit 0，`git status --porcelain` 均为空 |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | exit 0 |
| `bun run build:wasm` | exit 0 |
| `bun test tests/` | **167 pass / 0 fail / 71051 expect() calls**，35 文件，0 skip |
| `bun tools/verify-g6-locks.ts` | `pages=329, lockCommands=333, unlocked=327, transferred=2, unresolved=0, error=0` |
| `bun tools/verify-g6-determinism.ts` | PASS，`files=4636, bytes=61130652`，sha256 `7e010e985b…` |
| `bun tools/frozen-k1.ts` | `263 maps; 0 permanent input locks; 0 permanent blocking fibers; 0 errors` |
| `bun tools/verify-gb6-mainline.ts` | PASS，`109981 frames / 100 battles`，终态 `bd3616c7…` |
| `bun tools/verify-gb6-failures.ts` | PASS，首败 `3254 frames`，终态 `d321b217…` |
| `bun run web` | exit 0 |
| `bun tools/verify-web-journey.ts` | `WEB JOURNEY PASS`，`console errors: 0`，4 个关键帧像素哈希全部吻合 |
| `data/g6-journey.json` / `data/gb6-mainline-journey.json` | 相对 main 无 diff |
| `bun.lock` / `vendor/` | 相对 main 无 diff |
| fleet 任务号 | diff 中未出现 `task-1975`/`fleet/task-1975` 字样 |

所有数字均与 `findings/GB6-F1.md` 报告一致，未发现夸大或造假。

## 阻断项

无。

## 结论

上游 trace 独立复现逐字节一致，源码交叉核对确认修复条件的时间窗口精确对应「首战剧情持有
锁期间」，变异测试证明新断言有辨识力，受保护产物字节不变，全部门禁自跑通过，§4 审计的
Radiotower 抽查行号属实且报告措辞克制、未做越权断言。

PASS
