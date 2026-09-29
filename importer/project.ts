// Tuxemon event-to-rpgkit-project/v1 conversion.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadAllFileEvents,
  loadAllMaps,
  MAPS_DIR,
  parsePo,
  readCollisionCells,
  readCollisionRegions,
  TUXEMON_SRC,
  type Cond,
  type Rule,
  type TuxEvent,
  type TuxMap,
} from "./source.ts";
import { triggerClass } from "./shapes.ts";
import {
  buildCoverageReport,
  type CoverageEntry,
  type CoverageReport,
  type Disposition,
} from "./coverage.ts";
import { validateSchema } from "../vendor/pocket-rpgkit/src/engine/schema-validate.ts";
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
} from "../vendor/pocket-rpgkit/src/engine/types.ts";

export const DEFAULT_MAPS = ["spyder_bedroom", "spyder_paper_scoop", "spyder_downstairs", "spyder_paper_town"];
const PLAYER_NAME = "Red"; // mod.yaml starting_names: npc_red -> "Red"
const AREA_CELL_CAP = 64; // v1 has no event areas: expand up to this many cells

export interface ImportOptions {
  /** K1: emit one rectangular event instead of one event per covered cell. */
  areas: boolean;
  /** K1: retain player-facing trigger predicates. */
  facing: boolean;
  /** K1: emit PageCondition.all instead of derived switches/nested ifs. */
  condAll: boolean;
  /** K1: rely on per-map reset semantics for importer-owned local.* state. */
  localReset: boolean;
  /** K1: emit place commands and page initial directions for dynamic NPCs. */
  place: boolean;
  /** K1: emit cross-event lockInput/unlockInput commands. */
  inputLock: boolean;
  /** K2: target arbitrary events and emit turn/path/approach route steps. */
  routes: boolean;
}

export const DEFAULT_IMPORT_OPTIONS: Readonly<ImportOptions> = Object.freeze({
  areas: false,
  facing: false,
  condAll: false,
  localReset: false,
  place: false,
  inputLock: false,
  routes: false,
});

export const KIT_V2_IMPORT_OPTIONS: Readonly<ImportOptions> = Object.freeze({
  areas: true,
  facing: true,
  condAll: true,
  localReset: true,
  place: true,
  inputLock: true,
  routes: true,
});

/** The K1-only profile remains useful for focused importer regression tests. */
export const K1_IMPORT_OPTIONS: Readonly<ImportOptions> = Object.freeze({
  areas: true,
  facing: true,
  condAll: true,
  localReset: true,
  place: true,
  inputLock: true,
  routes: false,
});

/** The playable G6 profile: all merged K1 constructs plus K2 routes. */
export const G6_IMPORT_OPTIONS: Readonly<ImportOptions> = Object.freeze({
  ...K1_IMPORT_OPTIONS,
  routes: true,
});

const resolveOptions = (options: Partial<ImportOptions> = {}): ImportOptions => ({
  ...DEFAULT_IMPORT_OPTIONS,
  ...options,
});

type FutureCondition = Condition | { kind: "facing"; dir: Dir };
type FuturePageCondition = PageCondition & { all?: FutureCondition[] };
type FutureMoveStep = MoveStep
  | "turnTowardPlayer"
  | { turnToward: "player" | { event: string } }
  | { pathTo: { x: number; y: number } }
  | { approach: { target: "player" | { event: string }; side?: Dir; distance?: number } };
type FutureCommand = Command
  | { op: "lockInput" }
  | { op: "unlockInput" }
  | { op: "place"; target: "this" | { event: string }; x: number; y: number; dir?: Dir }
  | { op: "moveRoute"; target: "player" | "this" | { event: string }; wait?: boolean; route: { steps: FutureMoveStep[]; repeat: boolean; skippable: boolean } };
type FutureGameEvent = GameEvent & { w?: number; h?: number };

const command = (value: FutureCommand): Command => value as Command;
const gameEvent = (value: FutureGameEvent): GameEvent => value;

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

interface EconomyEntry {
  slug: string;
  price?: number;
}
interface EconomyRow {
  slug: string;
  items?: EconomyEntry[];
  monsters?: EconomyEntry[];
}
const economyDb = new Map<string, EconomyRow>();
for (const f of readdirSync(join(TUXEMON_SRC, "mods/tuxemon/db/economy")).sort()) {
  const doc = Bun.YAML.parse(readFileSync(join(TUXEMON_SRC, "mods/tuxemon/db/economy", f), "utf8")) as EconomyRow | EconomyRow[];
  for (const row of Array.isArray(doc) ? doc : [doc]) economyDb.set(row.slug, row);
}

// ---------------------------------------------------------------------------
// conversion log: every action/condition met, and what happened to it

export type Fate = "T1" | "T1-lowered" | "T2-dropped" | "T3-placeholder" | "T3-dropped" | "T4-dropped" | "structural";
const log = new Map<string, { key: string; fate: Fate; count: number; note: string }>();
function note(kind: "act" | "cond" | "behav" | "trigger", type: string, fate: Fate, why: string): void {
  const key = `${kind}:${type}:${fate}`;
  const row = log.get(key);
  if (row) row.count++;
  else log.set(key, { key, fate, count: 1, note: why });
}

interface RecordedDisposition {
  disposition: Disposition;
  reason: string;
}

function dispositionFor(fate: Fate): Disposition {
  if (fate === "T1") return "native";
  if (fate === "T1-lowered") return "degraded";
  if (fate === "T3-placeholder") return "placeholder";
  return "dropped";
}

const sourceEventKey = (event: TuxEvent): string => event.objectId === null
  ? `${event.source}:${event.kind}:${event.name}`
  : `${event.source}:object:${event.objectId}`;

class EventCoverage {
  readonly actions = new Map<Rule, RecordedDisposition>();
  readonly conditions = new Map<Cond, RecordedDisposition>();

  constructor(readonly event: TuxEvent) {}

  action(rule: Rule, fate: Fate, reason: string): void {
    if (!rule.synthetic) this.actions.set(rule, { disposition: dispositionFor(fate), reason });
  }

  condition(rule: Cond, fate: Fate, reason: string): void {
    if (!rule.synthetic) this.conditions.set(rule, { disposition: dispositionFor(fate), reason });
  }

  dropAll(reason: string): void {
    for (const action of this.event.acts) {
      if (!action.synthetic) this.actions.set(action, { disposition: "dropped", reason });
    }
    for (const condition of this.event.conds) {
      if (!condition.synthetic) this.conditions.set(condition, { disposition: "dropped", reason });
    }
  }

  entries(): CoverageEntry[] {
    const missing = "conversion emitted no supported behavior";
    return [
      ...this.event.acts.filter((rule) => !rule.synthetic).map((rule) => ({
        kind: "action" as const,
        type: rule.type,
        sourceType: rule.type,
        ...(this.actions.get(rule) ?? { disposition: "dropped" as const, reason: missing }),
      })),
      ...this.event.conds.filter((rule) => !rule.synthetic).map((rule) => ({
        kind: "condition" as const,
        type: `${rule.op} ${rule.type}`,
        sourceType: rule.type,
        ...(this.conditions.get(rule) ?? { disposition: "dropped" as const, reason: missing }),
      })),
    ];
  }
}

class ConversionCoverage {
  private readonly canonical: TuxEvent[];
  private readonly canonicalKeys: Set<string>;
  private selected = new Map<string, EventCoverage>();

  constructor(events: TuxEvent[]) {
    this.canonical = events;
    this.canonicalKeys = new Set(events.map(sourceEventKey));
    if (this.canonicalKeys.size !== events.length) {
      throw new Error("source-file coverage event keys are not unique");
    }
  }

  reset(): void {
    this.selected.clear();
  }

  commit(event: EventCoverage): void {
    const key = sourceEventKey(event.event);
    if (this.canonicalKeys.has(key) && !this.selected.has(key)) this.selected.set(key, event);
  }

  report(): CoverageReport {
    const entries: CoverageEntry[] = [];
    for (const source of this.canonical) {
      const selected = this.selected.get(sourceEventKey(source));
      if (selected) {
        const sourceActions = source.acts.filter((rule) => !rule.synthetic).map((rule) => rule.type);
        const selectedActions = selected.event.acts.filter((rule) => !rule.synthetic).map((rule) => rule.type);
        const sourceConditions = source.conds.filter((rule) => !rule.synthetic).map((rule) => `${rule.op} ${rule.type}`);
        const selectedConditions = selected.event.conds.filter((rule) => !rule.synthetic).map((rule) => `${rule.op} ${rule.type}`);
        if (sourceActions.join("\0") !== selectedActions.join("\0") ||
            sourceConditions.join("\0") !== selectedConditions.join("\0")) {
          throw new Error(`coverage materialization differs from source event ${sourceEventKey(source)}`);
        }
        entries.push(...selected.entries());
      } else {
        const absent = new EventCoverage(source);
        absent.dropAll("source event is not materialized by any map");
        entries.push(...absent.entries());
      }
    }
    return buildCoverageReport(this.canonical.length, entries);
  }
}

const conversionCoverage = new ConversionCoverage(loadAllFileEvents());
let activeCoverage: EventCoverage | undefined;

function noteAction(rule: Rule, type: string, fate: Fate, why: string): void {
  note("act", type, fate, why);
  activeCoverage?.action(rule, fate, why);
}

function noteCondition(rule: Cond, type: string, fate: Fate, why: string): void {
  note("cond", type, fate, why);
  activeCoverage?.condition(rule, fate, why);
}

// ---------------------------------------------------------------------------
// variables: string values -> enum codes (global, over every map, stable)

const enumValues = new Map<string, Set<string>>();
const valuesFor = (name: string): Set<string> =>
  enumValues.get(name) ?? enumValues.set(name, new Set()).get(name)!;
const addValue = (name: string, value: string) => valuesFor(name).add(value);
const DYNAMIC_VARIABLE_WRITERS: Record<string, number> = {
  translated_dialog_choice: 1,
  choice_monster: 1,
  choice_npc: 1,
  random_integer: 0,
  set_random_variable: 0,
  copy_variable: 0,
  format_variable: 0,
  get_player_monster: 0,
  get_pending_moves: 0,
};
for (const ev of loadAllFileEvents()) {
  for (const a of ev.acts) {
    if (a.type === "set_variable") for (const p of a.args) { const i = p.indexOf(":"); addValue(i < 0 ? p : p.slice(0, i), i < 0 ? "" : p.slice(i + 1)); }
    if (a.type === "set_random_variable" && a.args[0] && a.args[1]) {
      for (const value of a.args[1].split(":")) addValue(a.args[0], value);
    }
    if (a.type === "clear_variable") for (const name of a.args) valuesFor(name);
    if (a.type === "variable_math") valuesFor(a.args[3] ?? a.args[0]!);
    if (a.type in DYNAMIC_VARIABLE_WRITERS) {
      const index = DYNAMIC_VARIABLE_WRITERS[a.type]!;
      const name = a.args[index];
      if (name) valuesFor(name);
    }
    if (a.type === "translated_dialog_choice" || a.type === "choice_monster" || a.type === "choice_npc") for (const o of a.args[0]!.split(":")) addValue(a.args[1]!, o);
    if (a.type === "start_battle" || a.type === "start_double_battle") addValue("battle_last_trainer", a.args[0] === "player" ? a.args[1]! : a.args[0]!);
    if (a.type === "wild_encounter" && a.args[0]) addValue("battle_last_trainer", a.args[0]);
  }
  for (const c of ev.conds) {
    if (c.type === "variable_set") for (const p of c.args) {
      const i = p.indexOf(":");
      const name = i < 0 ? p : p.slice(0, i);
      valuesFor(name);
      if (i >= 0 && p.slice(i + 1) !== "") addValue(name, p.slice(i + 1));
    }
    if (c.type === "variable_is") {
      for (const value of [c.args[0], c.args[2]]) {
        if (value && !/^-?\d+(?:\.\d+)?$/.test(value)) valuesFor(value);
      }
    }
  }
}
for (const map of allMaps.values()) {
  for (const event of map.events) {
    for (const action of event.acts) {
      if (action.type === "load_yaml" && action.args[0]) {
        addValue(`__loaded_yaml.${map.slug}.${action.args[0]}`, "yes");
      }
    }
  }
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
  | { k: "facing"; dir: Dir }
  | { k: "const"; value: boolean };

const npcVar = (slug: string) => `local.npc.${slug.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
const collisionVar = (map: string, key: string) =>
  `local.collision.${map.replace(/[^A-Za-z0-9_.-]/g, "_")}.${key.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
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
function clauses(c: Cond, m: TuxMap, options: ImportOptions): Clause[] | null {
  const a = c.args;
  const not = c.op === "not";
  const K = (value: boolean): Clause[] => [{ k: "const", value: not ? !value : value }];
  if (TRIGGER_CONDS.has(c.type)) {
    if (c.type === "char_facing" && options.facing && c.op === "is" &&
        c.args[0] === "player" && DIRS.has(c.args[1]!)) {
      noteCondition(c, `${c.op} ${c.type}`, "T1", "K1 facing page condition");
      return [{ k: "facing", dir: c.args[1] as Dir }];
    }
    const native = c.type === "button_pressed" || c.type === "char_at" ||
      c.type === "char_moved" || c.type === "char_facing_tile";
    noteCondition(
      c,
      `${c.op} ${c.type}`,
      native ? "T1" : "T2-dropped",
      native ? "consumed by trigger selection" : "trigger predicate unavailable in v1",
    );
    return null;
  }
  switch (c.type) {
    case "variable_set": {
      if (not && a.length > 1) { noteCondition(c, "not variable_set(multi)", "T2-dropped", "NOT of several vars is an OR"); return K(true); }
      noteCondition(c, `${c.op} variable_set`, "T1", "page/if variable compare on the enum code");
      return a.map((p) => {
        const i = p.indexOf(":");
        const k = i < 0 ? p : p.slice(0, i);
        const v = i < 0 ? "" : p.slice(i + 1);
        if (v === "") return { k: "var", id: varId(k), op: not ? "==" : "!=", value: 0 } as Clause;
        return { k: "var", id: varId(k), op: not ? "!=" : "==", value: code(k, v) } as Clause;
      });
    }
    case "char_exists":
      noteCondition(
        c,
        `${c.op} char_exists`,
        options.localReset ? "T1" : "T1-lowered",
        options.localReset
          ? "local.npc.<slug> presence resets on map entry"
          : "local.npc.<slug> presence variable (per-visit reset is T2)",
      );
      return [{ k: "var", id: npcVar(a[0]!), op: not ? "==" : "!=", value: 0 }];
    case "battle_outcome":
      if (a[1] !== "won") { noteCondition(c, `${c.op} battle_outcome(${a[1]})`, "T3-placeholder", "P1 never loses"); return K(false); }
      noteCondition(c, `${c.op} battle_outcome`, "T3-placeholder", "switch bo.<opp>.won written by the battle placeholder");
      return [{ k: "sw", id: `bo.${a[2]}.won`, on: !not }];
    case "battle_outcome_count":
      noteCondition(c, `${c.op} battle_outcome_count`, "T3-placeholder", "variable boc.<opp>.won counted by the placeholder");
      return [cmpClause(`boc.${a[2]}.won`, "greater_or_equal", Number(a[3]), not)];
    case "char_defeated":
      noteCondition(c, `${c.op} char_defeated`, "T3-placeholder", "player never defeated in P1; NPC: switch defeated.<slug>");
      if (a[0] === "player") return K(false);
      return [{ k: "sw", id: `defeated.${a[0]}`, on: !not }];
    case "party_size":
      if (a[0] !== "player") { noteCondition(c, `${c.op} party_size(npc)`, "T3-placeholder", "NPC parties assumed non-empty"); return K(true); }
      noteCondition(c, `${c.op} party_size`, "T3-placeholder", "variable sys.party_size kept by add_monster");
      return [cmpClause("sys.party_size", a[1]!, Number(a[2]), not)];
    case "has_monster":
      noteCondition(c, `${c.op} has_monster`, "T3-placeholder", "switch mon.<slug> set by add_monster");
      return [{ k: "sw", id: `mon.${a[1]}`, on: !not }];
    case "has_item": {
      if (a[0] !== "player") {
        noteCondition(c, `${c.op} has_item(npc)`, "T3-dropped", "NPC inventory is combat-only");
        return K(false);
      }
      const count = a[2] && a[3] ? Number(a[3]) + (a[2] === "greater_than" ? 1 : 0) : 1;
      noteCondition(c, `${c.op} has_item`, a[2] && !["greater_than", "greater_or_equal"].includes(a[2]) ? "T2-dropped" : "T1", "item count >= n");
      return [{ k: "item", id: a[1]!, count, has: !not }];
    }
    case "money_is": {
      if (!/^\d+$/.test(a[2]!)) {
        noteCondition(c, `${c.op} money_is(variable)`, "T2-dropped", "gold comparison uses a variable operand");
        return K(true);
      }
      const n = Number(a[2]);
      const op = a[1];
      const atLeast = op === "greater_than" ? n + 1
        : op === "greater_or_equal" ? n
        : op === "less_or_equal" ? n + 1
        : op === "less_than" ? n
        : null;
      if (atLeast === null) {
        noteCondition(c, `${c.op} money_is(${op})`, "T2-dropped", "unsupported gold comparison");
        return K(true);
      }
      noteCondition(c, `${c.op} money_is`, "T1", "gold >= n");
      const lowerBound = op === "greater_than" || op === "greater_or_equal";
      return [{ k: "gold", amount: atLeast, has: lowerBound ? !not : not }];
    }
    case "tracker":
      noteCondition(c, `${c.op} tracker`, "T1", "switch tracker.<map> set by add_tracker");
      return [{ k: "sw", id: `tracker.${a[1]}`, on: !not }];
    case "current_state":
      noteCondition(c, `${c.op} current_state`, "T1-lowered", "folded against the P1 WorldState-only runtime");
      return K(a[0]!.split(":").includes("WorldState"));
    case "location_inside":
      noteCondition(c, `${c.op} location_inside`, "T1", "static map property, folded at import");
      return K(m.props.inside === "true");
    case "location_type":
      noteCondition(c, `${c.op} location_type`, "T1", "static map property, folded at import");
      return K(a[0]!.split(":").includes(m.props.map_type ?? "notype"));
    case "time_is":
      noteCondition(c, `${c.op} time_is`, "T1-lowered", "no clock in P1: folded against fixed daytime");
      if (a[0] === "stage_of_day") return K(a[1] === "equals" ? a[2] === "morning" : a[2] !== "morning");
      if (a[0] === "daytime") return K(a[1] === "equals" ? a[2] === "true" : a[2] !== "true");
      return K(false);
    case "music_playing":
      noteCondition(c, `${c.op} music_playing`, "T4-dropped", "no music in P1");
      return K(false);
    case "environment_is":
      noteCondition(c, `${c.op} environment_is`, "T3-dropped", "battle backdrop only");
      return K(false);
    case "party_infected":
      noteCondition(c, `${c.op} party_infected`, "T3-placeholder", "no plague in P1: none=true");
      return K(a[2] === "none");
    default:
      noteCondition(c, `${c.op} ${c.type}`, "T3-dropped", "monster/party/meta state unknown to P1: fixed answer");
      return K(["cooldown_days"].includes(c.type));
  }
}

function toIf(cl: Clause): { cond: Condition; negate: boolean } {
  switch (cl.k) {
    case "var": return { cond: { kind: "variable", id: cl.id, op: cl.op, value: cl.value }, negate: false };
    case "sw": return { cond: { kind: "switch", id: cl.id, value: cl.on }, negate: false };
    case "item": return { cond: { kind: "item", id: cl.id, count: cl.count }, negate: !cl.has };
    case "gold": return { cond: { kind: "gold", amount: cl.amount }, negate: !cl.has };
    case "facing": return {
      cond: { kind: "facing", dir: cl.dir } as unknown as Condition,
      negate: false,
    };
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
function pageCondition(
  cls: Clause[],
  options: ImportOptions,
): { cond?: FuturePageCondition; rest: Clause[] } {
  if (options.condAll && cls.length) {
    const converted = cls.map((cl): FutureCondition | null => {
      if (cl.k === "const") return null;
      const { cond, negate } = toIf(cl);
      return negate ? null : cond as FutureCondition;
    });
    if (converted.every((condition): condition is FutureCondition => condition !== null)) {
      return { cond: { all: converted }, rest: [] };
    }
  }
  const cond: PageCondition = {};
  const rest: Clause[] = [];
  const facing: FutureCondition[] = [];
  for (const cl of cls) {
    if (cl.k === "facing" && options.facing) facing.push({ kind: "facing", dir: cl.dir });
    else if (cl.k === "var" && !cond.variable) cond.variable = { id: cl.id, op: cl.op, value: cl.value };
    else if (cl.k === "sw" && cl.on && cond.switch === undefined) cond.switch = cl.id;
    else if (cl.k === "item" && cl.has && cl.count === 1 && cond.item === undefined) cond.item = cl.id;
    else rest.push(cl);
  }
  const future = cond as FuturePageCondition;
  if (facing.length) future.all = facing;
  return { cond: Object.keys(future).length ? future : undefined, rest };
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

function enumChoice(options: readonly string[], variable: string): Command {
  const make = (remaining: readonly string[]): Command => {
    const take = remaining.length <= 4 ? remaining.length : 3;
    const page: { text: string; commands: Command[] }[] = remaining.slice(0, take).map((option) => ({
      text: (po.get(option) ?? option).slice(0, 24) || option.slice(0, 24),
      commands: [{
        op: "variable" as const,
        id: varId(variable),
        set: { op: "set" as const, value: code(variable, option) },
      }],
    }));
    if (take < remaining.length) {
      page.push({ text: "Next >", commands: [make(remaining.slice(take))] });
    }
    return { op: "choices", prompt: "", options: page };
  };
  return make(options);
}

const npcName = (slug: string) => (po.get(slug) ?? slug).slice(0, 40);

// ---------------------------------------------------------------------------
// actions -> commands

const DIRS = new Set(["up", "down", "left", "right"]);
const FACE: Record<string, MoveStep> = { up: "faceUp", down: "faceDown", left: "faceLeft", right: "faceRight" };
const MOVE: Record<string, MoveStep> = { up: "moveUp", down: "moveDown", left: "moveLeft", right: "moveRight" };
const items = new Map<string, Item>();
const transferRepairs: TransferRepair[] = [];
const transferCollision = new Map<string, Set<string>>();
const INSTANT = new Set(["set_variable", "clear_variable", "add_item", "add_tracker", "create_npc", "remove_npc", "modify_money", "set_teleport_faint", "set_monster_health", "set_monster_status", "unlock_controls", "lock_controls", "park_experience", "remove_step_tracker", "set_layer"]);

const TRANSFER_NEIGHBORS = [
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 0],
] as const;

function transferCellIsWalkable(map: TuxMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const blocked = transferCollision.get(map.slug) ?? (() => {
    const cells = readCollisionCells(join(MAPS_DIR, `${map.slug}.tmx`));
    transferCollision.set(map.slug, cells);
    return cells;
  })();
  if (blocked.has(`${x},${y}`)) return false;
  return TRANSFER_NEIGHBORS.some(([dx, dy]) => {
    const nx = x + dx;
    const ny = y + dy;
    return nx >= 0 && ny >= 0 && nx < map.width && ny < map.height &&
      !blocked.has(`${nx},${ny}`);
  });
}

/** Geometric four-neighbour BFS from a clamped upstream coordinate. The
 * search crosses blocked cells while looking for the nearest usable landing;
 * collision connectivity cannot be assumed when the starting point itself is
 * bad. Neighbour order is fixed for byte-stable tie breaking. */
function nearestWalkableTransferCell(map: TuxMap, startX: number, startY: number): { x: number; y: number } {
  const queue: { x: number; y: number }[] = [{ x: startX, y: startY }];
  const seen = new Set([`${startX},${startY}`]);
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    if (transferCellIsWalkable(map, cell.x, cell.y)) return cell;
    for (const [dx, dy] of TRANSFER_NEIGHBORS) {
      const x = cell.x + dx;
      const y = cell.y + dy;
      const key = `${x},${y}`;
      if (x < 0 || y < 0 || x >= map.width || y >= map.height || seen.has(key)) continue;
      seen.add(key);
      queue.push({ x, y });
    }
  }
  throw new Error(`map ${map.slug} has no walkable transfer landing`);
}

interface Ctx {
  m: TuxMap;
  options: ImportOptions;
  economies: ReadonlyMap<string, string>;
  /** the NPC slug whose event runs these commands (talk pages), if any */
  self?: string;
}

function shopPlaceholder(npc: string, menu: string, economySlug: string | undefined): Command[] {
  const economy = economySlug ? economyDb.get(economySlug) : undefined;
  const wantsMonsters = menu.includes("monster");
  const stock = wantsMonsters ? economy?.monsters : economy?.items;
  const shown = (stock ?? []).slice(0, 4).map((entry) => {
    const name = po.get(entry.slug) ?? entry.slug.replaceAll("_", " ");
    return `${name}${entry.price === undefined ? "" : ` $${entry.price}`}`;
  });
  const remainder = Math.max(0, (stock?.length ?? 0) - shown.length);
  const summary = shown.length
    ? `Stock: ${shown.join(", ")}${remainder ? `, +${remainder} more` : ""}`
    : `Stock: ${economy ? "none" : "economy unavailable"}`;
  const menuLabel: Record<string, string> = {
    buy_item: "Buy items",
    sell_item: "Sell items",
    both_item: "Buy/sell items",
    buy_monster: "Buy monsters",
    sell_monster: "Sell monsters",
    both_monster: "Buy/sell monsters",
    train_monster: "Train monsters",
    heal_monster: "Heal monsters",
  };
  const lines = [
    `[SHOP] ${npcName(npc)} — ${menuLabel[menu] ?? menu}`,
    summary,
    "(P1 placeholder; trading is unavailable.)",
  ].flatMap((line) => wrap(line));
  const commands: Command[] = [];
  for (let i = 0; i < lines.length; i += 4) commands.push({ op: "text", lines: lines.slice(i, i + 4) });
  return commands;
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
        noteAction(a, a.type, "T1", "text boxes from en_US .po (layout args ignored)");
        out.push(...dialog(g[0]!, ctx.m));
        break;
      case "translated_dialog_choice": case "choice_monster": case "choice_npc": {
        const opts = g[0]!.split(":");
        const fate: Fate = a.type === "translated_dialog_choice"
          ? (opts.length > 4 ? "T1-lowered" : "T1")
          : "T3-placeholder";
        noteAction(
          a,
          a.type + (opts.length > 4 ? "(paginated)" : ""),
          fate,
          opts.length > 4 ? "nested choice pages retain every option" : "choices -> enum code",
        );
        out.push(enumChoice(opts, g[1]!));
        break;
      }
      case "set_variable":
        noteAction(a, a.type, "T1", "variable set enum code");
        for (const p of g) {
          const j = p.indexOf(":");
          const k = j < 0 ? p : p.slice(0, j);
          out.push({ op: "variable", id: varId(k), set: { op: "set", value: code(k, j < 0 ? "" : p.slice(j + 1)) } });
        }
        break;
      case "clear_variable":
        noteAction(a, a.type, "T1", "variable set 0");
        for (const p of g) out.push({ op: "variable", id: varId(p), set: { op: "set", value: 0 } });
        break;
      case "random_integer":
        noteAction(a, a.type, "T1", "variable random integer");
        out.push({
          op: "variable",
          id: varId(g[0]!),
          set: { op: "random", min: Number(g[1]), max: Number(g[2]) },
        });
        break;
      case "set_random_variable": {
        const codes = g[1]!.split(":")
          .map((value) => code(g[0]!, value))
          .sort((a, b) => a - b);
        noteAction(a, a.type, "T1", "variable random enum code");
        out.push({
          op: "variable",
          id: varId(g[0]!),
          set: { op: "random", min: codes[0]!, max: codes.at(-1)! },
        });
        break;
      }
      case "wait":
        noteAction(a, a.type, "T1", "wait seconds");
        if (Number(g[0]) > 0) out.push({ op: "wait", seconds: Math.min(30, Number(g[0])) });
        break;
      case "screen_transition":
        noteAction(a, a.type, "T1-lowered", "fade out+in -> wait 2t (visual fade is T2)");
        out.push({ op: "wait", seconds: Math.min(30, 2 * Number(g[0] ?? 0.3)) });
        break;
      case "play_sound":
        noteAction(a, a.type, "T1", "se cue");
        out.push({ op: "se", name: g[0]!.toLowerCase().replace(/[^a-z0-9_-]/g, "_") });
        break;
      case "add_item": {
        if (g[2] && g[2] !== "player") { noteAction(a, "add_item(npc)", "T3-dropped", "NPC bags are combat-only"); break; }
        const q = g[1] ? Number(g[1]) : 1;
        if (!q) { noteAction(a, "add_item(zero)", "T4-dropped", "zero quantity is a no-op"); break; }
        noteAction(a, a.type, "T1", "item add/sub");
        items.set(g[0]!, { id: g[0]!, name: (po.get(g[0]!) ?? g[0]!).slice(0, 24), sprite: "tux.0" });
        out.push({ op: "item", item: g[0]!, set: q > 0 ? "add" : "sub", count: Math.min(99, Math.abs(q)) });
        break;
      }
      case "modify_money":
        if (g[0] !== "player" || !g[1]) { noteAction(a, "modify_money(var/npc)", "T2-dropped", "amount from a variable"); break; }
        noteAction(a, a.type, "T1", "gold add/sub");
        out.push({ op: "gold", set: Number(g[1]) >= 0 ? "add" : "sub", amount: Math.abs(Number(g[1])) });
        break;
      case "add_tracker":
        noteAction(a, a.type, "T1-lowered", "switch tracker.<map>");
        out.push({ op: "switch", id: `tracker.${g[1]}`, value: true });
        break;
      case "create_npc":
        noteAction(
          a,
          a.type,
          ctx.options.place && ctx.options.localReset ? "T1" : "T1-lowered",
          ctx.options.place
            ? "local.npc.<slug> = 1 plus K1 place"
            : "local.npc.<slug> = 1 (spawn position other than the event's is T2 place)",
        );
        out.push({ op: "variable", id: npcVar(g[0]!), set: { op: "set", value: 1 } });
        if (ctx.options.place) {
          out.push(command({
            op: "place",
            target: { event: `npc_${slug(g[0]!)}` },
            x: Math.max(0, Math.min(ctx.m.width - 1, Number(g[1]))),
            y: Math.max(0, Math.min(ctx.m.height - 1, Number(g[2]))),
          }));
        }
        break;
      case "remove_npc":
        noteAction(a, a.type, ctx.options.localReset ? "T1" : "T1-lowered", "local.npc.<slug> = 0");
        out.push({ op: "variable", id: npcVar(g[0]!), set: { op: "set", value: 0 } });
        break;
      case "lock_controls": case "unlock_controls":
        if (ctx.options.inputLock) {
          noteAction(a, a.type, "T1", "K1 cross-event input lock command");
          out.push(command({ op: a.type === "lock_controls" ? "lockInput" : "unlockInput" }));
        } else {
          noteAction(a, a.type, "T1-lowered", "blocking fibers already freeze the player (cross-event locks are T2)");
        }
        break;
      case "char_stop":
        noteAction(a, a.type, "T1-lowered", "blocking fibers already freeze the player (cross-event locks are T2)");
        break;
      case "char_face": {
        const [who, dir] = [g[0]!, g[1]!];
        const target = who === "player"
          ? "player" as const
          : isSelf(who) ? "this" as const : { event: `npc_${slug(who)}` };
        if (!DIRS.has(dir)) {
          if (ctx.options.routes) {
            noteAction(a, "char_face(toward char)", "T1", "K2 arbitrary-target turn-toward route");
            const step: FutureMoveStep = dir === "player"
              ? "turnTowardPlayer"
              : { turnToward: { event: `npc_${slug(dir)}` } };
            out.push(command({ op: "moveRoute", target, wait: false, route: { steps: [step], repeat: false, skippable: true } }));
          } else {
            noteAction(a, "char_face(toward char)", "T2-dropped", "needs turnToward step");
          }
          break;
        }
        if (who === "player" || isSelf(who)) {
          noteAction(a, a.type, "T1-lowered", `moveRoute ${who === "player" ? "player" : "this"} face`);
          out.push({ op: "moveRoute", target: who === "player" ? "player" : "this", wait: false, route: { steps: [FACE[dir]!], repeat: false, skippable: true } });
        } else if (ctx.options.routes) {
          noteAction(a, a.type, "T1", "K2 moveRoute targets an arbitrary event");
          out.push(command({ op: "moveRoute", target, wait: false, route: { steps: [FACE[dir]!], repeat: false, skippable: true } }));
        } else noteAction(a, "char_face(other npc)", "T2-dropped", "moveRoute target must be an event id");
        break;
      }
      case "char_move": {
        const who = g[0]!;
        if (who !== "player" && !isSelf(who) && !ctx.options.routes) {
          noteAction(a, "char_move(other npc)", "T2-dropped", "moveRoute target must be an event id");
          break;
        }
        const steps: MoveStep[] = [];
        for (const mv of g.slice(1)) {
          const [d, n] = mv.trim().split(/\s+/);
          for (let k = 0; k < Number(n ?? 1); k++) steps.push(MOVE[d!]!);
        }
        noteAction(a, a.type, ctx.options.routes && who !== "player" && !isSelf(who) ? "T1" : "T1-lowered", "moveRoute steps");
        const target = who === "player" ? "player" as const
          : isSelf(who) ? "this" as const : { event: `npc_${slug(who)}` };
        out.push(command({ op: "moveRoute", target, wait: true, route: { steps, repeat: false, skippable: false } }));
        break;
      }
      case "transition_teleport": {
        if (g[0] !== "player") { noteAction(a, "transition_teleport(npc)", "T2-dropped", "only the player transfers"); break; }
        // Tuxemon keeps running the actions after a teleport in the same
        // frame; the kit's transfer ends the page. Hoist trailing instants,
        // fold a trailing `char_face player,<dir>` into the transfer's dir.
        let dir: Dir | "keep" = "keep";
        const hoisted: Rule[] = [];
        for (const b of acts.slice(i + 1)) {
          if (b.type === "char_face" && b.args[0] === "player" && DIRS.has(b.args[1]!)) {
            dir = b.args[1] as Dir;
            noteAction(b, "char_face(after teleport)", "T1", "folded into transfer direction");
          }
          else if (INSTANT.has(b.type)) hoisted.push(b);
          else noteAction(b, `${b.type}(after teleport)`, "T4-dropped", "runs on the old map during the fade");
        }
        out.push(...convertActions(hoisted, ctx));
        const map = g[1]!.replace(/\.tmx$/, "");
        const target = allMaps.get(map);
        if (!target) {
          noteAction(a, `${a.type}(missing map)`, "T4-dropped", `unknown target ${map}`);
          return out;
        }
        const requested = { x: Number(g[2]), y: Number(g[3]) };
        const clamped = {
          x: Math.max(0, Math.min(target.width - 1, requested.x)),
          y: Math.max(0, Math.min(target.height - 1, requested.y)),
        };
        let emitted = clamped;
        if (clamped.x !== requested.x || clamped.y !== requested.y) {
          if (!transferCellIsWalkable(target, clamped.x, clamped.y)) {
            emitted = nearestWalkableTransferCell(target, clamped.x, clamped.y);
          }
          transferRepairs.push({ sourceMap: ctx.m.slug, targetMap: map, requested, clamped, emitted });
          noteAction(
            a,
            `${a.type}(repaired)`,
            "T1-lowered",
            emitted === clamped
              ? "upstream landing point clamped into target bounds"
              : "clamped landing was isolated; deterministic BFS selected the nearest walkable cell",
          );
        } else {
          noteAction(a, a.type, "T1", "transfer (terminal; dir from trailing char_face)");
        }
        out.push({ op: "transfer", map, x: emitted.x, y: emitted.y, dir, fade: Math.min(2, Number(g[4] ?? 0.3)) });
        return out;
      }
      case "load_yaml":
        noteAction(a, a.type, "T1-lowered", "import-time events gated until this action runs");
        out.push({
          op: "variable",
          id: varId(`__loaded_yaml.${ctx.m.slug}.${g[0]}`),
          set: { op: "set", value: code(`__loaded_yaml.${ctx.m.slug}.${g[0]}`, "yes") },
        });
        break;
      case "remove_collision":
        noteAction(
          a,
          a.type,
          ctx.options.localReset ? "T1" : "T1-lowered",
          "keyed collision becomes a variable-gated blocking event",
        );
        out.push({
          op: "variable",
          id: collisionVar(ctx.m.slug, g[0]!),
          set: { op: "set", value: 1 },
        });
        break;
      case "start_battle": case "start_double_battle": {
        const opp = g[0] === "player" ? g[1]! : g[0]!;
        noteAction(a, a.type, "T3-placeholder", "inline placeholder: text + outcome writes");
        out.push(...battle(opp));
        break;
      }
      case "char_talk": {
        const line = npcDb.get(g[0]!)?.speech?.profile?.default?.[g[1]!];
        const key = Array.isArray(line) ? line[0] : line;
        if (!key) { noteAction(a, "char_talk(no line)", "T4-dropped", "profile has no such field"); break; }
        noteAction(a, a.type, "T1", "text of the NPC's dialogue-profile msgid");
        out.push(...dialog(key, ctx.m));
        break;
      }
      case "add_monster": {
        if (g[2] && g[2] !== "player") { noteAction(a, "add_monster(npc)", "T3-dropped", "trainer teams are P2"); break; }
        noteAction(a, a.type, "T3-placeholder", "sys.party_size += 1, switch mon.<slug>");
        out.push({ op: "variable", id: "sys.party_size", set: { op: "add", value: 1 } });
        out.push({ op: "switch", id: `mon.${g[0]}`, value: true });
        break;
      }
      case "random_monster":
        if (g[1]) {
          noteAction(a, "random_monster(npc)", "T3-dropped", "trainer teams are P2");
        } else {
          noteAction(a, a.type, "T3-placeholder", "sys.party_size += 1");
          out.push({ op: "variable", id: "sys.party_size", set: { op: "add", value: 1 } });
          out.push({ op: "switch", id: "mon.random", value: true });
        }
        break;
      case "remove_monster":
        noteAction(a, a.type, "T3-placeholder", "sys.party_size -= 1 when non-empty");
        out.push({
          op: "if",
          if: { kind: "variable", id: "sys.party_size", op: ">=", value: 1 },
          then: [{ op: "variable", id: "sys.party_size", set: { op: "sub", value: 1 } }],
        });
        break;
      case "wild_encounter":
        noteAction(a, a.type, "T3-placeholder", "scripted wild battle auto-wins in P1");
        out.push(...battle(g[0]!));
        break;
      case "random_encounter":
        noteAction(a, a.type, "T3-placeholder", "intentionally silent in P1");
        break;
      case "open_shop":
        noteAction(a, a.type, "T3-placeholder", "visible stock summary until the K4 shop UI lands");
        out.push(...shopPlaceholder(g[0]!, g[1]!, ctx.economies.get(g[0]!)));
        break;
      case "pathfind": {
        if (!ctx.options.routes) {
          noteAction(a, a.type, "T2-dropped", "runtime pathfinding / other-event routes / NPC motion props");
          break;
        }
        const who = g[0]!;
        const target = who === "player" ? "player" as const
          : isSelf(who) ? "this" as const : { event: `npc_${slug(who)}` };
        noteAction(a, a.type, "T1", "K2 deterministic pathTo route");
        out.push(command({
          op: "moveRoute",
          target,
          wait: true,
          route: {
            steps: [{ pathTo: { x: Number(g[1]), y: Number(g[2]) } }],
            repeat: false,
            skippable: false,
          },
        }));
        break;
      }
      case "pathfind_to_char": {
        if (!ctx.options.routes) {
          noteAction(a, a.type, "T2-dropped", "runtime pathfinding / other-event routes / NPC motion props");
          break;
        }
        const [toward, who, side, distance] = g;
        const target = who === "player" ? "player" as const
          : isSelf(who) ? "this" as const : { event: `npc_${slug(who!)}` };
        const approach: { target: "player" | { event: string }; side?: Dir; distance?: number } = {
          target: toward === "player" ? "player" : { event: `npc_${slug(toward!)}` },
        };
        if (DIRS.has(side)) approach.side = side as Dir;
        if (distance !== undefined && distance !== "") approach.distance = Math.max(1, Math.trunc(Number(distance)));
        noteAction(a, a.type, "T1", "K2 deterministic approach route");
        out.push(command({
          op: "moveRoute",
          target,
          wait: true,
          route: { steps: [{ approach }], repeat: false, skippable: false },
        }));
        break;
      }
      case "char_wander": case "char_speed": case "char_run":
      case "set_facing_mode": case "char_position":
        noteAction(a, a.type, "T2-dropped", "runtime pathfinding / other-event routes / NPC motion props");
        break;
      case "play_music": case "fadeout_music":
        noteAction(a, a.type, "T2-dropped", "bgm hook (P1: silent)");
        break;
      case "rename_player":
        noteAction(a, a.type, "T2-dropped", "name entry (P1: fixed name)");
        break;
      case "set_environment": case "set_monster_health": case "set_monster_status": case "set_teleport_faint":
      case "set_monster_attribute": case "open_journal": case "access_pc":
      case "get_player_monster": case "set_bill": case "format_variable":
        noteAction(a, a.type, "T3-dropped", "monster/combat subsystem (P2)");
        break;
      default:
        noteAction(a, a.type, "T4-dropped", "presentation / meta");
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
const hasCommand = (cmds: readonly Command[], wanted: FutureCommand["op"]): boolean =>
  cmds.some((c) => {
    if ((c as FutureCommand).op === wanted) return true;
    if (c.op === "if") return hasCommand(c.then, wanted) || hasCommand(c.else ?? [], wanted);
    if (c.op === "choices") {
      return c.options.some((option) => hasCommand(option.commands, wanted)) ||
        hasCommand(c.cancel?.commands ?? [], wanted);
    }
    return false;
  });

interface NpcAgg {
  slug: string;
  x: number;
  y: number;
  wander: boolean;
  face?: string;
  talks: { cls: Clause[]; cmds: Command[] }[];
}

interface SpatialPage {
  id: string;
  name: string;
  trigger: "playerTouch" | "action";
  cls: Clause[];
  cmds: Command[];
  cells: readonly [number, number][];
}

function convertMap(m: TuxMap, options: ImportOptions): { map: MapDef; sprites: Record<string, SpriteDef> } {
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
  /** K1 areas are partitioned after every source event is known. A partition
   *  has one exact ordered set of source events, which lets overlapping
   *  rectangles keep Tuxemon's "sample every guard, then run every matching
   *  body" semantics without expanding otherwise-disjoint large areas. */
  const spatialPages: SpatialPage[] = [];
  const collisionRegions = readCollisionRegions(join(MAPS_DIR, `${m.slug}.tmx`));
  const economies = new Map<string, string>();
  for (const event of m.events) {
    for (const action of event.acts) {
      if (action.type === "set_economy" && action.args[0] && action.args[1]) {
        economies.set(action.args[0], action.args[1]);
      }
    }
  }

  // NPCs first: every create_npc on this map names one NPC event
  for (const e of m.events) for (const a of e.acts) if (a.type === "create_npc") {
    const agg = npcOf(a.args[0]!, Number(a.args[1]), Number(a.args[2]));
    if (a.args[3] === "wander") agg.wander = true;
  }

  for (const e of m.events) {
    const eventCoverage = new EventCoverage(e);
    activeCoverage = eventCoverage;
    try {
      if (!e.conds.some((condition) => !condition.synthetic) && !e.behavs.length) {
        const reason = "Tuxemon never starts an event without source conditions or behavior";
        eventCoverage.dropAll(reason);
        note("trigger", "inert(no conditions or behavior)", "T4-dropped", reason);
        continue;
      }
      if (e.origin === "tmx" && (e.w === 0 || e.h === 0)) {
        const reason = "Tuxemon's integer tile boundary never contains a point for a zero-size TMX event";
        eventCoverage.dropAll(reason);
        note("trigger", "inert(zero-size TMX area)", "T4-dropped", reason);
        continue;
      }
      const cls0 = e.conds.map((c) => clauses(c, m, options));
      const cls: Clause[] = cls0.filter((x): x is Clause[] => x !== null).flat();
      if (cls.some((c) => c.k === "const" && !c.value)) {
        const reason = "fixed-false guard prevents the source event from starting";
        eventCoverage.dropAll(reason);
        note("trigger", "never-true guard", "T4-dropped", reason);
        continue;
      }
      const live = cls.filter((c) => c.k !== "const");
      for (const b of e.behavs) note("behav", b.type, "structural", "talk -> NPC action page");
      const k = triggerClass(e);

      // spawn: guard + create_npc -> a parallel page flipping local.npc.<slug>
      if (k === "spawn") {
        for (const a of e.acts) {
          if (a.type === "char_face") {
            if (npcs.has(a.args[0]!) && DIRS.has(a.args[1]!)) {
              npcOf(a.args[0]!).face = a.args[1];
              noteAction(a, a.type, "T1-lowered", "spawn facing becomes the NPC page route");
            } else {
              noteAction(a, "char_face(spawn unsupported)", "T2-dropped", "spawn target or direction is unavailable");
            }
          }
          if (a.type === "char_wander") {
            if (npcs.has(a.args[0]!)) {
              npcOf(a.args[0]!).wander = true;
              noteAction(a, a.type, "T1-lowered", "NPC page uses random movement; frequency/bounds are omitted");
            } else {
              noteAction(a, "char_wander(missing npc)", "T2-dropped", "spawn target is unavailable");
            }
          }
        }
        const cmds = convertActions(e.acts.filter((a) => a.type !== "char_face" && a.type !== "char_wander"), { m, options, economies });
        const blocking = hasBlocking(cmds);
        const page = blocking
          // A blocking spawn usually writes the same local.npc variable its
          // `not char_exists` guard reads. Keeping that guard on the page
          // would make K1 cancel the parallel fiber on the following frame,
          // halfway through its cutscene. Keep the page alive and evaluate
          // the complete guard inside the fiber instead; on the next restart
          // it is false and the body becomes a no-op.
          ? { trigger: "parallel" as const, sprite: null, commands: guard(live, cmds) }
          : (() => {
              const { cond, rest } = pageCondition(live, options);
              return { trigger: "parallel" as const, condition: cond, sprite: null, commands: guard(rest, cmds) };
            })();
        events.push({ id: nextId(e.name), name: `${e.name} (spawn guard)`, x: e.x, y: e.y, pages: [page] });
        note(
          "trigger",
          "spawn",
          "T1-lowered",
          blocking
            ? "parallel page keeps its fiber alive while an internal guard runs the cutscene once"
            : "parallel page: guard -> local.npc.<slug> = 1",
        );
        continue;
      }

      // talk: fold into the NPC's action page
      const talk = e.behavs.find((b) => b.type === "talk");
      if (talk) {
        const agg = npcOf(talk.args[0]!);
        agg.talks.push({ cls: live, cmds: convertActions(e.acts, { m, options, economies, self: talk.args[0] }) });
        note("trigger", "talk", "T1", "NPC event action page (if-chain over talk guards)");
        continue;
      }

      const cmds = convertActions(e.acts, { m, options, economies });
      if (!cmds.length) {
        const reason = "every action was removed, so no project event was emitted";
        eventCoverage.dropAll(reason);
        note("trigger", "no-op after conversion", "T4-dropped", reason);
        continue;
      }
      const cells: [number, number][] = [];
      for (let dy = 0; dy < Math.max(1, e.h); dy++) {
        for (let dx = 0; dx < Math.max(1, e.w); dx++) {
          const x = e.x + dx;
          const y = e.y + dy;
          if (x >= 0 && y >= 0 && x < m.width && y < m.height) cells.push([x, y]);
        }
      }

      if (k.startsWith("touch") || k.startsWith("action")) {
        const trigger = k.startsWith("touch") ? "playerTouch" : "action";
        if (!cells.length) {
          const reason = "source trigger area lies outside the map";
          eventCoverage.dropAll(reason);
          note("trigger", `${k}(outside map)`, "T4-dropped", reason);
          continue;
        }
        if (options.areas) {
          spatialPages.push({
            id: nextId(e.name),
            name: e.name,
            trigger,
            cls: live,
            cmds,
            cells,
          });
          note("trigger", `${k}(area)`, "T1", "K1 rectangular event area (overlaps partitioned after guard sampling)");
          continue;
        }
        if (cells.length > AREA_CELL_CAP) {
          if (!hasBlocking(cmds) && e.acts.some((action) => action.type === "add_tracker")) {
            const { cond, rest } = pageCondition(live, options);
            events.push({
              id: nextId(e.name),
              name: `${e.name} (whole-map lowering)`,
              x: cells[0]![0],
              y: cells[0]![1],
              pages: [{ trigger: "parallel", condition: cond, sprite: null, commands: guard(rest, cmds) }],
            });
            note("trigger", `${k}(whole-map tracker)`, "T1-lowered", "parallel visit tracker avoids expanding the full map");
          } else {
            const reason = `source trigger area exceeds the v1 ${AREA_CELL_CAP}-cell expansion cap`;
            eventCoverage.dropAll(reason);
            note("trigger", `${k}(area>${AREA_CELL_CAP})`, "T2-dropped", reason);
          }
          continue;
        }
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
        const { cond, rest } = pageCondition(live, options);
        events.push({ id: nextId(e.name), name: e.name, x: e.x, y: e.y, pages: [{ trigger: "parallel", condition: cond, sprite: null, commands: guard(rest, body) }] });
      } else {
        const { cond, rest } = pageCondition(live, options);
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
    } finally {
      conversionCoverage.commit(eventCoverage);
      activeCoverage = undefined;
    }
  }

  if (options.areas) {
    // Make a cell membership grid for each trigger. Greedily coalesce equal
    // membership signatures into rectangles. At an overlap, one event owns
    // the rectangle and snapshots every member's guard before any body runs;
    // this is the same latch used by the v1 per-cell lowering below.
    const membership = new Map<string, number[]>();
    spatialPages.forEach((page, index) => {
      for (const [x, y] of page.cells) {
        const key = `${page.trigger}|${x},${y}`;
        const members = membership.get(key) ?? [];
        members.push(index);
        membership.set(key, members);
      }
    });
    const sameMembers = (trigger: "playerTouch" | "action", x: number, y: number, signature: string): boolean =>
      (membership.get(`${trigger}|${x},${y}`) ?? []).join(",") === signature;
    const visited = new Set<string>();
    let region = 0;
    for (const trigger of ["playerTouch", "action"] as const) {
      for (let y = 0; y < m.height; y++) {
        for (let x = 0; x < m.width; x++) {
          const cellKey = `${trigger}|${x},${y}`;
          const members = membership.get(cellKey);
          if (!members?.length || visited.has(cellKey)) continue;
          const signature = members.join(",");
          let w = 1;
          while (x + w < m.width && !visited.has(`${trigger}|${x + w},${y}`) &&
                 sameMembers(trigger, x + w, y, signature)) w++;
          let h = 1;
          rows: while (y + h < m.height) {
            for (let dx = 0; dx < w; dx++) {
              const next = `${trigger}|${x + dx},${y + h}`;
              if (visited.has(next) || !sameMembers(trigger, x + dx, y + h, signature)) break rows;
            }
            h++;
          }
          for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) visited.add(`${trigger}|${x + dx},${y + dy}`);
          }

          const pages = members.map((index) => spatialPages[index]!);
          const first = pages[0]!;
          let condition: FuturePageCondition | undefined;
          let commands: Command[];
          if (pages.length === 1) {
            const page = pageCondition(first.cls, options);
            condition = page.cond;
            commands = guard(page.rest, first.cmds);
          } else {
            const flag = (i: number) => `local.area.${m.slug}.${region}.${i}`;
            commands = [];
            pages.forEach((page, i) => {
              if (page.cls.length) {
                commands.push(
                  { op: "switch", id: flag(i), value: false },
                  ...guard(page.cls, [{ op: "switch", id: flag(i), value: true }]),
                );
              }
            });
            pages.forEach((page, i) => commands.push(...(
              page.cls.length
                ? [{ op: "if", if: { kind: "switch", id: flag(i), value: true }, then: page.cmds } as Command]
                : page.cmds
            )));
            note("trigger", "stacked event areas", "T1-lowered", "partitioned: match flags then bodies");
          }
          events.push(gameEvent({
            id: `${first.id}_r${String(++region).padStart(3, "0")}`,
            name: pages.map((page) => page.name).join(" + "),
            x,
            y,
            w,
            h,
            pages: [{ trigger, condition, sprite: null, commands }],
          }));
        }
      }
    }
  }

  // one kit event per (trigger, cell): a lone Tuxemon event keeps its page
  // condition; stacked events become one unconditioned page that latches a
  // match flag per member, then runs every matched body (Tuxemon starts all
  // events whose guards hold on that frame).
  for (const list of cellPages.values()) {
    const first = list[0]!;
    if (list.length === 1) {
      const { cond, rest } = pageCondition(first.cls, options);
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
    if (agg.talks.length) {
      if (options.routes) {
        chain.unshift(command({
          op: "moveRoute",
          target: "this",
          wait: false,
          route: { steps: ["turnTowardPlayer"], repeat: false, skippable: true },
        }));
        note("behav", "talk(char_face npc,player)", "T1", "K2 turnTowardPlayer route step");
      } else {
        note("behav", "talk(char_face npc,player)", "T2-dropped", "turn toward the player needs a turnTowardPlayer move step");
      }
    }
    const present: Page = {
      condition: { variable: { id: npcVar(agg.slug), op: "==", value: 1 } },
      trigger: "action",
      sprite: spriteKey,
      blocks: true,
      moveType: agg.wander ? "random" : "static",
      commands: chain,
    };
    if (!agg.wander && agg.face) {
      if (options.place) (present as Page & { dir?: Dir }).dir = agg.face as Dir;
      else present.moveRoute = { steps: [FACE[agg.face]!], repeat: true, skippable: true };
    }
    events.push({
      id: `npc_${slug(agg.slug)}`,
      name: agg.slug,
      x: Math.max(0, Math.min(m.width - 1, agg.x)),
      y: Math.max(0, Math.min(m.height - 1, agg.y)),
      pages: [{ trigger: "action", sprite: null, commands: [] }, present],
    });
  }

  // Keyed collision rectangles become removable event bodies instead of
  // permanent terrain blocks.
  let collisionEvent = 0;
  for (const region of collisionRegions) {
    if (!region.key) continue;
    for (const [x, y] of region.cells) {
      if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
      events.push({
        id: `collision_${slug(region.key)}_${++collisionEvent}`,
        name: `collision:${region.key}`,
        x,
        y,
        pages: [
          { trigger: "action", sprite: null, blocks: true, commands: [] },
          {
            trigger: "action",
            condition: {
              variable: { id: collisionVar(m.slug, region.key), op: "==", value: 1 },
            },
            sprite: null,
            blocks: false,
            commands: [],
          },
        ],
      });
    }
  }

  // A handful of source cutscenes intentionally pass a control lock to a
  // second event, but one source map has no unlock action anywhere. Such a
  // lock cannot have a continuation in this map (and K1 resets locks only on
  // transfer), so close each affected page with a deterministic safety
  // unlock. This is corpus-derived rather than a per-map patch.
  if (options.inputLock) {
    const pages = events.flatMap((event) => event.pages.map((page) => ({ event, page })));
    const mapHasLock = pages.some(({ page }) => hasCommand(page.commands, "lockInput"));
    const mapHasUnlock = pages.some(({ page }) => hasCommand(page.commands, "unlockInput"));
    if (mapHasLock && !mapHasUnlock) {
      for (const { event, page } of pages) {
        if (!hasCommand(page.commands, "lockInput")) continue;
        page.commands.push(command({ op: "unlockInput" }));
        note("trigger", "orphan input lock repair", "T1-lowered", `safety unlock appended to ${m.slug}:${event.id}`);
      }
    }
  }

  // Pure guard events do not use their coordinates, but the kit data model
  // still requires every event to live on its map.
  for (const event of events) {
    event.x = Math.max(0, Math.min(m.width - 1, event.x));
    event.y = Math.max(0, Math.min(m.height - 1, event.y));
  }

  // terrain placeholder: one pass tile, Tuxemon collision rects blocked
  const blocked = readCollisionCells(join(MAPS_DIR, `${m.slug}.tmx`));
  for (const region of collisionRegions) {
    if (region.key) {
      for (const [x, y] of region.cells) blocked.delete(`${x},${y}`);
    }
  }
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

export interface ImportLogRow {
  key: string;
  fate: Fate;
  count: number;
  note: string;
}

export interface ImportReport {
  format: "pocket-tuxemon/import-report/v1";
  source: {
    maps: "mods/tuxemon/maps";
    locale: "en_US";
  };
  options?: ImportOptions;
  maps: string[];
  schemaErrors: { path: string; msg: string }[];
  byFate: Record<string, number>;
  rows: ImportLogRow[];
  transferRepairs: TransferRepair[];
  transferErrors: TransferError[];
  coverage: CoverageReport;
}

export interface TransferRepair {
  sourceMap: string;
  targetMap: string;
  requested: { x: number; y: number };
  clamped: { x: number; y: number };
  emitted: { x: number; y: number };
}

export interface TransferError {
  sourceMap: string;
  event: string;
  targetMap: string;
  x: number;
  y: number;
  reason: "missing-map" | "out-of-bounds";
}

export interface ImportBuild {
  project: Project;
  variables: Record<string, string[]>;
  report: ImportReport;
}

export function availableMapIds(): string[] {
  return [...allMaps.keys()].sort();
}

function transferErrors(project: Project): TransferError[] {
  const maps = new Map(project.maps.map((map) => [map.id, map]));
  const errors: TransferError[] = [];
  const visit = (sourceMap: string, event: string, commands: readonly Command[]): void => {
    for (const command of commands) {
      if (command.op === "transfer") {
        const target = maps.get(command.map);
        const reason = !target
          ? "missing-map"
          : command.x < 0 || command.y < 0 || command.x >= target.width || command.y >= target.height
            ? "out-of-bounds"
            : null;
        if (reason) errors.push({
          sourceMap,
          event,
          targetMap: command.map,
          x: command.x,
          y: command.y,
          reason,
        });
      } else if (command.op === "if") {
        visit(sourceMap, event, command.then);
        visit(sourceMap, event, command.else ?? []);
      } else if (command.op === "choices") {
        for (const option of command.options) visit(sourceMap, event, option.commands);
        visit(sourceMap, event, command.cancel?.commands ?? []);
      }
    }
  };
  for (const map of project.maps) {
    for (const event of map.events ?? []) {
      for (const page of event.pages) visit(map.id, event.id, page.commands);
    }
  }
  return errors;
}

export function buildProject(
  want: readonly string[] = DEFAULT_MAPS,
  requestedOptions: Partial<ImportOptions> = {},
): ImportBuild {
  const options = resolveOptions(requestedOptions);
  log.clear();
  items.clear();
  transferRepairs.length = 0;
  conversionCoverage.reset();

  const mapDefs: MapDef[] = [];
  const sprites: Record<string, SpriteDef> = {};
  for (const s of want) {
    const m = allMaps.get(s);
    if (!m) throw new Error(`no map ${s}`);
    const r = convertMap(m, options);
    mapDefs.push(r.map);
    Object.assign(sprites, r.sprites);
  }

  const startId = want.includes("spyder_bedroom") ? "spyder_bedroom" : want[0];
  if (!startId) throw new Error("at least one map must be selected");
  const startMap = mapDefs.find((m) => m.id === startId)!;

  // start_tuxemon.yaml's Spyder branch, as a one-shot boot page.
  const boot: Command[] = [
    ["scenario_choice", "spyder_campaign"],
    ["gender_choice", "gender_male"],
    ["race_choice", "white_male"],
    ["method_money", "conserved"],
  ].map(([k, v]) => ({
    op: "variable",
    id: varId(k!),
    set: { op: "set", value: code(k!, v!) },
  }) as Command);
  if (startId === "spyder_bedroom") startMap.events!.unshift({
    id: "e000_boot",
    name: "start_tuxemon (Spyder)",
    x: 0,
    y: 0,
    pages: [{
      trigger: "autorun",
      condition: { variable: { id: "sys.boot", op: "==", value: 0 } },
      sprite: null,
      commands: [
        ...boot,
        { op: "variable", id: "sys.boot", set: { op: "set", value: 1 } },
      ],
    }],
  });

  const built: Project = {
    format: "rpgkit-project/v1",
    title: "Pocket Tuxemon",
    tileSize: 16,
    start: {
      map: startId,
      x: Math.min(4, startMap.width - 1),
      y: Math.min(4, startMap.height - 1),
      dir: "down",
    },
    initialGold: 500,
    sheets: [{
      id: "tux",
      pak: "placeholder",
      cols: 1,
      rows: 1,
      defaultPassage: "pass",
    }],
    items: [...items.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    sprites,
    maps: mapDefs,
  };

  // Validate the document exactly as serialized (undefined keys disappear).
  const project = JSON.parse(JSON.stringify(built)) as Project;
  const schema = JSON.parse(readFileSync(
    new URL("../vendor/pocket-rpgkit/src/data/schema.json", import.meta.url),
    "utf8",
  ));
  const schemaErrors = validateSchema(schema, project);
  const rows = [...log.entries()]
    .map(([, v]) => ({
      key: v.key,
      fate: v.fate,
      count: v.count,
      note: v.note,
    }))
    .sort((a, b) =>
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
      (a.fate < b.fate ? -1 : a.fate > b.fate ? 1 : 0)
    );
  const byFate: Record<string, number> = {};
  for (const row of rows) {
    byFate[row.fate] = (byFate[row.fate] ?? 0) + row.count;
  }
  const variables = Object.fromEntries(
    [...enumTable.entries()]
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([name, values]) => [name, [...values]]),
  );

  return {
    project,
    variables,
    report: {
      format: "pocket-tuxemon/import-report/v1",
      source: { maps: "mods/tuxemon/maps", locale: "en_US" },
      ...(Object.values(options).some(Boolean) ? { options } : {}),
      maps: [...want],
      schemaErrors,
      byFate,
      rows,
      transferRepairs: [...transferRepairs],
      transferErrors: transferErrors(project),
      coverage: conversionCoverage.report(),
    },
  };
}
