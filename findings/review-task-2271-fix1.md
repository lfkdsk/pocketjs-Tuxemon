# 复审：I18N-T 修复 1（review of task 2271, fix round 1）

被审分支 `fleet/task-2271`，修复 1 共 6 个提交 `6b2596f..1d581b6`（叠在上一轮审查 `0b5c70c` 之上）。规格 `game-I18N-T-fix1.md`，上一轮审查 `findings/review-task-2271.md`（FAIL，B1–B4）。
**收敛规则**：只判定规格列出的 6 项和回退。新发现的问题如果只是措辞偏好，列为非阻断建议；错译和术语冲突可以阻断。
复审脚本在 `/var/tmp/fleet/2285/`：`b1.py` 统计专名，`namegap.py` 扫上游短标签与补译的冲突，`diffset.py` 抽样；PO 解析沿用上一轮自写的 `po.py`，不复用 `tools/l10n-lib.ts`。

## 结论速览

| 项 | 结论 |
|---|---|
| 1 B1 上一轮表里的专名 | **成立**：表中 13 个专名的旧译在补译里全部清零，全部改成上游译法；术语表 `source=upstream`；新增的 upstream-consistency 检查有辨识力（变异后变红） |
| 1' B1「一律采用上游译法」 | **部分**：还有 2 个上游已有译法的专名与补译冲突（Rutherford 名牌、Team Bazaar），另有补译内部 1 个专名两种写法（Orion），见阻断项 N1 |
| 2 B2「精灵」统一 | **成立**：拉丁「Tuxemon」只剩 2 条，都是游戏或模组名；58 条改动全部读过，其中 20 条抽样全部正确 |
| 3 B3 gettext 头 | **成立**：polib 读出 11 个头字段；编译成 `.mo` 后 Python gettext 能加载，charset 为 UTF-8；Babel 识别出 locale `zh_Hans_CN`；改坏头部后 3 个测试变红 |
| 4 B4 状态清单 | **部分**：条目已加；但其中「`check:l10n` 检查标准 gettext 头」这句不对（阻断项 N3） |
| 5 抽读 100 条（只从修复 1 改动过的 223 条里抽，50 条主线） | 主线 50 条错译 0；其余 50 条错译 1。另外，抽样以外又发现 1 处修复引入的错译（阻断项 N2）。表 C/D/E 的改动都已落实 |
| 6 门禁 | `check:l10n` 7/7，`tsc` 0，`bun run test` 358 pass / 0 fail |

## 阻断项

### N1（属于 B1 范围）还有上游已有译法的专名没有改成上游译法，补译内部也有专名两种写法
修复规格 B1 的要求是：「上游已经有译法的专名（尤其是 NPC 名牌）**一律**采用上游译法」，后面列的 12 个是「至少包括」。复审用 `namegap.py` 把上游所有短标签（725 个英文名）和补译对了一遍，发现下面 3 处属于这一类。它们都是专名冲突，不是措辞偏好：

| 英文 | 上游 | 补译 | 说明 |
|---|---|---|---|
| Rutherford | 名牌 `spyder_searoutec_rutherford`：**卢瑟福** | 名牌 `spyder_leathershaft1_rutherford`：**拉瑟福德** | 两个名牌显示同一个英文名，中文却不同（分别在 `spyder_routec`、`spyder_leather_shaft1` 两张图）。改成「卢瑟福」 |
| Team Bazaar | `spyder_cottoncafe_barmaidintro`（暖棉镇咖啡馆主线对话）：**芭莎团队** | `spyder_mansion_picnicker`：**集市队**；`spyder_mansion_magician1`：Bazaar Mansion「**集市宅邸**」 | 改成「芭莎团队」和「芭莎宅邸」 |
| Orion | 名牌 `spyder_route6_orion`：猎户座（字面误译，和 Argon/Zircon 属于同一类） | `classic_gym_leader_orion`「馆主**奥赖恩**」、`spyder_nimrod_papers2`「**奥赖恩**博士」，但 `spyder_dojo_orion`「**奥利安**和尚」 | 补译内部有两种写法，统一成「奥赖恩」，并在「已知取舍」里补一句上游名牌写的是「猎户座」 |

术语表里没有这三个词，所以 terminology 和 upstream-consistency 两项检查都抓不到。修完后请把它们加进术语表：Rutherford 和 Team Bazaar 标 `upstream`，Orion 标 `supplement`。

### N2（回退）`shop_heal_to` 改短后意思变了
`shop_heal_to`：英文 `Heal to {hp} HP`。修复前译「治疗至 {hp} HP」（正确），修复后为表 E 缩短成「**回血{hp}**」。上游 `tuxemon/states/shop_healing.py:200` 传入的是**目标血量** `min(monster.current_hp + q, monster.hp)`。「回血35」读起来像「回复 35 点」：一只 30/50 HP 的精灵买 5 点，界面会显示「回血35」。这是修复引入的错译。建议改成「回复至{hp}」或「HP回至{hp}」。

同类的小回退：`menu_daycare_mode_incompatible`，英文 `Training (Incompatible Pair)`。修复前「训练（配对不合）」，修复后「**配对不合**」。上游 `daycare.py:130-135` 把它拼成「模式: 配对不合」，玩家就看不到模式其实还是「训练」了。建议改成「训练(不合)」，和 N2 一起修。

### N3（属于 B4）状态清单有一句说法不对
`docs/status.md` 的 Localization 节写着「`bun run check:l10n` enforces … and a standard gettext header」。实际上 `tools/check-l10n.ts` 的 7 项检查（coverage、placeholders、no-empty、no-residual-english、terminology、no-overlap、upstream-consistency）都不看文件头，头部是 `tests/l10n-check.test.ts` 里的 3 个测试在查。验证：在副本里把头字段的 `\n` 全部去掉，`check:l10n` 仍然输出 `7/7 checks passed`，`bun test tests/l10n-check.test.ts` 则有 3 个失败。改法：把这句改成「gettext 头由 `bun run test` 校验」；另外也提一下新增的 upstream-consistency 检查。

## 1. B1 复核

`b1.py` 计数，三列依次是上游 / 修复前补译 / 修复后补译：

| 英文 | 旧译 | 上游译法 |
|---|---|---|
| Billie | 比利 0/8/**0** | 比莉 3/0/**8** |
| Paper Town | 纸镇 0/5/**0** | 方絮 1/0/**5** |
| Candy Town | 糖果镇 2/1/**0** | 甜饴 1/0/**1** |
| Timber Town | 木材镇 1/1/**0** | 粽木 1/0/**1** |
| Flower City | 花之城 0/1/**0** | 彩花城 0/0/**4**（花城只剩「彩花城」里的 4 处） |
| Omnichannel | 全渠道 2/40/**0** | 全能公司 39/0/**40** |
| trainer | 训练家 0/17/**0** | 训练师 23/0/**17** |
| Kay Wren | 凯·伦 0/1/**0** | 凯·雷恩 1/0/**1** |
| Looten | 卢滕 0/16/**0** | 罗顿 1/0/**16** |
| Scoop | 斯库普 0/6/**0** | 斯考普 2/0/**6** |
| Shaft | 沙弗特 2/6/**0** | 沙夫特 18/0/**6** |
| Nimrod | 宁录 2/10/**0** | 尼姆罗德 5/0/**10** |
| 道馆馆主（表 D） | 道馆 0/13/**0** | 馆主 —/13/13 |

- builder 报告「B1 术语对齐上游」表里的替换处数和上面的计数一致。
- 术语表（`l10n/zh_CN/glossary.tsv`）中这些专名都已是 `upstream`：63 Candy Town、140 Flower City、264 Paper Town、316 Shaft、361 Timber Town、368 trainer、920 Billie、928 Looten、931 Nimrod、932 Prof. Kay Wren、962 Cotton Town、1005 Omnichannel、1007 Scoop、1010 Tuxemon。Argon（918）、Zircon（948）仍是 `supplement`，「已知取舍」里写了原因 ✔。
- Nimrod、Shaft 徽章名的上游写法不统一，Argon/Zircon 用音译，这几处取舍都写进了「已知取舍」，理由合理 ✔。

### 变异（在独立 worktree 副本里做，做完即删）

| 变异 | 结果 |
|---|---|
| 补译中改回一处「比利」（`spyder_rivaldownstairs_package`） | `== FAIL terminology`，6/7 ✔ |
| 术语表 Billie 改回「比利」 | `FAIL terminology` + `FAIL upstream-consistency`（`UNVERIFIED 1`），5/7 ✔ |
| 术语表 Looten 和补译一起改成「卢滕」（术语表与补译自洽，只和上游不一致） | `FAIL upstream-consistency`，6/7 ✔。这正是这项新检查要抓的情况：terminology 查不出来，它能查出来 |
| `new_tech_delete` 的「精灵」改回「Tuxemon」 | `FAIL terminology`（`"Tuxemon" -> expected "精灵"`）✔ |
| `writePo` 和 `supplement.po` 头字段都去掉 `\n` | `bun test tests/l10n-check.test.ts`：3 个失败（头部解析、writePo 往返、`.mo` 加载）✔；`check:l10n` 仍 7/7，见 N3 |

非阻断：terminology 按子串匹配，所以「精灵中心」里的「精灵」也算命中了 Tuxemon。例如 `tabanurse_dialog_taba` 把「你的精灵」改回 Tuxemon 时检查不会变红。

## 2. B2 复核
- 补译里还含拉丁「Tuxemon」的只有 2 条：`water_campaign`（「Tuxemon：混沌之潮」，模组标题）和 `water_ending4`（「下个 Tuxemon 模组见」，指游戏本身），都已列入例外。两条都是专有名词，符合规则 ✔。
- 英文含 tuxemon 的条目（subagent 统计，我核对了 58 和 2 这两个数）：

  | 英文写法 | 条数 | 修复前 拉丁/精灵 | 修复后 拉丁/精灵 |
  |---|---|---|---|
  | 大写 | 100 | 60/40 | 2/98 |
  | 小写 | 105 | 0/104 | 0/105 |

  修复前那 1 条两种都没用的是 `brickhemoth_description`，现在补上了「精灵」。
- 从「Tuxemon」改成「精灵」的正好 58 条，和 builder 说的一致，全部读过。用 `Random(2285)` 抽了 20 条细看（`acolyte3challenger25`、`spyder_postintro01`、`professor_dialog`、`healsdone` 等），20/20 意思正确、读起来自然，没有「精灵精灵」重复，也没有多余空格。
- 复合专名没有改坏：Tuxecenter→精灵中心（与上游 `taba_town_sign_tuxecenter` 一致）、Tuxeball→精灵球、Tuxepedia→精灵百科、TuxeVault→Tuxe金库（机构名，保留 Tuxe 合理）。
- 术语表第 1010 行 `Tuxemon	精灵	other	upstream`，单值。报告里「上游惯例是保留拉丁」的说法已更正（`findings/I18N-T.md`「B2」节）✔。

## 3. B3 复核
- 文件头（`l10n/zh_CN/supplement.po:1-17`）：4 行 `#` 注释写来源和许可（与署名文件措辞一致），随后是 11 个各自以 `\n` 结尾的头字段。
- 本机没有 `msgfmt`，改用 polib、Python gettext、Babel 这三个独立实现：

  | 工具 | 结果 |
  |---|---|
  | polib | 读出 11 个 metadata 键，`Language=zh_CN`，`Content-Type=text/plain; charset=UTF-8`，3,361 个条目 |
  | `.mo` + Python gettext | `polib.save_as_mofile` 编译后由 `gettext.GNUTranslations` 加载，`charset()=UTF-8`，`info()['language']=zh_CN`，查表正常 |
  | Babel `read_po` | locale `zh_Hans_CN`，project `Pocket Tuxemon zh_CN supplement`，charset `utf-8`，3,361 条 |

  上一轮这三个工具都解析失败，现在全部正常 ✔。
- 测试：`tests/l10n-check.test.ts` 新增 3 个测试（自写严格解析、`writePo` 往返、`.mo` 加载）。变异后会变红，见第 1 节 ✔。

## 4. B4 复核
`docs/status.md` 新增 Localization 节，README 第 17-19 行已链接到状态清单。

| 条目 | 状态 | 是否准确 |
|---|---|---|
| Simplified Chinese text data | Partial | 数字对：5,370 = 2,009 + 3,361；术语表实际 1,007 行，写作「1,000-entry」可以接受。gettext 头那句不对，见 N3 |
| Chinese text in game | Planned | 准确：运行时仍然只加载 en_US |

## 5. 抽读与表 C/D/E

### 抽样
- 范围：修复 1 改动过的 223 条（主线 79、其他 144）。用种子 2285 各抽 50 条，存在 `/var/tmp/fleet/2285/sample.json`。
- 主线 50 条我本人逐条读过；另有 1 个 subagent 结合前后文和上游，把 100 条全部独立读了一遍。

| 组 | 正确 | 可改进 | 错译 | 术语冲突 |
|---|---|---|---|---|
| 主线（spyder_） | 46 | 3 | 0 | 1（`spyder_mansion_picnicker` 的 Team Bazaar，即 N1；改动前就是这样） |
| 其他 | 43 | 5 | 1（`menu_daycare_mode_incompatible`，即 N2 的小回退） | 1（`boost_armour`，见下方建议） |

抽样以外，又在 `shop_heal_to` 发现一处修复引入的错译（N2）。

### 全量自动扫描（223 条）
- 没有重叠字：镇镇、城城、公司公司、精灵精灵、训练师师、增幅剂剂、系系、的的都是 0。
- 没有旧词残留：Tuxemon、全渠道、训练家、比利、纸镇、糖果镇、木材镇、卢滕、斯库普、沙弗特、宁录、凯·伦、万灵药、道馆馆主都是 0。
- 占位符和 `\n` 个数与英文全部一致。

### 表 C/D/E（可选项）
| 表 | 落实情况 |
|---|---|
| D | 增幅剂 ×5、百愈剂、馆主X ×13 已落实，补译里不再有「道馆」「万灵药」 |
| C | 15 条都已落实。5 个 TM 名与上游招式名一致：叶之刃、太极拳、酸、全力以赴、冻疮 |
| E | 9 条已缩到 6 字以内。`shop_train_to`「升至{level}级」7 字、`menu_screen_size`「屏幕尺寸（实验）」8 字仍超出（指引性，非阻断）。`shop_heal_to` 和 `menu_daycare_mode_incompatible` 缩短时出了错，见 N2 |

属性后缀统一成「X系」没有改出问题：剩下 32 处「属性」都是「类型」的意思，或者是上游用词。

## 6. 门禁
- `TUXEMON_SRC=/var/tmp/tuxemon-src bun run check:l10n` → `7/7 checks passed`（terminology 命中 1,463 处，upstream-source 530 行）。
- `bunx tsc --noEmit` → exit 0。
- `bun run test` → `358 pass / 0 fail / 121604 expect() calls, 55 files [133.51s]`。
- `git diff --stat 0b5c70c..HEAD` 只动了 `docs/status.md`、`findings/I18N-T.md`、`l10n/zh_CN/*`、`tests/l10n-check.test.ts`、`tools/check-l10n.ts`、`tools/l10n-lib.ts`；没碰 `importer/`、`game/`、`ui/`、`vendor/`、`bun.lock`。
- 6 个提交作者都是 `lfkdsk <lfkdsk@gmail.com>`，没有 AI 尾注，提交信息里没有任务号。

## 非阻断建议（措辞，或修复前就有的问题）
- `boost_armour`「护甲增幅剂」和它的说明「防御提升2级」、属性名 `armour`「防御」不一致。这个名字是上一轮审查表 D 自己建议的；道场对话里本来也有 7 处「护甲」。建议统一用「防御增幅剂」，并给 Armor 加术语。
- 58 条补译在英文没有引号的地方加了「」：整段 water 模组台词，以及 `town_hall`「市政厅」、`flower_lady`、`water_outskirts_dude` 等名牌。名牌显示括号很显眼，建议批量去掉。修复 1 只处理了 `water_guide1–3`。
- Arachne（上游名牌「蛛形纲」）、Chip（上游名牌「芯片」）和 Argon/Zircon 一样，是上游把名字字面直译了，补译用的是音译。建议补进「已知取舍」。
- `tm_all_in_description` 译成「树叶弹幕」：上游英文文件里这个 msgid 有两份，第二份是错的，补译跟着它译了。现在道具名已改成「全力以赴」，名字和说明对不上，建议改说明。
- `spyder_dojo_billie3`「他们的」→「她的」；`manhattan_beach_uncle_jeff_opening`「送你你的」中「你」字重复；Daycare 有寄养中心、寄养屋、培育屋三种写法，上游是「日托中心」，建议加术语。
- 建议把 `namegap.py` 的逻辑做进 `check:l10n`：上游短标签的英文名出现在补译英文里时，要求补译里带上上游译法（可走例外）。N1 这一类问题以后就能自动发现。
- `findings/I18N-T.md` 前面几节（修复前写的）还有旧例子，如第 45 行的「暗影拳」和对话样例里的「全渠道」。这些是历史记录，可以不改。

## 给 builder 的修复清单（改完即可收敛）
1. N1：`spyder_leathershaft1_rutherford` 改为「卢瑟福」；`spyder_mansion_picnicker` 改为「芭莎团队」，`spyder_mansion_magician1` 改为「芭莎宅邸」；`spyder_dojo_orion` 改为「奥赖恩和尚」。术语表加 Rutherford、Team Bazaar（`upstream`）和 Orion（`supplement`），「已知取舍」补一句 Orion 的上游名牌是「猎户座」。
2. N2：`shop_heal_to` 改为「回复至{hp}」；`menu_daycare_mode_incompatible` 改为「训练(不合)」。
3. N3：`docs/status.md` 里 gettext 头改为由 `bun run test` 校验的说法，并补上 upstream-consistency 检查。

这三项都只改几行。按收敛规则，其余意见都不阻断。

subagent 使用：2 个，并行、前台，各约 3–4 分钟。① 结合上下文独立读了 100 条抽样，并对 223 条改动做了重叠字、旧词残留、占位符扫描（N1 的 Team Bazaar、N2 的 daycare 来自它的结果）；② 统计 B2 并读完 58 条改动，同时核对表 C/D/E（N2 的 `shop_heal_to` 来自它，我对照上游 `shop_healing.py:200` 复核过）。B1 计数、`namegap.py` 全量扫描（Rutherford、Orion）、B3 三个工具验证、变异测试和门禁都是我亲自跑的。省了时间：抽读和 B2 统计同时进行，大约省了 6–8 分钟。

FAIL
