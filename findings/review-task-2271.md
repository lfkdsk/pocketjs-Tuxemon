# 审查：I18N-T 简体中文补译（review of task 2271）

被审分支 `fleet/task-2271`（main `84c488e` 之上 7 个提交，`f3a01cb..59a788b`）。规格 `game-I18N-T-translate.md`，builder 报告 `findings/I18N-T.md`。
审查方法：自写 Python PO 解析器（不复用 `tools/l10n-lib.ts` / `importer/source.ts`），所有统计脚本在 `/var/tmp/fleet/2281/`（`po.py`、`stats.py`、`sample.py`、`fmtcheck.py`、`length.py`、`termgap.py`）。

## 结论速览

| 项 | 结论 |
|---|---|
| 1 质量抽读（200 条，种子 2281，排除 builder 自检样本） | **成立**：错译 0/200（0%，阈值 2%），可改进 15 条（表 C） |
| 2 术语一致 | **不成立**：主线专名与上游屏幕标签/对话冲突（B1）；「Tuxemon 对话保留拉丁」裁定的依据不实且实际按英文大小写分流（B2） |
| 2b 照抄商业专名 | 基本成立：宝可梦招牌译名（十万伏特、伤药、大师球、奇异甜食、宝可梦…）一个没有；有 5 处与宝可梦官方词相同（表 D），其中「训练家」同时背离上游「训练师」（并入 B1） |
| 3 格式 | 正文**成立**（独立检查 0 问题）；文件头**不成立**：不是标准 gettext 头（B3） |
| 4 长度 | 成立（指引性）：菜单类 446 条中 11 条 >6 字（表 E）；对话/散文 3,450 行中 426 行 >30 字，最长 67 字（`\n` 分段内），上游同口径 257/2,543 行 >30 |
| 5 署名与许可 | 成立：`licenses/TUXEMON-ATTRIBUTIONS.md` 只在 Translations 节后追加一节，上游原文未动；文件头说明非 Weblate（但该说明所在的文件头本身格式坏，见 B3） |
| 6 门禁 | `check:l10n` 6/6、`tsc` 0、`bun run test` 346 pass / 0 fail；未改导入器/运行时；`bun.lock` 未改；提交信息无任务号 |
| 状态清单 | **不成立**：`docs/status.md` 未标本分支落实的 zh_CN 数据与 `check:l10n`（B4） |

## 阻断项

### B1 主线专名与上游已有译名（含游戏里直接显示的标签）冲突，术语表把它们错标为「补译」
规格第 1 条要求「从已有 zh_CN 译文中抽取专有名词」。下列名字上游已有译法（多数是 NPC 名牌、地图名、徽章，玩家在屏幕上会直接看到），补译与术语表另起一套，结果同一画面里名牌和台词不一致。术语表把它们的 source 标成 `supplement`，像是上游没有一样。

| 英文 | 上游（msgid：译文） | 补译 / 术语表 | 次数（上游/补译） | 建议 |
|---|---|---|---|---|
| Billie（主线女劲敌） | `spyder_billie`：比莉；`spyder_papertown_rival`：比莉的房子 | 比利（`glossary.tsv:914`） | 3 / 8 | 改「比莉」（「比利」读起来是男性名，而 `spyder_rivalbedroom_bed` 写的是 she/her） |
| Paper Town（起始镇） | `paper_town`：方絮 | 纸镇 | 1 / 5 | 按地图名统一「方絮镇」——Cotton Town 已按地图名 `cotton_town`：暖棉 取「暖棉镇」，两边规则要一样 |
| Candy / Timber Town、Flower City | `candy_town`：甜饴；`timber_town`：粽木；`flower_city`：彩花 | 糖果镇、木材镇、花城/花之城 | — | 同上：甜饴镇 / 粽木镇 / 彩花城（补译里 Flower City 自身也有两种写法） |
| Omnichannel | 全能公司（含 `omnichannel_badge` 徽章：全能公司） | 全渠道（`glossary.tsv:999`） | 33 / 39 | 改「全能公司」 |
| trainer | 训练师 | 训练家（宝可梦官方用词） | 16 / 17 | 改「训练师」 |
| Prof. Kay Wren | `professorexists3`：凯·雷恩 | 凯·伦 | — | 改「凯·雷恩」 |
| Looten | `spyder_greenwash_looten`：罗顿 | 卢滕 | 1 / 16 | 改「罗顿」 |
| Scoop | 勺子 7 / `scoop_badge`：斯考普 | 斯库普 | — | 取徽章「斯考普」 |
| Shaft | 沙夫特 18、沙弗特 2 | 沙弗特，术语表缺 | — | 取多数「沙夫特」并入术语表 |
| Nimrod | 尼姆罗德 5、宁德 3、徽章 宁录 2 | 宁录 | — | 上游自身混乱；定一种写进术语表并在报告说明 |
| Argon / Zircon | 名牌 氩气 / 锆石（上游字面误译） | 阿贡 / 泽康 | 1 / 56、1 / 21 | 补译的选择合理，但名牌冲突要在报告「已知取舍」里写明（补充文件不得覆盖上游，需要接线任务决定是否加一层上游勘误） |

证据：`python3 stats` 计数——纸镇 up 0 / sup 5，方絮 up 1；比利 up 0 / sup 8，比莉 up 3；全渠道 up 2 / sup 39，全能公司 up 33；训练家 up 0 / sup 17，训练师 up 16；道馆 up 0 / sup 13。
修法：先改术语表（source 改 `upstream`，取上游译法），再按术语表批量改补译，最后跑 `check:l10n`。建议给检查工具加一项「术语表 source=upstream 的条目必须与上游对应 msgid 的译文一致」，以免再出现这种情况。

### B2 「Tuxemon 对话保留拉丁、散文作『精灵』」：依据不实，执行上实际按英文大小写分流
- builder 报告（`findings/I18N-T.md` 术语表摘要、已知取舍两处）称这是「上游惯例」。**上游不是这样**：英文大写 `Tuxemon` 的 72 条里，上游 66 条译「精灵」、3 条保留拉丁；保留拉丁的 2 处对话都不是指生物（`xero_hideout1` 是机构名，`37707_computer` 是开发者控制台）。
- 补译实际的规则是「英文大写就保留拉丁」：大写 99 条中拉丁 60、精灵 39；小写 105 条中精灵 104、拉丁 0，和对话还是散文无关。结果是同一个 NPC 的前后两句写法不同：
  - `spyder_barmaid_cafe2`「取出一些没有被感染的精灵」紧接着 `spyder_barmaid_cafe2a`「你拿到Tuxemon后」；
  - 补译的护士台词 `tabanurse_dialog_taba`「你想治疗你的 Tuxemon 吗？」对比上游 `spyder_billing_cathedral1`「你想治愈你的精灵吗?」；
  - 系统提示 `new_tech_delete`「Tuxemon 的招式太多了」。
  拉丁词前后的空格也不统一（有空格 40 处、无空格 27 处）。
- 检查工具无法发现这个问题：术语表值 `Tuxemon／精灵`（`glossary.tsv:1004`）两种写法都放行。
- **建议裁定**：生物统称一律译「精灵」（跟上游一致）；只有专有名词复合词（机构名、软件/系统名）才保留拉丁。改掉 60 条拉丁，术语表改成单值「精灵」，让检查真正执行。

### B3 `supplement.po` 文件头不是标准 gettext 头
`tools/l10n-lib.ts:80` 写头字段时没有加 `\n`，13 个头字段被拼成一个字符串（`Project-Id-Version: Pocket Tuxemon zh_CN supplementReport-Msgid-Bugs-To: …`）。真实工具的读取结果：
- `polib`：metadata 只读出 1 个键（上游 base.po 能读出 6 个以上）；
- 编译成 `.mo` 后，Python `gettext.GNUTranslations` 加载报 `UnicodeDecodeError: 'ascii' codec can't decode byte 0xe5`（charset 没解析出来）；
- Babel：`locale None`，`project` 是整串拼接。

规格要求「标准 gettext 格式」，而署名/许可说明（`X-Comment`）恰好放在这个坏掉的头里。修法：每个头字段末尾加 `\\n`；许可说明另外写成文件顶部的 `#` 注释；测试里加一条「头能解析出 Language / Content-Type charset」。

### B4 功能状态清单未更新
本分支落实了 zh_CN 补充数据、术语表和 `bun run check:l10n`，但 `docs/status.md` 和 README 都没有本地化条目（`grep -i 'l10n|translat|zh_CN|locali' docs/status.md README.md` 无输出）。按 2026-10-01 规矩，这是合并前的必做项。建议加一条：「简体中文文本：Partial——上游 2,009 + 机译补充 3,361 条全覆盖，`check:l10n` 校验格式；尚未接入游戏」。

## 1. 质量抽读

样本用 `sample.py` 生成，种子 2281，排除 builder 报告里已抽过的 100 条：
- 主线 100 条：`spyder_` 前缀，并且是 paper / route a·b·3 / cotton / captain / candy 这些地图（候选 162 条）；
- 菜单/战斗/道具/招式/怪物说明 50 条：非剧情前缀（候选 2,223 条）；
- 随机 50 条：其余全部。

我本人通读了全部 200 条。另有一个 subagent 结合上下文（同一段对话的前后句、上游译文、术语表）独立复读了一遍，两边都没有发现改变意思的错译，可改进的地方见表 C。

单独说两条容易误判的：`spyder_candyinn_monk3` 把 "Yes?" 译成「过敏？」，`monk2` 把 "No?" 译成「不过敏？」，这是承接上一句「你对蜂蜇过敏吗？」，译得对。builder 样本里 `spyder_greenwash_fossilisator3`「要我去化石吗？」生硬，但与「去化石仪」术语一致，可以接受。

**错译率 0/200 = 0% < 2%，质量本身不构成阻断。** 整体语气自然口语，人称统一用「你」（补译里「您」只出现 5 次，都是公告或正式场合），数字和条件都保留了。

### 表 C 可改进（非阻断）

| msgid | 英文（节选） | 现译 | 问题 | 建议 |
|---|---|---|---|---|
| spyder_routeb_nephthys2 | you might just be powerful enough to help | 也许只有你有能力帮忙 | 多了「只有」 | 也许你的实力足以帮上忙！ |
| spyder_papertown_momthanks | I invented a zapper | 除虫器 | Ziggurat 是咬电缆的啮齿类 | 电击器 |
| spyder_papertown_grannypiper9 / momthanks / timber_mom2 / momquest | Dearie / sweetie | 宝贝 / 亲爱的 混用 | 同一角色称呼不一；上游 mom2 用「亲爱的」 | 妈妈统一「亲爱的」，奶奶用「孩子」 |
| spyder_candyinn_jess1 | wild honeybee hunter | 野生蜜蜂猎人 | 歧义（「野生的猎人」） | 采野蜂蜜的猎蜂人 |
| spyder_cottontown_hillary | Come back very soon! | 很快再回来看看！ | 语序生硬 | 过些日子再来看看吧！ |
| spyder_cottontunnel_benden_cap | if you're worthy | 如果你足够资格 | 搭配不当 | 如果你够格 |
| poison_courtship_description | slowly poisoning them | 慢慢将其毒倒 | 程度过头 | 使其慢慢中毒 |
| route4_description | Up and down the road again! | 在路上翻山越岭！ | 增义、漏 again | 又在这条路上来来回回！ |
| tsushimi_description | the fleshy plates | 肉质板甲 | 与「铠甲」同义循环 | 肉质甲片 |
| taba_house1_husband_feb12 | a mythical Tuxemon | 传说 Tuxemon | 见 B2 | 传说中的精灵 |
| zestsap_description | Sharp, citrus-like | 尖锐如柑橘 | 「尖锐」不是味觉词 | 酸爽似柑橘 |
| acolyte2challenger9 | these grunts | 这些员工 | 贬义丢失 | 这些手下 |
| eclipse_event15_4 | Follow the dark earth. | 跟随黑暗的土地吧。 | 直译 | 循着黑土走吧。 |
| water_guide1–3 | I'm too scared… | 「我吓得…」 | 原文没有引号 | 去掉「」 |
| spyder_dojo_sokka2 | twice as many as others | 是别人的两倍 | 比较的对象是单属性精灵，不是人 | 有时甚至是单属性精灵的两倍 |
| spyder_dojo_yangchen1 | Metal … weakness to Metal | 金属性的精灵…弱于金的弱点 | 同一句里两种写法；全表属性后缀也混用 X系 / X属性 / 金属性，上游用 X系 | 统一「X系」 |
| tm_blade / tm_shadow_boxing / tm_acid / tm_all_in / tm_frostbite | TM: X | 利刃 / 暗影拳 / 酸液 / 全押 / 冻伤 | 学习器名和它教的招式名（上游：叶之刃 / 太极拳 / 酸 / 全力以赴 / 冻疮）不一致，玩家对不上 | TM 名改用上游招式名 |

## 2. 术语一致（30 个高频专名）

subagent 用脚本统计、我抽查复核。30 个专名里 17 个上游与补译一致：Tuxeball 精灵球、Cathedral 大教堂、Fire/Water/Earth、Taba 塔巴、Xero、Xeon 至强、Potion、Allie 艾莉、Christie 克里斯蒂、Rockitten 小岩猫、Maple 马恩、Captain 船长、Mom 妈妈、Professor 教授、Technique Manual 招式学习器。不一致的已列进 B1/B2。

另外有几处术语表内部的问题，来源都是上游，非阻断，建议在「已知取舍」里列出：
- Shammer Fossil 和 Rhincus Fossil 都译「沙默化石」；
- Pyramidion 和 Sea Girdle 都译「金字塔」；
- Embra 和 Ruption 都译「火球兽」；
- Team Xero Grunt I…X 这 10 条全部是「Xero Grunt I团队」（`glossary.tsv:930-939`）。

补译自己造成的撞名：美食家（怪物 Gastronium 和招式 Gourmet）、马蹄铁（怪物和道具）、龙卷风（怪物 Tornicane 和招式 Tornado）。

### 表 D 与宝可梦官方中文用词相同（非阻断，建议改）
| 英文 | 现译 | 撞的官方词 | 建议 |
|---|---|---|---|
| Boost Armor | 防御强化 | 防御强化（X Defense，同样是战斗内提升 2 级） | 护甲增幅剂 |
| Boost Speed（以及近战/远程/闪避强化系列） | 速度强化 | 速度强化（X Speed） | X增幅剂 |
| Gym Leader X（13 条 `classic_gym_leader_*`） | 道馆馆主X | 道馆馆主 | 馆主X |
| Cureall | 万灵药 | 万灵药（Full Heal）；也是普通词，属边缘情况 | 可留，或改百愈剂 |
| trainer | 训练家 | 训练家 | 训练师（见 B1） |

精灵球、招式学习器、精灵中心都沿用了上游，不算补译照抄。

## 3. 格式

- `bun run check:l10n`：6/6 PASS（en_US 5,370；上游 2,098；补充 3,361）。
- 独立检查（`fmtcheck.py`，自写正则 `${{x}}` / `${x}` / `{x}` / `%s`）：3,361 条中占位符多重集合不一致 0、换行数不一致 0（补译覆盖的英文共 580 个换行，补译里也是 580 个）、空译文 0（`combat_none` 英文本身就是空格）、覆盖上游 0、不在 en_US 的 msgid 0。上游 2,009 + 补充 3,361 = 5,370，全覆盖。
- 全角标点：汉字旁的半角 `, . ! ? : ;` 为 0；没有 ASCII 引号或 `...`。`「」` 不配对只有 1 处（`spyder_greenwash_pc_message3`），是照搬英文原文末尾多出的那个 `'`。
- 非阻断：
  - 换行后的前导空格：英文含 `\n ` 的 304 条里，补译去掉了 146 条，上游 107 条里保留了 100 条，两边不统一，排版时要统一处理；
  - 上游标点以半角为主（汉字后 `.` 1,367 处、`,` 1,115 处），补译是全角，同一游戏里会混用。规格要求补译用全角，所以不算错，建议接线时在加载层统一上游标点。
- builder 报告的数字小误差：「上游 2,098 条」里有 89 条不在 en_US，实际有效是 2,009 条；例外文件有 43 行，不是报告说的 42 行。

### 变异检查（在 `/var/tmp/fleet/2281/mut` 副本里做，已还原）
| 变异 | 结果 |
|---|---|
| `combat_full_health` 删掉 `{name}` | FAIL placeholders ✔ |
| 把上游已有的 `paper_town` 加进补充文件 | FAIL no-overlap ✔ |
| `spyder_dante_candy` 删一个 `\n` | FAIL placeholders ✔ |
| 比利 全部改成 比莉 | FAIL terminology ✔ |
| `spyder_papertown_momquest` 把「精灵球」改成「捕捉器」 | **6/6 仍通过** ✘ |

最后一项漏检的原因：术语匹配区分大小写，又用 `\b` 整词匹配（`tools/check-l10n.ts:170`），所以英文里小写、复数的 "tuxeballs" 不会被检查。按不区分大小写、带复数统计，有 519 处出现被跳过。其中 107 处译文里没有术语表中文，但大多是普通词（strike、fight），所以这个设计本身可以接受。

建议：对 monster / item / npc / place 类别做不区分大小写、带复数的匹配。另外：4 个字母以下的单词（Wood、Mom）不检查；带「／」的并列写法让拉丁词也能通过（B2）；工具也不比对上游与补译之间的术语（B1）。

## 4. 长度

### 表 E 菜单类超过 6 字（`length.py`：按键名前缀 + 英文 ≤28 字符 + 不以句末标点结尾筛出 446 条；占位符按 4 字算）
| msgid | 译文 | 宽度 |
|---|---|---|
| menu_daycare_exp_per_step | 每步经验（每只精灵） | 10 |
| menu_daycare_cost_per_step | 每步费用（每只精灵） | 10 |
| shop_train_to | 训练至 {level} 级 | 9 |
| shop_heal_to | 治疗至 {hp} HP | 9 |
| menu_screen_size | 屏幕尺寸（实验性） | 9 |
| menu_daycare_training_active_single / _double | 训练中（1只精灵）/（2只精灵） | 8.5 |
| menu_daycare_mode_incompatible | 训练（配对不合） | 8 |
| menu_park_seen | 见过的精灵种类 | 7 |
| menu_daycare_parents | 寄养屋中的父母 | 7 |
| cat_bustuarius | 布斯图阿里乌斯 | 7 |

这些英文原文本身就长，带括号的可以去掉括号（例如「每步经验/只」），不阻断。

对话/散文：3,450 行（按 `\n` 切）中 426 行超过 30 字，主线 `spyder_` 1,248 行中 162 行超过 30 字。最长的几条都是怪物图鉴说明：`medipup_description` 67、`delfeco_description` 66、`potturney_description` 65、`kernel_description` 63、`tux_description` 62。上游同口径是 2,543 行里 257 行超过 30 字。builder 把自动折行交给接线任务的排版层，合理；没有一段超过 90 字（三行对话框的容量）。

## 5. 署名与许可
- `licenses/TUXEMON-ATTRIBUTIONS.md`：diff 只在 Translations 名单之后、Special Thanks 之前新增 `### Chinese (Simplified) — Pocket Tuxemon supplement`，明确写了是机器翻译、由本项目维护、不是 Weblate 社区译文；上游原文一个字没改。✔
- `supplement.po` 头的 `X-Comment` 内容正确，但头部格式坏了（B3）。括号里「GPL-3.0-or-later for code-derived text, CC BY-SA for content」的说法比上游更具体：Tuxemon README 只声明代码是 GPLv3+，文本没有单独的许可。建议改成和署名文件一致的「same terms as the Tuxemon text」，非阻断。

## 6. 门禁与原则
- `TUXEMON_SRC=/var/tmp/tuxemon-src bun run check:l10n` → `6/6 checks passed`
- `bunx tsc --noEmit` → exit 0
- `bun run test` → `346 pass / 0 fail / 121539 expect() calls, 55 files [136.38s]`（builder 报告是 344 pass + 2 skip，差异来自本机有 ffmpeg，音频测试没有跳过）
- `git diff --stat main..HEAD`：只动了 `findings/I18N-T.md`、`l10n/zh_CN/*`、`licenses/TUXEMON-ATTRIBUTIONS.md`、`package.json`（加 `check:l10n` 一行）、`tests/l10n-check.test.ts`、`tools/check-l10n.ts`、`tools/l10n-lib.ts`。没有改 `importer/`、`game/`、`ui/`、`vendor/`、`bun.lock`。
- 7 个提交作者都是 `lfkdsk <lfkdsk@gmail.com>`，没有 AI 尾注，信息里没有任务号。

## 给 builder 的修复清单（按顺序）
1. B1：术语表里与上游冲突的条目改用上游译法，source 改 `upstream`，补译按表批量替换；Argon/Zircon 的名牌冲突写进已知取舍。
2. B2：生物统称一律译「精灵」，改掉 60 条拉丁；术语表 `Tuxemon` 改为单值；报告里「上游惯例」的说法改正。
3. B3：`writePo` 头字段加 `\n`，许可说明加成 `#` 注释，加头部可解析的测试。
4. B4：`docs/status.md` 加本地化条目。
5. 可选：表 C / D / E 的改进；检查工具对专名做不区分大小写、带复数的匹配，并加上游↔补译的一致性检查。

subagent 使用：3 个，并行、前台，各约 3–5 分钟。① 30 个高频专名、Tuxemon 规则、称呼的统计（B1/B2 的数据来源，我用自己的脚本复核了关键计数）；② 逐行比对术语表 485 条补译新名与宝可梦等商业官方译名（表 D）；③ 独立复读同一份 200 条样本（和我自己的通读互相印证，表 C 合并了两边的结果）。格式检查、长度统计、变异测试、门禁都是我亲自跑的。省了时间：三块调研同时进行，大约省了 10 分钟。

FAIL
