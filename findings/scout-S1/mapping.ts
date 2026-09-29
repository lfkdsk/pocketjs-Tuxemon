// findings/scout-S1/mapping.ts — emits findings/scout-S1-mapping.json:
// every Tuxemon action / condition / behaviour used by the maps, with its
// tier, use count (census.json, per-file view), kit target and P1 handling.
// Scout S1; not product code.
//
//   bun findings/scout-S1/census.ts > findings/scout-S1/census.json
//   bun findings/scout-S1/mapping.ts
//
// Tiers: T1 maps onto the kit's current vocabulary (possibly lowered by the
// importer); T2 needs a new generic kit capability (ids refer to the T2
// list at the bottom); T3 monster/combat (P2) with a P1 placeholder; T4 not
// needed (presentation, debug, meta, or dead data).

import { readFileSync, writeFileSync } from "node:fs";

type Tier = "T1" | "T2" | "T3" | "T4";
interface Row { tier: Tier; target: string; p1: string; notes?: string; t2?: string[]; split?: Record<string, number> }

const A: Record<string, Row> = {
  translated_dialog: { tier: "T1", target: "text", p1: "msgstr from l18n/en_US base.po; pages split at \\n (Tuxemon paginator), word-wrapped to 52 cols, <=4 lines per text command", notes: "args 2-5 (avatar/position/alignment/style) are layout -> ignored; ${{name}} -> player name (T2-14), ${{currency}}/${{map_name}}/${{north..}} folded at import; 5 keys missing from en_US" },
  char_face: { tier: "T2", target: "moveRoute {target, steps:[faceX]} ; T2-4 target any event ; T2-5 turnToward", p1: "player/self: moveRoute face (T1); other NPCs need T2-4; toward a character needs T2-5", t2: ["T2-4", "T2-5"], split: { player: 1153, npc: 874, towardCharacterOrPlayer: 180 } },
  create_npc: { tier: "T2", target: "NPC event (one per map x slug) + variable local.npc.<slug>=1", p1: "importer fuses spawn guard + talk events into one kit event per NPC; presence is a per-visit variable", notes: "4th arg wander(707)/stand(88) -> page moveType; 29 map x slug pairs spawn at several positions (T2-7 place); 4 slugs missing from db/npc; drawing the NPC (16x32 walker, facing, walk pose) is T2-11", t2: ["T2-6", "T2-7", "T2-11"] },
  transition_teleport: { tier: "T1", target: "transfer {map, x, y, dir, fade}", p1: "always the player; trailing char_face player,<dir> (884) becomes dir; trailing instants are hoisted before the terminal transfer; rgb ignored", notes: "0 of 1049 name a missing map; 14 same-map" },
  add_monster: { tier: "T3", target: "party (P2)", p1: "player gift: variable sys.party_size += 1 and switch mon.<slug>; NPC team setup (3rd arg = npc slug) dropped", split: { toPlayer: 75, toNpc: 717 } },
  char_talk: { tier: "T1", target: "text", p1: "text of the NPC's db/npc speech.profile.default.<field> msgid (pre_battle 301, post_battle_lose 471)", notes: "no profile field is a list, so Tuxemon's random line pick never matters" },
  set_variable: { tier: "T1", target: "variable {id: v.<name>, set: {op:set, value: enumCode}}", p1: "string value -> enum code (1-based index in the variable's sorted value table; 0 = unset)" },
  random_encounter: { tier: "T3", target: "wild encounter (P2)", p1: "no-op (a placeholder on every grass step would be noise)" },
  wait: { tier: "T1", target: "wait {seconds}", p1: "direct" },
  pathfind: { tier: "T2", target: "moveRoute {target, steps:[{pathTo:{x,y}}]} (T2-5)", p1: "dropped in the v1 prototype; needs runtime BFS", t2: ["T2-4", "T2-5"], split: { npc: 278, player: 58 } },
  start_battle: { tier: "T3", target: "battle (P2)", p1: "inline placeholder: text '[BATTLE] <name>' then writes bo.<opp>.won, defeated.<opp>, boc.<opp>.won+1, v.battle_last_result/winner/trainer; skipped when sys.party_size < 1 (Tuxemon skips illegal battles)" },
  unlock_controls: { tier: "T1", target: "(none)", p1: "no-op: a blocking page already freezes the player", notes: "27 events unlock a lock taken by another event -> T2-8 input lock for exactness", t2: ["T2-8"] },
  lock_controls: { tier: "T1", target: "(none)", p1: "no-op inside blocking pages", notes: "21 events lock without unlocking", t2: ["T2-8"] },
  play_map_animation: { tier: "T4", target: "-", p1: "dropped (grass rustle / door puffs)" },
  remove_npc: { tier: "T2", target: "variable local.npc.<slug> = 0", p1: "presence variable; the spawn guard re-spawns it if it still holds (Tuxemon semantics)", t2: ["T2-6"] },
  pathfind_to_char: { tier: "T2", target: "moveRoute {target, steps:[{approach:{target:'player', side?, distance?}}]} (T2-5)", p1: "dropped in v1; all 201 move an NPC to the player", t2: ["T2-4", "T2-5"] },
  play_music: { tier: "T2", target: "bgm hook (T2-12); map.bgm for the `not music_playing X -> play_music X` idiom", p1: "silent", t2: ["T2-12"] },
  set_environment: { tier: "T3", target: "battle backdrop (P2)", p1: "dropped; the `not environment_is X` guard idiom goes with it" },
  translated_dialog_choice: { tier: "T1", target: "choices {prompt:'', options:[{text, commands:[variable v.<var> = code]}]}", p1: "labels from .po; escape leaves the variable unset (Tuxemon re-asks)", notes: "10 uses have 5 or 8 options, 2 labels exceed 24 chars -> T2-9", t2: ["T2-9"], split: { upTo4Options: 139, moreThan4: 10 } },
  add_item: { tier: "T1", target: "item {item, set: add|sub, count}", p1: "negative quantity -> sub; NPC bag (1 use) dropped (T3); item slug read from a variable (elianeoutput, 7 uses) needs a lookup table (T2-16)", notes: "51 distinct slugs; p_monsters_eyes (4 uses) is in no item db file (broken upstream data); kit items need name (<=24 chars) + sprite" },
  char_stop: { tier: "T1", target: "(none)", p1: "no-op (always the player; the mover is frozen during the page)" },
  set_monster_health: { tier: "T3", target: "heal (P2)", p1: "no-op" },
  set_monster_status: { tier: "T3", target: "heal (P2)", p1: "no-op" },
  set_layer: { tier: "T2", target: "screen tint / overlay image (T2-13)", p1: "dropped (night tint, torchlight)", t2: ["T2-13"] },
  char_move: { tier: "T2", target: "moveRoute {steps: moveX...}", p1: "player/self: T1 moveRoute; other NPCs need T2-4", t2: ["T2-4"], split: { player: 12, npc: 65 } },
  play_sound: { tier: "T1", target: "se {name}", p1: "cue (host may ignore in P1)" },
  random_monster: { tier: "T3", target: "party (P2)", p1: "to the player (15 of 39): sys.party_size += 1; NPC teams dropped" },
  clear_variable: { tier: "T1", target: "variable set 0", p1: "direct" },
  char_wander: { tier: "T1", target: "page moveType: random", p1: "bounds (5 uses) need a T2 wander region; frequency ignored" },
  set_monster_attribute: { tier: "T3", target: "-", p1: "dropped" },
  set_teleport_faint: { tier: "T3", target: "faint respawn point (P2)", p1: "dropped (the player cannot faint in P1)" },
  open_shop: { tier: "T2", target: "shop {goods:[{item, price}]} (T2-10)", p1: "items/prices from db/economy; monster/training/heal menus are T3", t2: ["T2-10"] },
  screen_transition: { tier: "T2", target: "fade out/in (T2-13)", p1: "lowered to wait 2*t (same timing, no visual)", t2: ["T2-13"] },
  add_tracker: { tier: "T1", target: "switch tracker.<map> = on", p1: "direct" },
  set_template: { tier: "T2", target: "change sprite (T2-15)", p1: "dropped (swimmer/invisible player sprites)", t2: ["T2-15"] },
  wild_encounter: { tier: "T3", target: "scripted wild battle (P2)", p1: "same placeholder as start_battle, opponent 'wild:<slug>'" },
  char_speed: { tier: "T2", target: "move speed", p1: "ignored", notes: "MV Change Speed; cosmetic in P1" },
  modify_money: { tier: "T1", target: "gold {set: add|sub, amount}", p1: "literal amount (18); from a variable (1) is T2-16", t2: ["T2-16"] },
  get_player_monster: { tier: "T3", target: "-", p1: "dropped" },
  set_bubble: { tier: "T4", target: "(balloon icon)", p1: "dropped", notes: "MV Show Balloon; could become T2 later" },
  set_economy: { tier: "T2", target: "shop goods binding (T2-10)", p1: "importer resolves economy slug -> goods list for the NPC's shop command", t2: ["T2-10"] },
  change_bg: { tier: "T4", target: "-", p1: "dropped (full-screen narration backdrop)" },
  open_journal: { tier: "T3", target: "-", p1: "dropped (monster journal page)" },
  char_plague: { tier: "T3", target: "-", p1: "dropped" },
  add_tech: { tier: "T3", target: "-", p1: "dropped" },
  teleport_faint: { tier: "T3", target: "-", p1: "dropped" },
  access_pc: { tier: "T3", target: "-", p1: "dropped (PC storage); a text stub is fine" },
  format_variable: { tier: "T3", target: "-", p1: "dropped (cathedral bill floats)" },
  get_party_monster: { tier: "T3", target: "-", p1: "dropped" },
  park_experience: { tier: "T3", target: "-", p1: "dropped" },
  quarantine: { tier: "T3", target: "-", p1: "dropped" },
  start_double_battle: { tier: "T3", target: "battle (P2)", p1: "battle placeholder" },
  trading: { tier: "T3", target: "-", p1: "dropped" },
  change_bg_monster: { tier: "T4", target: "-", p1: "dropped" },
  load_yaml: { tier: "T1", target: "(import-time merge)", p1: "importer appends spyder_cathedral.yaml's events to the 7 maps, gated by a local flag the action sets" },
  autosave: { tier: "T4", target: "-", p1: "dropped (the kit has its own save menu)" },
  camera_position: { tier: "T4", target: "-", p1: "dropped (cutscene camera; MV Scroll Map later)" },
  set_mission: { tier: "T3", target: "-", p1: "dropped" },
  set_tuxepedia: { tier: "T3", target: "-", p1: "dropped" },
  remove_collision: { tier: "T1", target: "blocking events", p1: "importer turns a labelled collision zone into invisible blocks:true events whose page ends when the action's switch is set" },
  remove_monster: { tier: "T3", target: "-", p1: "player: sys.party_size -= 1" },
  remove_step_tracker: { tier: "T3", target: "-", p1: "dropped" },
  rename_player: { tier: "T2", target: "name input (T2-14)", p1: "fixed name 'Red'", t2: ["T2-14"] },
  variable_math: { tier: "T2", target: "variable arithmetic with a variable operand (T2-16)", p1: "dropped (cathedral bill, dojo points)", t2: ["T2-16"] },
  change_bg_char: { tier: "T4", target: "-", p1: "dropped" },
  add_step_tracker: { tier: "T3", target: "-", p1: "dropped" },
  dojo_method: { tier: "T3", target: "-", p1: "dropped" },
  modify_bill: { tier: "T3", target: "-", p1: "dropped" },
  quit_world: { tier: "T4", target: "-", p1: "dropped (battle_menu test yaml)" },
  set_char_attribute: { tier: "T4", target: "variable", p1: "player gender from the start menu -> a variable if text ever needs it" },
  set_monster_level: { tier: "T3", target: "-", p1: "dropped" },
  set_step_tracker_milestone_shown: { tier: "T3", target: "-", p1: "dropped" },
  update_time: { tier: "T4", target: "-", p1: "dropped" },
  change_taste: { tier: "T3", target: "-", p1: "dropped" },
  char_run: { tier: "T2", target: "move speed", p1: "ignored" },
  choice_monster: { tier: "T3", target: "choices", p1: "lowered to a plain choices box (5 options -> T2-9)", t2: ["T2-9"] },
  copy_variable: { tier: "T2", target: "variable copy (T2-16)", p1: "dropped", t2: ["T2-16"] },
  daycare: { tier: "T3", target: "-", p1: "dropped" },
  evolution: { tier: "T3", target: "-", p1: "dropped" },
  get_pending_moves: { tier: "T3", target: "-", p1: "dropped" },
  remove_tech: { tier: "T3", target: "-", p1: "dropped" },
  rename_monster: { tier: "T3", target: "-", p1: "dropped" },
  set_bill: { tier: "T3", target: "-", p1: "dropped" },
  set_facing_mode: { tier: "T4", target: "-", p1: "dropped (MV Direction Fix)" },
  set_kennel_visible: { tier: "T3", target: "-", p1: "dropped" },
  set_party_status: { tier: "T3", target: "-", p1: "dropped" },
  tune_radio: { tier: "T4", target: "-", p1: "dropped" },
  update_tile_properties: { tier: "T3", target: "-", p1: "dropped (surfing)" },
  char_position: { tier: "T2", target: "place {target, x, y} (T2-7)", p1: "dropped", t2: ["T2-7"] },
  choice_npc: { tier: "T4", target: "choices", p1: "start-menu appearance pick (6 options): fixed default" },
  create_kennel: { tier: "T3", target: "-", p1: "dropped" },
  fadeout_music: { tier: "T2", target: "bgm hook (T2-12)", p1: "silent", t2: ["T2-12"] },
  info: { tier: "T4", target: "-", p1: "dropped" },
  modify_monster_bond: { tier: "T3", target: "-", p1: "dropped" },
  not: { tier: "T4", target: "-", p1: "dropped: authoring bug (a condition string in an act slot, one event)" },
  play_tile_animation: { tier: "T4", target: "-", p1: "dropped" },
  random_integer: { tier: "T1", target: "variable {set: {op: random, min, max}}", p1: "numeric variable (read by variable_is)" },
  set_random_variable: { tier: "T1", target: "variable random -> enum code", p1: "uniform pick; weights (a=3:b) would need T2", notes: "1 use" },
};

const C: Record<string, Row> = {
  char_at: { tier: "T1", target: "trigger playerTouch (with char_moved: every step) / action (with button_pressed) on the event cell; multi-cell -> T2-1 area", p1: "704 events are multi-cell (24,528 cells) -> T2-1", t2: ["T2-1"] },
  char_exists: { tier: "T2", target: "variable local.npc.<slug> (0/1)", p1: "per-visit bank T2-6", t2: ["T2-6"] },
  char_facing: { tier: "T2", target: "Condition {kind:'facing', dir} + touch re-fires on a turn (T2-3)", p1: "v1 cannot test facing: exit mats fire when crossed sideways (seen in the smoke run)", t2: ["T2-3"] },
  variable_set: { tier: "T1", target: "page condition / if: variable v.<name> ==|!= enumCode (bare name: != 0)", p1: "`not` over several name:value pairs is an OR (rare) -> split pages", t2: ["T2-2"] },
  char_moved: { tier: "T1", target: "trigger playerTouch (fires on entering each cell)", p1: "with areas (T2-1) every step inside the area fires, as in Tuxemon" },
  button_pressed: { tier: "T1", target: "trigger action", p1: "INTERACT 418, K_RETURN 1" },
  battle_outcome: { tier: "T3", target: "switch bo.<opp>.won", p1: "written by the battle placeholder; lost/draw never true in P1" },
  char_facing_tile: { tier: "T1", target: "trigger action on the event cell(s) (front tile in the area)", p1: "the `value` form (surfable, 5) is T3" },
  music_playing: { tier: "T4", target: "-", p1: "constant false; the guarded play_music becomes map.bgm (T2-12)" },
  char_defeated: { tier: "T3", target: "switch defeated.<npc>; player never defeated in P1", p1: "constant false for the player" },
  environment_is: { tier: "T3", target: "-", p1: "constant false (env setters dropped)" },
  current_state: { tier: "T4", target: "-", p1: "WorldState -> true, any other engine state -> false" },
  time_is: { tier: "T2", target: "virtual clock (T2-17) or fixed daytime", p1: "fixed daytime (stage_of_day=morning, daytime=true, dates false)", t2: ["T2-17"] },
  has_item: { tier: "T1", target: "page condition item / if item count>=n (NOT via else)", p1: "direct; less_than/equals quantity forms need if-chains" },
  party_size: { tier: "T3", target: "variable sys.party_size", p1: "kept by add_monster/remove_monster placeholders; NPC party -> true" },
  check_char_parameter: { tier: "T4", target: "-", p1: "constant false (moving flag / cheat names)" },
  char_sprite: { tier: "T2", target: "sprite state (T2-15)", p1: "constant: default sprite", t2: ["T2-15"] },
  has_monster: { tier: "T3", target: "switch mon.<slug>", p1: "set by add_monster placeholder" },
  tracker: { tier: "T1", target: "switch tracker.<map>", p1: "direct" },
  money_is: { tier: "T1", target: "Condition gold >= n", p1: "greater_or_equal (and greater_than n+1) direct; other ops/variable amounts T2-16" },
  battle_outcome_count: { tier: "T3", target: "variable boc.<opp>.won", p1: "counted by the placeholder" },
  check_party_parameter: { tier: "T3", target: "-", p1: "constant false" },
  step_tracker: { tier: "T3", target: "-", p1: "constant false" },
  char_in: { tier: "T3", target: "-", p1: "constant false (surf zones)" },
  tile_property_updated: { tier: "T3", target: "-", p1: "constant false (surfing)" },
  party_infected: { tier: "T3", target: "-", p1: "none -> true, some/all -> false (no plague in P1); keeps Candy Town's story moving" },
  bill_is: { tier: "T3", target: "-", p1: "constant false" },
  check_evolution: { tier: "T3", target: "-", p1: "constant false" },
  check_max_tech: { tier: "T3", target: "-", p1: "constant false" },
  check_world: { tier: "T4", target: "-", p1: "constant false (overlay state)" },
  has_kennel: { tier: "T3", target: "-", p1: "kennel count 0" },
  kennel: { tier: "T3", target: "-", p1: "constant false" },
  location_inside: { tier: "T1", target: "(import-time constant)", p1: "map property `inside` folded at import" },
  char_gender: { tier: "T4", target: "-", p1: "constant (fixed start-menu pick)" },
  char_healed: { tier: "T3", target: "-", p1: "constant false" },
  cooldown_days: { tier: "T2", target: "clock (T2-17)", p1: "constant true", t2: ["T2-17"] },
  has_tuxepedia: { tier: "T3", target: "-", p1: "constant false" },
  location_type: { tier: "T1", target: "(import-time constant)", p1: "map property `map_type` folded at import" },
  player_facing_tile: { tier: "T4", target: "-", p1: "dead: no such condition in tuxemon/event/conditions (the one event never fires upstream either)" },
  bill_exists: { tier: "T3", target: "-", p1: "constant false" },
};

const B: Record<string, Row> = {
  talk: { tier: "T1", target: "the NPC event's action page (match flags per talk event, then bodies)", p1: "expands upstream to `is char_facing_char player,<npc>` + `is button_pressed INTERACT` + prepended `char_face <npc>,player` (turn toward player needs T2-5)", t2: ["T2-5"] },
};

const T2 = [
  { id: "T2-1", name: "event areas", schema: "event.w?, event.h? (default 1)", semantics: "action fires when the faced tile or the player's own tile is inside the rect; playerTouch fires on every entry into a cell of the rect", generic: true, uses: "704 multi-cell events, 24,528 cells" },
  { id: "T2-2", name: "compound page conditions", schema: "condition.all?: Condition[] (AND; the `if` Condition union incl. switch value:false)", semantics: "page active only when every clause holds; lets the kit's trigger arbitration skip pages whose guard fails", generic: true, uses: "965 events carry >= 2 non-trigger clauses" },
  { id: "T2-3", name: "facing condition", schema: "Condition {kind:'facing', dir}", semantics: "player facing test in `all`/`if`; a playerTouch page whose condition reads facing re-fires when the player turns while standing in it", generic: true, uses: "1008 `is char_facing player,<dir>`" },
  { id: "T2-4", name: "move routes on any event", schema: "moveRoute.target: 'player' | 'this' | {event: id}", semantics: "MV Set Movement Route on another event; wait:true parks the caller until that route lands", generic: true, uses: "874 char_face on NPCs, 65 char_move, 278 pathfind, 201 pathfind_to_char" },
  { id: "T2-5", name: "turn-toward and pathfinding steps", schema: "MoveStep += 'turnTowardPlayer' | {turnToward: id} | {pathTo:{x,y}} | {approach:{target, side?, distance?}}", semantics: "expanded when the step starts: deterministic 4-way BFS over the passage table + bodies (fixed neighbour order), re-planned when blocked", generic: true, uses: "336 pathfind, 201 pathfind_to_char, 180 face-toward, 787 talk auto-turn" },
  { id: "T2-6", name: "per-visit (local) variables", schema: "ids with prefix `local.` are cleared on every map entry", semantics: "Tuxemon NPCs and running events live for one map visit", generic: true, uses: "1503 create_npc, 224 remove_npc, 1409 char_exists" },
  { id: "T2-7", name: "place event / initial facing", schema: "{op:'place', target, x, y, dir?}; page.dir?", semantics: "MV Set Event Location; the facing an NPC shows on spawn", generic: true, uses: "29 map x slug spawn positions, char_position 1, char_face right after create_npc" },
  { id: "T2-8", name: "input lock across events", schema: "{op:'lock', value}", semantics: "while set the mover ignores the d-pad even between blocking pages", generic: true, uses: "21 lock-only + 27 unlock-only events" },
  { id: "T2-9", name: "longer choices", schema: "choices.options up to 8 (scrolling), labels up to 32 chars", semantics: "same command, bigger box", generic: true, uses: "10 choices with 5 or 8 options; choice_monster/choice_npc" },
  { id: "T2-10", name: "shop", schema: "{op:'shop', goods:[{item, price}], sell?}; item.price?", semantics: "MV Shop Processing over gold + items", generic: true, uses: "28 open_shop, 16 set_economy (4 economies)" },
  { id: "T2-11", name: "walker NPC sprites", schema: "spriteDef walker with 16x32 frames (anchor = bottom tile), NPC facing + walk pose in the UI", semantics: "Tuxemon sheet 48x128: rows down,left,right,up; cols walk1,idle,walk2", generic: true, uses: "1145 NPC rows, 184 sheets (+ static props)" },
  { id: "T2-12", name: "bgm hook", schema: "{op:'bgm', name, fadeMs?}; map.bgm?", semantics: "cue for the host; silent in P1", generic: true, uses: "200 play_music (196 guarded by `not music_playing`), 1 fadeout_music" },
  { id: "T2-13", name: "screen fade / tint", schema: "{op:'fade', dir:'out'|'in', seconds}; {op:'tint', rgba|image}", semantics: "MV Fadeout/Fadein/Tint Screen", generic: true, uses: "25 screen_transition, 79 set_layer" },
  { id: "T2-14", name: "player name", schema: "text placeholder {name}; optional {op:'nameInput'}", semantics: "display-time substitution", generic: true, uses: "53 msgstr carrying ${{name}}, 5 rename_player" },
  { id: "T2-15", name: "change sprite", schema: "{op:'sprite', target, sprite}", semantics: "MV Change Actor Graphic / event image", generic: true, uses: "24 set_template, 66 char_sprite" },
  { id: "T2-16", name: "variable operands", schema: "variable set {op:'copy'|'add'|'sub'|'mul', from: id}", semantics: "arithmetic with another variable", generic: true, uses: "5 variable_math, 2 copy_variable, 1 modify_money from var" },
  { id: "T2-17", name: "virtual clock (optional)", schema: "sys.time variables advanced by the session", semantics: "day/night stage for time_is; P1 can pin daytime instead", generic: true, uses: "128 time_is, 1 cooldown_days" },
];

const census = JSON.parse(readFileSync(new URL("./census.json", import.meta.url), "utf8"));
const files = census.files;
const byOp: Record<string, { count: number; maps: number }> = {};
for (const r of files.conditionsByOperator) byOp[r.type] = { count: r.count, maps: r.maps };

function rows(list: { type: string; count: number; maps: number; argc: Record<string, number>; examples: string[] }[], table: Record<string, Row>, kind: string) {
  return list.map((r) => {
    const t = table[r.type];
    if (!t) throw new Error(`unclassified ${kind} ${r.type}`);
    const out: Record<string, unknown> = { name: r.type, tier: t.tier, count: r.count, maps: r.maps };
    if (kind === "condition") {
      out.is = byOp[`is ${r.type}`]?.count ?? 0;
      out.not = byOp[`not ${r.type}`]?.count ?? 0;
    }
    Object.assign(out, { target: t.target, p1: t.p1 });
    if (t.split) out.split = t.split;
    if (t.t2) out.t2 = t.t2;
    if (t.notes) out.notes = t.notes;
    out.example = r.examples[0];
    return out;
  });
}

const actions = rows(files.actions, A, "action");
const conditions = rows(files.conditions, C, "condition");
const behaviours = rows(files.behaviours, B, "behaviour");
const tally = (xs: Record<string, unknown>[]) => {
  const t: Record<string, { types: number; uses: number }> = {};
  for (const x of xs) { const k = x.tier as string; t[k] ??= { types: 0, uses: 0 }; t[k].types++; t[k].uses += x.count as number; }
  return t;
};
const doc = {
  format: "pocket-tuxemon/scout-S1-mapping/v1",
  source: { tuxemon: "9e6258ff", kit: "5dd48ef", census: "findings/scout-S1/census.json (per-file view)" },
  totals: {
    events: files.events,
    actionTypes: files.actionTypes, actionUses: files.actionUses,
    conditionTypes: files.conditionTypes, conditionOperatorPairs: files.conditionsByOperator.length, conditionUses: files.conditionUses,
    behaviourUses: files.behaviourUses,
  },
  tiers: {
    T1: "maps onto the kit's current vocabulary (17 op names: 15 commands + variable set/random), possibly lowered by the importer",
    T2: "needs a new generic kit capability (see t2Capabilities)",
    T3: "monster/combat subsystem: P2; P1 placeholder given",
    T4: "not needed: presentation, debug, meta or dead data",
  },
  tierTally: { actions: tally(actions), conditions: tally(conditions) },
  actions,
  conditions,
  behaviours,
  t2Capabilities: T2,
};
writeFileSync(new URL("../scout-S1-mapping.json", import.meta.url), JSON.stringify(doc, null, 1) + "\n");
console.log(JSON.stringify(doc.tierTally));
console.log(`actions ${actions.length}, conditions ${conditions.length}, behaviours ${behaviours.length}`);

// markdown tables for the report (same data, sorted by use count)
const esc = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const md: string[] = [];
md.push("#### 动作（98 种，13,617 次）", "", "| # | 动作 | 次数 | 地图数 | 级别 | Kit 目标 | P1 做法 / 备注 |", "|---|---|---:|---:|---|---|---|");
actions.forEach((a, i) => md.push(`| ${i + 1} | \`${a.name}\` | ${a.count} | ${a.maps} | ${a.tier}${a.t2 ? ` (${(a.t2 as string[]).join(",")})` : ""} | ${esc(a.target)} | ${esc(a.p1)}${a.split ? `；拆分 ${esc(JSON.stringify(a.split))}` : ""}${a.notes ? `；${esc(a.notes)}` : ""} |`));
md.push("", "#### 条件（40 种 / 64 个 is·not 组合，8,663 次）", "", "| # | 条件 | 次数 | is | not | 地图数 | 级别 | Kit 目标 | P1 做法 / 备注 |", "|---|---|---:|---:|---:|---:|---|---|---|");
conditions.forEach((c, i) => md.push(`| ${i + 1} | \`${c.name}\` | ${c.count} | ${c.is} | ${c.not} | ${c.maps} | ${c.tier}${c.t2 ? ` (${(c.t2 as string[]).join(",")})` : ""} | ${esc(c.target)} | ${esc(c.p1)} |`));
md.push("", "#### 行为（behav）", "", "| 行为 | 次数 | 地图数 | 级别 | Kit 目标 | 备注 |", "|---|---:|---:|---|---|---|");
behaviours.forEach((b) => md.push(`| \`${b.name}\` | ${b.count} | ${b.maps} | ${b.tier} | ${esc(b.target)} | ${esc(b.p1)} |`));
md.push("", "#### T2 能力清单", "", "| id | 能力 | schema / 参数 | 语义 | 用量 |", "|---|---|---|---|---|");
for (const t of T2) md.push(`| ${t.id} | ${t.name} | ${esc(t.schema)} | ${esc(t.semantics)} | ${esc(t.uses)} |`);
writeFileSync(new URL("./tables.md", import.meta.url), md.join("\n") + "\n");
