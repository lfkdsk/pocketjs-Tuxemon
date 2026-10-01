# Scout S5：P3 主线续录与酷炫层规划

任务 1991；游戏仓基线 `15f4519`，RPG Kit 子模块 `fb3b319`，Tuxemon 源
`9e6258ff`。本任务只做阅读、统计和设计，没有修改产品代码。数字默认采用源文件口径；
涉及性能的数字只引用现有桌面宿主 rquickjs/QuickJS 测量，Bun 运行只明确标成容量诊断。

## 0. 结论

1. 当前 GB6 tape 已到 `spyder_route3 @4,6`，主力 Arthrobolt L32；Route 3 后的最短剧情链可以
   继续录到 Candy Hospital、Omnichannel 和 Radio Tower。源码的真实顺序是
   `hospitalcure → Omnichannel → Beaverbrook → omnichannelradioannounce`；Data Center 的
   Kernel 是广播后的尾声，不是结局前置。
2. 当前导入覆盖中没有发现一个**确定会阻断上述最短链**的 Placeholder/Dropped。剩余首要风险是
   地图内逐格可达、NPC 路线和长程练级，必须由分段真走 tape 证明，不能拿 S1 贪心模拟器代替。
3. 后续最短结局建议预算 110k–150k 个 60 Hz source frames（约 31–42 分钟）；Kernel 尾声另加
   20k–35k。若追求 97/99 地图及高等级支线，后续总预算约 200k–260k（56–72 分钟）。这些是录制
   预算，不是已测成品长度。
4. 四个 `.world` 共有 67 张户外图；严格用 TMX `inside`、真实尺寸、边界传送/方向元数据筛选后，
   可接受 71 条接缝。Spyder 的 23 张户外图仍是一个连通组件，但 `.world` 中 19 张户外图尺寸为
   `0×0`，且还有非零陈旧尺寸，因此 importer 不能直接相信 world 尺寸或所有矩形接触。
5. 无缝模式应把邻图当“只读视觉 halo”，跨过 allowlist 接缝时仍原子切换唯一活动 `mapId` 并执行
   既有 `enterMap` 语义；这样 parallel event、`local.*`、NPC、自开关、存档和 KR2 都不会变成
   多地图并发解释器问题。
6. `.world` 窗口叠加 G7 单图数据给出的 960×544 串行上界为 Classic 34 ms、Eclipse 69 ms、
   Normal 102 ms、Spyder 170 ms；同一 rquickjs session 的实测原型中，Classic 两图首访中位
   10.681 ms（新增邻图 4.989 ms、commit 0.006 ms），Spyder 最重七图 halo 中位 193.889 ms，
   单 stage 中位峰值 38.112 ms。必须提前预取/换可切片格式，不能在边界帧同步 acquire 全 halo。
7. 自动演示的第一版无需新 AI：现有确定性 `battleAutoplayInput`、离线寻路器、AttractController、
   任意非 transport 键接管及 KR2 关键帧已够用；产品缺口是安全 idle 判定、tape 接线和移动端
   L/SELECT 控件。发布时应重放冻结 tape，不在 QuickJS 帧循环里跑 A*。
8. 保留“完整主线验收 tape + 5–8 分钟 showcase tape”两层：前者跨 60/30/20/4 Hz 做 oracle，
   后者用于日常 attract。漫游/练级/剧情目标选择器属于录带工具，固定 seed、排序和策略版本后再
   冻结为 masks。
9. 上游 `set_environment/environment_is` 是**战斗背景**，不是天气。当前内容有 128 次 `time_is`、
   174 次 `set_environment`、200 次 `environment_is`、79 次 `set_layer`、3 次 `update_time`，但
   `load_weather/set_weather` 都是 0；10 种天气没有 transition rules，modifier 也全空，因此天气
   在这版内容里是 dormant 的视觉扩展，而非主线门槛。
10. 昼夜权威时间必须放在 reducer/扩展状态内并按 60 Hz reference tick 推进；真实时钟最多只在
    新档时采样一次并写入确定性输入。天气也要保存 slug/deadline/独立 RNG 游标；渲染只能从状态
    派生，不能读 wall clock 或 `Math.random()`，否则多 hz、存档和倒带无法一致。

## 1. 口径与复核

- GB6 的冻结文件有 109,981 个 masks，60 Hz 时长 1,833.017 秒；100 场战斗 = 22 trainer +
  78 wild，终态 hash 为
  `bd3616c750f5aa2b76ba105713c4e921f434d397ab5a0618845e382df62fa0d0`。
  证据见 `findings/GB6.md:3-14,47-58`。
- 最后一场 QQQ 开战前队伍为 Arthrobolt L32、Aardorn L4、Cardiling L8、Cataspike L3、
  Eyenemy L5、Pawsand L22；`data/gb6-mainline-journey.json` 的最后 battle checkpoint 可直接复核。
- Spyder 除测试图外的 98 张有效图中有 271 次 `start_battle`、8 次 `start_double_battle`；
  205 个 NPC 对手中 202 个会与玩家战斗，共 601 个怪物位、等级 L2–55。队伍规模为
  1×83、2×112、3×48、4×17、5×8、6×7（`findings/scout-S4-battle.md:147-154`）。
- S1 贪心模拟访问 97/99 图、击败 199 个 opponent、设置 202 个变量，但不模拟实际碰撞和 NPC
  路线；其两张未访问图只是没有猜中 Hospital 的 `blue/10` 密码
  （`findings/scout-S1-events.md:354-361`）。本文只把它当剧情可达上界。

## 2. A — Route 3 之后的主线

### 2.1 章节、门槛、战斗与 tape 预算

下表把“剧情硬门”和“地理上可能强制触发的训练师”分开。后者最终仍以真实寻路 trace 为准。
每段从上一段冻结终态续录，frame 是规划区间，不宣称已经运行过。

| 段 | 地理/剧情顺序 | 训练师与等级带 | 硬门、谜题、所需能力 | 建议续录预算 / 练级 |
| --- | --- | --- | --- | --- |
| A0 已完成 | Route 3 北段；Zoolander 胜后取得 `sledgehammer` 并清 boulder | Route 3 L8–16；Zoolander = L14/L14/L16/L16 | 当前终态已有 `shaftscheme=1`、`zoolanderWon=true`；确认锤子障碍已清 | 0；以 GB6 hash 作为输入 fixture |
| A1 | Wayfarer Inn → Route A → Route 4 | Inn L12–14；Route A L12–20（Billie L20）；Route 4 L12–18（Billie L18） | 当前 tape 已打 Inn 三人，但未记录 guestbook 的 `enforcers_response=done`；续录先补签名 | 10k–15k；当前 L32 无需 grind |
| A2 | Mansion → top → basement → 回主楼 | Mansion L15–26；Lucy L15×2 是显式胜果剧情战 | `foundcaptain=yes → captainreturns=yes`，开启 Paper/Leather/Flower/Timber 船夫网络 | 10k–15k；继续轮换低级后备 |
| A3 | Leather/Greenwash/Dojo 2–4（多城内容可并行） | Greenwash L15–35；Looten 四只 L35；Dojo2 L25、Dojo3 L30、Dojo4 L30–35 | **必须通过 Looten 事件取得 `aardant`**；Leather Gym 的 NPC-vs-NPC 只缺演出 | 15k–22k；主力到 L38–40，至少培养第二只 |
| A4 | Nimrod 三层 → Route 5/6 → Route C 与船运节点 | Nimrod L21–40；Route5 L21–40；Route6 L25–40（Billie L40）；RouteC L25–41 | Route5 的 6 次 double action 主要是两组对局入口，不能算 6 组敌人；当前 8/8 双打已 Native | 20k–28k；主力/后备到 L42–45 |
| A5 | Candy Town → Hospital 1/2/3 | Hospital L32–45；治愈后 Billie 四只全 L45 | 颜色 8 选 1 + 数字 8 选 1，答案 `blue`/`10`；三楼需 `aardant`；设备写 `hospitalcure=yes` | 20k–28k；主力 L45–50，固定回血路线 |
| A6 | Omnichannel 1–4 → Radio Tower | Omni L25–45；入口 Enforcer L40；Beaverbrook = `mk01_gamma`/`mk01_omega` L55 | 治愈后入楼；屏幕机关写 `omnichannel1wall=yes` 并移 collision；护士给 `spyder_pass`；Beaverbrook 必须胜 | 25k–35k；建议主力接近 L50 且 2–3 只可战 |
| A7 尾声 | Cotton 触发 `kernelquestbegin` → Route E/B → Data Center | Route E/B L35–45；Data Center L35–45；Kernel L50；错题各出 Blasdoor L40 | 七题答案见下；最终写 `kernelquest=done`。这是广播后尾声 | 20k–35k；原则上不需再刷到 L55 |
| A8 completionist | Scoop 1–4、Dragon's Cave、Walled Garden、Dryad's Grove | Scoop L35–45；Dragon L40–45；Walled L45–55；Dryad 全 L50 | 含 Dragon 2 次双打、Walled Midas 胜果分支；不在最短广播链 | 最短链之外；后续总计 200k–260k |

上述 A1–A6 的区间合计约 100k–143k，再给无法预见的绕路、文本和回血留 10% 余量，采用
**110k–150k** 作为最短结局的验收预算。当前 100 场/109,981 frames 只给出约
1,100 frames/战的历史均值；后期六怪队、多回合战和谜题会改变这个均值，因此不能把预算当承诺。

经验总量是 `L³`。当前主力 L32 到 L45/L50/L55 分别还需 58,357 / 92,232 / 133,607 XP。
最短结局不建议只堆一只：经验只给造成过伤害且未倒下的怪，最终 L55×2 前应维护 2–3 只可战成员。

### 2.2 关键剧情链与终局修正

- Route 3：Zoolander 战后给 `sledgehammer`，互动障碍降低成“持有道具即自动使用并移除对应
  NPC/collision”；当前 GB6 已实际走过（`importer/project.ts:197-222,1921-1945`，
  `tools/gb6-journey.ts:655-661`）。
- Mansion：地下室写 `foundcaptain=yes`，主楼回收 Captain 后写 `captainreturns=yes`；这是船运
  网络的剧情锚点（上游 `spyder_mansion_basement.tmx:100-108`、`spyder_mansion.tmx:140-180`）。
- Greenwash：Looten 战的后续动作直接 `add_item aardant`（上游 `spyder_greenwash.tmx:67-81`）；
  Hospital 三楼用 `has_item aardant` 把无道具玩家推回（`spyder_candy_hospital3.tmx:48-99`）。
- Hospital：一楼密码逻辑明确检查 `passcode_color:blue` 与 `passcode_number:10`
  （`spyder_candy_hospital1.tmx:354-384`）；三楼的治愈事件先写 `hospitalcure=yes`，才执行被丢弃的
  plague/quarantine 动作（`spyder_candy_hospital3.tmx:127-143`）。
- Omnichannel：未治愈会被一楼赶出；治愈后 Enforcer 战、屏幕 collision、护士给 `spyder_pass`，
  四楼用该物品开 Radio Tower 传送（`spyder_omnichannel1.tmx:116-177,192-235`，
  `spyder_omnichannel4.tmx:76-90`）。
- Radio Tower：Beaverbrook 胜后写 `kernelquest=yes`；广播事件只检查玩家位置与
  `not omnichannelradioannounce:yes`，**没有 `kernelquest:done` 守卫**
  （`spyder_radiotower.tmx:95-140,155-168`）。所以忠实实现中的广播结局先于 Kernel 尾声。
- Data Center 七题依次应选 `snokari / shybulb / ignibus / snarlon / jemuar / baobaraffe / shammer`；
  终端随后启动 Kernel L50 并写 `kernelquest=done`（`spyder_datacenter.tmx:96-173`）。

### 2.3 当前覆盖缺口是否会卡主线

全库 Actions 为 13,617 uses（Native 11,583、Degraded 639、Placeholder 19、Dropped 1,376），
Conditions 为 8,663（Native 7,666、Degraded 95、Placeholder 1、Dropped 901）；详见
`findings/G1-coverage.md:9-27`。P2 遗留的 20 个 Placeholder 是
`choice_monster` 2、`choice_npc` 1、`open_shop` 7、`remove_monster` 4、NPC-vs-NPC
`start_battle` 5、`party_infected` 1（`:38-62`）。

| 缺口 | 对 Route 3 后的影响 | 判定 |
| --- | --- | --- |
| Spyder 4 次 NPC-vs-NPC battle | Leather Gym 2、Nimrod 1、Scoop3 CCTV 1；显示 skip notice，后续命令仍执行 | 失去演出/战果，不是已知硬阻断 |
| `char_plague` 13 + `quarantine` 8 Dropped | 疫情/隔离细节缺失；`hospitalcure` 在这些动作前写入 | 失真，不阻断 Omni 门 |
| `set_monster_attribute` 33 Dropped | Hospital Billie 队伍的性别指定丢失，怪和战斗仍存在 | 视觉/资料失真 |
| `set_layer`、`set_template`、`change_bg*`、`play_tile_animation`、`autosave` | 色层、模板恢复、动画或自动存档缺失 | 多数非主线硬门；D 块另补色层 |
| 交易/移除怪/按怪属性分支 | 影响商店、形态、感染及支线 | 放在 completionist 清零，不阻挡最短链 |
| 空间可达性 | S1 不模拟碰撞、视线、NPC 路线，无法证明任何一段真走 | **当前最大风险；每章必须生成真实 tape** |

因此这里的结论是“**未发现确定阻断**”，不是宣称整条链已经通过。A1–A7 每段必须断言起终
`SessionState`、必需变量、道具、战果、地图位置、队伍和 hash，并从上一段冻结终态续录。

## 3. B — `.world` 无缝大世界

### 3.1 可拼范围与可信接缝

户外判据是 TMX 顶层没有 `inside=true`；不能只看文件名或 `map_type`。尺寸一律由 TMX 根节点
`width × tilewidth` / `height × tileheight` 重算。Spyder world 的 95 条记录中有 46 条 `0×0`，
其中 19 条是户外图；另有 `spyder_routeb` 在 world 写 256×640、TMX 实际 320×640 的非零陈旧值。

严格接缝判据为：矩形共边且投影为正长度，并由位于该边的 `transition_teleport` 或对应
`north/east/south/west` 元数据佐证。结果：

| world | 户外/总图 | 户外 bbox（tiles） | 几何接触 | 接受接缝 | 接受图组件 |
| --- | ---: | ---: | ---: | ---: | --- |
| Classic | 15/15 | 280×120 | 15 | 15 | 15 |
| Eclipse | 12/12 | 120×240 | 14 | 9 | 8 + 1 + 1 + 1 + 1 |
| Normal | 17/17 | 200×341 | 18 | 15 | 16 + 1 |
| Spyder | 23/95 | 180×200 | 44 | 32 | 23 |
| **合计** | **67/139** | — | **91** | **71** | — |

Spyder 连通组件为：`routea route5 flower_city timber_town route4 route3 leather_town
cotton_town citypark route2 dryadsgrove route6 tunnel candy_town routec route1 routed routee
paper_town routeb candy_port diamond_hill brideswood`（均带 `spyder_` 前缀）。其 12 个假接触是：

```text
flower_city—routeb       timber_town—routeb      route4—routed
leather_town—cotton_town cotton_town—citypark    dryadsgrove—route6
dryadsgrove—candy_town   route6—routee           route6—routeb
routed—routeb            candy_town—diamond_hill candy_port—diamond_hill
```

Normal 还证明“有 portal 不等于空间接缝”：Taba Town 与 Route 1 虽几何接触，但两侧事件不在对应
边界；Taba↔Dryad's Grove↔Leather↔Flower↔Timber 的传送又与 world 几何不相邻。所有这些应继续
作为原传送门户，不能被坐标拼接改写。Classic 15 图全可信，最适合第一轮原型；Eclipse 的
route i/h/g/f 在元数据修复前保持孤立。

### 3.2 运行时语义

推荐导入一份带版本和内容 hash 的 `OutdoorWorldIndex`：

```text
worldId
maps[mapId] = { originTileX, originTileY, width, height }
seams[] = { a, sideA, spanA, b, sideB, spanB, coordinateMapping }
portals[] = 原 transition_teleport
rejectedContacts[] = 构建诊断
```

首期维持“一张逻辑活动图”：邻图只绘 terrain/upper/animated/NPC preview；跨过 allowlist seam
才把世界坐标换成目标局部坐标，并原子 `enterMap`。当前 `enterMap` 会清 `local.*`、重建解释器/NPC，
保留全局 switches/items/gold/RNG（`vendor/pocket-rpgkit/src/engine/session.ts:578-620`）；同时运行
多个地图解释器会改变 parallel event、自开关和阻挡语义，应避免。

当前基础不是推倒重来：`MapRepository.releaseExcept(ids)` 已支持保留多个 map
（`vendor/pocket-rpgkit/src/engine/map-repository.ts:388-448`）。需要补的是：

- `applyTransfer` 目前进入目标后只保留目标图，改成 active + visible halo + 1 个 heading-prefetch；
- `StreamedChunkLayer` 只有一个 `mapId`，换图即 `clear()`，需支持 world transform 与多图窗口
  （`vendor/pocket-rpgkit/src/ui/StreamedChunkLayer.tsx:90-148,170-241`）；
- 游戏仓 `lazyEntryTable` 只 `cache.set`、没有淘汰 API，terrain/animated/NPC shard 会随长走累计
  （`ui/lazy-entry-table.ts:24-62`）；
- 存档继续保存 `mapId + local mover`，halo 是派生 cache；world/seam manifest 必须进入 content
  identity，防止仅坐标布局变化时错误接受旧档；
- KR2 关键帧仍只保存语义状态，restore 由 `mapId+position` 重建 halo，不把纹理/cache 放进 timeline。

宽出口原作可能把 8 个入口格汇到一个固定目标格。无缝直穿若保留横向 offset 会改变落点；首期只
开放旧目标与 world 坐标一致的 seam，其余保留 portal，或显式把差异列入设计变更。

### 3.3 QuickJS 首访模型与预算

第一层原型把修复后的 `.world` 矩形窗口叠到 `findings/G7-map-first-visits.tsv` 的**真实逐图 QuickJS
冷首访**上。每个候选视口同时求相交地图数、JSON bytes 和串行冷首访总时间，因此下表是容量/时间
模型，不是一次真实 stitched frame：

| world | 户外 map JSON 总量 | 单图冷首访 min / upper-median / max | 同见地图数 480 / 960 | 最重 960 窗口 JSON | 最重 960 窗口串行冷访和 |
| --- | ---: | --- | ---: | ---: | ---: |
| Classic | 294,110 B | 3.640 / 4.021 / 6.817 ms | 3 / 8 | 153,916 B | 34.025 ms |
| Eclipse | 566,699 B | 4.907 / 10.186 / 18.741 ms | 4 / 6 | 306,512 B | 68.547 ms |
| Normal | 868,917 B | 4.325 / 8.979 / 38.736 ms | 3 / 5 | 434,995 B | 101.929 ms |
| Spyder | 1,665,916 B | 7.146 / 17.099 / 40.979 ms | 5 / 8 | 623,603 B | 170.201 ms |

第二层原型在桌面宿主的真实 rquickjs 中，让多图连续完成 parse → validate → world/passage compile →
commit，且不在图间 release；随后逐图断言第一次 `prepareSessionMapStep` 就返回 true，证明同一 session
仍保有完整 keep-set。5 次运行的中位结果是：

| 场景 | 图数 | 顺序首访总计 | 最大单 stage | 全图 cached revisit |
| --- | ---: | ---: | ---: | ---: |
| Classic Route 1→Hearthrock 真接缝 | 2 | 10.681 ms | 4.961 ms | 0.011 ms |
| Spyder 最重 960×544 时间窗口 | 7 | 193.889 ms | 38.112 ms | 0.040 ms |

Classic 中当前图 Route 1 首访中位 5.715 ms，新增 Hearthrock 邻图 4.989 ms，邻图 commit 仅
0.006 ms；因此“提前准备、边界只 commit”的路径可行。Spyder 七图实测比 G7 历史样本求和更慢，仍
验证了不能同步首访整个 halo。原型、命令与五轮原始汇总在
`/var/tmp/fleet/1991/stitched-map-quickjs.{rs,md}`；它只测 repository/compile keep-set，尚未实现或测量
多图 layer 合成、纹理驻留和 draw，这些仍属于 W5。

代表性原始数据：Classic Route 4 总 6.817 ms、Eclipse Route 7 18.741 ms、Normal Route 1
38.736 ms、Spyder Dryad's Grove 40.979 ms（其中 read/decode/`JSON.parse` 32.113 ms）。当前
`acquireStep` 的 parse 是一个不可切片调用（`map-repository.ts:400-420`）；Wander 的约
1.5 ms/tick 工作队列只能作为新实现目标，不能声称已经解决 JSON parse。

最新 GK QuickJS 基线为：480/960 启动 207.748/199.153 ms，walking p95 1.083/0.970 ms，
map-switch max 13.764/12.260 ms，全库非豁免冷首访最坏 47.192 ms
（`findings/GK.md:94-108`）。首轮无缝验收建议：

- crossing commit ≤1 ms；walking p95 不劣于约 1.1 ms；任何预取帧 <16.67 ms；
- 预取平均预算约 1.5 ms/reference tick；至少提前 24 tiles；parse 仍超帧时改预解析二进制/更细 shard；
- stable keep-set ≤8 可见图 + 1 前瞻，额外 QuickJS heap ≤6 MiB，cache key/纹理数往返不增长；
- Classic Route 1↔Hearthrock 做正例，Normal Route 1—Taba Town 做拒绝接缝负例；
- 480×272、960×544 与 60/30/20/4 Hz 都测，且存档两侧恢复、KR2 map-boundary keyframe 等价。

## 4. C — 闲置自动演示

### 4.1 现成能力和缺口

- `battle/autoplay.ts` 已按低血治疗 → 低血野怪捕获 → 必要换怪 → 最大期望伤害选择，并用稳定菜单
  顺序决胜；它不读战斗 RNG（`:57-77,118-240`），`battleAutoplayInput` 把选择逐 edge 展开
  （`:243-274`）。
- `tools/gb6-journey.ts` 已有真实 `stepSession` BFS/A*、NPC 交互、治疗点、练级循环和同一 autoplay
  调用。寻路 key 包含 mover/chars 的 JSON 和 RNG，每个候选都会折 reducer；这适合构建期录带，
  不适合放进 QuickJS 每帧。
- `AttractController` 已有默认 idle 10 s、source tape 60 Hz、结尾停 2 s、L 退 3 虚拟秒、
  非 L/SELECT 的任一已定义 BTN 接管、SELECT 恢复/重开，以及 3,600-frame/8 MiB KR2 关键帧
  （`vendor/pocket-rpgkit/src/engine/attract.ts:65-95,117-147,300-329`）。
- `main.tsx:69-87` 没传 `attractTape`，所以游戏产品当前没有启用演示；GameView 已有 DEMO、
  YOU HAVE CONTROL、REWIND 覆层，无需重做交互皮肤。
- 当前 play idle 只看 `live===0`。应仅在 `scene/modal/interpreter/input-lock/fade/move/map-load` 全空的
  safe-world 帧累计，否则玩家读长对话或思考战斗时会被强制 reset。

### 4.2 推荐行为

发布运行时只保留 `PLAY ↔ ATTRACT_REPLAY`：

1. safe-world 无输入满 10 秒，clean reset 后开始冻结 tape；后台网页暂停时不累计。
2. L 在 attract/play 都倒带 3 秒并保持原 phase；SELECT 在未偏离 tape prefix 时从当前位置恢复，
   已偏离则 clean restart。
3. 接管定义为任一非 transport 的 PocketJS 16-bit BTN，不是任意 OS 字符。第 `k` 帧按接管键时仍
   折 `tape[k]`，第 `k+1` 帧起吃 live mask，保证接管瞬间世界不跳；短 tap 被当接管手势消费。
4. Web 的 Q/L=LTRIGGER、Shift=SELECT；desktop 的 Q/L=LTRIGGER、Tab=SELECT。移动端
   `web.json` 当前没列 L/SELECT，产品接线时必须补两个控件及说明。

录带工具使用固定优先级：处理 battle/modal/fade → 危险则最近治疗点 → 等级足够则下一未满足剧情
guard → 不足则固定 encounter 两点练级 → 主线耗尽后，从稳定排序 POI 用独立 `demoSeed` 漫游。
不可达目标有上限和 fallback。禁止 `Math.random()`，也不要消费游戏的 `SessionState.sw.rng`；产物
记录 seed、项目 hash、策略版本、tape SHA。

建议两条 tape：

- **验收/长演示**：完整主线，继续承担多 hz、存读档、倒带和剧情 oracle；
- **showcase**：5–8 分钟，覆盖户外无缝跨边、天气变化、野战、捕获、训练师战和接管提示。

### 4.3 容量与真实性能

现有 GB6 JSON 是 1,003,767 B；仅 masks 的紧凑 JSON 是 294,697 B，原始 u16 是 219,962 B。
RLE 因大量 `mask,0,mask,0` 边沿并不占优；正式版优先 u16 pak/typed array，排期紧则直接内置数组。

在钉住提交上用 Bun/JSC 完整驱动一次 attract 的**容量诊断**得到：109,981 source frames 变成
179,986 个含阅读节奏的 timeline ticks（约 49:59.8）；保留 235 个关键帧、估算 8,370,921 B，
已 FIFO 淘汰 105 个；typed history 864,000 B，总 rewind estimate 9,234,921 B。54.8 s 的运行时间
不是 QuickJS 帧性能，不用于预算。

真实 QuickJS 的 GB6 全帧 p95 为 17.205/17.678 ms，max 38.703/49.648 ms，960 的最坏帧距
50 ms 门槛仅 0.352 ms（`findings/GB6.md:168-197`）。KR2 简化 100k-frame workload 的
2,620-frame 后缀 rewind median/max 为 67.093/70.808 ms，capture spike 0.1778 ms
（`findings/kit/KR2-task-1966-1968.md:32-48`）。真实 Tuxemon 3,600-frame suffix 尚未测，集成时必须
设 capture <5 ms、rewind p95 <100 ms/hard <250 ms；超标就把本游戏 interval 从 3,600 调到
240–600，而不是加入在线 planner。

## 5. D — 昼夜与天气

### 5.1 数据、覆盖与概念边界

源文件口径与“把 shared scenario YAML 展开到每图”口径如下。Spyder scenario 被 99 张 TMX 引用，
所以 expanded 数量只衡量触达面，不是独立内容数。

| 指令/条件 | source uses | expanded uses | 当前处理 |
| --- | ---: | ---: | --- |
| `time_is` | 128 | 618 | Degraded 61 / Dropped 67；固定 morning/daytime |
| `environment_is` | 200 | 395 | Native 116 / Dropped 84 |
| `set_environment` | 174 | 369 | Native 118 / Dropped 56 |
| `set_layer` | 79 | 373 | Dropped 79 |
| `update_time` | 3 | 179 | Dropped 3 |
| `load_weather` / `set_weather` | 0 / 0 | 0 / 0 | 无内容调用 |

`time_is` 中 109 次是 `stage_of_day equals night`，16 次是日期彩蛋，另有 daytime 2、hour 1。
`set_environment` 的主要值是 interior 52、grass 49、night_grass 45；它由战斗背景扩展持久化，
不是地图天气。当前 random/wild battle 仍硬编码 `hour:12` / `daytime:true`
（`importer/project.ts:620-634,1338-1366,1445-1450`）。

上游 `TimeHandler` 每次读取 `datetime.now()`，daytime 是 06:00–17:59；stage 为 dawn 04–07、
morning 08–11、afternoon 12–15、dusk 16–19、night 20–03
（`/var/tmp/tuxemon-src/tuxemon/time_handler.py:63-137`）。照搬 wall clock 会破坏 tape、hash 和倒带。

天气数据库有 misty、windy、freezing、hot、cloudy、foggy、thunderstorm、snow、rain、sunny 共
10 种，每项 `modifiers: []`（`mods/tuxemon/db/weather/weathers.yaml:22-80`）。源码树虽有
`mods/weather_previsions.yaml`，但内容没有调用 `load_weather` / `set_weather`，该文件也不符合当前
loader 要求的顶层 `transitions` 包装（无参 loader 还查找 `.yml` 而不是 `.yaml`），因此本 mod
实际没有启用 weather transition rules；天气既不挡剧情，也没有战斗 modifier。视觉夜色主要来自
`set_layer`：空值清除，PNG 做 overlay，RGBA 做色层，而不是 weather。

### 5.2 确定性状态模型

游戏仓 `TuxemonExtensionState` 增加：

```text
clock = { mode, refTick, epochDay, minuteOfDay, subMinuteTicks, ticksPerGameMinute }
weather = { slug, enteredAtTick, nextTransitionTick, rngCursor }
battleContext = { hour, stageOfDay, daytime, weather, environment }
```

- 默认 game clock 只随 60 Hz reference tick 推进；暂停无帧就不走。新档可由 effect-shell 采一次真实
  时间并把值写进输入/存档，之后绝不在 reducer/render 再读墙钟。
- 从 clock 派生 hour/date/day-of-year/year/month/weekday/leap-year/daytime/stage/season，按上游的
  numeric/string/date 三路比较实现全部 `time_is`；`update_time` 写回上游同样的八个变量。
- Weather 用独立 PRNG stream，在进入天气时一次抽出 next deadline/choice；到 reducer tick 才转移，
  不按 render frame 每帧 roll，也不让战斗随机调用改变天气序列。
- 进入战斗时冻结 `battleContext`，random encounter 选择与背景读取同一个 snapshot，整场不因钟点
  跨界改变。`environment` 仍是显式战斗背景，不由 weather 隐式覆盖。
- `clock/weather` 纳入 ext codec、存档、canonical hash 和 KR2 keyframe；overlay/粒子完全由该状态
  派生，不拥有 RNG 或时间。

### 5.3 视觉分级

PocketJS 已能用 sibling z-order、颜色/opacity/gradient 和固定 atlas Sprite：足够实现半透明昼夜
色层、预烘焙雨雪雾、确定性固定粒子。它没有通用 per-image hue/shader/blend-mode；首版不应为此
修改 `vendor/pocketjs`。

建议 tier：A = 色层 + 预烘焙 rain/snow/fog atlas + 固定粒子；B = 仅色层；C = 无视觉但完整保留
条件/存档语义。当前 modifier 全空，因此 C 也不漏现有 gameplay。通用 Kit 只需给 GameView 一个
位于 world/actors/upper 之后、Dialog 之前的 overlay slot；Tuxemon 的 palette、天气 atlas 和映射留在
游戏仓。若未来真的需要 shader tint，另提 PocketJS 能力，不让它阻塞 P3。

## 6. Builder 拆分、依赖与并行计划

### 6.1 主线 journey（游戏仓）

| 包 | 工作 | 依赖 | 工期 |
| --- | --- | --- | ---: |
| J1 **可立即开工** | 从 GB6 终态录到 `captainreturns`；补 Wayfarer guestbook；冻结 state/tape hash | 当前 main | 1–1.5 d |
| J2 | `captainreturns → aardant → hospitalcure`，含密码、回血与练级 oracle | J1 | 1.5–2 d |
| J3 | `hospitalcure → spyder_pass → Beaverbrook → omnichannelradioannounce` | J2 | 2–3 d |
| J4 | `kernelquestbegin → Route E/B → kernelquest:done`；另录 completionist tape | J3；completion 可后置 | 1.5–3 d |

每段产物都只存 input masks + metadata/checkpoints，从上一段 terminal snapshot 构建，但最终 CI 仍要支持
从 frame 0 合并重放，防止快照遮住历史不一致。

### 6.2 无缝世界（游戏仓 + 组件仓）

| 包 | 仓 | 工作 | 依赖 | 工期 |
| --- | --- | --- | --- | ---: |
| W1 **可立即开工** | 游戏 | importer 生成 world index、尺寸修复、seam allowlist/reject diagnostics 与 hash | 当前 main | 1–1.5 d |
| W2 | 组件 | 多 map keep-set、预算预取队列、原子 handoff、跨边 passage | W1 schema | 2–3 d |
| W3 | 组件+游戏 | 多图 world transform/layer 合成；terrain/animated/NPC shard eviction | W1；可与 W2 后半并行 | 2–3 d |
| W4 | 组件+游戏 | save content identity、restore/KR2 halo 重建、边界测试 | W1+W2 | 1–1.5 d |
| W5 | 游戏 | Classic 正例、Normal 负例、Spyder 扩展、QuickJS/heap/golden/肉眼验收 | W2+W3+W4 | 1.5–2 d |

总量约 8–11 工程日；两名 Builder 在 schema 稳定后并行，约 5–7 日历日。先做 Classic 原型，性能
门禁通过后再开放 Spyder，不把“画面看似相连”当成语义验收。

### 6.3 自动演示（组件仓 + 游戏仓）

| 包 | 仓 | 工作 | 依赖 | 工期 |
| --- | --- | --- | --- | ---: |
| C1 **可立即开工** | 组件 | safe-idle 判定；GameView 透传 idle/keyframe 配置；modal/battle/fade/lock 测试 | 当前 kit | 1–1.5 d |
| C2 | 游戏 | 数据化目标/治疗/等级表、固定 seed wander、冻结 5–8 分钟 showcase | 可立即，但建议第 5 lane | 2–3 d |
| C3 | 组件 | 可选 u16/ArrayLike tape loader，保留 JSON override 兼容 | 与 C1 同链；可选 | 0.5–1 d |
| C4 | 游戏 | `main.tsx` 接 tape；web L/SELECT；平台化说明 | C1 bump；C3 可选 | 0.5–1 d |
| C5 | 游戏 | 接管/L/SELECT、多 hz、真实 QuickJS rewind、两视口截图 | C2+C4 | 1–2 d |

总量约 5–7 工程日；C1/C3 与 C2 两路并行约 3–4 日历日。在线 A* 不在产品实现范围。

### 6.4 昼夜天气（游戏仓为主，组件仓只加通用插槽）

| 包 | 仓 | 工作 | 依赖 | 工期 |
| --- | --- | --- | --- | ---: |
| D1 **可立即开工** | 游戏 | clock/weather schema、10 条天气表、time/set-layer 导入与 coverage fixtures | 当前 main | 1–1.5 d |
| D2 | 游戏 | ext codec/migration、60 Hz clock、compare/update、独立 weather RNG/deadline | D1 | 2–3 d |
| D3 | 组件+游戏 | 通用 overlay slot + 色层/预烘焙天气 atlas；A/B/C tier | D1+D2；与 D4 并行 | 1.5–2 d |
| D4 | 游戏 | battle-entry snapshot；移除 hour/daytime 硬编码；environment/weather 分离 | D1+D2 | 1–1.5 d |
| D5 | 游戏 | 128/200/174/79/3 fixtures，save/load/rewind/multi-hz/hash 与视觉 golden | D2；视觉等 D3 | 1–2 d |

总量约 7–10 工程日；D3/D4 并行约 5–7 日历日。语义 tier C 不依赖 shader，可先于视觉完成。

### 6.5 首轮并行波次

最多同时四名 Builder，建议立即开：`J1`、`W1`、`C1`、`D1`。它们分别拥有 journey、world-index、
attract、安全时间/数据文件；若 W1/D1 都要改 importer 入口，预先分配独立模块并由后合并者做小型集成。
第一波后：`J2` 继续串行；`W2 ∥ W3`；`C2`；`D2`。所有组件仓任务先合并，再由主会话 bump 游戏仓
子模块，之后才做 C4/W4/D3 集成。性能/全量测试仍串行跑，避免污染 QuickJS 数字。

## 7. 风险清单与验收优先级

1. **先证真走**：A1 最可能暴露 NPC path/空间事件问题；一旦失败先修 importer/引擎，不手改产物。
2. **先证 seam**：`.world` 假接触、陈旧尺寸、固定落点是内容风险；world index 必须生成 diagnostics。
3. **先量 parse**：Spyder 单图 parse 已超 16.67 ms；没有预取/预解析前不得宣称无缝帧预算通过。
4. **控制 cache**：map repository 有淘汰，game-side shard table 没有；所有 residency 测试都要往返并
   断言 cache/texture 数回落。
5. **保持一个真随机流的边界**：战斗/遭遇继续用 session RNG；demo wander 与 weather 各用独立、
   保存的 cursor，避免功能互相改变 tape。
6. **用真实 Tuxemon 状态量 KR2**：简化 workload 的 70.808 ms 不是 3,600 帧复杂场景保证；接线后
   必须实测并调小 interval。
7. **不碰 PocketJS 核心**：首版色层和预烘焙粒子已够；shader/tint 只作为后续可选提案。

subagent 使用：4 个 / A 主线与缺口、B `.world` 与流式预算、C 自动演示与平台行为、D 昼夜天气与确定性状态；并行完成后由主代理复核关键源码、统计和 QuickJS 基线，明显节省了调研时间。
