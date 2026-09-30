import type {
  ExtensionCommandContext,
  ExtensionOptions,
  ExtensionReadContext,
} from "../vendor/pocket-rpgkit/src/engine/extensions.ts";
import type { JsonValue } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import type { BattleDb } from "../importer/battle-schema.ts";
import { battleDbToTuxemonBattleDb } from "./from-battle-db.ts";
import { spawnMonsterWithRandom } from "./spawn.ts";
import type { SpawnedMonsterSnapshot, Stats } from "./types.ts";
import { STAT_NAMES } from "./types.ts";

export const PARTY_LIMIT = 6;
export const KENNEL_LIMIT = 30;
export const TUXEMON_EXT_SAVE_FORMAT = "pocket-tuxemon/ext/v1";
const TUXEMON_EXT_RUNTIME_PREFIX = "pocket-tuxemon/ext-runtime/v1:";

export interface PendingMonster {
  iid: string;
  slug: string;
  level: number;
  experienceModifier: number;
  moneyModifier: number;
}

export interface BattleHistoryEntry {
  fighter: string;
  opponent: string;
  outcome: "won" | "lost" | "draw";
}

export interface FaintPoint {
  map: string;
  x: number;
  y: number;
}

export interface TuxemonExtensionState {
  version: 1;
  party: SpawnedMonsterSnapshot[];
  kennel: SpawnedMonsterSnapshot[];
  caught: string[];
  npcParties: Record<string, PendingMonster[]>;
  history: BattleHistoryEntry[];
  /** Battle rewards not yet reconciled with the kit's generic wallet. */
  money: number;
  /** Active Tuxemon battle backdrop; null matches an unloaded environment. */
  environment: string | null;
  faintPoints: Record<string, FaintPoint>;
  nextMonsterId: number;
}

export interface BattleDbProvider {
  load(): BattleDb;
  release?(): void;
}

export type BattleDbSource = BattleDb | (() => BattleDb) | BattleDbProvider;

export function resolveBattleDb(source: BattleDbSource): BattleDb {
  if (typeof source === "function") return source();
  return "load" in source ? source.load() : source;
}

export function releaseBattleDb(source: BattleDbSource): void {
  if (typeof source !== "function" && "load" in source) source.release?.();
}

export function initialTuxemonExtensionState(): TuxemonExtensionState {
  return {
    version: 1,
    party: [],
    kennel: [],
    caught: [],
    npcParties: {},
    history: [],
    money: 0,
    environment: null,
    faintPoints: {},
    nextMonsterId: 1,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeInteger(value: unknown): value is number {
  return finite(value) && Number.isSafeInteger(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function statsProblem(value: unknown, label: string): string | null {
  const object = record(value);
  if (!object) return `${label} must be an object`;
  for (const stat of STAT_NAMES) {
    if (!safeInteger(object[stat]) || (object[stat] as number) < 0) {
      return `${label}.${stat} must be a non-negative safe integer`;
    }
  }
  return null;
}

function monsterProblem(value: unknown, label: string, db?: BattleDb): string | null {
  const monster = record(value);
  if (!monster) return `${label} must be an object`;
  if (!nonEmptyString(monster.iid)) return `${label}.iid must be a non-empty string`;
  if (!nonEmptyString(monster.slug) || (db && !(monster.slug in db.monsters))) {
    return `${label}.slug must name an imported monster`;
  }
  if (!safeInteger(monster.level) || monster.level < 1) return `${label}.level must be a positive safe integer`;
  for (const field of ["stage", "gender", "tasteCold", "tasteWarm"] as const) {
    if (!nonEmptyString(monster[field])) return `${label}.${field} must be a non-empty string`;
  }
  for (const field of ["height", "weight", "experienceModifier", "moneyModifier", "bond"] as const) {
    if (!finite(monster[field])) return `${label}.${field} must be finite`;
  }
  if (!Array.isArray(monster.birthdate)
    || monster.birthdate.length !== 2
    || !monster.birthdate.every(safeInteger)) return `${label}.birthdate must be an integer pair`;
  const baseProblem = statsProblem(monster.base, `${label}.base`);
  if (baseProblem) return baseProblem;
  const ivProblem = statsProblem(monster.individualValues, `${label}.individualValues`);
  if (ivProblem) return ivProblem;
  const tpProblem = statsProblem(monster.trainingPoints, `${label}.trainingPoints`);
  if (tpProblem) return tpProblem;
  const base = monster.base as unknown as Stats;
  if (!safeInteger(monster.currentHp) || monster.currentHp < 0 || monster.currentHp > base.hp) {
    return `${label}.currentHp must be an integer in 0..base.hp`;
  }
  if (!safeInteger(monster.totalExperience) || monster.totalExperience < 0) {
    return `${label}.totalExperience must be a non-negative safe integer`;
  }
  if (!Array.isArray(monster.moves) || !monster.moves.every(nonEmptyString)) {
    return `${label}.moves must contain strings`;
  }
  if (!Array.isArray(monster.types) || !monster.types.every(nonEmptyString)) {
    return `${label}.types must contain strings`;
  }
  if (monster.status !== null && !nonEmptyString(monster.status)) {
    return `${label}.status must be null or a non-empty string`;
  }
  return null;
}

function pendingProblem(value: unknown, label: string, db?: BattleDb): string | null {
  const pending = record(value);
  if (!pending) return `${label} must be an object`;
  if (!nonEmptyString(pending.iid)) return `${label}.iid must be a non-empty string`;
  if (!nonEmptyString(pending.slug) || (db && !(pending.slug in db.monsters))) {
    return `${label}.slug must name an imported monster`;
  }
  if (!safeInteger(pending.level) || pending.level < 1) return `${label}.level must be a positive safe integer`;
  if (!finite(pending.experienceModifier) || !finite(pending.moneyModifier)) {
    return `${label} modifiers must be finite`;
  }
  return null;
}

function unpackRuntimeExtension(value: JsonValue): JsonValue {
  if (typeof value !== "string") return value;
  if (!value.startsWith(TUXEMON_EXT_RUNTIME_PREFIX)) {
    throw new Error("runtime state has an unknown encoding");
  }
  try {
    return JSON.parse(value.slice(TUXEMON_EXT_RUNTIME_PREFIX.length)) as JsonValue;
  } catch {
    throw new Error("runtime state contains malformed JSON");
  }
}

function tuxemonStateProblem(value: JsonValue, db?: BattleDb): string | null {
  const state = record(value);
  if (!state || state.version !== 1) return "version must be 1";
  if (!Array.isArray(state.party) || state.party.length > PARTY_LIMIT) {
    return `party must contain at most ${PARTY_LIMIT} monsters`;
  }
  if (!Array.isArray(state.kennel) || state.kennel.length > KENNEL_LIMIT) {
    return `kennel must contain at most ${KENNEL_LIMIT} monsters`;
  }
  const identities = new Set<string>();
  for (const [group, values] of [["party", state.party], ["kennel", state.kennel]] as const) {
    for (let index = 0; index < values.length; index++) {
      const problem = monsterProblem(values[index], `${group}[${index}]`, db);
      if (problem) return problem;
      const iid = (values[index] as SpawnedMonsterSnapshot).iid!;
      if (identities.has(iid)) return `duplicate monster iid ${iid}`;
      identities.add(iid);
    }
  }
  if (!Array.isArray(state.caught) || !state.caught.every(nonEmptyString)) return "caught must contain strings";
  const npcParties = record(state.npcParties);
  if (!npcParties) return "npcParties must be an object";
  for (const [npc, values] of Object.entries(npcParties)) {
    if (!nonEmptyString(npc) || !Array.isArray(values) || values.length > PARTY_LIMIT) {
      return `npcParties.${npc} must contain at most ${PARTY_LIMIT} monsters`;
    }
    for (let index = 0; index < values.length; index++) {
      const problem = pendingProblem(values[index], `npcParties.${npc}[${index}]`, db);
      if (problem) return problem;
      const iid = (values[index] as PendingMonster).iid;
      if (identities.has(iid)) return `duplicate monster iid ${iid}`;
      identities.add(iid);
    }
  }
  if (!Array.isArray(state.history)) return "history must be an array";
  for (let index = 0; index < state.history.length; index++) {
    const entry = record(state.history[index]);
    if (!entry || !nonEmptyString(entry.fighter) || !nonEmptyString(entry.opponent)
      || !["won", "lost", "draw"].includes(String(entry.outcome))) {
      return `history[${index}] is invalid`;
    }
  }
  if (!safeInteger(state.money) || state.money < 0) {
    return "money must be a non-negative safe integer";
  }
  if (state.environment !== null && !nonEmptyString(state.environment)) {
    return "environment must be null or a non-empty string";
  }
  const faintPoints = record(state.faintPoints);
  if (!faintPoints) return "faintPoints must be an object";
  for (const [character, rawPoint] of Object.entries(faintPoints)) {
    const point = record(rawPoint);
    if (!nonEmptyString(character) || !point || !nonEmptyString(point.map)
      || !safeInteger(point.x) || point.x < 0 || !safeInteger(point.y) || point.y < 0) {
      return `faintPoints.${character} is invalid`;
    }
  }
  if (!safeInteger(state.nextMonsterId) || state.nextMonsterId < 1) {
    return "nextMonsterId must be a positive safe integer";
  }
  return null;
}

export function tuxemonExtensionProblem(value: JsonValue, db?: BattleDb): string | null {
  try {
    return tuxemonStateProblem(unpackRuntimeExtension(value), db);
  } catch (error) {
    return error instanceof Error ? error.message : "runtime state cannot be decoded";
  }
}

export function tuxemonExtensionState(value: JsonValue, db?: BattleDb): TuxemonExtensionState {
  let unpacked: JsonValue;
  try {
    unpacked = unpackRuntimeExtension(value);
  } catch (error) {
    throw new Error(`Tuxemon extension state: ${error instanceof Error ? error.message : "cannot decode"}`);
  }
  const problem = tuxemonStateProblem(unpacked, db);
  if (problem) throw new Error(`Tuxemon extension state: ${problem}`);
  return unpacked as unknown as TuxemonExtensionState;
}

/** Extension handlers receive state that cloneExtension validated at the
 * start of the current reducer frame. Avoid re-walking the full party once
 * for every page condition; command results are validated by the engine
 * before they become the following frame's state. */
let lastRuntimeWire: string | null = null;
let lastRuntimeState: TuxemonExtensionState | null = null;
function currentExtensionState(value: JsonValue): TuxemonExtensionState {
  if (typeof value === "string") {
    if (value === lastRuntimeWire && lastRuntimeState) return lastRuntimeState;
    const state = unpackRuntimeExtension(value) as unknown as TuxemonExtensionState;
    lastRuntimeWire = value;
    lastRuntimeState = state;
    return state;
  }
  return value as unknown as TuxemonExtensionState;
}

/** Keep the complete state in SessionState.ext while making the kit's
 * mandatory per-frame defensive clone O(1) for ordinary world frames. */
export function packTuxemonExtensionState(state: TuxemonExtensionState): JsonValue {
  return `${TUXEMON_EXT_RUNTIME_PREFIX}${JSON.stringify(state)}`;
}

function json(state: TuxemonExtensionState): JsonValue {
  return packTuxemonExtensionState(state);
}

function migrateV1(value: JsonValue): JsonValue {
  const state = record(value);
  return state?.version === 1 && state.environment === undefined
    ? { ...state, environment: null } as JsonValue
    : value;
}

function argsRecord(value: JsonValue, call: string): Record<string, unknown> {
  const args = record(value);
  if (!args) throw new Error(`${call}: arguments must be an object`);
  return args;
}

function nextIid(state: TuxemonExtensionState): [string, number] {
  if (!Number.isSafeInteger(state.nextMonsterId + 1)) throw new Error("tux.add_monster: monster id space exhausted");
  return [`txmn-${state.nextMonsterId.toString(36).padStart(6, "0")}`, state.nextMonsterId + 1];
}

function resolveSpecies(
  context: ExtensionReadContext,
  raw: unknown,
  db: BattleDb,
): string {
  if (typeof raw === "string") {
    if (!(raw in db.monsters)) throw new Error(`tux.add_monster: unknown monster '${raw}'`);
    return raw;
  }
  const reference = record(raw);
  if (!reference || !nonEmptyString(reference.variable)
    || !Array.isArray(reference.values) || !reference.values.every(nonEmptyString)) {
    throw new Error("tux.add_monster: species must be a slug or variable reference");
  }
  const selected = context.variables[reference.variable];
  let slug: string | undefined;
  if (typeof selected === "string") slug = selected;
  else if (safeInteger(selected) && selected >= 1) slug = reference.values[selected - 1] as string | undefined;
  if (!slug || !(slug in db.monsters)) {
    throw new Error(`tux.add_monster: ${reference.variable} does not select an imported monster`);
  }
  return slug;
}

function addMonsterCommand(source: BattleDbSource) {
  return (context: ExtensionCommandContext, value: JsonValue) => {
    const db = resolveBattleDb(source);
    const rulesDb = battleDbToTuxemonBattleDb(db);
    const args = argsRecord(value, "tux.add_monster");
    const character = args.character === undefined ? "player" : args.character;
    if (!nonEmptyString(character)) throw new Error("tux.add_monster: character must be a string");
    const slug = resolveSpecies(context, args.species, db);
    if (!safeInteger(args.level)) throw new Error("tux.add_monster: level must be an integer");
    const experienceModifier = args.experienceModifier === undefined ? 1 : args.experienceModifier;
    const moneyModifier = args.moneyModifier === undefined ? 0 : args.moneyModifier;
    if (!finite(experienceModifier) || !finite(moneyModifier)) {
      throw new Error("tux.add_monster: modifiers must be finite");
    }
    const current = currentExtensionState(context.ext);
    const [iid, followingId] = nextIid(current);
    if (character !== "player") {
      const party = [...(current.npcParties[character] ?? [])];
      if (party.length < PARTY_LIMIT) {
        party.push({
          iid,
          slug,
          level: Math.max(db.rules.levelRange[0], Math.min(db.rules.levelRange[1], args.level)),
          experienceModifier,
          moneyModifier,
        });
      }
      return {
        ext: json({
          ...current,
          npcParties: { ...current.npcParties, [character]: party },
          nextMonsterId: followingId,
        }),
        writes: { "v.add_monster": iid },
      };
    }

    const monster = spawnMonsterWithRandom(db, rulesDb, context.random, slug, args.level, {
      iid,
      experienceModifier,
      moneyModifier,
    });
    const party = [...current.party];
    const kennel = [...current.kennel];
    if (party.length < PARTY_LIMIT) party.push(monster);
    else if (kennel.length < KENNEL_LIMIT) kennel.push(monster);
    return {
      ext: json({
        ...current,
        party,
        kennel,
        caught: current.caught.includes(slug) ? current.caught : [...current.caught, slug],
        nextMonsterId: followingId,
      }),
      writes: { "v.add_monster": iid },
    };
  };
}

function monsterTarget(
  context: ExtensionReadContext,
  args: Record<string, unknown>,
): string | null {
  if (args.variable === undefined) return null;
  if (!nonEmptyString(args.variable)) throw new Error("monster target variable must be a string");
  const iid = context.variables[args.variable];
  return typeof iid === "string" && iid.length > 0 ? iid : "";
}

function updatePlayerMonsters(
  current: TuxemonExtensionState,
  target: string | null,
  update: (monster: SpawnedMonsterSnapshot) => SpawnedMonsterSnapshot,
): TuxemonExtensionState {
  if (target === "") return current;
  const apply = (monster: SpawnedMonsterSnapshot) =>
    target === null || monster.iid === target ? update(monster) : monster;
  return {
    ...current,
    party: current.party.map(apply),
    kennel: target === null ? current.kennel : current.kennel.map(apply),
  };
}

function healthCommand() {
  return (context: ExtensionCommandContext, value: JsonValue) => {
    const args = argsRecord(value, "tux.set_monster_health");
    const target = monsterTarget(context, args);
    const rawHealth = args.health;
    let kind: "full" | "fraction" | "points" = "full";
    let amount = 1;
    if (rawHealth !== undefined) {
      const health = record(rawHealth);
      if (!health || (health.kind !== "fraction" && health.kind !== "points") || !finite(health.value)) {
        throw new Error("tux.set_monster_health: health must be {kind,value}");
      }
      kind = health.kind;
      amount = health.value;
    }
    const current = currentExtensionState(context.ext);
    return {
      ext: json(updatePlayerMonsters(current, target, (monster) => {
        const wanted = kind === "full" ? monster.base.hp
          : kind === "fraction" ? Math.trunc(monster.base.hp * amount)
          : Math.trunc(amount);
        const currentHp = Math.max(0, Math.min(monster.base.hp, wanted));
        return { ...monster, currentHp, ...(currentHp === 0 ? { status: "faint" } : {}) };
      })),
    };
  };
}

function statusCommand(source: BattleDbSource) {
  return (context: ExtensionCommandContext, value: JsonValue) => {
    const db = resolveBattleDb(source);
    const args = argsRecord(value, "tux.set_monster_status");
    const target = monsterTarget(context, args);
    const status = args.status === undefined || args.status === "" ? null : args.status;
    if (status !== null && (!nonEmptyString(status) || !(status in db.statuses))) {
      throw new Error("tux.set_monster_status: status must name an imported status");
    }
    const current = currentExtensionState(context.ext);
    return {
      ext: json(updatePlayerMonsters(current, target, (monster) => ({ ...monster, status }))),
    };
  };
}

function partyFor(state: TuxemonExtensionState, character: string): readonly (SpawnedMonsterSnapshot | PendingMonster)[] {
  return character === "player" ? state.party : state.npcParties[character] ?? [];
}

function negate(result: boolean, args: Record<string, unknown>): boolean {
  return args.negate === true ? !result : result;
}

function compare(operator: unknown, left: number, right: number): boolean {
  switch (operator) {
    case "less_than": return left < right;
    case "less_or_equal": return left <= right;
    case "greater_than": return left > right;
    case "greater_or_equal": return left >= right;
    case "equals": return left === right;
    case "not_equals": return left !== right;
    default: throw new Error(`tux.party_size: unknown operator '${String(operator)}'`);
  }
}

/** Pure game registration used by createSession, GameView and attract replay. */
export function createTuxemonExtensions(source: BattleDbSource): ExtensionOptions {
  const initial = json(initialTuxemonExtensionState());
  const validationDb = typeof source !== "function" && !("load" in source) ? source : undefined;
  // cloneExtension invokes the validator on every frame. A packed primitive
  // is immutable, so validating each distinct string once retains the full
  // boundary check without reparsing an unchanged party sixty times/second.
  let lastValidatedRuntime: string | null = null;
  return {
    initial,
    commands: {
      "tux.add_monster": addMonsterCommand(source),
      "tux.set_monster_health": healthCommand(),
      "tux.set_monster_status": statusCommand(source),
      "tux.set_environment": (context, value) => {
        const args = argsRecord(value, "tux.set_environment");
        const environment = args.environment === undefined || args.environment === ""
          ? null
          : args.environment;
        if (environment !== null && !nonEmptyString(environment)) {
          throw new Error("tux.set_environment: environment must be a string");
        }
        const current = currentExtensionState(context.ext);
        return { ext: json({ ...current, environment }) };
      },
      "tux.set_faint_point": (context, value) => {
        const args = argsRecord(value, "tux.set_faint_point");
        const character = args.character === undefined ? "player" : args.character;
        if (!nonEmptyString(character) || !nonEmptyString(args.map)
          || !safeInteger(args.x) || args.x < 0 || !safeInteger(args.y) || args.y < 0) {
          throw new Error("tux.set_faint_point: invalid character/map/coordinates");
        }
        const current = currentExtensionState(context.ext);
        return { ext: json({
          ...current,
          faintPoints: { ...current.faintPoints, [character]: { map: args.map, x: args.x, y: args.y } },
        }) };
      },
      "tux.prepare_faint_transfer": (context, value) => {
        const args = argsRecord(value, "tux.prepare_faint_transfer");
        const character = args.character === undefined ? "player" : args.character;
        if (!nonEmptyString(character)) throw new Error("tux.prepare_faint_transfer: invalid character");
        const current = currentExtensionState(context.ext);
        const point = current.faintPoints[character];
        if (!point) return;
        const healHere = args.healing === true && args.currentMap === point.map;
        const ext = healHere
          ? updatePlayerMonsters(current, null, (monster) => ({
              ...monster,
              currentHp: monster.base.hp,
              status: null,
            }))
          : current;
        return { ext: json(ext), writes: {
          "tux.faint.map": point.map,
          "tux.faint.x": point.x,
          "tux.faint.y": point.y,
        } };
      },
    },
    conditions: {
      "tux.environment_is": (context, value) => {
        const args = argsRecord(value, "tux.environment_is");
        if (!nonEmptyString(args.environment)) return false;
        const state = currentExtensionState(context.ext);
        return negate(state.environment === args.environment, args);
      },
      "tux.has_faint_point": (context, value) => {
        const args = argsRecord(value, "tux.has_faint_point");
        if (!nonEmptyString(args.character)) return false;
        const state = currentExtensionState(context.ext);
        return negate(state.faintPoints[args.character] !== undefined, args);
      },
      "tux.party_size": (context, value) => {
        const args = argsRecord(value, "tux.party_size");
        if (!nonEmptyString(args.character) || !safeInteger(args.value)) return false;
        const state = currentExtensionState(context.ext);
        return negate(compare(args.operator, partyFor(state, args.character).length, args.value), args);
      },
      "tux.has_monster": (context, value) => {
        const args = argsRecord(value, "tux.has_monster");
        if (!nonEmptyString(args.character) || !nonEmptyString(args.species)) return false;
        const state = currentExtensionState(context.ext);
        return negate(partyFor(state, args.character).some((monster) => monster.slug === args.species), args);
      },
      "tux.char_defeated": (context, value) => {
        const args = argsRecord(value, "tux.char_defeated");
        if (!nonEmptyString(args.character)) return false;
        const state = currentExtensionState(context.ext);
        const party = partyFor(state, args.character);
        const defeated = party.length > 0 && party.every((monster) =>
          "currentHp" in monster && monster.currentHp !== undefined && monster.currentHp <= 0
        );
        return negate(defeated, args);
      },
      "tux.battle_outcome": (context, value) => {
        const args = argsRecord(value, "tux.battle_outcome");
        if (!nonEmptyString(args.fighter) || !nonEmptyString(args.opponent)
          || !["won", "lost", "draw"].includes(String(args.outcome))) return false;
        const state = currentExtensionState(context.ext);
        const found = state.history.some((entry) => entry.fighter === args.fighter
          && entry.opponent === args.opponent && entry.outcome === args.outcome);
        return negate(found, args);
      },
      "tux.battle_outcome_count": (context, value) => {
        const args = argsRecord(value, "tux.battle_outcome_count");
        if (!nonEmptyString(args.fighter) || !nonEmptyString(args.opponent)
          || !["won", "lost", "draw"].includes(String(args.outcome))
          || !safeInteger(args.count) || args.count < 0) return false;
        const state = currentExtensionState(context.ext);
        const count = state.history.filter((entry) => entry.fighter === args.fighter
          && entry.opponent === args.opponent && entry.outcome === args.outcome).length;
        return negate(count >= args.count, args);
      },
    },
    codec: {
      encode: (value) => ({
        format: TUXEMON_EXT_SAVE_FORMAT,
        state: tuxemonExtensionState(value, resolveBattleDb(source)) as unknown as JsonValue,
      }),
      decode: (value) => {
        if (value === null) return initial;
        const saved = record(value);
        if (saved?.format === TUXEMON_EXT_SAVE_FORMAT && saved.state !== undefined) {
          const migrated = migrateV1(saved.state as JsonValue);
          return json(tuxemonExtensionState(migrated, resolveBattleDb(source)));
        }
        // Accept a direct v1 state for development snapshots made before the
        // save wrapper was introduced.
        if (saved?.version === 1) {
          return json(tuxemonExtensionState(migrateV1(value), resolveBattleDb(source)));
        }
        throw new Error("unsupported Tuxemon extension save format");
      },
    },
    validate: (value) => {
      if (typeof value === "string" && value === lastValidatedRuntime) return;
      // Lazy production sources live in the pak. Commands and save restore
      // perform the database-backed check at their boundary; the hot-frame
      // validator still checks the complete numeric/shape invariants here.
      const problem = tuxemonExtensionProblem(value, validationDb);
      if (!problem && typeof value === "string") lastValidatedRuntime = value;
      return problem ?? undefined;
    },
  };
}
