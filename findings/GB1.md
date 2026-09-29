# GB1：战斗数据与战斗美术导入

Fleet task 1867，源数据固定为 Tuxemon `9e6258ff726b786040a267e8bdbbf037b560285e`。本任务在游戏仓内完成；没有修改 `vendor/pocketjs`、没有 push，也没有改动 `bun.lock`。

## 结论

`bun run import` 现在默认从 98 张非测试 Spyder 地图及上游 YAML 自动生成精简的 `data/battle-db.json`、511 张战斗纹理和字面量资产清单。设置 `BATTLE_DB_SCOPE=full` 会从同一份源数据生成完整数据库与 799 张纹理，不维护怪物、对手或素材白名单，也不手改产物。

生成库通过 TypeScript schema/关系校验：训练师队伍、怪物出生技能、遭遇表、元素、射程公式及美术 key 都必须可解析；遭遇权重必须为正；每张纹理必须是 2 的幂、边长不超过 512，且存在于 pak 输入集合。`game:battle-db` 作为 raw pak entry 写入 `pak.json`；战斗图片用 PSM 4444，经 `ui/battle-assets.ts` 的字面量路径进入 PocketJS 编译器。

## 导入内容

`importer/battle.ts` 从以下数据构造 `pocket-tuxemon/battle-db/v1`：

| 表/配置 | 保留的战斗字段 |
|---|---|
| monster / shape / taste | 体型六项系数、等级、IV/TP、口味、身高体重浮动、性别权重、属性、捕获率/抗性、等级技能、进化、前/后/菜单图矩形 |
| technique | sort、range、速度档位、命中、potency、威力、治疗、冷却、目标、属性、效果/条件插件及参数、状态修正、消息、动画帧页 |
| item / status | 战斗可用域、消耗/持有行为、效果/条件及参数、状态转移/持续/bond/步行效果、修正、球图、图标与动画 |
| element | 完整 13×13 相克表和大小图标 |
| encounter | 怪物、闭区间等级、正权重、经验倍率、持有物和变量守卫 |
| npc + 地图事件 | NPC 战斗外观/配置；从 `add_monster` 与 `start_battle`/`start_double_battle` 相邻动作恢复真实队伍、等级、经验/金钱倍率及出处 |
| config_monster / config_combat / range_map | 等级/IV/TP 上限、能力值系数、经验曲线、体型浮动、行动类别顺序、−3…+3 速度档位与公式系数、属性倍率夹取、射程对应攻防属性 |
| config_capture / capture_devices | 摇球常数、HP 系数、状态/球修正及每种已选球的特殊参数 |

Spyder 选择不是手写清单：导入器先解析场景、事件变量、商店、学习机、固定野怪和 21 张遭遇表，再闭包出场等级可学技能。`billie_choice` 等变量怪名保留变量名，同时附带当前剧情可取的全部合法物种，运行时可按变量解析。

## 数据覆盖与 S4 对照

| 指标 | S4 Spyder 盘点 | GB1 Spyder | GB1 full |
|---|---:|---:|---:|
| 对手 NPC | 205 | 205 | 1,139 |
| 对手位 | 283 | 283 | 343 |
| 不同训练师队伍 | 214（见下） | 213 | 260 |
| 训练师怪位 | 正文 601（见下） | 611 | 721 |
| 怪物 | 214 | 214 | 411 |
| 技能 | 228（含学习机） | 228 | 274 |
| 道具 | 82（含商店） | 82 | 224 个不同 slug |
| 元素 / 口味 / 状态 | 13 / 12 / 35 | 13 / 12 / 35 | 13 / 12 / 35 |
| 遭遇表 | 21 | 21 | 35 |
| random_encounter 使用 | 261 | 261 | 476 |
| wild_encounter 使用 | 17 | 17 | 20 |
| 环境 | 8 | 8 | 40 |

两处差异来自 S4 报告文本/中间产物，而不是丢数据：

1. 对 S4 的 `spyder_subset.json` 直接求和得到 285 条 battle 记录、615 个全体怪位；排除测试地图后是 **283 个对手位、611 个怪位**。因此正文的 601 是少算 10，GB1 固定为源事件实际的 611。
2. S4 的 214 个 `distinct_battle_definitions` 比 GB1 多出的唯一记录是 `spyder_route5_cleo: memnomnom L5 ×2`；钉住的 `spyder_route5.tmx` 三处 Cleo 双打都明确写的是 **L25 ×2**。L25 队伍已导入，虚构的 L5 变体不应进入数据库，所以真实去重数是 213。

## 美术、尺寸与 pak

所有素材从上游路径自动复制/重排：怪物 sheet、环境背景与站台、HUD/队伍图标、捕获球、训练师图、技能/道具/状态动画、元素/射程/速度/状态图标及 HP/XP 条。静态图透明填充到最近的 2 次幂；帧条按帧尺寸重排为不超过 512×512 的一页或多页，并记录 `firstFrame`、帧数、列数与可见尺寸。

| 指标（字节） | Spyder | full |
|---|---:|---:|
| 唯一上游源图 | 511 | 798 |
| 唯一上游 PNG 字节 | 1,598,170 | 2,992,908 |
| 生成纹理文件 | 511 | 799 |
| 生成 PNG 字节 | 1,070,236 | 2,055,935 |
| PSM 4444 纹理字节（含条目头） | 23,414,264 | 34,445,048 |
| battle-db JSON | 1,030,737 | 1,967,467 |
| battle-only pak | **24,491,344** | **36,484,608** |
| 最大纹理 | 512×512 | 512×512 |

S4 按类别相加报 Spyder 512 文件 / 1,599,154 B、full 799 文件 / 2,993,892 B。两组都把 984 B 的 `animations/technique/drip_green.png` 同时算进技能动画和道具/状态动画，因此物理唯一源分别少 1 文件和 984 B。full 的物理输出又回到 799 张，是因为一条大动画在 ≤512 约束下被分成两页。

逐类源文件数与 S4 一致：怪物 214/411、背景 8/37、站台 6/14、技能动画 126/141、道具/状态动画 3/3、HUD 10/12、球 7/28、训练师 61/76、图标及条 77/77（Spyder/full）。

## 视觉验收

`tools/render-battle-preview.ts` 从生成纹理组合 [GB1-preview.png](GB1-preview.png)：左侧为 2× 的 256×144 草地战斗构图，右侧为训练师、Ram 四帧动画、球与图标接触表。已按原始像素打开检查：前/后怪、站台、HUD 与透明边界正常，没有错页、裁切或紫块。

`tests/battle-import.test.ts` 还锁定整张 PNG 字节，并做语义像素断言：未遮挡草地逐像素等于背景源图；Rockitten 背面所有完全不透明像素以 2×2 块落在玩家槽；Ram 四帧的 829 个完全不透明像素逐个落在右侧帧条。

## PSP / 内存风险（1881 补记，源自 `review-task-1867.md` §3）

本报告原文没有提到 PSP/内存风险，是审查（task 1867 review）指出的疏漏，这里补上：

- **PSP 装不下**：PSP 宿主 `include_bytes!` 把整个 `.pak` 原样塞进 `.rodata`，没有任何流式/压缩（`vendor/pocket-rpgkit/vendor/pocketjs/hosts/psp/src/pak.rs`、`build.rs:218-246`）。真实 `bun run build` 产出的 `dist/main.pak` 为 2,891 entries、50,757,856 字节，其中地形 `ui:tile.*` 21,575,296 字节、战斗 `ui:img.*` 24,498,560 字节（1881 补齐 `empty`/`hawk` 两个技能后的现值，较原始 24,491,344 略增，量级不变）——两块加起来远超 PSP 32 MB 的可用内存。桌面/网页端不受影响：网页 battle 字节区间 gzip -9 后约为原始的 2.9%，下载体积不是瓶颈,瓶颈是常驻内存/显存。
- **PSM_4444 量化有可见但不严重的损失**：抽样战斗纹理 8888→4444→8888 往返，平均每通道误差 0.74–5.28/255，多达 94.5% 像素在某通道上有 >4/255 偏差，主要在抗锯齿边缘；上游本身是低色数像素画（怪物图 23–91 种 RGBA），条带感存在但不严重。
- **CLUT8+RLE 能省约 4.2 倍，但不是本任务能顺手做的配置项**：对全部战斗纹理字节做 CLUT8 模拟，498/511 张（怪物/图标/HUD/球/训练师/站台图）在 256 色以内，纯索引流 + PackBits 只要现有 4444 体积的 6.3%（含 TILESET 容器开销 8.6%）；13 张战斗背景超过 256 色需维持 4444/8888 或专门降色。混合方案（498 张 CLUT8+RLE、13 张背景维持 4444）预计 **≈5.8 MB**，是当前 battle-only pak 的约 1/4.2。但组件仓的通用 `ui:img.*` pak 入口（`encodeImageEntry`）目前没有 `PSM_T8` 分支——CLUT8+RLE 现在只存在于地形用的 `TILESET` 流式容器（`loadTileTexture` 按视口加载），要给战斗美术用等于要把它接到那套机制上，这是和 S2（地形渲染架构 scout）同量级的框架工作，不是导入器任务的范围。

**结论**：这不阻断 GB1/GB-int 本身的验收（两边任务书都只要求给出字节数，不要求已经落地 PSP 可用格式），但战斗美术 + 地形美术合计已确认让 PSP 装不下，需要 commander 另立一个类似 S2 的后续任务，同时改组件仓 pak 编译器（加 `PSM_T8`/CLUT8+RLE 分支）与战斗渲染的加载路径。

## 验证

| 命令 | 结果 |
|---|---|
| 连续两次 `bun run import`，每次随后 `git status --short` | 两次 exit 0；两次均为 clean；均报 214 monsters、228 techniques、511 textures、24,491,344 B |
| `bun run verify:g6:determinism` | PASS；隔离根 2，2,902 文件，49,345,468 B，SHA-256 `a5311215fdee257dd2c37ce113a4d5b14e09ab205e7a5c6eff8e564585d87b18` |
| `bun test` | 43 pass、0 fail、1 个既有 built-bundle 条件跳过，44,258 次断言 |
| `bunx tsc --noEmit` | exit 0，无输出 |
| `bun run build` | exit 0；真实 PocketJS pak 2,891 entries、50,757,856 B；其中 431 个 raw entries 为 22,575,733 B |
| `BATTLE_DB_SCOPE=full G6_OUTPUT_ROOT=<scratch> bun run import` | exit 0；411 monsters、274 techniques、799 textures、36,484,608 B battle-only pak |
| `git diff --name-only -- bun.lock` | 无输出 |

本地提交：`0c03ac8`（数据/美术/集成）、`d1474c6`（公式配置）、`9dcc467`（视觉与像素验收）、`5574ca4`（全量资产测试集成），以及本报告提交。不 push。
