# I18N-T: 简体中文补译（3,361 条、术语表、占位符检查）

## 结果概览

- en_US 共 **5,370** 条 msgid；上游 zh_CN（Tuxemon Weblate，2023-09）译 **2,098** 条（其中 2,009 条在 en_US 中，其余 89 条是 en_US 没有的条目）；本任务补译 **3,361** 条（约 18.8 万英文字符），覆盖率 100%。
- 产出：
  - `l10n/zh_CN/supplement.po` — 3,361 条机译补充（标准 gettext，文件头注明非 Weblate 社区译文、许可随 Tuxemon 文本）；
  - `l10n/zh_CN/glossary.tsv` — 1,001 条术语（516 条抽自上游译文 + 485 条本项目新拟）；
  - `l10n/zh_CN/glossary-exceptions.txt` — 43 条例外（同名碰撞，逐条注明原因）；
  - `tools/check-l10n.ts`（`bun run check:l10n`）+ `tools/l10n-lib.ts`；
  - `tests/l10n-check.test.ts` — 34 个测试（术语表格式 + 每项检查行为各有用例）。
- 门禁：`check:l10n` 6/6 通过；`bunx tsc --noEmit` 0 错；`bun run test` 344 pass / 2 skip / 0 fail；`bun.lock` 未改；未改导入器与游戏运行时。

## 术语表摘要

| 类别 | 条数 | 说明 |
|---|---|---|
| monster | 406 | 怪物种名；上游 241 + 新拟 165 |
| technique | 274 | 招式名；全部来自 db |
| item | 224 | 道具名（含精灵球变种、浆果、TM、食物） |
| npc | 35 | 人名（Kay Wren、Argon、Zircon、Nimrod 等） |
| element | 13 | 属性（火/水/土/金属/正常 为上游；冰/英勇/天空/暗影/闪电/宇宙 为新拟） |
| place | 4 | 暖棉镇、方登地区、塔巴对战区、Xero（保留拉丁） |
| menu | 35 | 菜单/界面用词 |
| other | 13 | 斯派德、全能公司、精灵、传说精灵、OmniOS 等 |

新拟专名原则：怪物种名按英文构词意译或音意结合（如 Vulpyre→焰狐、Conglolem→砾魔像、Tumbledillo→滚球犰狳）；招式动宾结构（如 Water Bullet→水弹、Tooth for Tooth→以牙还牙）；道具按上游模式（X 精灵球、X 浆果、招式学习器：X）；人名音译；地名意译为主。冲突裁定：Xeon 从上游译「至强」、Maple 从上游译「马恩」；Nudiflot 上游有 ♂/♀ 两形，取 ♂ 为条目（♀ 形出现时按例外处理）。~~Tuxemon 在对话中保留拉丁、散文中作「精灵」（上游惯例），术语表记为「Tuxemon／精灵」。~~ **（此说法不实，已在「修复 1」B2 改正：上游 72 处大写 Tuxemon 中 66 处译「精灵」，生物统称一律译「精灵」，术语表单值。）**

## 检查工具行为（均有用例）

1. **覆盖率**：上游 + 补充覆盖 en_US 全部 msgid；补充文件不得含 en_US 之外的 msgid。
2. **占位符**：每条译文的占位符多重集合（`{name}`、`${{currency}}` 等 47 种）与英文完全一致，`\n` 数量相同。3,361/3,361 通过。
3. **无空译文**（英文本身为空白的 UI 占位串除外，如 `combat_none`）。
4. **无残留英文**：多词英文片段或 ≥5 字母单词必须在白名单（术语表英文列 + 内置缩写表）；占位符内字母不计。有意保留的拉丁（JAS-KERI-BIT、xenos、OmniOS 版本号、内核 trace、文件名「Cut Intro」、R&B）已入白名单。
5. **术语一致**：940 个可执行术语在英文原文出现时，译文必须含对应中文（支持「／」并列同义）；43 条例外全部是同名碰撞（道具名 vs 招式/属性名，如 Feather、Crystal、Stick、Potion），逐条注明。
6. **不覆盖上游**：补充文件与上游 zh_CN 零交集。

## 已知取舍

- **语气**：按规格用全角标点；上游 2023 年译文标点半全角混用，未回改上游。
- **专名白名单**：Xero 及少量文件名、版本号、代号保留拉丁（与上游对话惯例一致）。（Tuxemon 原本在此列，「修复 1」B2 起生物统称一律译「精灵」，仅游戏/模组名保留拉丁。）
- **`\n` 换行**：按英文原样保留数量与位置；中文行长未强制重排（对话框约 30 字/行的约束交给接线任务的排版层）。
- **未译专名**：db 之外的一次性 NPC（如 Route 7 忏悔者、道馆馆主）由各批译者音译，未全部收入术语表；后续接线时如需统一可再补。
- **`old_sphalian_house01`** 英文原文自带 `.,0` 残尾，译文照原样保留。
- **TM 道具名与招式名的关系**：如「TM: Shadow Boxing」道具名译「招式学习器：暗影拳」，招式本身译「太极拳」（从上游），对话中给出 TM 时用招式名。

## 抽样自检（100 条：50 条 spyder 主线 + 50 条随机，种子 2271）

通读后修正 3 处：`spyder_candyport_monk1`「15多个」→「15个以上」；`spyder_xeon_creation4`「潜力上可能比任何人类都更聪明」→「可能比任何人类都聪明」；`eclipse_zircon2_win`「信念能成为的力量」→「信念所能成就的力量」。其余 97 条未发现错误。对照如下：

### spyder_greenwash_fossilisator3
EN: Ah, I see you have a toothed bird fossil. Shall I de-fossilate it?
ZH: 啊，我看到你有一块齿鸟化石。要我去化石吗？

### spyder_drinking_flashback2
EN: Drinking Buddy 1: Dude, you're not even making sense! Sit back down and finish your drink!\n We're in the middle of a sale at Scoop, and I'm not leaving until I get my hands on that new collectible.
ZH: 酒友1：老兄，你都语无伦次了！快坐下把酒喝完！\n 斯库普正在促销，不抢到那款新周边我是不会走的。

### spyder_output_nurse3
EN: There we go! You're all fixed up. Don't worry about it, it's all part of the service.
ZH: 好了！你完全恢复了。别客气，这都是服务的一部分。

### spyder_mansion_reed
EN: Reed
ZH: 里德

### spyder_routea_rosy1
EN: I came here to play with my Shammer, but he's just lazing around in the sun.
ZH: 我来这儿是想和我的犀牛兽玩，可它就只顾着晒太阳偷懒。

### spyder_greenwash_fossilisator9
EN: It worked! The fossils turned into a Shammer and a Rhincus!
ZH: 成功了！化石变成了犀牛兽和飞犀牛！

### spyder_dojo_board_d
EN: It is the Mentor's notes on Techniques.
ZH: 这是导师关于招式的笔记。

### spyder_dojo_kataro
EN: Monk Kataro
ZH: 卡塔罗和尚

### spyder_dojo_iroh
EN: Monk Iroh
ZH: 艾洛和尚

### spyder_walled_augustus
EN: Augustus
ZH: 奥古斯都

### spyder_greenwash_pc_message1
EN: E-mail from Selby to Looten\n 'I've been thinking a lot about the De-Fossilator and I have to admit, I'm getting a bit uneasy about the whole thing.'
ZH: 塞尔比发给卢滕的邮件\n「我最近一直在想去化石仪的事，不得不承认，我对整件事越来越感到不安。」

### spyder_dojo_hermes1
EN: My team are lightning-quick, with high Speed.\n By the time you get around to attacking, we'll have already defeated you.
ZH: 我的队伍快如闪电，速度极高。\n等你反应过来要攻击的时候，我们已经把你打败了。

### spyder_billie_flashback3
EN: Granny: Oh, honey. That must be hard. But remember, you don't have to agree with everything they say.
ZH: 奶奶：哦，宝贝。那一定很难受。但记住，你不必认同他们说的每一句话。

### spyder_dojo_zhu
EN: Zhu
ZH: 朱

### spyder_cottontown_enforcer1
EN: I told you before - scram!
ZH: 我告诉过你——滚！

### spyder_greenwash_dempsey1
EN: This is fine.
ZH: 一切安好。

### spyder_leather_note2
EN: *digs deeper into the trash can, pushing aside banana peels and broken pens* Gross. Okay, what's this? Another notebook...\n Field Notes of Dr Sophia, Conservation Biologist\n My team and I have been monitoring tuxemon populations in the wild, and our data suggests that their numbers are declining at an alarming rate.\n This is likely due to habitat destruction and fragmentation, as well as the increasing demand for tuxemon for military and commercial purposes.\n We've observed that tuxemon are playing a crucial role in maintaining ecosystem balance in certain regions.\n Their loss could have far-reaching consequences for the environment and human societies that depend on these ecosystems.
ZH: *继续往垃圾桶深处挖，拨开香蕉皮和断笔* 好恶心。好吧，这是什么？又一本笔记本……\n保护生物学家索菲娅博士的野外笔记\n我和我的团队一直在监测野生精灵的种群数量，数据显示它们正以惊人的速度减少。\n这很可能是由于栖息地的破坏和碎片化，以及军事和商业用途对精灵日益增长的需求。\n我们观察到，在某些地区，精灵对维持生态平衡起着至关重要的作用。\n失去它们，可能对环境和依赖这些生态系统的人类社会造成深远的后果。

### spyder_greenwash_hunt1
EN: Come work at Greenwash, they said.\n Perform experiments that blur the line between science and madness, they said.\n Look where that got me!
ZH: 他们说，来格林沃什工作吧。\n他们说，来做那些游走在科学与疯狂之间的实验吧。\n看看我落得什么下场！

### spyder_routea_connie2
EN: A tuxemon battle, that's the tonic!
ZH: 一场精灵对战，那才是提神良药！

### spyder_top_mickey
EN: Mickey
ZH: 米奇

### spyder_nimrod_flashback6
EN: Zircon: Compassion? For what? The tuxemon? They're just machines. Tools to be used and discarded.
ZH: 泽康：同情心？对谁？对精灵？它们不过是机器。是用完即弃的工具。

### spyder_candyhouse2_captain
EN: I'm writing a book about my journey to the Archipelago. It is composed of nine volcanic islands.\nAbout 1,400 km (870 mi) west of Paper Town, about 1,500 km (930 mi) north west of Candy Town.
ZH: 我正在写一本关于我群岛之旅的书。它由九座火山岛组成。\n位于纸镇以西约1400公里（870英里），糖果镇西北约1500公里（930英里）。

### spyder_hospital1_fring
EN: Fring
ZH: 弗林

### spyder_dojo_fu_student1b
EN: I can return a monster in its second stage to its intermediary form. \nThe insights from reversing evolution are invaluable to my research.
ZH: 我可以把第二阶段的精灵恢复到中间形态。\n逆转变形带来的洞见，对我的研究来说是无价的。

### spyder_candyinn_cott1
EN: Welcome to Cott's Candy Inn. My name is Cott.
ZH: 欢迎来到科特糖果旅馆。我叫科特。

### spyder_hospital1_melanie
EN: Melanie
ZH: 梅兰妮

### spyder_hospital1_rhizome
EN: Rhizome
ZH: 莱佐姆

### spyder_enforcershq_flashback4
EN: Doc: That's a possibility, but we need to be cautious.\n The inn is isolated, but we can't rule out the possibility of visitors coming or going.
ZH: 医生：有这个可能，但我们必须谨慎。\n 旅馆地处偏僻，但我们不能排除有访客进出的可能。

### spyder_candyport_monk2
EN: The business owner didn't pay the required bribe for the timber, so the officials decided to confiscate it all.
ZH: 那个老板没为这批木材交该交的贿赂，所以官员们决定全部没收。

### spyder_cathedral
EN: Cathedral
ZH: 大教堂

### spyder_hospital2_nurse1
EN: Quarantines have their use, especially for people who don't have tuxemon to heal them,\n but Spyder have used this one very cynically.\n So I don't mind slipping you one of your monsters back.
ZH: 隔离也有隔离的用处，尤其是对那些没有精灵疗伤的人来说，\n但斯派德把这次隔离用得太无耻了。\n所以我不介意偷偷把你的一只精灵还给你。

### spyder_outsidewalled_midas1
EN: Welcome one and all to the Public Garden. \n Lovers of tuxemon and the sport of tuxemon battling are our honored guests.
ZH: 欢迎各位来到公共花园。 \n 喜爱精灵、热爱精灵对战运动的各位，都是我们的贵宾。

### spyder_candyinn_james5
EN: Leave? Sure. An island in the Archipelago.
ZH: 走？当然。去群岛上的一座小岛。

### spyder_leather_note3
EN: *pulls out a moldy pizza box and a stack of old newspapers* This trash can is a treasure trove of grossness. Oh, a journal...\n Journal of Dr John, Historian\n My research on the ancient empire's use of tuxemon has led me to question the official narrative.\n It appears that the empire's relationship with tuxemon was more complex and nuanced than previously thought...\n with evidence of both reverence and exploitation.\n I've discovered a series of ancient texts that suggest the empire's use of tuxemon was not solely for military purposes...\n but also for spiritual and ceremonial reasons.\n These texts, written in a long-forgotten language, offer a glimpse into a world where tuxemon were revered as sacred beings.\n As I delve deeper, I'm uncovering a rich tapestry of stories and legends... revealing the empire's profound connection to the tuxemon.\n Fascinating and unsettling, it raises more questions than answers about the empire's rulers.
ZH: *掏出一个发霉的披萨盒和一摞旧报纸* 这垃圾桶真是个恶心的宝藏。哦，一本日记……\n历史学家约翰博士的日记\n我对古代帝国使用精灵的研究，让我开始质疑官方的说法。\n帝国与精灵的关系似乎比以往认为的更加复杂微妙……\n既有崇敬，也有利用。\n我发现了一系列古代文献，表明帝国使用精灵不仅仅是为了军事目的……\n还有精神和仪式上的原因。\n这些用早已被遗忘的文字写成的文献，让我们得以窥见一个将精灵奉为神圣存在的世界。\n随着研究的深入，我正在揭开一幅由故事和传说织成的丰富画卷……揭示帝国与精灵之间深厚的联系。\n既迷人又令人不安，关于帝国的统治者，它带来的问题远多于答案。

### spyder_routeb_nephthys1
EN: Nothing to see here. Scram!
ZH: 这儿没什么好看的。快走！

### spyder_postintro01
EN: And, the Tuxemon themselves are just a bunch of cute, marketable creatures designed to separate kids from their parents' money.\n I mean, we're creating a whole ecosystem around these things, and it's all just a big cash grab.\n We're exploiting people's desire for novelty and their willingness to spend money on anything that's trendy.
ZH: 而且，Tuxemon本身不过是一群可爱、适合营销的精灵，就是为了掏光孩子们父母的钱。\n 我是说，我们围绕这些东西搞出了一整个生态系统，结果全是为了捞钱。\n 我们在利用人们追求新奇的心理，以及他们愿意为任何时髦东西花钱的心态。

### spyder_cottoncafe_cayden1
EN: Hey, aren't you the guy who stopped the Spyder plot? Can't you do something?
ZH: 嘿，你就是那个粉碎斯派德阴谋的人吧？你就不能想想办法吗？

### spyder_datacenter_lagrange2
EN: The kernel vulnerability was fixed in a supplemental update for OmniOS 6.20.4.
ZH: 该内核漏洞已在OmniOS 6.20.4的补充更新中修复。

### spyder_dojo_orion2
EN: Here is a TM that you may find useful: Shadow Boxing.\n It uses your Melee and their Dodge,\n allowing your strong melee attackers to get around an enemy with high Armor.\n I'll also heal you.
ZH: 这个招式学习器你可能会用得上：太极拳。\n它用你的近战对抗它们的闪避，\n让你强大的近战攻击手绕过护甲高的敌人。\n我也会治愈你。

### spyder_cottontunnel_benden1
EN: We, the Dragonriders, will retreat to Lion Mountain.\n There, we'll watch over this land from afar, hoping that the balance can somehow be restored.
ZH: 我们龙骑士将撤退到狮子山。\n 在那里，我们会远远地守护这片土地，希望平衡有朝一日能够恢复。

### spyder_candyport_monk1
EN: Port authority seized more than 15 illegal containers of timber on a ship. Have you heard about it?
ZH: 港务局在一艘船上查获了15多个非法木材集装箱。你听说了吗？

### spyder_billie_tv_flashback5
EN: Reporter: This is getting intense! Agnigon is down! Fribbit wins! What a stunning upset!
ZH: 记者：战况越来越激烈！焱龙鬣蜥倒下了！弗洛蛙赢了！多么惊人的逆转！

### spyder_candyhouse1_tillie
EN: Tillie
ZH: 蒂莉

### spyder_scoop_arachne_flashback7
EN: Reese: Stop right there! Those Restraints are crucial to containing the tuxemon outbreak.\n You have no idea what kind of damage you could cause if you take them.
ZH: 里斯：站住！那些拘束具对控制精灵疫情至关重要。\n 你不知道拿走它们会造成多大的破坏。

### spyder_xeon_creation4
EN: Dr. Elara: Xeon's neural network is based on advanced algorithms and machine learning techniques.\n It's capable of learning and adapting at an exponential rate, making it potentially more intelligent than any human.
ZH: 埃拉拉博士：至强的神经网络基于先进的算法和机器学习技术。\n 它能够以指数级的速度学习和适应，潜力上可能比任何人类都更聪明。

### spyder_candyinn_monk6
EN: Please take this as apology.
ZH: 请收下这个，当作我的歉意。

### spyder_nimrod_argon_lost
EN: Zircon, you've changed. I don't know what's happened to you.
ZH: 泽康，你变了。我不知道你身上发生了什么。

### spyder_nimrod_note1
EN: Note\n 'I've received an inquiry from the military about our hardware. Let's discuss how to proceed.'
ZH: 便条\n 『军方就我们的硬件发来了问询。我们商量一下该如何应对。』

### spyder_timber_cafe_trigger_after
EN: I'm glad I could share that with you. It's always interesting to see how people react to change.
ZH: 很高兴能和你分享这些。看看人们对变化的反应总是很有意思。

### spyder_nimrod_zircon_lost
EN: You'll never understand, Argon. You'll never see the truth.
ZH: 你永远不会明白，阿贡。你永远看不到真相。

### cat_overseer
EN: Overseer
ZH: 监工

### curse
EN: Curse
ZH: 诅咒

### cat_elf_ring
EN: Elf Ring
ZH: 精灵环

### cat_pottery
EN: Pottery
ZH: 陶器

### cat_rootball
EN: Rootball
ZH: 根球

### flamehorn_shank_description
EN: Thick slices harvested from flamehorn flora—giant, non-sentient fireplants cultivated for seared cuts. Bold, charred, and packed with bite.
ZH: 从焰角植物上切下的厚片——那是专为煎烤而培育的巨型无感知火植物。浓烈焦香，嚼劲十足。

### yamada_description
EN: While ghosts are known for being tricksters, YAMADA tend to take the law seriously, even seeing good behavior as more important than physical might.
ZH: 幽灵向来以爱恶作剧著称，山田却格外认真地对待法律，甚至认为良好的品行比蛮力更重要。

### woodsmash_description
EN: The user slams into the opponent with a powerful wooden strike, dealing damage and potentially knocking them back.
ZH: 使用者以强力的木质一击撞向对手，造成伤害并可能将其击退。

### amnesia_description
EN: The combatants' minds touch, leaving both befuddled.
ZH: 交战双方的意识相触，双双陷入迷茫。

### sort_by_name
EN: Sort by Name
ZH: 按名称排序

### water_omni3
EN: Omnichannel has identified that this village maintains a high-value relationship with water resources.\n Leveraging this asset is key to our long-term sustainability roadmap, or so the brochure says.
ZH: 「全渠道发现，这个村庄与水资源保持着高价值关系。\n利用这一资产是我们长期可持续发展路线图的关键，宣传册上至少是这么说的。」

### buzz_resonator_description
EN: Detects insect-like tuxemon vibrations and hive signals.
ZH: 探测昆虫类精灵的振动与蜂巢信号。

### pastry_description
EN: Flaky pastry filled with a spicy sweetroot swirl. Buttery folds with a firecracker heart.
ZH: 酥脆皮点，裹着辛辣的甜根旋馅。层层奶香，内馅如爆竹般火辣。

### pearamanca_description
EN: PEARAMANCA sells insurance to innocent people just trying to buy fruit, which makes it the most terrifying monster of all.
ZH: 梨螈会向只是想买水果的无辜人们推销保险，这使它成为最可怕的精灵。

### raise_armour_description
EN: Learn the hardness of the diamond. Train Armor.
ZH: 学习钻石的坚硬。锻炼防御。

### headupstairstababa7
EN: The Battle Area Master is up those stairs on the far side.\nI'd wish you luck, but, y'know? I don't actually want you to win!
ZH: 对战区首领就在远处那道楼梯上面。\n我倒是想祝你好运，不过，你懂的？我其实并不想让你赢！

### armour
EN: Armor
ZH: 防御

### taste
EN: Taste
ZH: 口味

### old_sphalian_house01
EN: You watch some TV with your beloved Lv ${{monster_0_level}} ${{monster_0_name}}.,0
ZH: 你和心爱的Lv ${{monster_0_level}} ${{monster_0_name}}一起看了会儿电视。,0

### echo_core
EN: Echo Core
ZH: 回声核心

### neutralize
EN: Neutralize
ZH: 中和

### cat_sleek_boulder
EN: Sleek Boulder
ZH: 滑岩

### raise_melee
EN: Raise Melee
ZH: 近战提升

### water_guide1
EN: To the North is an icy village being attacked by an angry Tuxemon.
ZH: 「北边是一个冰雪村庄，正被一只愤怒的精灵袭击。」

### acolyte2challenger3
EN: Still wondering where I am? I thought you might!\nI'm unlike any Acolyte you've faced before. I'm a shadow, unseen to anything and everyone.\nSoon enough you will fear the true power of ME!\nI am the second Acolyte! Garth!
ZH: 还在想我在哪儿？我就知道你会！\n我和你之前面对的任何侍僧都不同。我是一道暗影，万物与众生都无法看见我。\n很快你就会畏惧我真正的力量！\n我就是第二名侍僧！加思！

### junkyard_07
EN: GARY: People like you shouldn't be able to get Tuxemon like this!
ZH: 「加里：像你这样的人，不配这样得到精灵！」

### kiss
EN: Kiss
ZH: 亲吻

### relation_friend
EN: Friend
ZH: 朋友

### cat_lightning_salamander
EN: Lightning Salamander
ZH: 闪电蝾螈

### nimbulex_description
EN: NIMBULEX dresses itself in sparks and storm clouds to protect its delicate inner core.
ZH: 云布雷克斯用火花与雷云包裹自己，以保护其脆弱的内在核心。

### taba_house3_choice2
EN: Use of pesticides?
ZH: 杀虫剂的使用？

### classic_gym_leader_marin
EN: Gym Leader Marin
ZH: 道馆馆主玛琳

### eclipse_lionmountain_jacques2
EN: Not only is it technically difficult and unstable and frightening \n but your heart goes like crazy because of the altitude.
ZH: 不仅技术难度大、地面不稳、令人害怕，\n 而且因为高原反应，心脏会狂跳不止。

### app_radio_description
EN: Tune in to local broadcasts, quest updates, and ambient chatter from across the region.
ZH: 收听本地广播、任务动态与来自地区各地的环境闲聊。

### combat_state_stat_rose_greatly
EN: {target}'s {stat} rose greatly.
ZH: {target}的{stat}大幅提升了！

### combat_multiattack
EN: Hit {hit_count} time(s)!
ZH: 命中{hit_count}次！

### crystal_town_description
EN: The highest settlement in the Fondent Region!
ZH: 方登地区海拔最高的聚居地！

### eclipse_zircon2_win
EN: Impossible… You cling to ideals, and yet you stand. Perhaps I underestimated what conviction can become.
ZH: 不可能……你死守着理想，却还站着。也许我低估了信念能成为的力量。

### cat_garbage
EN: Garbage
ZH: 垃圾

### deletion_request_description
EN: They try to put the opponent's deletion into a data queue.
ZH: 它们试图将对手的删除请求排入数据队列。

### normal_berry
EN: Normal Berry
ZH: 普通浆果

### mm_metal_description
EN: Learn the particular Metal type technique in this MM. Then it is consumed.
ZH: 学习该招式模块中特定的金属属性招式，学习后即消耗。

### pickoon_description
EN: It enjoys picking things up and stuffing them discreetly into its scarf.
ZH: 它喜欢捡起各种东西，再偷偷塞进自己的围巾里。

### menu_park_highlights
EN: Encounter behavior highlights
ZH: 遭遇行为亮点

### tornicane
EN: Tornicane
ZH: 龙卷风

### acolyte3challenger17
EN: They called me crazy, they called me a fool. I was fired from the research division because they feared me. They feared what I could do!\nHumans and Tuxemon, merged together as one. So in sync that one can't be separated from the other... unless they burn out entirely.
ZH: 他们说我疯了，说我是傻瓜。我被开除，因为他们怕我，怕我能做到的事！\n人类与 Tuxemon，融为一体。契合到无法分离……除非其中一方彻底燃尽。

### agnsher_description
EN: A fusion of two tuxemon.
ZH: 由两只精灵融合而成。

### tabanurse_dialog_cotton
EN: Welcome to the Cotton Town Tuxecenter!\nDo you want to heal your Tuxemon?
ZH: 欢迎来到暖棉镇精灵中心！\n你想治疗你的 Tuxemon 吗？

### cat_flatfoot
EN: Flatfoot
ZH: 平足

### doctsky_description
EN: The little hyena just wants to take care of others, but has a bad reputation after a movie with it as a villain came out.
ZH: 这只小鬣狗只是想照顾别人，但自从一部以它为反派的电影上映后，它的名声就坏了。


## subagent 使用

13 个翻译 subagent（general-purpose，前台并行，每波 4 个共 4 波）：各自翻译 150–300 条并输出 JSON，主 agent 统一术语表、合并、跑检查、通读修正。批次 01 首次输出被截断，拆成 01a/01b 重发后完成。明显省时间：约 18.8 万字符的翻译并行完成，主 agent 只做质量关。

PASS

---

# 修复 1（审查 B1–B4、检查工具加强、表 C/D/E）

审查 `findings/review-task-2271.md` 判 FAIL（译文质量 0/200 错译，但 B1–B4 阻断）。本节记录修复。6 个提交：`6b2596f`（B1）、`17cf947`（B2）、`0ab4c07`（B3）、`7e003bf`（B4）、`13bc2a6`（检查工具）、`0b28496`（表 C/D/E）。

## B1 术语对齐上游

术语表与上游冲突的专名一律改用上游译法，`source` 改 `upstream`，补译按表批量替换（替换处数按 msgstr 内出现次数计）：

| 英文 | 旧译 | 上游译法（出处） | 新译 | 替换处数 |
|---|---|---|---|---|
| Billie | 比利 | 比莉（`spyder_billie` 名牌） | 比莉 | 8 |
| Paper Town | 纸镇 | 方絮（`paper_town` 地图标签），按 Cotton Town 同规则加「镇」 | 方絮镇 | 5 |
| Candy Town | 糖果镇 | 甜饴（`candy_town`） | 甜饴镇 | 1 |
| Timber Town | 木材镇 | 粽木（`timber_town`） | 粽木镇 | 1 |
| Flower City | 花城/花之城 | 彩花（`flower_city`） | 彩花城 | 4 |
| Omnichannel | 全渠道 | 全能公司（`omnichannel_badge` 等，上游 39 处） | 全能公司 | 40（含「全渠道公司」2 处） |
| trainer | 训练家 | 训练师（上游 16 处） | 训练师 | 17 |
| Prof. Kay Wren | 凯·伦教授 | 凯·雷恩（`professorexists3` 对话） | 凯·雷恩（名牌译「凯·雷恩教授」） | 1 |
| Looten | 卢滕 | 罗顿（`spyder_greenwash_looten`） | 罗顿 | 16 |
| Scoop | 斯库普 | 斯考普（`scoop_badge`） | 斯考普 | 6 |
| Shaft | 沙弗特 | 沙夫特（`spyder_shaft_plaque` 等，上游对话 18/20 多数） | 沙夫特 | 6 |
| Nimrod | 宁录 | 尼姆罗德（`spyder_nimrod_plaque` 等，上游 5/10） | 尼姆罗德 | 10 |
| Cotton Town | 暖棉镇 | 暖棉（`cotton_town`） | 暖棉镇（不变，`source` 改 upstream） | 0 |
| Tuxemon | Tuxemon／精灵 | 精灵（`menu_monster` 菜单标签） | 见 B2 | — |

术语表新增 6 条（Paper/Candy/Timber/Flower Town、Shaft、trainer，均 `upstream`）；Nimrod 类别 npc→other（这些是公司/组织名，不是人名）。Argon/Zircon 维持补译音译（阿贡/泽康），见「已知取舍」。

## B2 「精灵」统一

- 补译中 60 条保留拉丁「Tuxemon」的条目，58 条改译「精灵」（含「传说 Tuxemon」→「传说中的精灵」、「豪华Tuxemon」→「豪华精灵」、`spyder_postintro01` 改写避免「精灵……精灵」重复）；拉丁词前后的多余空格一并清理。
- 2 条专有名词保留拉丁：`water_campaign`（战役标题「Tuxemon：混沌之潮」）、`water_ending4`（「下个 Tuxemon 模组见」指游戏本身），已入术语例外。
- 术语表 `Tuxemon` 改单值「精灵」（`source=upstream`，依据：上游菜单标签 `menu_monster` 译文即「精灵」）。
- **更正旧报告失实说法**：上游并非「对话保留拉丁」——英文大写 Tuxemon 的 72 条里上游 66 条译「精灵」，保留拉丁的 2 处对话都不是指生物（机构名、开发者控制台）；补译此前实际按英文大小写分流。

## B3 gettext 头

- `writePo`（`tools/l10n-lib.ts`）：每个头字段在引号内加 `\n`（gettext 拼接续行，旧写法把 11 个字段拼成一行，polib/Babel/gettext 均无法解析）；新增 `headerComments` 参数，以 `#` 注释输出在头条目之前。
- `supplement.po` 头部重写：11 个字段各自 `\n` 结尾；署名与许可说明从坏掉的 `X-Comment` 字段移到文件顶部 4 行 `#` 注释，许可措辞与 `licenses/TUXEMON-ATTRIBUTIONS.md` 一致（「same terms as the Tuxemon text it translates」）。
- 验证：自写严格解析器（不复用 l10n-lib）读出 `Language: zh_CN`、`charset=UTF-8` 等 11 个字段；编译成 `.mo` 后 Python `gettext.GNUTranslations` 加载成功（metadata 正确、查表正确）。新增 3 个测试（严格解析、`writePo` 往返、`.mo` 加载，python3 不可用时跳过最后一个）。

## B4 状态清单

`docs/status.md` 新增 Localization 节：简体中文数据 **Partial**（2,009 条上游 + 3,361 条补译全覆盖 5,370 条 en_US、1,007 条术语表、`check:l10n`）；游戏内接线 **Planned**（运行时仍加载 en_US；标点统一与折行留给接线任务）。

## 检查工具加强

- **术语检查不区分大小写 + 复数/所有格**：monster/item/npc/place/other 五类的匹配改为 `\bterm(?:s'?|'s)?\b`（不区分大小写），覆盖 `tuxeballs`、`Tuxeball's`、`Tuxeballs'`；element/technique/menu 仍大小写敏感整词匹配（fire/strike/fight 等同形普通词）。术语命中数 1,120→1,463。
- **新增第 7 项检查 `upstream-consistency`**：`source=upstream` 的 530 条术语必须与上游一致——tier 1（524 条）：英文是 en_US msgstr 时，对应上游译文必须包含术语表译文（或反之，任取上游多种译法之一，空白归一）；tier 2（6 条：Omnichannel、trainer、Scoop、Shaft、Nimrod、Prof. Kay Wren）：译文必须出现在某条上游译文中。这项检查能在审查期就抓住 B1 类漂移。
- 加强后的检查抓到 **2 处真实漏译**并已修：`brickhemoth_description`（英文有 the tuxemon，译文缺「精灵」）、`spyder_candy_prof1`（英文 ZUNNA!，译文缺「祖纳」）。
- 11 处普通词碰撞入例外（Pastry×3、Feather×2、Potion×3、Kernel×3），1 处改写（`dynastor_description` 翅翼→翅膀）。
- **变异测试**（隔离 worktree `13bc2a6`，每条做完即还原）：

| 变异 | 结果 |
|---|---|
| `spyder_papertown_momquest` 精灵球→捕捉器（英文是小写复数 tuxeballs，审查时漏检的那条） | FAIL terminology ✔ |
| 术语表 Billie 比莉→比利（B1 回退） | FAIL upstream-consistency（`UNVERIFIED: Billie -> 比利 (upstream: 比莉)`）+ 8 条 terminology ✔ |
| `spyder_candy_prof1` 删「祖纳」 | FAIL terminology（Zunna） ✔ |

## 表 C/D/E（可选项，已全部处理）

- **表 D**（避开宝可梦官方词）：Boost Armor/Dodge/Melee/Ranged/Speed 5 件→护甲/闪避/近战/远程/速度增幅剂；Cureall 万灵药→百愈剂；13 条 `classic_gym_leader_*` 道馆馆主X→馆主X。
- **表 E**（菜单 ≤6 字）：10 条缩短（每步经验/只、每步费用/只、升至{level}级、回血{hp}、屏幕尺寸（实验）、训练中1只/2只、配对不合、见过的种类、寄养父母）；`cat_bustuarius`（布斯图阿里乌斯）是怪物类目专名，缩短会丢信息，保留。
- **表 C**：15 条改进全部落实——妈妈/奶奶称呼统一（亲爱的/孩子）、电击器、采野蜂蜜的猎蜂人、够格、使其慢慢中毒、又在这条路上来来回回、肉质甲片、酸爽似柑橘、这些手下、循着黑土走吧、water_guide1–3 去掉英文原文没有的「」、sokka2 比较对象改对、TM 名对齐上游招式名（叶之刃/太极拳/酸/全力以赴/冻疮）。
- **属性后缀统一 X系**：元素+属性的复合词（火属性→火系等 16 处）统一；TM 描述用「金属系」（满足 Metal 术语），对话用「金系」，Metal 术语表加并列值「金属／金系」。

## 已知取舍

- **Nimrod**：上游自身混乱（尼姆罗德 5／宁德 3／徽章「宁录」2）。补译统一「尼姆罗德」（公司铭牌 `spyder_nimrod_plaque` 的用法，也是多数）；徽章名「徽章：宁录」是上游原文，补充文件不覆盖上游，保留。
- **Shaft**：同理，上游对话多数「沙夫特」(18/20)，徽章「徽章：沙弗特」。补译取「沙夫特」，徽章保留上游。
- **Argon/Zircon**：上游名牌是字面误译（氩气/锆石），补译用音译阿贡/泽康。名牌与补译的冲突留给接线任务决定是否加一层上游勘误（补充文件不得覆盖上游）。
- **Tuxemon 保留拉丁 2 处**：`water_campaign`（战役标题）、`water_ending4`（指游戏本身），已入术语例外。
- **金属系/金系**：TM 等道具描述用「金属系」（术语表 Metal 要求「金属」），对话用「金系」；术语表记并列值。
- **上游有效条数**：上游 2,098 条中 89 条不在 en_US，有效 2,009 条；例外文件现 56 条（修复 1 净增 13 条）。

## 门禁

- `TUXEMON_SRC=/var/tmp/tuxemon-src bun run check:l10n` → **7/7**（新增 upstream-consistency）。
- `bunx tsc --noEmit` → 0。
- `bun run test` → **358 pass / 0 fail**（55 个文件；原 346 + 本次新增 12 个 l10n 测试）。
- 未改导入器与运行时（`importer/`、`game/`、`ui/`、`vendor/` 零改动）；`bun.lock` 未改；提交信息无任务号。

## subagent 使用

1 个（general-purpose，前台，约 13 分钟）：执行表 C/D/E 的 40 余条译文改进（规格已给出确切 msgid 与建议译法），主 agent 逐行复核了全部 diff、补了它标记的 1 处奶奶称呼（`spyder_billie_flashback3` 宝贝→孩子）、并裁定了它提出的金属系/金系分歧。省了时间：这批机械替换与主 agent 的报告/门禁工作并行。

PASS
