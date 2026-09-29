// findings/scout-S1/proto.ts — Scout S1 one-off prototype (NOT product code).
//
// Converts a few Tuxemon maps' events into an `rpgkit-project/v1` document
// using ONLY the kit's current vocabulary (T1 + importer-side lowering),
// validates it with the kit's schema validator, and logs every Tuxemon
// action/condition it met with how it was handled (T1 op / lowered /
// dropped as T2 / T3 / T4). The mapping rules are the ones written up in
// findings/scout-S1-events.md.
//
//   bun findings/scout-S1/proto.ts [maps...]
//     default maps: the Spyder opening (bedroom, paper_scoop, downstairs,
//     paper_town). Writes findings/scout-S1/proto-v1.json and
//     findings/scout-S1/proto-log.json; exits 1 on a schema error.
//
// Model, in one breath:
//   * every Tuxemon string variable `name` is a numeric variable `v.name`
//     holding an enum code (0 = unset, k = k-th distinct value, sorted);
//   * NPC presence is `local.npc.<slug>` (0/1): create_npc sets 1,
//     remove_npc 0, `char_exists` reads it; each NPC is one kit event whose
//     page is active while the variable is 1 (the `local.` prefix is the
//     proposed T2 per-visit bank — v1 simply keeps it);
//   * the trigger comes from the guard's SHAPE: char_at(+moved/facing) ->
//     playerTouch, button+facing_tile/char_at -> action, `talk` behaviour
//     -> the NPC's action page, pure state guards -> autorun (visible or
//     blocking work) / parallel (bookkeeping), TMX `init` -> autorun+erase;
//   * a guard clause the v1 page condition cannot hold becomes an `if`
//     around the commands (action/touch/parallel pages) or a derived
//     switch computed by a parallel evaluator (autorun pages);
//   * trainer battles run an inline P1 placeholder that auto-wins and
//     writes every outcome Tuxemon's combat would.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadAllFileEvents,
  loadAllMaps,
  MAPS_DIR,
  parsePo,
  readCollisionCells,
  TUXEMON_SRC,
  type Cond,
  type Rule,
  type TuxEvent,
  type TuxMap,
} from "./tuxsrc.ts";
import { triggerClass } from "./shapes.ts";
import { validateSchema } from "../../vendor/pocket-rpgkit/src/engine/schema-validate.ts";
import type {
  Command,
  Condition,
  Dir,
  GameEvent,
  Item,
  MapDef,
  MoveStep,
  Page,
  PageCondition,
  Project,
  SpriteDef,
} from "../../vendor/pocket-rpgkit/src/engine/types.ts";

const OUT_DIR = new URL(".", import.meta.url).pathname;
const DEFAULT_MAPS = ["spyder_bedroom", "spyder_paper_scoop", "spyder_downstairs", "spyder_paper_town"];
const WANT = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_MAPS;
const PLAYER_NAME = "Red"; // mod.yaml starting_names: npc_red -> "Red"
const AREA_CELL_CAP = 64; // v1 has no event areas: expand up to this many cells

// ---------------------------------------------------------------------------
// sources

const po = parsePo(join(MAPS_DIR, "../l18n/en_US/LC_MESSAGES/base.po"));
const allMaps = new Map(loadAllMaps().map((m) => [m.slug, m]));

interface NpcRow {
  slug: string;
  template: { sprite_name: string; is_static_prop?: boolean };
  speech?: { profile?: { default?: Record<string, string | string[] | undefined> } };
}
const npcDb = new Map<string, NpcRow>();
for (const f of readdirSync(join(TUXEMON_SRC, "mods/tuxemon/db/npc")).sort()) {
  const doc = Bun.YAML.parse(readFileSync(join(TUXEMON_SRC, "mods/tuxemon/db/npc", f), "utf8")) as NpcRow | NpcRow[];
  for (const row of Array.isArray(doc) ? doc : [doc]) npcDb.set(row.slug, row);
}

// ---------------------------------------------------------------------------
// conversion log: every action/condition met, and what happened to it

type Fate = "T1" | "T1-lowered" | "T2-dropped" | "T3-placeholder" | "T3-dropped" | "T4-dropped" | "structural";
const log = new Map<string, { fate: Fate; count: number; note: string }>();
function note(kind: "act" | "cond" | "behav" | "trigger", type: string, fate: Fate, why: string): void {
  const key = `${kind}:${type}:${fate}`;
  const row = log.get(key);
  if (row) row.count++;
  else log.set(key, { fate, count: 1, note: why });
}

// ---------------------------------------------------------------------------
// variables: string values -> enum codes (global, over every map, stable)

const enumValues = new Map<string, Set<string>>();
const addValue = (k: string, v: string) => (enumValues.get(k) ?? enumValues.set(k, new Set()).get(k)!).add(v);
for (const ev of loadAllFileEvents()) {
  for (const a of ev.acts) {
    if (a.type === "set_variable") for (const p of a.args) { const i = p.indexOf(":"); addValue(i < 0 ? p : p.slice(0, i), i < 0 ? "" : p.slice(i + 1)); }
    if (a.type === "translated_dialog_choice" || a.type === "choice_monster" || a.type === "choice_npc") for (const o of a.args[0]!.split(":")) addValue(a.args[1]!, o);
    if (a.type === "start_battle" || a.type === "start_double_battle") addValue("battle_last_trainer", a.args[0] === "player" ? a.args[1]! : a.args[0]!);
  }
  for (const c of ev.conds) if (c.type === "variable_set") for (const p of c.args) { const i = p.indexOf(":"); if (i >= 0 && p.slice(i + 1) !== "") addValue(p.slice(0, i), p.slice(i + 1)); }
}
for (const v of ["won", "lost", "draw"]) addValue("battle_last_result", v);
addValue("battle_last_winner", "player");
const enumTable = new Map([...enumValues.entries()].map(([k, s]) => [k, [...s].sort()]));
const varId = (name: string) => `v.${name.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
function code(name: string, value: string): number {
  const vals = enumTable.get(name);
  const i = vals ? vals.indexOf(value) : -1;
  if (i < 0) throw new Error(`no enum code for ${name}:${value}`);
  return i + 1;
}

// ---------------------------------------------------------------------------
// conditions -> clauses

type Clause =
  | { k: "var"; id: string; op: ">=" | "<=" | "==" | "!="; value: number }
  | { k: "sw"; id: string; on: boolean }
  | { k: "item"; id: string; count: number; has: boolean }
  | { k: "gold"; amount: number; has: boolean }
  | { k: "const"; value: boolean };

const npcVar = (slug: string) => `local.npc.${slug.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
const TRIGGER_CONDS = new Set(["char_at", "char_facing", "char_moved", "button_pressed", "char_facing_tile", "char_facing_char", "player_facing_tile"]);

function cmpClause(id: string, op: string, n: number, negate: boolean): Clause {
  // Tuxemon operators -> the kit's four; negation flips.
  const table: Record<string, [">=" | "<=" | "==" | "!=", number]> = {
    less_than: ["<=", n - 1],
    less_or_equal: ["<=", n],
    greater_than: [">=", n + 1],
    greater_or_equal: [">=", n],
    equals: ["==", n],
    not_equals: ["!=", n],
  };
  let [o, v]: [">=" | "<=" | "==" | "!=", number] = table[op] ?? ["==", n];
  if (negate) {
    if (o === "<=") { o = ">="; v = v + 1; }
    else if (o === ">=") { o = "<="; v = v - 1; }
    else o = o === "==" ? "!=" : "==";
  }
  return { k: "var", id, op: o, value: v };
}

/** One Tuxemon condition -> clauses (AND), or null when it is a trigger-
 *  shape condition consumed by the trigger choice. */
function clauses(c: Cond, m: TuxMap): Clause[] | null {
  const a = c.args;
  const not = c.op === "not";
  const K = (value: boolean): Clause[] => [{ k: "const", value: not ? !value : value }];
  if (TRIGGER_CONDS.has(c.type)) return null;
  switch (c.type) {
    case "variable_set": {
      if (not && a.length > 1) { note("cond", "not variable_set(multi)", "T2-dropped", "NOT of several vars is an OR"); return K(true); }
      note("cond", `${c.op} variable_set`, "T1", "page/if variable compare on the enum code");
      return a.map((p) => {
        const i = p.indexOf(":");
        const k = i < 0 ? p : p.slice(0, i);
        const v = i < 0 ? "" : p.slice(i + 1);
        if (v === "") return { k: "var", id: varId(k), op: not ? "==" : "!=", value: 0 } as Clause;
        return { k: "var", id: varId(k), op: not ? "!=" : "==", value: code(k, v) } as Clause;
      });
    }
    case "char_exists":
      note("cond", `${c.op} char_exists`, "T1-lowered", "local.npc.<slug> presence variable (per-visit reset is T2)");
      return [{ k: "var", id: npcVar(a[0]!), op: not ? "==" : "!=", value: 0 }];
    case "battle_outcome":
      if (a[1] !== "won") { note("cond", `${c.op} battle_outcome(${a[1]})`, "T3-placeholder", "P1 never loses"); return K(false); }
      note("cond", `${c.op} battle_outcome`, "T3-placeholder", "switch bo.<opp>.won written by the battle placeholder");
      return [{ k: "sw", id: `bo.${a[2]}.won`, on: !not }];
    case "battle_outcome_count":
      note("cond", `${c.op} battle_outcome_count`, "T3-placeholder", "variable boc.<opp>.won counted by the placeholder");
      return [cmpClause(`boc.${a[2]}.won`, "greater_or_equal", Number(a[3]), not)];
    case "char_defeated":
      note("cond", `${c.op} char_defeated`, "T3-placeholder", "player never defeated in P1; NPC: switch defeated.<slug>");
      if (a[0] === "player") return K(false);
      return [{ k: "sw", id: `defeated.${a[0]}`, on: !not }];
    case "party_size":
      if (a[0] !== "player") { note("cond", `${c.op} party_size(npc)`, "T3-placeholder", "NPC parties assumed non-empty"); return K(true); }
      note("cond", `${c.op} party_size`, "T3-placeholder", "variable sys.party_size kept by add_monster");
      return [cmpClause("sys.party_size", a[1]!, Number(a[2]), not)];
    case "has_monster":
      note("cond", `${c.op} has_monster`, "T3-placeholder", "switch mon.<slug> set by add_monster");
      return [{ k: "sw", id: `mon.${a[1]}`, on: !not }];
    case "has_item": {
      if (a[0] !== "player") return K(false);
      const count = a[2] && a[3] ? Number(a[3]) + (a[2] === "greater_than" ? 1 : 0) : 1;
      note("cond", `${c.op} has_item`, a[2] && !["greater_than", "greater_or_equal"].includes(a[2]) ? "T2-dropped" : "T1", "item count >= n");
      return [{ k: "item", id: a[1]!, count, has: !not }];
    }
    case "money_is": {
      const ge = a[1] === "greater_or_equal" || a[1] === "greater_than";
      if (!ge || !/^\d+$/.test(a[2]!)) { note("cond", `${c.op} money_is(${a[1]})`, "T2-dropped", "only gold >= n exists"); return K(true); }
      note("cond", `${c.op} money_is`, "T1", "gold >= n");
      return [{ k: "gold", amount: Number(a[2]) + (a[1] === "greater_than" ? 1 : 0), has: !not }];
    }
    case "tracker":
      note("cond", `${c.op} tracker`, "T1", "switch tracker.<map> set by add_tracker");
      return [{ k: "sw", id: `tracker.${a[1]}`, on: !not }];
    case "current_state":
      note("cond", `${c.op} current_state`, "T4-dropped", "WorldState is the only overworld state");
      return K(a[0]!.split(":").includes("WorldState"));
    case "location_inside":
      note("cond", `${c.op} location_inside`, "T1-lowered", "static map property, folded at import");
      return K(m.props.inside === "true");
    case "location_type":
      note("cond", `${c.op} location_type`, "T1-lowered", "static map property, folded at import");
      return K(a[0]!.split(":").includes(m.props.map_type ?? "notype"));
    case "time_is":
      note("cond", `${c.op} time_is`, "T2-dropped", "no clock in P1: fixed daytime");
      if (a[0] === "stage_of_day") return K(a[1] === "equals" ? a[2] === "morning" : a[2] !== "morning");
      if (a[0] === "daytime") return K(a[1] === "equals" ? a[2] === "true" : a[2] !== "true");
      return K(false);
    case "music_playing":
      note("cond", `${c.op} music_playing`, "T4-dropped", "no music in P1");
      return K(false);
    case "environment_is":
      note("cond", `${c.op} environment_is`, "T3-dropped", "battle backdrop only");
      return K(false);
    case "party_infected":
      note("cond", `${c.op} party_infected`, "T3-placeholder", "no plague in P1: none=true");
      return K(a[2] === "none");
    default:
      note("cond", `${c.op} ${c.type}`, "T3-dropped", "monster/party/meta state unknown to P1: fixed answer");
      return K(["cooldown_days"].includes(c.type));
  }
}

function toIf(cl: Clause): { cond: Condition; negate: boolean } {
  switch (cl.k) {
    case "var": return { cond: { kind: "variable", id: cl.id, op: cl.op, value: cl.value }, negate: false };
    case "sw": return { cond: { kind: "switch", id: cl.id, value: cl.on }, negate: false };
    case "item": return { cond: { kind: "item", id: cl.id, count: cl.count }, negate: !cl.has };
    case "gold": return { cond: { kind: "gold", amount: cl.amount }, negate: !cl.has };
    case "const": throw new Error("const clause");
  }
}

/** Wrap commands in nested ifs, one per clause (AND). */
function guard(cls: Clause[], body: Command[]): Command[] {
  let out = body;
  for (const cl of [...cls].reverse()) {
    const { cond, negate } = toIf(cl);
    out = [negate ? { op: "if", if: cond, then: [], else: out } : { op: "if", if: cond, then: out }];
  }
  return out;
}

/** Split clauses into the one v1 PageCondition can carry and the rest. */
function pageCondition(cls: Clause[]): { cond?: PageCondition; rest: Clause[] } {
  const cond: PageCondition = {};
  const rest: Clause[] = [];
  for (const cl of cls) {
    if (cl.k === "var" && !cond.variable) cond.variable = { id: cl.id, op: cl.op, value: cl.value };
    else if (cl.k === "sw" && cl.on && cond.switch === undefined) cond.switch = cl.id;
    else if (cl.k === "item" && cl.has && cl.count === 1 && cond.item === undefined) cond.item = cl.id;
    else rest.push(cl);
  }
  return { cond: Object.keys(cond).length ? cond : undefined, rest };
}

// ---------------------------------------------------------------------------
// text

function wrap(text: string, width = 52): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let cur = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      for (let w = word; w.length; ) {
        const piece = w.length > width ? w.slice(0, width) : w;
        w = w.slice(piece.length);
        if (!cur) cur = piece;
        else if (cur.length + 1 + piece.length <= width) cur += " " + piece;
        else { lines.push(cur); cur = piece; }
      }
    }
    if (cur) lines.push(cur);
  }
  return lines.length ? lines : [" "];
}

function format(s: string, m: TuxMap): string {
  return s
    .replace(/\$\{\{name\}\}/g, PLAYER_NAME)
    .replace(/\$\{\{NAME\}\}/g, PLAYER_NAME.toUpperCase())
    .replace(/\$\{\{currency\}\}/g, "$")
    .replace(/\$\{\{map_name\}\}/g, po.get(m.props.slug ?? m.slug) ?? m.slug)
    .replace(/\$\{\{(north|south|east|west)\}\}/g, (_x, d: string) => po.get(m.props[d] ?? "") ?? m.props[d] ?? "")
    .replace(/\$\{\{[^}]*\}\}/g, "???");
}

/** A translation key -> text boxes: pages split at "\n" (Tuxemon's
 *  paginator), each page word-wrapped to 52 columns and cut into <=4-line
 *  boxes (the kit's text command limits). */
function dialog(key: string, m: TuxMap): Command[] {
  const raw = po.get(key);
  if (raw === undefined) { note("act", "translated_dialog(missing key)", "T4-dropped", "msgid absent from en_US"); return [{ op: "text", lines: [key.slice(0, 52)] }]; }
  const out: Command[] = [];
  for (const page of format(raw, m).replace(/\\n/g, "\n").split("\n").map((p) => p.trim()).filter(Boolean)) {
    const lines = wrap(page);
    for (let i = 0; i < lines.length; i += 4) out.push({ op: "text", lines: lines.slice(i, i + 4) });
  }
  return out.length ? out : [{ op: "text", lines: [" "] }];
}

const npcName = (slug: string) => (po.get(slug) ?? slug).slice(0, 40);

// ---------------------------------------------------------------------------
// actions -> commands

const DIRS = new Set(["up", "down", "left", "right"]);
const FACE: Record<string, MoveStep> = { up: "faceUp", down: "faceDown", left: "faceLeft", right: "faceRight" };
const MOVE: Record<string, MoveStep> = { up: "moveUp", down: "moveDown", left: "moveLeft", right: "moveRight" };
const items = new Map<string, Item>();
const INSTANT = new Set(["set_variable", "clear_variable", "add_item", "add_tracker", "create_npc", "remove_npc", "modify_money", "set_teleport_faint", "set_monster_health", "set_monster_status", "unlock_controls", "lock_controls", "park_experience", "remove_step_tracker", "set_layer"]);

interface Ctx {
  m: TuxMap;
  /** the NPC slug whose event runs these commands (talk pages), if any */
  self?: string;
}

function battle(opp: string): Command[] {
  const body: Command[] = [
    { op: "text", lines: [`[BATTLE] ${npcName(opp)}`.slice(0, 52), "(P1 placeholder: the player wins)"] },
    { op: "switch", id: `bo.${opp}.won`, value: true },
    { op: "switch", id: `defeated.${opp}`, value: true },
    { op: "variable", id: `boc.${opp}.won`, set: { op: "add", value: 1 } },
    { op: "variable", id: varId("battle_last_result"), set: { op: "set", value: code("battle_last_result", "won") } },
    { op: "variable", id: varId("battle_last_winner"), set: { op: "set", value: code("battle_last_winner", "player") } },
    { op: "variable", id: varId("battle_last_trainer"), set: { op: "set", value: code("battle_last_trainer", opp) } },
  ];
  // Tuxemon skips an illegal battle (empty party) and the event goes on.
  return [{ op: "if", if: { kind: "variable", id: "sys.party_size", op: ">=", value: 1 }, then: body }];
}

function convertActions(acts: readonly Rule[], ctx: Ctx): Command[] {
  const out: Command[] = [];
  for (let i = 0; i < acts.length; i++) {
    const a = acts[i]!;
    const g = a.args;
    const isSelf = (slug?: string) => slug !== undefined && slug === ctx.self;
    switch (a.type) {
      case "translated_dialog":
        note("act", a.type, "T1", "text boxes from en_US .po (layout args ignored)");
        out.push(...dialog(g[0]!, ctx.m));
        break;
      case "translated_dialog_choice": case "choice_monster": case "choice_npc": {
        const opts = g[0]!.split(":");
        const fate: Fate = a.type === "translated_dialog_choice" ? (opts.length > 4 ? "T2-dropped" : "T1") : "T3-placeholder";
        note("act", a.type + (opts.length > 4 ? "(>4 options)" : ""), fate, opts.length > 4 ? "kit choices hold 2..4 options: truncated" : "choices -> enum code");
        out.push({
          op: "choices",
          prompt: "",
          options: opts.slice(0, 4).map((o) => ({
            text: (po.get(o) ?? o).slice(0, 24) || o.slice(0, 24),
            commands: [{ op: "variable", id: varId(g[1]!), set: { op: "set", value: code(g[1]!, o) } }],
          })),
        });
        break;
      }
      case "set_variable":
        note("act", a.type, "T1", "variable set enum code");
        for (const p of g) {
          const j = p.indexOf(":");
          const k = j < 0 ? p : p.slice(0, j);
          out.push({ op: "variable", id: varId(k), set: { op: "set", value: code(k, j < 0 ? "" : p.slice(j + 1)) } });
        }
        break;
      case "clear_variable":
        note("act", a.type, "T1", "variable set 0");
        for (const p of g) out.push({ op: "variable", id: varId(p), set: { op: "set", value: 0 } });
        break;
      case "wait":
        note("act", a.type, "T1", "wait seconds");
        if (Number(g[0]) > 0) out.push({ op: "wait", seconds: Math.min(30, Number(g[0])) });
        break;
      case "screen_transition":
        note("act", a.type, "T1-lowered", "fade out+in -> wait 2t (visual fade is T2)");
        out.push({ op: "wait", seconds: Math.min(30, 2 * Number(g[0] ?? 0.3)) });
        break;
      case "play_sound":
        note("act", a.type, "T1", "se cue");
        out.push({ op: "se", name: g[0]!.toLowerCase().replace(/[^a-z0-9_-]/g, "_") });
        break;
      case "add_item": {
        if (g[2] && g[2] !== "player") { note("act", "add_item(npc)", "T3-dropped", "NPC bags are combat-only"); break; }
        const q = g[1] ? Number(g[1]) : 1;
        if (!q) break;
        note("act", a.type, "T1", "item add/sub");
        items.set(g[0]!, { id: g[0]!, name: (po.get(g[0]!) ?? g[0]!).slice(0, 24), sprite: "tux.0" });
        out.push({ op: "item", item: g[0]!, set: q > 0 ? "add" : "sub", count: Math.min(99, Math.abs(q)) });
        break;
      }
      case "modify_money":
        if (g[0] !== "player" || !g[1]) { note("act", "modify_money(var/npc)", "T2-dropped", "amount from a variable"); break; }
        note("act", a.type, "T1", "gold add/sub");
        out.push({ op: "gold", set: Number(g[1]) >= 0 ? "add" : "sub", amount: Math.abs(Number(g[1])) });
        break;
      case "add_tracker":
        note("act", a.type, "T1-lowered", "switch tracker.<map>");
        out.push({ op: "switch", id: `tracker.${g[1]}`, value: true });
        break;
      case "create_npc":
        note("act", a.type, "T1-lowered", "local.npc.<slug> = 1 (spawn position other than the event's is T2 place)");
        out.push({ op: "variable", id: npcVar(g[0]!), set: { op: "set", value: 1 } });
        break;
      case "remove_npc":
        note("act", a.type, "T1-lowered", "local.npc.<slug> = 0");
        out.push({ op: "variable", id: npcVar(g[0]!), set: { op: "set", value: 0 } });
        break;
      case "lock_controls": case "unlock_controls": case "char_stop":
        note("act", a.type, "T1-lowered", "blocking fibers already freeze the player (cross-event locks are T2)");
        break;
      case "char_face": {
        const [who, dir] = [g[0]!, g[1]!];
        if (!DIRS.has(dir)) { note("act", "char_face(toward char)", "T2-dropped", "needs turnToward step"); break; }
        if (who === "player" || isSelf(who)) {
          note("act", a.type, "T1", `moveRoute ${who === "player" ? "player" : "this"} face`);
          out.push({ op: "moveRoute", target: who === "player" ? "player" : "this", wait: false, route: { steps: [FACE[dir]!], repeat: false, skippable: true } });
        } else note("act", "char_face(other npc)", "T2-dropped", "moveRoute target must be an event id");
        break;
      }
      case "char_move": {
        const who = g[0]!;
        if (who !== "player" && !isSelf(who)) { note("act", "char_move(other npc)", "T2-dropped", "moveRoute target must be an event id"); break; }
        const steps: MoveStep[] = [];
        for (const mv of g.slice(1)) {
          const [d, n] = mv.trim().split(/\s+/);
          for (let k = 0; k < Number(n ?? 1); k++) steps.push(MOVE[d!]!);
        }
        note("act", a.type, "T1", "moveRoute steps");
        out.push({ op: "moveRoute", target: who === "player" ? "player" : "this", wait: true, route: { steps, repeat: false, skippable: false } });
        break;
      }
      case "transition_teleport": {
        if (g[0] !== "player") { note("act", "transition_teleport(npc)", "T2-dropped", "only the player transfers"); break; }
        // Tuxemon keeps running the actions after a teleport in the same
        // frame; the kit's transfer ends the page. Hoist trailing instants,
        // fold a trailing `char_face player,<dir>` into the transfer's dir.
        let dir: Dir | "keep" = "keep";
        const hoisted: Rule[] = [];
        for (const b of acts.slice(i + 1)) {
          if (b.type === "char_face" && b.args[0] === "player" && DIRS.has(b.args[1]!)) dir = b.args[1] as Dir;
          else if (INSTANT.has(b.type)) hoisted.push(b);
          else note("act", `${b.type}(after teleport)`, "T4-dropped", "runs on the old map during the fade");
        }
        out.push(...convertActions(hoisted, ctx));
        note("act", a.type, "T1", "transfer (terminal; dir from trailing char_face)");
        out.push({ op: "transfer", map: g[1]!.replace(/\.tmx$/, ""), x: Number(g[2]), y: Number(g[3]), dir, fade: Math.min(2, Number(g[4] ?? 0.3)) });
        return out;
      }
      case "start_battle": case "start_double_battle": {
        const opp = g[0] === "player" ? g[1]! : g[0]!;
        note("act", a.type, "T3-placeholder", "inline placeholder: text + outcome writes");
        out.push(...battle(opp));
        break;
      }
      case "char_talk": {
        const line = npcDb.get(g[0]!)?.speech?.profile?.default?.[g[1]!];
        const key = Array.isArray(line) ? line[0] : line;
        if (!key) { note("act", "char_talk(no line)", "T4-dropped", "profile has no such field"); break; }
        note("act", a.type, "T1-lowered", "text of the NPC's dialogue-profile msgid");
        out.push(...dialog(key, ctx.m));
        break;
      }
      case "add_monster": {
        if (g[2] && g[2] !== "player") { note("act", "add_monster(npc)", "T3-dropped", "trainer teams are P2"); break; }
        note("act", a.type, "T3-placeholder", "sys.party_size += 1, switch mon.<slug>");
        out.push({ op: "variable", id: "sys.party_size", set: { op: "add", value: 1 } });
        out.push({ op: "switch", id: `mon.${g[0]}`, value: true });
        break;
      }
      case "pathfind": case "pathfind_to_char": case "char_wander": case "char_speed": case "char_run":
      case "set_facing_mode": case "char_position":
        note("act", a.type, "T2-dropped", "runtime pathfinding / other-event routes / NPC motion props");
        break;
      case "play_music": case "fadeout_music":
        note("act", a.type, "T2-dropped", "bgm hook (P1: silent)");
        break;
      case "rename_player":
        note("act", a.type, "T2-dropped", "name entry (P1: fixed name)");
        break;
      case "set_environment": case "set_monster_health": case "set_monster_status": case "set_teleport_faint":
      case "random_encounter": case "wild_encounter": case "set_monster_attribute": case "open_journal": case "access_pc":
      case "get_player_monster": case "random_monster": case "set_bill": case "format_variable":
        note("act", a.type, a.type === "random_encounter" ? "T3-dropped" : "T3-dropped", "monster/combat subsystem (P2)");
        break;
      default:
        note("act", a.type, "T4-dropped", "presentation / meta");
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// events

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "event";
const BLOCKING = new Set<Command["op"]>(["text", "choices", "wait", "transfer", "moveRoute"]);
const hasBlocking = (cmds: Command[]): boolean =>
  cmds.some((c) => BLOCKING.has(c.op) || (c.op === "if" && (hasBlocking(c.then) || hasBlocking(c.else ?? []))) || (c.op === "choices"));

interface NpcAgg {
  slug: string;
  x: number;
  y: number;
  wander: boolean;
  face?: string;
  talks: { cls: Clause[]; cmds: Command[] }[];
}

function convertMap(m: TuxMap): { map: MapDef; sprites: Record<string, SpriteDef> } {
  const events: GameEvent[] = [];
  const sprites: Record<string, SpriteDef> = {};
  const npcs = new Map<string, NpcAgg>();
  const npcOf = (s: string, x = 0, y = 0): NpcAgg => npcs.get(s) ?? npcs.set(s, { slug: s, x, y, wander: false, talks: [] }).get(s)!;
  let n = 0;
  const nextId = (name: string) => `e${String(++n).padStart(3, "0")}_${slug(name)}`;
  /** touch/action pages by cell: Tuxemon may stack several guarded events
   *  on one cell (e.g. "My First Mon" / "... - Not Met"); the kit starts
   *  only the first eligible event per trigger, so they merge below. */
  const cellPages = new Map<string, { id: string; name: string; x: number; y: number; trigger: "playerTouch" | "action"; cls: Clause[]; cmds: Command[] }[]>();

  // NPCs first: every create_npc on this map names one NPC event
  for (const e of m.events) for (const a of e.acts) if (a.type === "create_npc") {
    const agg = npcOf(a.args[0]!, Number(a.args[1]), Number(a.args[2]));
    if (a.args[3] === "wander") agg.wander = true;
  }

  for (const e of m.events) {
    const cls0 = e.conds.map((c) => clauses(c, m));
    const cls: Clause[] = cls0.filter((x): x is Clause[] => x !== null).flat();
    if (cls.some((c) => c.k === "const" && !c.value)) { note("trigger", "never-true guard", "T4-dropped", "a fixed-false clause (music/env/time/...) gates it"); continue; }
    const live = cls.filter((c) => c.k !== "const");
    for (const b of e.behavs) note("behav", b.type, "structural", "talk -> NPC action page");
    const k = triggerClass(e);

    // spawn: guard + create_npc -> a parallel page flipping local.npc.<slug>
    if (k === "spawn") {
      for (const a of e.acts) {
        if (a.type === "char_face" && npcs.has(a.args[0]!) && DIRS.has(a.args[1]!)) npcOf(a.args[0]!).face = a.args[1];
        if (a.type === "char_wander" && npcs.has(a.args[0]!)) npcOf(a.args[0]!).wander = true;
      }
      const cmds = convertActions(e.acts.filter((a) => a.type !== "char_face" && a.type !== "char_wander"), { m });
      const { cond, rest } = pageCondition(live);
      events.push({ id: nextId(e.name), name: `${e.name} (spawn guard)`, x: e.x, y: e.y, pages: [{ trigger: "parallel", condition: cond, sprite: null, commands: guard(rest, cmds) }] });
      note("trigger", "spawn", "T1-lowered", "parallel page: guard -> local.npc.<slug> = 1");
      continue;
    }

    // talk: fold into the NPC's action page
    const talk = e.behavs.find((b) => b.type === "talk");
    if (talk) {
      const agg = npcOf(talk.args[0]!);
      agg.talks.push({ cls: live, cmds: convertActions(e.acts, { m, self: talk.args[0] }) });
      note("trigger", "talk", "T1", "NPC event action page (if-chain over talk guards)");
      continue;
    }

    const cmds = convertActions(e.acts, { m });
    if (!cmds.length) { note("trigger", "no-op after conversion", "T4-dropped", "every action dropped"); continue; }
    const cells: [number, number][] = [];
    for (let dy = 0; dy < Math.max(1, e.h); dy++) for (let dx = 0; dx < Math.max(1, e.w); dx++) cells.push([e.x + dx, e.y + dy]);

    if (k.startsWith("touch") || k.startsWith("action")) {
      const trigger = k.startsWith("touch") ? "playerTouch" : "action";
      if (e.conds.some((c) => c.type === "char_facing")) note("cond", "is char_facing(player)", "T2-dropped", "no facing filter on triggers in v1");
      if (cells.length > AREA_CELL_CAP) { note("trigger", `${k}(area>${AREA_CELL_CAP})`, "T2-dropped", "needs event areas"); continue; }
      const base = nextId(e.name);
      cells.forEach(([x, y], i) => {
        const key = `${trigger}|${x},${y}`;
        const list = cellPages.get(key) ?? cellPages.set(key, []).get(key)!;
        list.push({ id: cells.length > 1 ? `${base}_${i}` : base, name: e.name, x, y, trigger, cls: live, cmds });
      });
      note("trigger", k, cells.length > 1 ? "T1-lowered" : "T1", cells.length > 1 ? "area expanded to one event per cell" : trigger);
      continue;
    }

    // pure guards (and init objects)
    const blocking = hasBlocking(cmds);
    const body = e.kind === "init" ? [...cmds, { op: "erase" } as Command] : cmds;
    if (!live.length) {
      events.push({ id: nextId(e.name), name: e.name, x: e.x, y: e.y, pages: [{ trigger: blocking ? "autorun" : "parallel", sprite: null, commands: body }] });
    } else if (!blocking) {
      const { cond, rest } = pageCondition(live);
      events.push({ id: nextId(e.name), name: e.name, x: e.x, y: e.y, pages: [{ trigger: "parallel", condition: cond, sprite: null, commands: guard(rest, body) }] });
    } else {
      const { cond, rest } = pageCondition(live);
      const id = nextId(e.name);
      if (!rest.length) {
        events.push({ id, name: e.name, x: e.x, y: e.y, pages: [{ trigger: "autorun", condition: cond, sprite: null, commands: body }] });
      } else {
        // derived switch: a parallel evaluator keeps c.<id> == AND(clauses)
        const sw = `c.${m.slug}.${id}`;
        events.push({
          id: `${id}_eval`, name: `${e.name} (guard)`, x: e.x, y: e.y,
          pages: [{ trigger: "parallel", sprite: null, commands: [{ op: "switch", id: sw, value: false }, ...guard(live, [{ op: "switch", id: sw, value: true }])] }],
        });
        // The evaluator lags the state by up to two frames (a parallel page
        // restarts one frame after it ends): the autorun therefore drops the
        // switch first and re-checks the live guard before its body, so a
        // stale switch can neither re-run a finished event nor run one whose
        // guard just failed.
        events.push({ id, name: e.name, x: e.x, y: e.y, pages: [{ trigger: "autorun", condition: { switch: sw }, sprite: null, commands: [{ op: "switch", id: sw, value: false }, ...guard(live, body)] }] });
        note("trigger", "guard(compound)", "T1-lowered", "derived switch evaluator (T2 condition.all removes it)");
      }
    }
    note("trigger", e.kind === "init" ? "init" : k, "T1", blocking ? "autorun" : "parallel");
  }

  // one kit event per (trigger, cell): a lone Tuxemon event keeps its page
  // condition; stacked events become one unconditioned page that latches a
  // match flag per member, then runs every matched body (Tuxemon starts all
  // events whose guards hold on that frame).
  for (const list of cellPages.values()) {
    const first = list[0]!;
    if (list.length === 1) {
      const { cond, rest } = pageCondition(first.cls);
      events.push({ id: first.id, name: first.name, x: first.x, y: first.y, pages: [{ trigger: first.trigger, condition: cond, sprite: null, commands: guard(rest, first.cmds) }] });
      continue;
    }
    const flag = (i: number) => `local.cell.${m.slug}.${first.id}.${i}`;
    const commands: Command[] = [];
    list.forEach((p, i) => { if (p.cls.length) commands.push({ op: "switch", id: flag(i), value: false }, ...guard(p.cls, [{ op: "switch", id: flag(i), value: true }])); });
    list.forEach((p, i) => commands.push(...(p.cls.length ? [{ op: "if", if: { kind: "switch", id: flag(i), value: true }, then: p.cmds } as Command] : p.cmds)));
    events.push({ id: first.id, name: list.map((p) => p.name).join(" + "), x: first.x, y: first.y, pages: [{ trigger: first.trigger, sprite: null, commands }] });
    note("trigger", "stacked events on one cell", "T1-lowered", "merged: match flags then bodies");
  }
  events.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // NPC events: page 0 absent; page 1 present while local.npc.<slug> == 1
  for (const agg of npcs.values()) {
    const row = npcDb.get(agg.slug);
    const spriteKey = row ? `npc.${row.template.sprite_name}` : "npc.missing";
    sprites[spriteKey] = { kind: "image", src: row ? `${row.template.is_static_prop ? "sprites_obj" : "sprites"}/${row.template.sprite_name}.png` : "missing.png" };
    // Tuxemon starts EVERY talk event whose guard holds on the INTERACT
    // frame, all guards read before any action runs. Mirror that: latch one
    // match flag per talk first, then run the matched bodies in authored
    // order (sequential where Tuxemon runs them concurrently).
    const chain: Command[] = [];
    const flag = (i: number) => `local.talk.${m.slug}.${slug(agg.slug)}.${i}`;
    agg.talks.forEach((t, i) => {
      if (t.cls.length) chain.push({ op: "switch", id: flag(i), value: false }, ...guard(t.cls, [{ op: "switch", id: flag(i), value: true }]));
    });
    agg.talks.forEach((t, i) => {
      if (!t.cls.length) chain.push(...t.cmds);
      else chain.push({ op: "if", if: { kind: "switch", id: flag(i), value: true }, then: t.cmds });
    });
    if (agg.talks.length) note("behav", "talk(char_face npc,player)", "T2-dropped", "turn toward the player needs a turnTowardPlayer move step");
    const present: Page = {
      condition: { variable: { id: npcVar(agg.slug), op: "==", value: 1 } },
      trigger: "action",
      sprite: spriteKey,
      blocks: true,
      moveType: agg.wander ? "random" : "static",
      commands: chain,
    };
    if (!agg.wander && agg.face) present.moveRoute = { steps: [FACE[agg.face]!], repeat: true, skippable: true };
    events.push({ id: `npc_${slug(agg.slug)}`, name: agg.slug, x: agg.x, y: agg.y, pages: [{ trigger: "action", sprite: null, commands: [] }, present] });
  }

  // terrain placeholder: one pass tile, Tuxemon collision rects blocked
  const blocked = readCollisionCells(join(MAPS_DIR, `${m.slug}.tmx`));
  const passage: [number, "pass" | "block"][] = [];
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (blocked.has(`${x},${y}`)) passage.push([y * m.width + x, "block"]);
  return {
    map: {
      id: m.slug,
      name: (po.get(m.props.slug ?? "") ?? m.slug).slice(0, 40),
      width: m.width,
      height: m.height,
      sheets: ["tux"],
      ground: new Array(m.width * m.height).fill("tux.0"),
      passage,
      events,
    },
    sprites,
  };
}

// ---------------------------------------------------------------------------
// project

const mapDefs: MapDef[] = [];
const sprites: Record<string, SpriteDef> = {};
for (const s of WANT) {
  const m = allMaps.get(s);
  if (!m) throw new Error(`no map ${s}`);
  const r = convertMap(m);
  mapDefs.push(r.map);
  Object.assign(sprites, r.sprites);
}
// start_tuxemon.yaml's Spyder branch, as a one-shot boot page on the start map
const boot: Command[] = [
  ["scenario_choice", "spyder_campaign"], ["gender_choice", "gender_male"], ["race_choice", "white_male"], ["method_money", "conserved"],
].map(([k, v]) => ({ op: "variable", id: varId(k!), set: { op: "set", value: code(k!, v!) } }) as Command);
mapDefs[0]!.events!.unshift({ id: "e000_boot", name: "start_tuxemon (Spyder)", x: 0, y: 0, pages: [{ trigger: "autorun", condition: { variable: { id: "sys.boot", op: "==", value: 0 } }, sprite: null, commands: [...boot, { op: "variable", id: "sys.boot", set: { op: "set", value: 1 } }] }] });

const project: Project = {
  format: "rpgkit-project/v1",
  title: "Pocket Tuxemon — S1 prototype (Spyder opening)",
  tileSize: 16,
  start: { map: WANT[0]!, x: 4, y: 4, dir: "down" },
  initialGold: 500,
  sheets: [{ id: "tux", pak: "placeholder", cols: 1, rows: 1, defaultPassage: "pass" }],
  items: [...items.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
  sprites,
  maps: mapDefs,
};

const schema = JSON.parse(readFileSync(new URL("../../vendor/pocket-rpgkit/src/data/schema.json", import.meta.url), "utf8"));
// validate the document exactly as written (JSON drops undefined keys)
const text = JSON.stringify(project, null, 1) + "\n";
const errors = validateSchema(schema, JSON.parse(text));
writeFileSync(join(OUT_DIR, "proto-v1.json"), text);
const logRows = [...log.entries()]
  .map(([k, v]) => ({ key: k.split(":").slice(0, 2).join(":"), fate: v.fate, count: v.count, note: v.note }))
  .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.fate < b.fate ? -1 : 1));
const byFate: Record<string, number> = {};
for (const r of logRows) byFate[r.fate] = (byFate[r.fate] ?? 0) + r.count;
writeFileSync(join(OUT_DIR, "proto-log.json"), JSON.stringify({ maps: WANT, schemaErrors: errors, byFate, rows: logRows }, null, 1) + "\n");
console.log(`maps: ${WANT.join(", ")}`);
console.log(`events: ${mapDefs.map((m) => `${m.id}=${m.events!.length}`).join(" ")}`);
console.log(`schema errors: ${errors.length}`);
for (const e of errors.slice(0, 20)) console.log(`  ${e.path}: ${e.msg}`);
console.log(`fates: ${JSON.stringify(byFate)}`);
if (errors.length) process.exit(1);
