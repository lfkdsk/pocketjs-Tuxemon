# Scout S1：Tuxemon 事件与数据模型 → Pocket RPG Kit 映射

任务 fleet 1782 · 分支 `fleet/task-1782` · Tuxemon `9e6258ff`（`/var/tmp/tuxemon-src`）· 组件仓 `5dd48ef`（游戏仓子模块）。
机器可读映射：`findings/scout-S1-mapping.json`。全部脚本与中间产物在 `findings/scout-S1/`（`sh findings/scout-S1/run-all.sh` 一键重算，两遍字节一致）。

## 0. 结论先行

1. **语义差异的核心**：Tuxemon 的每个事件都是「每帧轮询的电平触发守卫进程」——所有条件 AND，成立且未在运行就启动，跑完后若条件仍成立下一帧再启动；多个事件可以同时运行；换图时全部清空（连同 NPC）。Kit 是 RPG Maker 式「页 + 4 种触发 + 同时只有一个阻塞 fiber」。所以映射不是逐条翻译，而是**按守卫的「形状」选触发**：`char_at`(+`char_moved`/`char_facing`) → `playerTouch`；`button_pressed`+`char_facing_tile`/`char_at` → `action`；`talk` 行为 → NPC 事件的 `action` 页；`not char_exists`+`create_npc` → NPC 存在页；纯状态守卫 → `autorun`（有对话/等待/移动/传送）或 `parallel`（纯记账）。
2. **覆盖面**（按使用次数）：动作 T1 45.9% / T2 35.1% / T3 16.5% / T4 2.5%；条件 T1 53.0% / T2 30.2% / T3 13.1% / T4 3.7%（T2 条目里含可立即用 T1 表达的子集，例如 `char_face player,*` 1,153 次）。
3. **变量可以无损映射**：486 个字符串变量，每个最多 10 个取值 → 每个变量一个数字变量 `v.<name>`，值 = 该变量取值表（排序）里的 1 基序号，0 = 未设置。`variable_set k` → `!= 0`，`k:v` → `== code`，`not` 取反。
4. **需要组件仓新增 11 项通用能力才能忠实跑 P1**（T2-1…T2-11：事件区域、复合页条件、朝向条件、对任意事件的移动路线、转向/寻路步、每次进图清零的 `local.` 变量、放置事件与初始朝向、跨事件输入锁、>4 选项、商店、16×32 行走 NPC 精灵），另有 6 项可选（背景音乐钩子、淡入淡出/色调、玩家名、换精灵、变量间运算、虚拟时钟）。全部是「任何 RPG Maker 式游戏都用得上」的能力，没有 Tuxemon 专用项。
5. **主线 = Spyder 战役**（99 张图、205 个对手、281 次 `start_battle`）。战斗卡主线的方式主要是**训练师视线/生成守卫**（`not battle_outcome player,won,X`，169+39 个事件）和**战斗后顺序推进**（变量在 `start_battle` 之后无条件设置）；显式按胜负推进剧情的在 Spyder 里只有 4 处 `is battle_outcome` + 6 处 `battle_last_result` 分支。所以 P1「战斗占位=自动胜利并写回全部战果变量」就能放行整条主线：贪心剧情模拟器在 P1 假设下走到 **99 张里的 97 张**（剩 2 张在一个 8 选项密码谜题后面，玩家能解），击败 199 个对手（含最终 BOSS Beaverbrook），设置 202 个剧情变量。
6. **原型可行**：把 Spyder 开场 4 张图（卧室、商店、楼下、Paper Town）只用 **v1 现有词汇**转成 `rpgkit-project/v1`，组件仓 schema 校验 **0 错误**；再用组件仓自己的 `session` reducer 无头驱动：跳过开场 → 商店剧情 → 回家 → 和妈妈说话 → 进镇 → Dante 剧情 → 从垃圾桶拿到 Rockitten → 与劲敌第一战（占位）→ 通往 Route 1 的出口打开，**11/11 检查在 60/30/20 Hz 都通过且剧情节拍一致**。原型也实锤了 v1 的缺口（见 §10）。

## 1. 数据与方法

| 项 | 数值 | 来源 |
|---|---|---|
| 地图 | 263 `.tmx`；62 `.yaml`（55 张同名 + 7 个无 TMX：`spyder.yaml`/`xero.yaml`/`eclipse.yaml` 三个**剧本（scenario）文件**、`spyder_cathedral.yaml`（`load_yaml` 动态加载）、`battle_menu.yaml` 与 2 个 `test_*`） | `findings/scout-S1/census.json` |
| 事件（按文件计） | **4,578** = TMX `event` 3,686 + TMX `init` 6 + YAML 886 | census.json `files.byKind` |
| 动作 | 98 种 / 13,617 次 | census.json |
| 条件 | **40 种**（64 个 is/not 组合）/ 8,663 次 | census.json |
| 行为 `behav` | `talk` 787 次（138 张图）；`door` 0 次 | census.json |
| 运行时事件（剧本 yaml 合并进每张图后） | 7,508 个事件、18,849 次动作、17,577 次条件；每图 p50 19 / p90 62 / 最多 133 个 | census.json `loaded`，patterns.json |
| 剧本归属 | spyder 99 · xero 80 · eclipse 23 · tobedefined 3 · start_tuxemon 1 · 无 57 | census.json `scenarios` |

与 commander 事实的出入（其余数字全部复核一致）：
- 事件 4,572 → **4,578**：漏了 6 个 TMX `type="init"` 对象（每次进图跑一次的事件）。
- 「64 种条件」实为 **40 种条件类型**，64 是 `is`/`not` 两种运算符的组合数；各条目次数与 commander 列的完全一致。
- 「npc 125」是 125 个**文件**，里面有 **1,145 条 NPC**（很多文件是列表）。
- 「sprites 774 个文件 1.8 MB」是 `gfx/sprites`（战斗用怪物/人物图）；地图上的角色表在 `mods/tuxemon/sprites`：**209 张 PNG（446 KB）**，外加 `sprites_obj` 25 张（静态道具）。
- 没统计到的 `talk` 行为（787 次）是 NPC 对话的主入口，展开后等价于 `is char_facing_char player,<npc>` + `is button_pressed INTERACT` 两个条件和一个前置动作 `char_face <npc>,player`（`tuxemon/event/behaviors/talk.py:44-76`）。

脚本（全部一次性，不进产品代码）：`tuxsrc.ts`（按 `tuxemon/map/loader.py` 读 TMX/YAML、按 `script/parser.py` 拆字符串）、`census.ts`、`shapes.ts`（守卫形状）、`patterns.ts`（设计决策用的各种计数）、`vars.ts`（变量表）、`mainline.ts`（战役可达性）、`sim.ts`（P1 剧情模拟器）、`mapping.ts`（生成映射 JSON 与本报告的表格）、`proto.ts`（原型转换 + schema 校验）、`smoke.ts`（原型无头试玩）。

## 2. Tuxemon 事件语义（读源码的结论）

**来源与合并。** TMX 对象层里 `type="event"` 与 `type="init"` 的对象是事件（`tuxemon/map/loader.py:510-513`）；属性名以 `cond`/`act`/`behav` 开头的分别是条件/动作/行为，**按属性名自然排序**（`natsorted`，`loader.py:657`），所以 `act10 < act20 < act100`，`act1`/`act5` 这种非 10 倍数也合法。坐标是像素 ÷16 取整（`loader.py:644`），宽高同理，事件是一个**矩形区域**。YAML 的 `events:` 是 `名字 → {type, x, y, width, height, conditions, actions, behav, priority, timeout, delay}`（坐标已是格子，宽高默认 1），只收 `type` 为 `event`/`init` 的条目。一张图加载时依次合并：TMX 事件 → 同名 `<map>.yaml` → 地图属性 `scenario` 指向的 `<scenario>.yaml`（`loader.py:127-133`、`221-222`）。所以 `spyder.yaml` 的 28 个事件会复制进 99 张 Spyder 地图（游泳、羁绊、疗养院账单、昏厥传送……）。`load_yaml` 动作在运行时把另一个 yaml 的事件追加进当前地图（只有 `spyder_cathedral`，7 处）。

**触发时机。** 每帧 `EventEngine.update` → `check_conditions`，先 `inits` 再 `events`（`tuxemon/event/eventengine.py:175-201`）；一个事件的全部条件（含行为展开出的条件）**逐个求值后取 AND**（`eventengine.py:247-250`）；**没有任何条件的事件永远不会启动**（`eventengine.py:244-245`）；已在运行的事件不会重入（`eventengine.py:145-146`、`260`）。跑完即从 `running_events` 移除，下一帧若条件仍成立就再次启动——这就是**电平触发**，作者必须在动作末尾把守卫打破（`set_variable`、传送走、转身），否则会循环。`init` 事件启动后从 `inits` 移除（`eventengine.py:156-157`），即**每次进图最多一次**。条件求值时把事件矩形放进 `session.current_condition_box`，`is`/`not` 通过 `result == is_expected` 实现（`tuxemon/event/running.py:306-311`）。

**`interact` 与 `event` 的区别**：这一版本的地图里**没有 `interact` 类型**（对象类型只有 event 3,686 / collision 4,389 / collision-line 104 / init 6，`grep` 0 处 `interact`）。按键交互完全由条件表达：`is button_pressed INTERACT`（418 次，另有 `K_RETURN` 1 次）配合 `is char_facing_tile player`（面前的格子在事件矩形内）或 `is char_at player`（站在矩形内），以及 `talk` 行为。

**空间条件的精确语义。** `char_at`：角色格子落在事件矩形内（`tuxemon/boundary.py:218-224`，宽高 0 的矩形永不命中）。`char_moved`：角色的「下一目标格」变化且当前在矩形内时为真一次（`tuxemon/event/conditions/char_moved.py`），配合 `char_at` 就是「在区域内每走一步触发一次」（野外遇敌就这么写）。`char_facing_tile`：玩家四邻中落在矩形内、且正是玩家朝向的那一格（`char_facing_tile.py`）。`char_facing`：纯朝向比较。

**动作执行。** 一个事件内动作严格顺序执行（`running.py:110-191`）。动作若没覆盖 `update()` 就只活一帧，同一帧里继续下一个动作（非阻塞链）；覆盖了 `update()` 的动作一直阻塞到自己 `stop()`（`tuxemon/event/eventaction.py:218-234`）。阻塞的有：`translated_dialog`/`char_talk`（等对话框关闭）、`translated_dialog_choice`/`choice_*`（等选择）、`wait`、`pathfind`/`pathfind_to_char`/`char_move`（等走到）、`start_battle`/`random_encounter`/`wild_encounter`（等战斗结束）、`screen_transition`、`access_pc`、`rename_player`、`open_journal`……；**`transition_teleport` 不阻塞**：它排队传送并立刻 `stop()`，同一帧里后续动作照常执行（`transition_teleport.py`），`char_face player,<dir>` 在过场中会改写待传送的朝向（`char_face.py`），这就是 884 个事件在传送后紧跟 `char_face player,*` 的原因。

**并发与重置。** 不同事件可以同时运行（`running_events` 是字典，逐个 `step`）。换图时 `MapTransition.change_map` 先清 NPC（只留 `persistence`，数据库里没有任何 NPC 设了它）再 `event_engine.reset`（`tuxemon/map/transition.py:43`、`52`；`tuxemon/npc_manager.py:60`、`150`）。所以 **NPC 与运行中的事件都只活一次到访**，每次进图靠 `not char_exists X → create_npc X` 重新生成。

**阻塞玩家。** `lock_controls` 压一个 `SinkState` 吞掉输入，`unlock_controls` 弹掉；对话框/选择框本身也是压在世界之上的 state，所以 **任何事件里的对话都会冻结玩家**。

## 3. 组件仓现状（映射目标）

- 命令 **15 条**：`text choices switch variable selfSwitch if transfer moveRoute wait gold item se erase exit common`（`vendor/pocket-rpgkit/src/engine/types.ts:67-87`，CHANGELOG「Commands, 15」）；context 里的「17 个 op」把 `variable` 的子操作 `set`/`random` 也算进去了（还有 `add`/`sub`）。
- 触发 4 种：`action`（面前一格或同格，`interpreter.ts:644-654`）、`playerTouch`（进入该格那一帧，`655-661`）、`autorun`、`parallel`；**同时只有一个阻塞 fiber**（`interpreter.ts:640`），`autorun`/`parallel` 跑完后若页仍激活则下一帧重启（`interpreter.ts:21-23`）。
- 页条件：最多 1 个开关（只能要求 ON）+ 1 个自开关 + 1 个变量比较 + 1 个道具（`types.ts:90-95`）；`if` 的条件是 switch(可要求 OFF)/variable/selfSwitch/item(≥n)/gold(≥n) 之一（`types.ts:50-55`）。
- `moveRoute.target` 只有 `"player" | "this"`（`types.ts:80`，`schema.json:358`）；移动步只有上下左右移动/转向/前进/等待/随机转向。
- `text` 每条 1–4 行、每行 ≤52 字符（`schema.json:258`）；`choices` 2–4 个选项、标签 ≤24 字符（`schema.json:271-278`）。
- 事件只占一格（`event.x/y`）；NPC 渲染是每页一张 16×16 静态图（`src/ui/GameView.tsx:398`，玩家行走图同样 16×16，`src/ui/PlayerSprite.tsx:50`），NPC 没有朝向/行走动画的显示。
- 换图重建解释器与角色（`session.ts:192-206`），开关/变量/自开关/道具/金钱跨图保留——**没有「只活一次到访」的状态**（除了 `erase`）。

## 4. 映射设计

### 4.1 按守卫形状选触发（`findings/scout-S1/shapes.json`）

| 形状 | 事件数 | 多格区域事件 / 格数 | 典型守卫 | Kit 映射 |
|---|---:|---|---|---|
| touch:facing | 933 | 119 / 369 | `is char_at player & is char_facing player,up` | `playerTouch` + 朝向条件（T2-3）；多格 → 区域（T2-1） |
| guard | 905 | 4 / 10 | `is variable_set x`、`not music_playing m` | 有对话/等待/移动/传送 → `autorun`，否则 `parallel`；页条件 = 守卫（多子句 → T2-2） |
| talk | 787 | — | 空 / `is battle_outcome …` / `not variable_set …` | 并入该 NPC 事件的 `action` 页 |
| spawn | 732 | — | `not char_exists X [& …]` → `create_npc X` | NPC 存在变量 `local.npc.X`（§4.3） |
| touch:step | 454 | 335 / 6,593 | `is char_at player & is char_moved player` | `playerTouch`（每进一格触发）+ 区域（T2-1）；几乎都是野外遇敌 |
| touch:on | 349 | 183 / 17,311 | `is char_at player & not battle_outcome player,won,X & not char_defeated X`（训练师视线 166 个） | `playerTouch` + 区域 |
| action:facingTile | 338 | 52 / 219 | `is button_pressed INTERACT & is char_facing_tile player` | `action`（面前格在区域内） |
| action:standingOn | 75 | 11 / 26 | `… & is char_at player & is char_facing player,up` | `action`（同格）+ 朝向条件 |
| 其他 | 5 | — | 游泳推入水中 4、调用不存在条件 1 | T3 / T4 |

多格区域共 **704 个事件、24,528 格**；v1 只能一格一事件地展开，所以 T2-1 事件区域是必需项。最大的区域是覆盖整张图的「打卡」事件（如 `spyder_route3` 的 `Track route3`，40×40 = 1,600 格，守卫 `is char_at player & not tracker player,route3` → `add_tracker`），导入器可以把「区域 = 整张图」直接当作进图时的 `parallel` 页，不必用区域。同一格上叠了多个 touch/action 事件的格子有 **2,744 个**：Kit 每次只启动按 id 排序的第一个合格事件，若它的页条件装不下全部子句、子句又放进了 `if`，它会「吃掉」这次触发——原型里就撞上了（`My First Mon` 与 `My First Mon - Not Met` 叠在同一条 9 格区域上）。v1 下的解法是把同格同触发的事件合并成一个事件：先按各自守卫锁存匹配标志，再依次执行所有匹配的主体（与 Tuxemon「本帧所有守卫成立的事件都启动」一致）；有了 T2-2，页条件能装下全部子句，Kit 自身的仲裁就会跳过不成立的页，合并不再需要。

### 4.2 变量模型（`findings/scout-S1/vars.json`）

- 486 个变量；取值个数分布：0 个取值 19（只做存在性检查，或只被动态写入）、1 个 294、2 个 97、3 个 45、4 个 16、5 个 8、6 个 2、8 个 3、10 个 2。取值来源：`set_variable k:v`、`variable_set k:v` 的比较值、`translated_dialog_choice`/`choice_monster`/`choice_npc` 的选项。
- **编码**：`v.<name>` 数字变量；0 = 未设置，k = 排序后取值表里第 k 个（空串 `""` 也是一个合法取值，≠ 0）。写：`set_variable k:v` → `variable v.k set code`；`clear_variable k` → `set 0`。读：`is variable_set k` → `v.k != 0`；`is … k:v` → `== code`；`not … k:v` → `!= code`（未设置时 0 ≠ code，语义正确）；`not … k` → `== 0`；一个 `variable_set` 带多个 `k:v` 是 AND，`not` 作用于多个就成了 OR（只有极少数，拆页处理）。取值表在整个导入里全局固定，存档里存的就是这些数字。
- 引擎自己写的变量要在占位里补上：`battle_last_result`（won/lost/draw）、`battle_last_winner`、`battle_last_trainer`（`tuxemon/combat/utils.py:223-291`）；`add_monster` 会写同名变量 `add_monster`=怪物实例 id（只给 `set_monster_attribute add_monster,…` 用，T3）。
- 数值型变量 9 个（点数、疗养院账单、`luckgiveegg`）：`random_integer`/`variable_math`/`format_variable` 写、`variable_is` 读 → 直接存数值（不走枚举），运算需要 T2-16。
- 动态取值 17 个（`get_player_monster`、`choice_monster`、`set_random_variable` 写入怪物/物品名）：T3 为主。
- 只读不写 14 个（如 `badge`：`taba_town` 的草丛遇敌要求 `is variable_set badge:yes`，全库没人设置 → 那些遇敌永不触发，上游如此）。

### 4.3 动态 NPC

Tuxemon 的 NPC 是「按 slug 存在于本次到访」的实体：生成事件每帧检查守卫（`not char_exists X` + 其他条件）并 `create_npc X,x,y[,wander|stand]`；`remove_npc X` 删除；若删除后生成守卫仍成立，下一帧就在出生点重新生成；换图全部清空。映射：

- 每个（地图 × slug）一个 Kit 事件 `npc_<slug>`，位置 = 第一个 `create_npc` 的坐标。页 0：无条件、无精灵、无命令（「不在场」）；页 1：条件 `local.npc.<slug> == 1`，精灵 = 该 NPC 的行走图，`blocks: true`，`moveType` 由 `wander`（707）/`stand`（88）/`char_wander` 决定，触发 `action`，命令 = 该 NPC 所有 `talk` 事件（先锁存各自守卫的匹配标志，再按原顺序执行匹配的主体）。
- 生成事件变成一个 `parallel` 页：条件 `local.npc.<slug> == 0`，命令 `if <其余守卫> { local.npc.<slug> = 1 }`。
- `create_npc X`（包括过场里的）→ `local.npc.X = 1`；`remove_npc X` → `= 0`；`is/not char_exists X` → `!= 0 / == 0`。于是「删掉后守卫仍成立就重生」的上游语义原样保留（原型里实际跑通）。
- 需要的 T2：`local.` 前缀的变量**每次进图清零**（T2-6，否则上次到访留下的 NPC 会一直在场）；在非第一个位置生成（29 个 地图×slug 组合）与 `char_position` 需要 `place`（T2-7）；生成后立刻 `char_face X,dir` 的初始朝向需要页 `dir`（T2-7；v1 原型用只含一个转向步的巡逻路线凑合）。
- `talk` 行为自带「NPC 转向玩家」（`char_face npc,player`），需要 `turnTowardPlayer` 移动步（T2-5）。
- 1,109 个被地图生成的 slug 里有 4 个不在数据库（`37707_male`、`cfanatic1`、`cfanatic2`、`azure_enforcer1`，上游坏数据，T4）。

### 4.4 寻路

`pathfind X,x,y`（336：NPC 278、玩家 58）与 `pathfind_to_char <target>,<mover>[,side][,distance]`（201：目标全是玩家、移动者全是 NPC，20 个指定了从哪一侧靠近）用 A*（曼哈顿）在碰撞图上寻路，被挡住就原地等待并重算（`tuxemon/movement.py:158-212`、`tuxemon/entity/path/controller.py`），动作阻塞到走完。玩家与 NPC 的位置在运行时才确定，不能在导入期预算路径，所以需要 **T2-5**：移动步 `{pathTo:{x,y}}` 与 `{approach:{target, side?, distance?}}`，在该步开始时用确定性的 4 邻 BFS（固定邻居顺序、通行表 + 角色身体）展开成普通移动步，被挡住时等待/重算；配合 **T2-4** 让路线能挂到任意事件上。`char_move X,up 3,left 2`（77）本身就是固定步序列，玩家/本事件可直接 T1。

### 4.5 锁控制

Kit 里阻塞 fiber（autorun/action/playerTouch）运行期间玩家本来就被冻结，所以事件内部成对的 `lock_controls … unlock_controls`（301 个事件）直接丢掉即可（T1）。但有 21 个事件只锁不解、27 个只解不锁——锁跨越了多个事件（例如过场 A 锁住、设置变量，过场 B 接手后才解锁）；Kit 在两个 autorun 之间会有一个参考帧放开移动，所以要 **T2-8 输入锁**（`{op:"lock", value}`，置位期间 mover 忽略方向键）。`char_stop player`（88）同理丢掉。

### 4.6 每帧检查的空间条件 → 触发

`char_at`/`char_facing`/`char_moved`/`button_pressed`/`char_facing_tile`/`char_facing_char` 不进页条件，而是决定触发类型（§4.1）；其余条件进页条件或 `if`。两处语义细节：
- **朝向**：Tuxemon 的门/出口是「站在格上且朝向某方向」的电平条件，侧着走进出口垫不会触发、站在上面转身才会；v1 的 `playerTouch` 只看进入、也没有朝向条件 → 原型里驱动器侧向穿过楼下的出口垫时直接出了门（§10）。T2-3 的建议语义：页条件可含 `{kind:"facing", dir}`，且站在区域内**转身**也视为一次触发机会。
- **`char_moved`**：Kit 的 `playerTouch` 正是「进入格子那一帧」，有了区域（T2-1）后区域内每走一步都算一次进入，与 Tuxemon 一致。

### 4.7 复合守卫与 v1 下的降级

965 个事件有 ≥2 个非触发子句（最多 13 个，另有两个测试事件 124/500 个）。T2-2 `condition.all: Condition[]` 最干净。v1 的降级办法（原型已实现并跑通）：
- `action`/`playerTouch`/`parallel` 页：放得下的一个变量/一个开关(ON)/一个道具进页条件，其余包成嵌套 `if`（触发本身是边沿，语义精确）。
- `autorun` 页：不能用 `if` 包（守卫不成立的 autorun 会每帧空转并挡住其它触发），改用「派生开关」：一个 `parallel` 求值事件每轮把 `c.<map>.<id>` 置为守卫的 AND，autorun 的页条件就是这个开关；因为求值事件每两帧才跑一次，autorun 开头先清掉开关再用 `if` 复核一遍守卫，避免滞后导致同一事件重跑（原型第一版就踩到了这个坑，已修）。

### 4.8 传送

`transition_teleport` 全部移动玩家（1,049/1,049），目标图全部存在（0 缺失），14 个是同图传送。映射为终结命令 `transfer {map, x, y, dir, fade: trans_time}`：之后紧跟的 `char_face player,<dir>`（884 处）折叠成 `dir`；之后的瞬时动作（`set_variable`、`remove_npc`、`add_item`…）提前到 `transfer` 之前（上游它们本来就在同一帧执行）；`rgb` 忽略。

### 4.9 文本

`translated_dialog <msgid>` → 查 `l18n/en_US/LC_MESSAGES/base.po`（5,370 条），Tuxemon 默认分页器**按 `\n` 分页**（每段一个对话框页，`tuxemon/ui/text_paginator.py:48-50`），再在框内自动换行。映射：每页按 52 列断词换行、每 4 行切一条 `text`。2,068 次使用、1,626 个不同 key（5 个在 en_US 缺失）、共 3,115 页，页长 p50 59 / p90 109 / p99 138 / 最长 184 字符，**没有一页需要超过一个 52×4 的框**。占位符：`${{name}}`（53 条 msgstr）→ 玩家名（T2-14，P1 固定为 mod.yaml 的 `npc_red` = "Red"）；`${{currency}}`→`$`；`${{map_name}}`/`${{north}}`… 在导入期按地图属性折叠；`${{var:x}}`（7 条）要运行时插值（T2）。多语言：14 个语言目录（zh_CN 2,099 条，缺得多），建议导入器按语言各出一份 project（Kit 不用改），P1 只出 en_US。上游 `base.po` 有 1 条坏条目（`spyder_omnichannel_dempsey1` 少了结尾引号），解析器需要容错。`translated_dialog` 的第 2–5 个参数是头像/位置/对齐/样式（255 处），纯排版，忽略。

## 5. 分级映射总表

以下两张表由 `findings/scout-S1/mapping.ts` 从 census 计数与分级表生成（机器可读版本即 `scout-S1-mapping.json`），按使用次数排序。级别列里括号是依赖的 T2 能力编号。

#### 动作（98 种，13,617 次）

| # | 动作 | 次数 | 地图数 | 级别 | Kit 目标 | P1 做法 / 备注 |
|---|---|---:|---:|---|---|---|
| 1 | `translated_dialog` | 2068 | 176 | T1 | text | msgstr from l18n/en_US base.po; pages split at \n (Tuxemon paginator), word-wrapped to 52 cols, <=4 lines per text command；args 2-5 (avatar/position/alignment/style) are layout -> ignored; ${{name}} -> player name (T2-14), ${{currency}}/${{map_name}}/${{north..}} folded at import; 5 keys missing from en_US |
| 2 | `char_face` | 2027 | 236 | T2 (T2-4,T2-5) | moveRoute {target, steps:[faceX]} ; T2-4 target any event ; T2-5 turnToward | player/self: moveRoute face (T1); other NPCs need T2-4; toward a character needs T2-5；拆分 {"player":1153,"npc":874,"towardCharacterOrPlayer":180} |
| 3 | `create_npc` | 1503 | 177 | T2 (T2-6,T2-7,T2-11) | NPC event (one per map x slug) + variable local.npc.<slug>=1 | importer fuses spawn guard + talk events into one kit event per NPC; presence is a per-visit variable；4th arg wander(707)/stand(88) -> page moveType; 29 map x slug pairs spawn at several positions (T2-7 place); 4 slugs missing from db/npc; drawing the NPC (16x32 walker, facing, walk pose) is T2-11 |
| 4 | `transition_teleport` | 1049 | 253 | T1 | transfer {map, x, y, dir, fade} | always the player; trailing char_face player,<dir> (884) becomes dir; trailing instants are hoisted before the terminal transfer; rgb ignored；0 of 1049 name a missing map; 14 same-map |
| 5 | `add_monster` | 792 | 84 | T3 | party (P2) | player gift: variable sys.party_size += 1 and switch mon.<slug>; NPC team setup (3rd arg = npc slug) dropped；拆分 {"toPlayer":75,"toNpc":717} |
| 6 | `char_talk` | 772 | 60 | T1 | text | text of the NPC's db/npc speech.profile.default.<field> msgid (pre_battle 301, post_battle_lose 471)；no profile field is a list, so Tuxemon's random line pick never matters |
| 7 | `set_variable` | 715 | 118 | T1 | variable {id: v.<name>, set: {op:set, value: enumCode}} | string value -> enum code (1-based index in the variable's sorted value table; 0 = unset) |
| 8 | `random_encounter` | 476 | 56 | T3 | wild encounter (P2) | no-op (a placeholder on every grass step would be noise) |
| 9 | `wait` | 441 | 54 | T1 | wait {seconds} | direct |
| 10 | `pathfind` | 336 | 61 | T2 (T2-4,T2-5) | moveRoute {target, steps:[{pathTo:{x,y}}]} (T2-5) | dropped in the v1 prototype; needs runtime BFS；拆分 {"npc":278,"player":58} |
| 11 | `start_battle` | 331 | 78 | T3 | battle (P2) | inline placeholder: text '[BATTLE] <name>' then writes bo.<opp>.won, defeated.<opp>, boc.<opp>.won+1, v.battle_last_result/winner/trainer; skipped when sys.party_size < 1 (Tuxemon skips illegal battles) |
| 12 | `unlock_controls` | 330 | 92 | T1 (T2-8) | (none) | no-op: a blocking page already freezes the player；27 events unlock a lock taken by another event -> T2-8 input lock for exactness |
| 13 | `lock_controls` | 323 | 93 | T1 (T2-8) | (none) | no-op inside blocking pages；21 events lock without unlocking |
| 14 | `play_map_animation` | 276 | 24 | T4 | - | dropped (grass rustle / door puffs) |
| 15 | `remove_npc` | 224 | 61 | T2 (T2-6) | variable local.npc.<slug> = 0 | presence variable; the spawn guard re-spawns it if it still holds (Tuxemon semantics) |
| 16 | `pathfind_to_char` | 201 | 50 | T2 (T2-4,T2-5) | moveRoute {target, steps:[{approach:{target:'player', side?, distance?}}]} (T2-5) | dropped in v1; all 201 move an NPC to the player |
| 17 | `play_music` | 200 | 197 | T2 (T2-12) | bgm hook (T2-12); map.bgm for the `not music_playing X -> play_music X` idiom | silent |
| 18 | `set_environment` | 174 | 119 | T3 | battle backdrop (P2) | dropped; the `not environment_is X` guard idiom goes with it |
| 19 | `translated_dialog_choice` | 149 | 60 | T1 (T2-9) | choices {prompt:'', options:[{text, commands:[variable v.<var> = code]}]} | labels from .po; escape leaves the variable unset (Tuxemon re-asks)；拆分 {"upTo4Options":139,"moreThan4":10}；10 uses have 5 or 8 options, 2 labels exceed 24 chars -> T2-9 |
| 20 | `add_item` | 118 | 37 | T1 | item {item, set: add\|sub, count} | negative quantity -> sub; NPC bag (1 use) dropped (T3); item slug read from a variable (elianeoutput, 7 uses) needs a lookup table (T2-16)；51 distinct slugs; p_monsters_eyes (4 uses) is in no item db file (broken upstream data); kit items need name (<=24 chars) + sprite |
| 21 | `char_stop` | 88 | 51 | T1 | (none) | no-op (always the player; the mover is frozen during the page) |
| 22 | `set_monster_health` | 83 | 41 | T3 | heal (P2) | no-op |
| 23 | `set_monster_status` | 83 | 41 | T3 | heal (P2) | no-op |
| 24 | `set_layer` | 79 | 28 | T2 (T2-13) | screen tint / overlay image (T2-13) | dropped (night tint, torchlight) |
| 25 | `char_move` | 77 | 10 | T2 (T2-4) | moveRoute {steps: moveX...} | player/self: T1 moveRoute; other NPCs need T2-4；拆分 {"player":12,"npc":65} |
| 26 | `play_sound` | 67 | 28 | T1 | se {name} | cue (host may ignore in P1) |
| 27 | `random_monster` | 39 | 4 | T3 | party (P2) | to the player (15 of 39): sys.party_size += 1; NPC teams dropped |
| 28 | `clear_variable` | 36 | 13 | T1 | variable set 0 | direct |
| 29 | `char_wander` | 33 | 16 | T1 | page moveType: random | bounds (5 uses) need a T2 wander region; frequency ignored |
| 30 | `set_monster_attribute` | 33 | 9 | T3 | - | dropped |
| 31 | `set_teleport_faint` | 29 | 24 | T3 | faint respawn point (P2) | dropped (the player cannot faint in P1) |
| 32 | `open_shop` | 28 | 10 | T2 (T2-10) | shop {goods:[{item, price}]} (T2-10) | items/prices from db/economy; monster/training/heal menus are T3 |
| 33 | `screen_transition` | 25 | 16 | T2 (T2-13) | fade out/in (T2-13) | lowered to wait 2*t (same timing, no visual) |
| 34 | `add_tracker` | 24 | 22 | T1 | switch tracker.<map> = on | direct |
| 35 | `set_template` | 24 | 11 | T2 (T2-15) | change sprite (T2-15) | dropped (swimmer/invisible player sprites) |
| 36 | `wild_encounter` | 20 | 7 | T3 | scripted wild battle (P2) | same placeholder as start_battle, opponent 'wild:<slug>' |
| 37 | `char_speed` | 19 | 8 | T2 | move speed | ignored；MV Change Speed; cosmetic in P1 |
| 38 | `modify_money` | 19 | 7 | T1 (T2-16) | gold {set: add\|sub, amount} | literal amount (18); from a variable (1) is T2-16 |
| 39 | `get_player_monster` | 17 | 10 | T3 | - | dropped |
| 40 | `set_bubble` | 16 | 4 | T4 | (balloon icon) | dropped；MV Show Balloon; could become T2 later |
| 41 | `set_economy` | 16 | 10 | T2 (T2-10) | shop goods binding (T2-10) | importer resolves economy slug -> goods list for the NPC's shop command |
| 42 | `change_bg` | 15 | 6 | T4 | - | dropped (full-screen narration backdrop) |
| 43 | `open_journal` | 14 | 4 | T3 | - | dropped (monster journal page) |
| 44 | `char_plague` | 13 | 4 | T3 | - | dropped |
| 45 | `add_tech` | 12 | 1 | T3 | - | dropped |
| 46 | `teleport_faint` | 11 | 9 | T3 | - | dropped |
| 47 | `access_pc` | 10 | 10 | T3 | - | dropped (PC storage); a text stub is fine |
| 48 | `format_variable` | 10 | 3 | T3 | - | dropped (cathedral bill floats) |
| 49 | `get_party_monster` | 9 | 4 | T3 | - | dropped |
| 50 | `park_experience` | 8 | 4 | T3 | - | dropped |
| 51 | `quarantine` | 8 | 4 | T3 | - | dropped |
| 52 | `start_double_battle` | 8 | 2 | T3 | battle (P2) | battle placeholder |
| 53 | `trading` | 8 | 4 | T3 | - | dropped |
| 54 | `change_bg_monster` | 7 | 2 | T4 | - | dropped |
| 55 | `load_yaml` | 7 | 7 | T1 | (import-time merge) | importer appends spyder_cathedral.yaml's events to the 7 maps, gated by a local flag the action sets |
| 56 | `autosave` | 6 | 6 | T4 | - | dropped (the kit has its own save menu) |
| 57 | `camera_position` | 6 | 3 | T4 | - | dropped (cutscene camera; MV Scroll Map later) |
| 58 | `set_mission` | 6 | 3 | T3 | - | dropped |
| 59 | `set_tuxepedia` | 6 | 1 | T3 | - | dropped |
| 60 | `remove_collision` | 5 | 5 | T1 | blocking events | importer turns a labelled collision zone into invisible blocks:true events whose page ends when the action's switch is set |
| 61 | `remove_monster` | 5 | 5 | T3 | - | player: sys.party_size -= 1 |
| 62 | `remove_step_tracker` | 5 | 4 | T3 | - | dropped |
| 63 | `rename_player` | 5 | 4 | T2 (T2-14) | name input (T2-14) | fixed name 'Red' |
| 64 | `variable_math` | 5 | 2 | T2 (T2-16) | variable arithmetic with a variable operand (T2-16) | dropped (cathedral bill, dojo points) |
| 65 | `change_bg_char` | 4 | 3 | T4 | - | dropped |
| 66 | `add_step_tracker` | 3 | 2 | T3 | - | dropped |
| 67 | `dojo_method` | 3 | 1 | T3 | - | dropped |
| 68 | `modify_bill` | 3 | 1 | T3 | - | dropped |
| 69 | `quit_world` | 3 | 1 | T4 | - | dropped (battle_menu test yaml) |
| 70 | `set_char_attribute` | 3 | 1 | T4 | variable | player gender from the start menu -> a variable if text ever needs it |
| 71 | `set_monster_level` | 3 | 3 | T3 | - | dropped |
| 72 | `set_step_tracker_milestone_shown` | 3 | 3 | T3 | - | dropped |
| 73 | `update_time` | 3 | 3 | T4 | - | dropped |
| 74 | `change_taste` | 2 | 1 | T3 | - | dropped |
| 75 | `char_run` | 2 | 2 | T2 | move speed | ignored |
| 76 | `choice_monster` | 2 | 2 | T3 (T2-9) | choices | lowered to a plain choices box (5 options -> T2-9) |
| 77 | `copy_variable` | 2 | 1 | T2 (T2-16) | variable copy (T2-16) | dropped |
| 78 | `daycare` | 2 | 2 | T3 | - | dropped |
| 79 | `evolution` | 2 | 2 | T3 | - | dropped |
| 80 | `get_pending_moves` | 2 | 2 | T3 | - | dropped |
| 81 | `remove_tech` | 2 | 2 | T3 | - | dropped |
| 82 | `rename_monster` | 2 | 2 | T3 | - | dropped |
| 83 | `set_bill` | 2 | 1 | T3 | - | dropped |
| 84 | `set_facing_mode` | 2 | 1 | T4 | - | dropped (MV Direction Fix) |
| 85 | `set_kennel_visible` | 2 | 1 | T3 | - | dropped |
| 86 | `set_party_status` | 2 | 2 | T3 | - | dropped |
| 87 | `tune_radio` | 2 | 2 | T4 | - | dropped |
| 88 | `update_tile_properties` | 2 | 1 | T3 | - | dropped (surfing) |
| 89 | `char_position` | 1 | 1 | T2 (T2-7) | place {target, x, y} (T2-7) | dropped |
| 90 | `choice_npc` | 1 | 1 | T4 | choices | start-menu appearance pick (6 options): fixed default |
| 91 | `create_kennel` | 1 | 1 | T3 | - | dropped |
| 92 | `fadeout_music` | 1 | 1 | T2 (T2-12) | bgm hook (T2-12) | silent |
| 93 | `info` | 1 | 1 | T4 | - | dropped |
| 94 | `modify_monster_bond` | 1 | 1 | T3 | - | dropped |
| 95 | `not` | 1 | 1 | T4 | - | dropped: authoring bug (a condition string in an act slot, one event) |
| 96 | `play_tile_animation` | 1 | 1 | T4 | - | dropped |
| 97 | `random_integer` | 1 | 1 | T1 | variable {set: {op: random, min, max}} | numeric variable (read by variable_is) |
| 98 | `set_random_variable` | 1 | 1 | T1 | variable random -> enum code | uniform pick; weights (a=3:b) would need T2；1 use |

#### 条件（40 种 / 64 个 is·not 组合，8,663 次）

| # | 条件 | 次数 | is | not | 地图数 | 级别 | Kit 目标 | P1 做法 / 备注 |
|---|---|---:|---:|---:|---:|---|---|---|
| 1 | `char_at` | 1811 | 1811 | 0 | 253 | T1 (T2-1) | trigger playerTouch (with char_moved: every step) / action (with button_pressed) on the event cell; multi-cell -> T2-1 area | 704 events are multi-cell (24,528 cells) -> T2-1 |
| 2 | `char_exists` | 1409 | 9 | 1400 | 172 | T2 (T2-6) | variable local.npc.<slug> (0/1) | per-visit bank T2-6 |
| 3 | `variable_set` | 1401 | 730 | 671 | 129 | T1 (T2-2) | page condition / if: variable v.<name> ==\|!= enumCode (bare name: != 0) | `not` over several name:value pairs is an OR (rare) -> split pages |
| 4 | `char_facing` | 1008 | 1008 | 0 | 238 | T2 (T2-3) | Condition {kind:'facing', dir} + touch re-fires on a turn (T2-3) | v1 cannot test facing: exit mats fire when crossed sideways (seen in the smoke run) |
| 5 | `battle_outcome` | 593 | 230 | 363 | 68 | T3 | switch bo.<opp>.won | written by the battle placeholder; lost/draw never true in P1 |
| 6 | `char_moved` | 454 | 454 | 0 | 36 | T1 | trigger playerTouch (fires on entering each cell) | with areas (T2-1) every step inside the area fires, as in Tuxemon |
| 7 | `button_pressed` | 419 | 419 | 0 | 119 | T1 | trigger action | INTERACT 418, K_RETURN 1 |
| 8 | `char_facing_tile` | 344 | 344 | 0 | 101 | T1 | trigger action on the event cell(s) (front tile in the area) | the `value` form (surfable, 5) is T3 |
| 9 | `environment_is` | 200 | 28 | 172 | 120 | T3 | - | constant false (env setters dropped) |
| 10 | `music_playing` | 197 | 1 | 196 | 196 | T4 | - | constant false; the guarded play_music becomes map.bgm (T2-12) |
| 11 | `char_defeated` | 191 | 10 | 181 | 53 | T3 | switch defeated.<npc>; player never defeated in P1 | constant false for the player |
| 12 | `time_is` | 128 | 67 | 61 | 56 | T2 (T2-17) | virtual clock (T2-17) or fixed daytime | fixed daytime (stage_of_day=morning, daytime=true, dates false) |
| 13 | `has_item` | 111 | 53 | 58 | 14 | T1 | page condition item / if item count>=n (NOT via else) | direct; less_than/equals quantity forms need if-chains |
| 14 | `current_state` | 78 | 78 | 0 | 21 | T4 | - | WorldState -> true, any other engine state -> false |
| 15 | `char_sprite` | 66 | 37 | 29 | 32 | T2 (T2-15) | sprite state (T2-15) | constant: default sprite |
| 16 | `party_size` | 55 | 50 | 5 | 18 | T3 | variable sys.party_size | kept by add_monster/remove_monster placeholders; NPC party -> true |
| 17 | `check_char_parameter` | 41 | 40 | 1 | 26 | T4 | - | constant false (moving flag / cheat names) |
| 18 | `has_monster` | 35 | 24 | 11 | 7 | T3 | switch mon.<slug> | set by add_monster placeholder |
| 19 | `money_is` | 24 | 15 | 9 | 5 | T1 | Condition gold >= n | greater_or_equal (and greater_than n+1) direct; other ops/variable amounts T2-16 |
| 20 | `tracker` | 22 | 0 | 22 | 21 | T1 | switch tracker.<map> | direct |
| 21 | `check_party_parameter` | 14 | 8 | 6 | 1 | T3 | - | constant false |
| 22 | `battle_outcome_count` | 11 | 2 | 9 | 3 | T3 | variable boc.<opp>.won | counted by the placeholder |
| 23 | `char_in` | 7 | 1 | 6 | 1 | T3 | - | constant false (surf zones) |
| 24 | `step_tracker` | 7 | 7 | 0 | 4 | T3 | - | constant false |
| 25 | `tile_property_updated` | 6 | 4 | 2 | 1 | T3 | - | constant false (surfing) |
| 26 | `check_world` | 3 | 2 | 1 | 1 | T4 | - | constant false (overlay state) |
| 27 | `kennel` | 3 | 2 | 1 | 1 | T3 | - | constant false |
| 28 | `location_inside` | 3 | 1 | 2 | 1 | T1 | (import-time constant) | map property `inside` folded at import |
| 29 | `party_infected` | 3 | 3 | 0 | 1 | T3 | - | none -> true, some/all -> false (no plague in P1); keeps Candy Town's story moving |
| 30 | `bill_is` | 2 | 2 | 0 | 1 | T3 | - | constant false |
| 31 | `char_gender` | 2 | 1 | 1 | 1 | T4 | - | constant (fixed start-menu pick) |
| 32 | `char_healed` | 2 | 1 | 1 | 1 | T3 | - | constant false |
| 33 | `check_evolution` | 2 | 2 | 0 | 2 | T3 | - | constant false |
| 34 | `check_max_tech` | 2 | 2 | 0 | 2 | T3 | - | constant false |
| 35 | `has_kennel` | 2 | 2 | 0 | 1 | T3 | - | kennel count 0 |
| 36 | `has_tuxepedia` | 2 | 1 | 1 | 1 | T3 | - | constant false |
| 37 | `location_type` | 2 | 1 | 1 | 1 | T1 | (import-time constant) | map property `map_type` folded at import |
| 38 | `bill_exists` | 1 | 0 | 1 | 1 | T3 | - | constant false |
| 39 | `cooldown_days` | 1 | 1 | 0 | 1 | T2 (T2-17) | clock (T2-17) | constant true |
| 40 | `player_facing_tile` | 1 | 1 | 0 | 1 | T4 | - | dead: no such condition in tuxemon/event/conditions (the one event never fires upstream either) |

#### 行为（behav）

| 行为 | 次数 | 地图数 | 级别 | Kit 目标 | 备注 |
|---|---:|---:|---|---|---|
| `talk` | 787 | 138 | T1 | the NPC event's action page (match flags per talk event, then bodies) | expands upstream to `is char_facing_char player,<npc>` + `is button_pressed INTERACT` + prepended `char_face <npc>,player` (turn toward player needs T2-5) |

#### T2 能力清单

| id | 能力 | schema / 参数 | 语义 | 用量 |
|---|---|---|---|---|
| T2-1 | event areas | event.w?, event.h? (default 1) | action fires when the faced tile or the player's own tile is inside the rect; playerTouch fires on every entry into a cell of the rect | 704 multi-cell events, 24,528 cells |
| T2-2 | compound page conditions | condition.all?: Condition[] (AND; the `if` Condition union incl. switch value:false) | page active only when every clause holds; lets the kit's trigger arbitration skip pages whose guard fails | 965 events carry >= 2 non-trigger clauses |
| T2-3 | facing condition | Condition {kind:'facing', dir} | player facing test in `all`/`if`; a playerTouch page whose condition reads facing re-fires when the player turns while standing in it | 1008 `is char_facing player,<dir>` |
| T2-4 | move routes on any event | moveRoute.target: 'player' \| 'this' \| {event: id} | MV Set Movement Route on another event; wait:true parks the caller until that route lands | 874 char_face on NPCs, 65 char_move, 278 pathfind, 201 pathfind_to_char |
| T2-5 | turn-toward and pathfinding steps | MoveStep += 'turnTowardPlayer' \| {turnToward: id} \| {pathTo:{x,y}} \| {approach:{target, side?, distance?}} | expanded when the step starts: deterministic 4-way BFS over the passage table + bodies (fixed neighbour order), re-planned when blocked | 336 pathfind, 201 pathfind_to_char, 180 face-toward, 787 talk auto-turn |
| T2-6 | per-visit (local) variables | ids with prefix `local.` are cleared on every map entry | Tuxemon NPCs and running events live for one map visit | 1503 create_npc, 224 remove_npc, 1409 char_exists |
| T2-7 | place event / initial facing | {op:'place', target, x, y, dir?}; page.dir? | MV Set Event Location; the facing an NPC shows on spawn | 29 map x slug spawn positions, char_position 1, char_face right after create_npc |
| T2-8 | input lock across events | {op:'lock', value} | while set the mover ignores the d-pad even between blocking pages | 21 lock-only + 27 unlock-only events |
| T2-9 | longer choices | choices.options up to 8 (scrolling), labels up to 32 chars | same command, bigger box | 10 choices with 5 or 8 options; choice_monster/choice_npc |
| T2-10 | shop | {op:'shop', goods:[{item, price}], sell?}; item.price? | MV Shop Processing over gold + items | 28 open_shop, 16 set_economy (4 economies) |
| T2-11 | walker NPC sprites | spriteDef walker with 16x32 frames (anchor = bottom tile), NPC facing + walk pose in the UI | Tuxemon sheet 48x128: rows down,left,right,up; cols walk1,idle,walk2 | 1145 NPC rows, 184 sheets (+ static props) |
| T2-12 | bgm hook | {op:'bgm', name, fadeMs?}; map.bgm? | cue for the host; silent in P1 | 200 play_music (196 guarded by `not music_playing`), 1 fadeout_music |
| T2-13 | screen fade / tint | {op:'fade', dir:'out'\|'in', seconds}; {op:'tint', rgba\|image} | MV Fadeout/Fadein/Tint Screen | 25 screen_transition, 79 set_layer |
| T2-14 | player name | text placeholder {name}; optional {op:'nameInput'} | display-time substitution | 53 msgstr carrying ${{name}}, 5 rename_player |
| T2-15 | change sprite | {op:'sprite', target, sprite} | MV Change Actor Graphic / event image | 24 set_template, 66 char_sprite |
| T2-16 | variable operands | variable set {op:'copy'\|'add'\|'sub'\|'mul', from: id} | arithmetic with another variable | 5 variable_math, 2 copy_variable, 1 modify_money from var |
| T2-17 | virtual clock (optional) | sys.time variables advanced by the session | day/night stage for time_is; P1 can pin daytime instead | 128 time_is, 1 cooldown_days |

## 6. T2：建议组件仓新增的通用能力（优先级）

上表 T2-1…T2-17 全部是 RPG Maker 式通用能力（MV/MZ 里多有原生对应：Set Movement Route 任意事件、Turn toward Player、Set Event Location、Shop Processing、Name Input、Fadeout/Tint Screen、Change Actor Graphic、Control Variables 的变量操作数），没有 Tuxemon 专用项。加的都是**可选字段/新命令**，现有 v1 文档保持有效，可以像 2026-09-27 那次一样做 v1 修订而不必升 v2。

- **P1 必需（没有就不忠实或跑不通）**：T2-1 区域、T2-2 复合页条件、T2-3 朝向、T2-4 路线挂任意事件、T2-5 转向/寻路步、T2-6 `local.` 每次进图清零、T2-7 放置与初始朝向、T2-8 输入锁、T2-9 >4 选项（开场选剧本/外观、医院密码谜题、船夫目的地都要）、T2-10 商店（P1 要求「商店生效」）、T2-11 16×32 行走 NPC 精灵（与 S2 渲染架构一起定）。
- **P1 可缓**：T2-12 背景音乐钩子（P1 不搬音乐，映射成 `map.bgm` 元数据即可）、T2-13 淡入淡出/色调（v1 先用 `wait 2t` 保持节奏）、T2-14 玩家名（P1 固定 "Red"）、T2-15 换精灵（游泳/隐身，属 T3 玩法居多）、T2-16 变量间运算（疗养院账单、道场积分）、T2-17 虚拟时钟（P1 固定白天）。
- 性能提醒：T2-1 区域会把「每帧扫描事件」从点比较变成矩形比较，T2-5 的 BFS 在 100×100 图上最多 1 万格；两者都要按硬规矩在 QuickJS 宿主上量每帧耗时（本 Scout 没有量 QuickJS，只在 Bun 里跑了原型）。

## 7. T3 与 P1 战斗占位

**占位规格（原型已实现并跑通，`findings/scout-S1/proto.ts` 的 `battle()`）**：`start_battle` / `start_double_battle` / 剧情用 `wild_encounter` → 内联命令：
```
if sys.party_size >= 1 {                     # 上游 check_battle_legal：空队伍时整场战斗跳过、事件继续
  text ["[BATTLE] <对手显示名>", "(P1 placeholder: the player wins)"]
  switch bo.<opp>.won = on                   # is/not battle_outcome player,won,<opp>
  switch defeated.<opp> = on                 # is/not char_defeated <opp>（视线触发要用）
  variable boc.<opp>.won += 1                # battle_outcome_count
  variable v.battle_last_result = code(won)  # 6 处剧情分支读它
  variable v.battle_last_winner = code(player)
  variable v.battle_last_trainer = code(<opp>)
}
```
战前/战后的 `char_talk <opp>,pre_battle|post_battle_lose`（301 / 471）照常显示对话。其余 T3 的 P1 处理：`random_encounter`（476）**不做任何事**（每步一个占位框会淹没游戏）；给玩家的 `add_monster`（75）/`random_monster`（15）→ `sys.party_size += 1` 和开关 `mon.<slug>`，`remove_monster`（5）→ `-= 1`（`party_size` 与 `has_monster` 守卫靠它们，例如 Paper Town 北口「没怪物不许出镇」）；给 NPC 的 `add_monster`（717）丢弃；`party_infected …,none` 视为真（没有瘟疫），`some/all` 为假（这样 Candy Town 的剧情走「未感染」分支继续）；`char_defeated player` 恒假；回血、状态、图鉴、道场、交易、孵化、进化、账单等全部空操作；不提供「输」按钮（上游输了走 `spyder.yaml` 的 Teleport Faint 回最近治疗点，P2 再做）。

## 8. NPC / 对话 / 精灵格式与转换

**NPC 数据库** `mods/tuxemon/db/npc/*.yaml`（125 个文件、1,145 条）：字段 `slug`、`template{sprite_name, combat_sheet, slug, is_static_prop?}`、`speech.profile{default{greeting…post_battle_draw}, location_based}`、`combat{forfeit, switch_logic}`、`audio{battle_music}`、`monsters[]`（只有 1 条 NPC 有）、`items[]`、`persistence`（没人用）、`birthdate`。完整模型见 `tuxemon/db.py:1932-2200`。184 张不同的精灵表；67 条是静态道具（`sprites_obj`：箱子、路牌、巨石）；238 条有战斗台词（`pre_battle`/`post_battle_*` 都是 msgid，没有列表值，所以上游的随机挑一句不影响确定性）；`location_based` 没人用。NPC 显示名 = 以 slug 为 msgid 查 `.po`。**转换**：每条 NPC → `project.sprites["npc.<sprite_name>"]`（行走图）+ 名字；台词在导入期展开成 `text`；`combat`/`audio`/`monsters` 留给 P2。

**对话** `l18n/<lang>/LC_MESSAGES/base.po`：标准 gettext，`msgid "key"` / `msgstr "..."`，多行值用相邻字符串拼接；`\n` = 分页。`translated_dialog key` 直接查 msgid；`translated_dialog_choice a:b:c,var` 每个选项也以选项值为 msgid 查标签（`yes`→"Yes"）。转换规则见 §4.9。

**角色精灵表**（已按像素肉眼核对，`/var/tmp/fleet/1782/adventurer_x6.png` 是放大 6 倍的 `adventurer.png`）：`sprites/<name>.png` 208 张是 **48×128 = 3 列 × 4 行、每帧 16×32**；行 = 朝下、朝左、朝右、朝上；列 = 迈左脚、站立、迈右脚（`tuxemon/map/view.py:262-320`，`row_map` 与 `frames[1]` 为站立帧）；行走动画序列是 站立→迈步1→站立→迈步2；比一格高 16 px 的部分向上溢出（`view.py` `_set_sprite_position` 的 `y_offset`）。另有 1 张 16×32 单帧、`sprites_obj` 25 张各种尺寸的静态道具。**转换**：Kit 的行走帧顺序是朝向 0 下、1 左、2 上、3 右，每个朝向 idle/walkL/walkR（`tools/lib/bake.ts` `loadWalker`）→ Tuxemon 行 0/1/3/2，列 1→idle、0→walkL、2→walkR；帧高 32 需要 T2-11（Kit 现在只画 16×16，`src/ui/GameView.tsx:398`、`src/ui/PlayerSprite.tsx:50`）。玩家角色同理（mod.yaml `sprite: adventurer`）。

## 9. 主线

**战役**：开局 `start_tuxemon.tmx`（8×8 空图 + `start_tuxemon.yaml`）让玩家选剧本（`translated_dialog_choice spyder_campaign:xero_campaign:water_campaign`）、外观（`choice_npc` 6 选 1）、代词，再传送到各战役起点。按传送图做可达性（`findings/scout-S1/mainline.json`）：

| 战役 | 起点 | 可达地图 | 战斗（`start_battle`） | 说明 |
|---|---|---:|---:|---|
| **Spyder** | `spyder_bedroom` (4,4) | 99 | 281（205 个对手） | 内容最完整，**定为 P1/P3 主线** |
| Xero | `player_house_bedroom` (4,4) | 75（剧本 80 张） | 11 | 旧 Taba Town 线，战斗很少 |
| Water | `water_end_of_desert` (11,32) | 11 | 1 | 短篇 |

另有 77 张图从任何战役起点都走不到（`classic_*` 28 张、`eclipse_*` 23 张、`37707_*`/`rubberduck_*`/`sphalian_*`/`tt_*` 各 3 张、Xero 剧本里的 5 张孤岛 `azure_town*`/`taba_ba_br_master`/`tabathas`/`witcher_route_7`、测试图等）；P1 仍要导入保证「能进」，但不在主线上。

**Spyder 开场（原型实测的顺序）**：`spyder_bedroom`（`question_intro` 选择是否看开场 → `spyder_intro`）→ `spyder_paper_scoop`（店长开场，`choice_phase` 状态机：`yes`→选劲敌的怪 `myintrochoice`→确认 `areyousure`→`progress`→`intro_scoop:done`）→ `spyder_bedroom` → `spyder_downstairs`（妈妈：`spokenmom`）→ `spyder_paper_town`（Dante 在垃圾桶旁：`dantefirst`/`dantebin`；翻垃圾桶选初始怪：`<mon>chosen` → `mymonchoice`、`firstfightdue:yes`；**与劲敌 Billie 第一战**；赢/输分支读 `battle_last_result`；`firstfightdue:no` 打开北口）→ `spyder_route1` → `spyder_cotton_town` …

**之后的章节顺序**用训练师队伍等级做代理（上游没有显式章节变量；劲敌 Billie 的等级依次是 Paper Town 5 → Route 2 6 → Route 4 18 → Route A 20 → 道场 4 34 → Route 6 40 → Candy 医院 3 45）：Paper Town(5) → Route 2(7) → City Park(8) → Route 3(11) → Wayfarer Inn(12) → Route A(14) → Route 4(16) → 豪宅(20–22)、隧道(21) → Greenwash 温室 / Leather 道馆(24) → Nimrod 塔、Route 5、道场 2(25) → Greenwash、Route C(27–30)、道场 3(30) → 道场 4(34) → Route 6、Candy 医院(35–45) → Omnichannel 各层、数据中心、Route B/E、Scoop 1–4、龙之洞(40–43) → Walled Garden、Dryad's Grove(50) → **广播塔最终战 Beaverbrook(55)**（`kernelquest:yes`、`omnichannelradioannounce:yes`）。关键剧情变量（按出现先后）：`question_intro`、`spyder_intro`、`choice_phase`、`intro_scoop`、`myintrochoice`/`billie_choice`、`dantefirst`、`dantebin`、`<mon>chosen`、`mymonchoice`、`firstfightdue`/`firstfightend`、`spokenmom`、`visitcottonmart`/`momthanked`、`captainreturns`、`seentimber`/`seencandy`（开放船夫 `rivergoto` 目的地）、`confiscation_candy`/`confiscation_done`/`henrik_react`、`incident_greenwash`、`zircon_argon`、`enforcers_response`、`billie_grandma`、`dragonscavedrokoro`、`kernelquest`、`omnichannelradioannounce`；地图打卡用 `add_tracker`/`tracker`。

**战斗怎样卡主线**（Spyder）：
1. **视线/生成守卫**：训练师站在路上，`is char_at player & not battle_outcome player,won,X & not char_defeated X` 的区域（全库 169 个）一踩就走过来开战；生成守卫 `not battle_outcome player,won,X`（39 个）让没赢过的训练师一直在场。**必须赢**才放行；输了会被 Teleport Faint 送回治疗点。
2. **战后顺序推进**：剧情变量写在同一事件 `start_battle` 之后，与胜负无关（例：`First Fight - Start` 末尾 `set_variable firstfightdue:no` 打开 Route 1）。
3. **显式按胜负分支**：`is battle_outcome player,won,X` 被推进剧情的事件读到的只有 4 个对手（`spyder_route3_zoolander` → Dante 的对话、`spyder_walled_midas` → Walled Garden 的 Billie、`spyder_dragonscave_benden`、`spyder_mansion_lucy`），另有 6 个事件按 `battle_last_result` 分支（第一战的赢/输对话等）。

**P1 占位能推进到哪里**：贪心剧情模拟器（`findings/scout-S1/sim.ts`；假设玩家能走到/按到任何事件、战斗自动胜利、无野外遇敌、白天、无瘟疫）在 Spyder 走了 558 步：**访问 99 张里的 97 张**，击败 199 个对手（含最终 BOSS），写入 202 个剧情变量，队伍 11 只（全部来自剧情赠送）；没进去的 2 张（`spyder_candy_hospital2/3`）在一个两级 8 选项密码谜题后面（`passcode_color:blue & passcode_number:10`），模拟器轮询选项没撞上，玩家能解（需要 T2-9）。Xero 75/75、Water 11/11。P1 仍然到不了的只有**依赖真实怪物状态的支线**：指定物种的交易（`has_monster`）、化石复活、Vivi 系形态检查、感染分支的另一半、寄存箱、钱不够的分支。模拟器不模拟地图内的可走性和过场里 NPC 的走位，是「T2 到位之后」的上界；逐章节的实机验证见 Builder G4。

## 10. 原型：Spyder 开场 4 张图

`bun findings/scout-S1/proto.ts`：只用 **v1 现有词汇**（外加 §4 的导入期降级）转换 `spyder_bedroom`、`spyder_paper_scoop`、`spyder_downstairs`、`spyder_paper_town`，输出 `findings/scout-S1/proto-v1.json`（地形用占位：单一可走图块 + Tuxemon 的碰撞矩形；Kit 事件数分别 14 / 32 / 10 / 83）。

- **Schema 校验**：用组件仓 `src/engine/schema-validate.ts` + `src/data/schema.json` 校验写出的 JSON：**0 个错误**。
- **转换去向**（`proto-log.json`，含剧本 yaml 在每张图里的副本）：T1 471、T1 降级 150、T2 丢弃 115、T3 占位 51、T3 丢弃 168、T4 丢弃 195、结构性 17。
- **无头试玩**（`bun findings/scout-S1/smoke.ts`，只按键：确认/下键推进对话与选择，方向键按 BFS 走路）：跳过开场 → 商店剧情（店长 3 段对话、选劲敌的怪、确认两次）→ 回卧室 → 下楼（`playerTouch`）→ 妈妈被生成守卫生成并对话（`local.npc.*` + 匹配标志链）→ 出门到 Paper Town → 走进 9 格区域触发 Dante 剧情 → 对着 Rockitten 垃圾桶按键、选「是」→ 队伍占位 +1 → 劲敌第一战占位 → 赢分支对话 → 走到北口，请求传送到 `spyder_route1`（未转换，按预期报 unknown map）。**11/11 检查通过**，60 / 30 / 20 Hz 下的文本、选择、换图序列完全一致（`smoke-log*.txt`）。连上游的一个小毛病也复现了：商店里「确认」问了两次——上游同一帧里两个事件同时启动（`Confirm Monster` 在 `Confirm Monster Yes` 改掉守卫前就重启了），Kit 的行为与之一致。
- **原型实锤的 v1 缺口**：① 侧向走过楼下 1 格宽的出口垫就出了门——v1 丢了 `char_facing player,down`（T2-3）；② 叠在同一区域上的两个守卫互补的 touch 事件，第一个的 `if` 吃掉了触发（改为合并，T2-2 可免）；③ 派生开关每两帧才更新一次，第一版导致 autorun 重跑一次（改为先清开关再复核）；④ 过场里 NPC 的走位（`pathfind`/`char_face <npc>`）全部丢失，剧情文本和变量照走，但画面上角色不动（T2-4/T2-5）；⑤ 劲敌怪的 5 个选项只能显示 4 个（T2-9）；⑥ NPC 只能画静态 16×16 图（T2-11）。
- 字节稳定：`run-all.sh` 连跑两遍，全部 14 个产物逐字节相同。

## 11. 建议的 Builder 拆分与工作量

组件仓（在 `/var/tmp/oss/pocket-rpgkit` 开 worktree，commander 合并后 bump 子模块）：

| 任务 | 内容 | 依赖 | 量 |
|---|---|---|---|
| **K1 事件模型扩展** | T2-1 区域、T2-2 `condition.all`、T2-3 朝向条件 + 转身重触发、T2-6 `local.` 每次进图清零、T2-7 `place` + 页 `dir`、T2-8 输入锁；`types.ts`/`schema.json`/CHANGELOG（v1 修订）/`interpreter.ts`/`session.ts`/存档校验；测试 + QuickJS 每帧耗时 | — | 大（2–3 天） |
| **K2 移动扩展** | T2-4 路线挂任意事件（wait 语义同现有）、T2-5 `turnTowardPlayer`/`turnToward`/`pathTo`/`approach`（确定性 BFS、被挡等待重算）；多 hz 测试；QuickJS 下 100×100 BFS 耗时 | — | 中（1.5–2 天） |
| **K3 UI** | T2-11 16×32 行走 NPC（朝向 + 步态来自 `CharState`）、T2-9 滚动选项框与更长标签、T2-14 `{name}` 占位符；与 S2 的渲染架构一起定 | S2 结论 | 中（1.5 天） |
| **K4 商店** | T2-10 `shop` 命令 + UI + 道具价格字段 | — | 中（1 天） |
| K5 可选 | T2-12 bgm 钩子 + `map.bgm`、T2-13 淡入淡出/色调、T2-15 换精灵、T2-16 变量操作数、T2-17 时钟 | — | 小–中 |

游戏仓：

| 任务 | 内容 | 依赖 | 量 |
|---|---|---|---|
| **G1 事件导入器** | 把 `proto.ts` 产品化：TMX/YAML/剧本合并、`load_yaml`、形状分类、变量枚举表（全局、稳定）、`.po` 文本分页、传送折叠、NPC 融合（存在变量 + talk 标志链）、战斗占位、转换日志；先出 v1 降级版，K1/K2 合并后切到新构造；golden + 字节稳定测试 | 可先行；K1/K2 后切换 | 大（3 天） |
| **G2 数据导入** | `db/npc` → 精灵键/名字；`db/item` → Kit 道具（名字、图标、价格）；`db/economy`（4 个）→ 商店货单；台词表；按语言出字符串（先 en_US） | K3/K4 的格式 | 中（1–1.5 天） |
| **G3 P1 运行时胶水** | 开局菜单（剧本/外观/代词 → 变量；T2-9）、战斗占位的呈现、队伍占位变量、音频空钩子 | G1 | 小（0.5–1 天） |
| **G4 主线验证** | 把 `smoke.ts` 的做法接到真实导入产物上，按 §9 的章节逐段写无头验收（Spyder 开场 → Cotton Town → …），为 P3 tape 打底 | G1、S2 地形 | 中（持续） |

地形、图块、碰撞（含 Tuxemon 的图块碰撞、碰撞线与方向进出属性）属于 S2 / 地形导入，本原型只用了碰撞矩形。

## 12. 复现

```
sh findings/scout-S1/run-all.sh      # TUXEMON_SRC 默认 /var/tmp/tuxemon-src（9e6258ff）
```
依次生成 `census.json`、`shapes.json`、`patterns.json`、`vars.json`、`mainline.json`、`sim-{spyder,xero,water}.json`、`../scout-S1-mapping.json` 与 `tables.md`、`proto-v1.json`/`proto-log.json`、`smoke-log{,-30hz,-20hz}.txt`。门禁：仓库 `tsc --noEmit` 退出 0（worktree 借用主 checkout 的 `node_modules`），`findings/scout-S1/*.ts` 在同样的严格配置下也退出 0；仓库 `bun test` 在骨架提交 `b8f79f5` 上没有 `tests/` 目录，退出 1（"Failed to scan non-existent root directory"），本分支不含产品代码与测试。
