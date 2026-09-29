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
