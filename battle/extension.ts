import type {
  ExtensionCommandContext,
  ExtensionOptions,
  ExtensionReadContext,
} from "../vendor/pocket-rpgkit/src/engine/extensions.ts";
import type { JsonValue } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import type { BattleDb } from "../importer/battle-schema.ts";
import {
  DAYLIGHT_STAGE_VARIABLE,
  DAYLIGHT_TARGET_VARIABLE,
  DAYLIGHT_TINT_PROFILES,
} from "./daylight.ts";
import { advanceDaycareStep } from "./daycare.ts";
import { battleDbToTuxemonBattleDb } from "./from-battle-db.ts";
import { evolveMonsterSnapshot } from "./progression.ts";
import { spawnMonsterWithRandom } from "./spawn.ts";
import {
  advanceClock,
  advanceTimeWeather,
  DEFAULT_WEATHER_SLUGS,
  initialTimeWeatherState,
  stageOfDayFromMinute,
  timeIs,
  timeWeatherProblem,
  updateTimeWrites,
  type ClockState,
  type Hemisphere,
  type TimeWeatherState,
  type WeatherSchedule,
  type WeatherState,
} from "./time-weather.ts";
import type { DaycareExtensionState, SpawnedMonsterSnapshot, Stats } from "./types.ts";
import { STAT_NAMES } from "./types.ts";

export const PARTY_LIMIT = 6;
export const KENNEL_LIMIT = 30;
export const TUXEMON_EXT_SAVE_FORMAT = "pocket-tuxemon/ext/v1";
const TUXEMON_EXT_RUNTIME_PREFIX = "pocket-tuxemon/ext-runtime/v1:";
const TUXEMON_EXT_RUNTIME_V2_PREFIX = "pocket-tuxemon/ext-runtime/v2:";

interface TuxemonRuntimeEnvelope {
  wire: string;
  coreWire: string;
  corePrefix: string;
  refTick: number;
  epochDay: number;
  minuteOfDay: number;
  subMinuteTicks: number;
  ticksPerGameMinute: number;
  weatherSlug: string;
  weatherSlugWire: string;
  weatherEnteredAtTick: number;
  weatherNextTransitionTick: number;
  weatherRngCursor: number;
}

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
  /** Seen-only Tuxepedia entries. Caught species live in `caught` instead. */
  seen: string[];
  caught: string[];
  /** Upstream keeps failed escape attempts on the player between battles. */
  runAttempts: number;
  npcParties: Record<string, PendingMonster[]>;
  history: BattleHistoryEntry[];
  /** Active Tuxemon battle backdrop; null matches an unloaded environment. */
  environment: string | null;
  faintPoints: Record<string, FaintPoint>;
  nextMonsterId: number;
  /** Deterministic virtual calendar; advanced only by active world ticks. */
  clock: ClockState;
  /** Saved weather stream, deliberately independent from the battle RNG. */
  weather: WeatherState;
  /** Sparse: present once the player's main "Kennel" box exists. Upstream
   *  creates it on the first PC visit or the first party overflow; its
   *  monsters always live in `kennel`. */
  kennelBox?: true;
  /** Sparse named boxes other than the main Kennel, in creation order
   *  (for example the story's hidden "quarantine" box). */
  boxes?: Record<string, MonsterBox>;
  /** Sparse monster-shop sales per `<economy>:<slug>` stock label. */
  shopSold?: Record<string, number>;
  /** Sparse two-slot daycare, created on first deposit. */
  daycare?: DaycareExtensionState;
}

export interface MonsterBox {
  /** Hidden boxes are excluded from PC storage menus. */
  hidden: boolean;
  capacity: number;
  monsters: SpawnedMonsterSnapshot[];
}

export const KENNEL_BOX = "Kennel";

/** True when the player's main Kennel box exists (upstream `has_box`). */
export function kennelExists(state: Readonly<TuxemonExtensionState>): boolean {
  return state.kennelBox === true || state.kennel.length > 0;
}

export interface TuxemonExtensionRuntimeOptions {
  /** Fresh-game clock/weather sampled or fixed by the effect shell. */
  initialTimeWeather?: TimeWeatherState;
  /** Imported weather slugs and deterministic duration bounds. */
  weatherSchedule?: WeatherSchedule;
  hemisphere?: Hemisphere;
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

export function initialTuxemonExtensionState(
  timeWeather: Readonly<TimeWeatherState> = initialTimeWeatherState(),
): TuxemonExtensionState {
  return {
    version: 1,
    party: [],
    kennel: [],
    seen: [],
    caught: [],
    runAttempts: 0,
    npcParties: {},
    history: [],
    environment: null,
    faintPoints: {},
    nextMonsterId: 1,
    clock: { ...timeWeather.clock },
    weather: { ...timeWeather.weather },
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
  if (monster.nickname !== undefined
    && (!nonEmptyString(monster.nickname) || monster.nickname.length > 15)) {
    return `${label}.nickname must contain 1..15 characters`;
  }
  if (!safeInteger(monster.level) || monster.level < 1) return `${label}.level must be a positive safe integer`;
  for (const field of ["stage", "gender", "tasteCold", "tasteWarm"] as const) {
    if (!nonEmptyString(monster[field])) return `${label}.${field} must be a non-empty string`;
  }
  for (const field of ["motherIid", "fatherIid"] as const) {
    if (monster[field] !== undefined && !nonEmptyString(monster[field])) {
      return `${label}.${field} must be a non-empty string when present`;
    }
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

let lastRuntimeEnvelope: TuxemonRuntimeEnvelope | null = null;

function runtimeEnvelope(value: JsonValue): TuxemonRuntimeEnvelope | null {
  if (typeof value !== "string" || !value.startsWith(TUXEMON_EXT_RUNTIME_V2_PREFIX)) return null;
  if (value === lastRuntimeEnvelope?.wire) return lastRuntimeEnvelope;
  const fields = value.slice(TUXEMON_EXT_RUNTIME_V2_PREFIX.length).split("\n");
  if (fields.length !== 10) return null;
  const numbers = [fields[1], fields[2], fields[3], fields[4], fields[5], fields[7], fields[8], fields[9]];
  if (!numbers.every((part) => /^(?:0|[1-9]\d*)$/.test(part!))) return null;
  const parsed = numbers.map(Number);
  if (!parsed.every(Number.isSafeInteger)) return null;
  let weatherSlug: unknown;
  try {
    weatherSlug = JSON.parse(fields[6]!);
  } catch {
    return null;
  }
  if (typeof weatherSlug !== "string") return null;
  const envelope: TuxemonRuntimeEnvelope = {
    wire: value,
    coreWire: fields[0]!,
    corePrefix: `${TUXEMON_EXT_RUNTIME_V2_PREFIX}${fields[0]!}\n`,
    refTick: parsed[0]!,
    epochDay: parsed[1]!,
    minuteOfDay: parsed[2]!,
    subMinuteTicks: parsed[3]!,
    ticksPerGameMinute: parsed[4]!,
    weatherSlug,
    weatherSlugWire: fields[6]!,
    weatherEnteredAtTick: parsed[5]!,
    weatherNextTransitionTick: parsed[6]!,
    weatherRngCursor: parsed[7]!,
  };
  lastRuntimeEnvelope = envelope;
  return envelope;
}

function parseRuntimePart(value: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    throw new Error("runtime state contains malformed JSON");
  }
}

function unpackRuntimeExtension(value: JsonValue): JsonValue {
  const envelope = runtimeEnvelope(value);
  if (envelope) {
    const core = record(parseRuntimePart(envelope.coreWire));
    if (!core) throw new Error("runtime state core must be an object");
    return {
      ...core,
      clock: clockFromRuntimeEnvelope(envelope),
      weather: weatherFromRuntimeEnvelope(envelope),
    } as unknown as JsonValue;
  }
  if (typeof value !== "string") return value;
  if (!value.startsWith(TUXEMON_EXT_RUNTIME_PREFIX)) {
    throw new Error("runtime state has an unknown encoding");
  }
  return parseRuntimePart(value.slice(TUXEMON_EXT_RUNTIME_PREFIX.length));
}

function clockFromRuntimeEnvelope(envelope: TuxemonRuntimeEnvelope): ClockState {
  return {
    mode: "game",
    refTick: envelope.refTick,
    epochDay: envelope.epochDay,
    minuteOfDay: envelope.minuteOfDay,
    subMinuteTicks: envelope.subMinuteTicks,
    ticksPerGameMinute: envelope.ticksPerGameMinute,
  };
}

function weatherFromRuntimeEnvelope(envelope: TuxemonRuntimeEnvelope): WeatherState {
  return {
    slug: envelope.weatherSlug,
    enteredAtTick: envelope.weatherEnteredAtTick,
    nextTransitionTick: envelope.weatherNextTransitionTick,
    rngCursor: envelope.weatherRngCursor,
  };
}

function tuxemonStateProblem(
  value: JsonValue,
  db?: BattleDb,
  weatherSlugs?: ReadonlySet<string>,
): string | null {
  const state = record(value);
  if (!state || state.version !== 1) return "version must be 1";
  if (!Array.isArray(state.party) || state.party.length > PARTY_LIMIT) {
    return `party must contain at most ${PARTY_LIMIT} monsters`;
  }
  if (!Array.isArray(state.kennel) || state.kennel.length > KENNEL_LIMIT) {
    return `kennel must contain at most ${KENNEL_LIMIT} monsters`;
  }
  const identities = new Set<string>();
  const groups: [string, unknown[]][] = [["party", state.party], ["kennel", state.kennel]];
  if (state.kennelBox !== undefined && state.kennelBox !== true) return "kennelBox must be true when present";
  if (state.boxes !== undefined) {
    const boxes = record(state.boxes);
    if (!boxes) return "boxes must be an object";
    for (const [id, rawBox] of Object.entries(boxes)) {
      const box = record(rawBox);
      if (!nonEmptyString(id) || id === KENNEL_BOX || !box || typeof box.hidden !== "boolean"
        || !safeInteger(box.capacity) || box.capacity < 1 || box.capacity > KENNEL_LIMIT
        || !Array.isArray(box.monsters) || box.monsters.length > box.capacity) {
        return `boxes.${id} is invalid`;
      }
      groups.push([`boxes.${id}`, box.monsters]);
    }
  }
  if (state.shopSold !== undefined) {
    const sold = record(state.shopSold);
    if (!sold || !Object.entries(sold).every(([key, count]) =>
      nonEmptyString(key) && safeInteger(count) && count > 0)) {
      return "shopSold must map stock labels to positive integers";
    }
  }
  if (state.daycare !== undefined) {
    const daycare = record(state.daycare);
    if (!daycare || !Array.isArray(daycare.parents) || daycare.parents.length < 1
      || daycare.parents.length > 2) {
      return "daycare.parents must contain 1..2 monsters";
    }
    if (!safeInteger(daycare.progressSteps) || daycare.progressSteps < 0) {
      return "daycare.progressSteps must be a non-negative safe integer";
    }
    if (!finite(daycare.pendingExperience) || daycare.pendingExperience < 0
      || !safeInteger(daycare.pendingExperience * 4)) {
      return "daycare.pendingExperience must be a non-negative quarter increment";
    }
    for (const field of ["lastTrainingExp", "lastTrainingCost"] as const) {
      if (!safeInteger(daycare[field]) || daycare[field] < 0) {
        return `daycare.${field} must be a non-negative safe integer`;
      }
    }
    groups.push(["daycare.parents", daycare.parents]);
  }
  for (const [group, values] of groups) {
    for (let index = 0; index < values.length; index++) {
      const problem = monsterProblem(values[index], `${group}[${index}]`, db);
      if (problem) return problem;
      const iid = (values[index] as SpawnedMonsterSnapshot).iid!;
      if (identities.has(iid)) return `duplicate monster iid ${iid}`;
      identities.add(iid);
    }
  }
  if (!Array.isArray(state.seen) || !state.seen.every(nonEmptyString)) return "seen must contain strings";
  if (!Array.isArray(state.caught) || !state.caught.every(nonEmptyString)) return "caught must contain strings";
  const seen = state.seen as string[];
  const caught = state.caught as string[];
  if (new Set(seen).size !== seen.length) return "seen must not contain duplicates";
  if (new Set(caught).size !== caught.length) return "caught must not contain duplicates";
  if (seen.some((slug) => caught.includes(slug))) return "seen and caught must be disjoint";
  if (db) {
    if (seen.some((slug) => !(slug in db.monsters))) return "seen must name imported monsters";
    if (caught.some((slug) => !(slug in db.monsters))) return "caught must name imported monsters";
  }
  if (!safeInteger(state.runAttempts) || state.runAttempts < 0) {
    return "runAttempts must be a non-negative safe integer";
  }
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
  const timeProblem = timeWeatherProblem(
    { clock: state.clock, weather: state.weather },
    weatherSlugs,
  );
  if (timeProblem) return timeProblem;
  return null;
}

export function tuxemonExtensionProblem(
  value: JsonValue,
  db?: BattleDb,
  weatherSlugs?: ReadonlySet<string>,
): string | null {
  try {
    return tuxemonStateProblem(unpackRuntimeExtension(value), db, weatherSlugs);
  } catch (error) {
    return error instanceof Error ? error.message : "runtime state cannot be decoded";
  }
}

export function tuxemonExtensionState(
  value: JsonValue,
  db?: BattleDb,
  weatherSlugs?: ReadonlySet<string>,
): TuxemonExtensionState {
  let unpacked: JsonValue;
  try {
    unpacked = unpackRuntimeExtension(value);
  } catch (error) {
    throw new Error(`Tuxemon extension state: ${error instanceof Error ? error.message : "cannot decode"}`);
  }
  const problem = tuxemonStateProblem(unpacked, db, weatherSlugs);
  if (problem) throw new Error(`Tuxemon extension state: ${problem}`);
  return unpacked as unknown as TuxemonExtensionState;
}

/** Extension handlers receive state that cloneExtension validated at the
 * start of the current reducer frame. Avoid re-walking the full party once
 * for every page condition; command results are validated by the engine
 * before they become the following frame's state. */
let lastRuntimeState: TuxemonExtensionState | null = null;
let lastRuntimeStateWire: string | null = null;
let lastRuntimeCoreWire: string | null = null;
let lastRuntimeCore: Record<string, unknown> | null = null;
function currentExtensionState(value: JsonValue): TuxemonExtensionState {
  const envelope = runtimeEnvelope(value);
  if (envelope) {
    if (envelope.wire === lastRuntimeStateWire && lastRuntimeState) {
      return lastRuntimeState;
    }
    const core = envelope.coreWire === lastRuntimeCoreWire && lastRuntimeCore
      ? lastRuntimeCore
      : record(parseRuntimePart(envelope.coreWire))!;
    const state = {
      ...core,
      clock: clockFromRuntimeEnvelope(envelope),
      weather: weatherFromRuntimeEnvelope(envelope),
    } as unknown as TuxemonExtensionState;
    lastRuntimeEnvelope = envelope;
    lastRuntimeState = state;
    lastRuntimeStateWire = envelope.wire;
    lastRuntimeCoreWire = envelope.coreWire;
    lastRuntimeCore = core;
    return state;
  }
  if (typeof value === "string") {
    const state = unpackRuntimeExtension(value) as unknown as TuxemonExtensionState;
    lastRuntimeEnvelope = null;
    lastRuntimeState = state;
    lastRuntimeStateWire = value;
    return state;
  }
  return value as unknown as TuxemonExtensionState;
}

/**
 * Keep the whole runtime in one immutable primitive so the kit's mandatory
 * frame clone is O(1). The large battle core precedes a newline-delimited
 * clock/weather suffix; ordinary ticks reuse the cached prefix and never
 * parse or serialize JSON.
 */
export function packTuxemonExtensionState(state: TuxemonExtensionState): JsonValue {
  const { clock, weather, ...core } = state;
  const coreWire = JSON.stringify(core);
  return `${TUXEMON_EXT_RUNTIME_V2_PREFIX}${coreWire}\n${clock.refTick}\n${clock.epochDay}`
    + `\n${clock.minuteOfDay}\n${clock.subMinuteTicks}\n${clock.ticksPerGameMinute}`
    + `\n${JSON.stringify(weather.slug)}\n${weather.enteredAtTick}`
    + `\n${weather.nextTransitionTick}\n${weather.rngCursor}`;
}

function json(state: TuxemonExtensionState): JsonValue {
  const wire = packTuxemonExtensionState(state) as string;
  const envelope = runtimeEnvelope(wire)!;
  lastRuntimeEnvelope = envelope;
  lastRuntimeState = state;
  lastRuntimeStateWire = wire;
  lastRuntimeCoreWire = envelope.coreWire;
  const { clock: _clock, weather: _weather, ...core } = state;
  lastRuntimeCore = core;
  return wire;
}

interface PackedTimeWeatherAdvance {
  wire: string;
  minuteOfDay: number;
  subMinuteTicks: number;
}

/**
 * Clock ticks are the only extension mutation that runs on every active
 * reference tick. Reuse the immutable battle-core string, advance the flat
 * primitive fields directly, and invoke the general weather reducer only at
 * a saved deadline.
 */
function packTimeWeatherAdvance(
  currentWire: JsonValue,
  schedule: Readonly<WeatherSchedule>,
): PackedTimeWeatherAdvance {
  const currentEnvelope = runtimeEnvelope(currentWire);
  if (!currentEnvelope) {
    const current = currentExtensionState(currentWire);
    const advanced = advanceTimeWeather(current, 1, schedule);
    const state = { ...current, ...advanced };
    return {
      wire: json(state) as string,
      minuteOfDay: advanced.clock.minuteOfDay,
      subMinuteTicks: advanced.clock.subMinuteTicks,
    };
  }

  const refTick = currentEnvelope.refTick + 1;
  let epochDay = currentEnvelope.epochDay;
  let minuteOfDay = currentEnvelope.minuteOfDay;
  let subMinuteTicks = currentEnvelope.subMinuteTicks + 1;
  const ticksPerGameMinute = currentEnvelope.ticksPerGameMinute;
  if (!Number.isSafeInteger(refTick)) throw new Error("time-weather: clock overflow");
  if (subMinuteTicks === ticksPerGameMinute) {
    subMinuteTicks = 0;
    minuteOfDay++;
    if (minuteOfDay === 1_440) {
      minuteOfDay = 0;
      epochDay++;
      if (!Number.isSafeInteger(epochDay)) throw new Error("time-weather: clock overflow");
    }
  }
  let weatherSlug = currentEnvelope.weatherSlug;
  let weatherSlugWire = currentEnvelope.weatherSlugWire;
  let weatherEnteredAtTick = currentEnvelope.weatherEnteredAtTick;
  let weatherNextTransitionTick = currentEnvelope.weatherNextTransitionTick;
  let weatherRngCursor = currentEnvelope.weatherRngCursor;
  if (weatherNextTransitionTick <= refTick) {
    const weather = advanceTimeWeather({
      clock: {
        mode: "game",
        refTick,
        epochDay,
        minuteOfDay,
        subMinuteTicks,
        ticksPerGameMinute,
      },
      weather: weatherFromRuntimeEnvelope(currentEnvelope),
    }, 0, schedule).weather;
    weatherSlug = weather.slug;
    weatherSlugWire = JSON.stringify(weather.slug);
    weatherEnteredAtTick = weather.enteredAtTick;
    weatherNextTransitionTick = weather.nextTransitionTick;
    weatherRngCursor = weather.rngCursor;
  }
  const wire = `${currentEnvelope.corePrefix}${refTick}\n${epochDay}\n${minuteOfDay}`
    + `\n${subMinuteTicks}\n${ticksPerGameMinute}\n${weatherSlugWire}`
    + `\n${weatherEnteredAtTick}\n${weatherNextTransitionTick}\n${weatherRngCursor}`;
  lastRuntimeEnvelope = {
    wire,
    coreWire: currentEnvelope.coreWire,
    corePrefix: currentEnvelope.corePrefix,
    refTick,
    epochDay,
    minuteOfDay,
    subMinuteTicks,
    ticksPerGameMinute,
    weatherSlug,
    weatherSlugWire,
    weatherEnteredAtTick,
    weatherNextTransitionTick,
    weatherRngCursor,
  };
  lastRuntimeState = null;
  lastRuntimeStateWire = null;
  return { wire, minuteOfDay, subMinuteTicks };
}

function migrateV1(value: JsonValue): JsonValue {
  const state = record(value);
  if (state?.version !== 1) return value;
  // KB5 makes SessionState.items/gold the only bag and wallet. Older saves
  // may still carry the former battle-only mirrors; discard those fields
  // while preserving every Tuxemon-specific extension value.
  const { inventory: _legacyInventory, money: _legacyMoney, ...extension } = state;
  const hasClock = state.clock !== undefined;
  const hasWeather = state.weather !== undefined;
  if (hasClock !== hasWeather) {
    throw new Error("Tuxemon extension state: clock and weather must either both be present or both be absent");
  }
  return {
    ...extension,
    ...(state.seen === undefined ? { seen: [] } : {}),
    ...(state.environment === undefined ? { environment: null } : {}),
    ...(state.runAttempts === undefined ? { runAttempts: 0 } : {}),
    ...(!hasClock
      ? initialTimeWeatherState()
      : {}),
  } as JsonValue;
}

function argsRecord(value: JsonValue, call: string): Record<string, unknown> {
  const args = record(value);
  if (!args) throw new Error(`${call}: arguments must be an object`);
  return args;
}

function nextIid(state: TuxemonExtensionState): [string, number] {
  return nextMonsterIid(state.nextMonsterId);
}

/** Deterministic iid for a monster spawned outside tux.add_monster (for
 *  example a trainer party folded into the battle setup), sharing the same
 *  id space so persisted NPC parties stay addressable by iid. */
export function nextMonsterIid(nextMonsterId: number): [string, number] {
  if (!Number.isSafeInteger(nextMonsterId + 1)) throw new Error("monster id space exhausted");
  return [`txmn-${nextMonsterId.toString(36).padStart(6, "0")}`, nextMonsterId + 1];
}

/** Register a sighting without weakening an existing caught entry. */
export function registerSeenMonster(
  state: TuxemonExtensionState,
  slug: string,
): TuxemonExtensionState {
  if (state.caught.includes(slug) || state.seen.includes(slug)) return state;
  return { ...state, seen: [...state.seen, slug] };
}

/** Register ownership monotonically: caught wins over seen-only. */
export function registerCaughtMonster(
  state: TuxemonExtensionState,
  slug: string,
): TuxemonExtensionState {
  const seen = state.seen.includes(slug)
    ? state.seen.filter((candidate) => candidate !== slug)
    : state.seen;
  const caught = state.caught.includes(slug) ? state.caught : [...state.caught, slug];
  if (seen === state.seen && caught === state.caught) return state;
  return { ...state, seen, caught };
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
      ext: json(registerCaughtMonster({
        ...current,
        party,
        kennel,
        ...(kennel.length > 0 ? { kennelBox: true as const } : {}),
        nextMonsterId: followingId,
      }, slug)),
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

function firstWaitingIndex(state: TuxemonExtensionState): number {
  return state.party.findIndex((monster) => monster.waitingToEvolve === true);
}

function clearPendingEvolution(state: TuxemonExtensionState): TuxemonExtensionState {
  const index = firstWaitingIndex(state);
  if (index < 0) return state;
  const party = [...state.party];
  party[index] = { ...party[index]!, waitingToEvolve: false };
  return { ...state, party };
}

function evolutionVariables(
  values: ExtensionReadContext["variables"],
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(values)) {
    result[key] = value;
    if (key.startsWith("v.")) result[key.slice(2)] = value;
  }
  return result;
}

function evolutionCommand(source: BattleDbSource) {
  return (context: ExtensionCommandContext, value: JsonValue) => {
    const args = argsRecord(value, "tux.evolution");
    const character = args.character === undefined ? "player" : args.character;
    if (!nonEmptyString(character)) throw new Error("tux.evolution: character must be a string");
    if (args.inside !== undefined && typeof args.inside !== "boolean") {
      throw new Error("tux.evolution: inside must be boolean");
    }
    const current = currentExtensionState(context.ext);
    // The imported story only invokes this action for the player. Staged NPC
    // parties do not carry full persistent monster state and cannot evolve.
    if (character !== "player") return { ext: json(current) };
    const index = firstWaitingIndex(current);
    if (index < 0) return { ext: json(current) };
    const db = resolveBattleDb(source);
    const evolved = evolveMonsterSnapshot(
      db,
      battleDbToTuxemonBattleDb(db),
      current.party[index]!,
      current.party,
      {
        variables: evolutionVariables(context.variables),
        inside: args.inside === true,
      },
      context.random,
    );
    if (!evolved) return { ext: json(clearPendingEvolution(current)) };
    const party = [...current.party];
    party[index] = evolved.monster;
    return { ext: json(registerCaughtMonster({
      ...current,
      party,
    }, evolved.target)) };
  };
}

function tuxepediaCommand(source: BattleDbSource) {
  return (context: ExtensionCommandContext, value: JsonValue) => {
    const args = argsRecord(value, "tux.set_tuxepedia");
    const character = args.character === undefined ? "player" : args.character;
    if (!nonEmptyString(character)) throw new Error("tux.set_tuxepedia: character must be a string");
    if (!nonEmptyString(args.species)) throw new Error("tux.set_tuxepedia: species must be a string");
    const db = resolveBattleDb(source);
    if (!(args.species in db.monsters)) {
      throw new Error(`tux.set_tuxepedia: unknown monster '${args.species}'`);
    }
    if (args.status !== "seen" && args.status !== "caught" && args.status !== "unseen") {
      throw new Error("tux.set_tuxepedia: status must be unseen, seen, or caught");
    }
    const current = currentExtensionState(context.ext);
    if (character !== "player" || args.status === "unseen") return { ext: json(current) };
    return {
      ext: json(args.status === "caught"
        ? registerCaughtMonster(current, args.species)
        : registerSeenMonster(current, args.species)),
    };
  };
}

function renameTarget(
  context: ExtensionReadContext,
  args: Record<string, unknown>,
  call: string,
): { state: TuxemonExtensionState; monster: SpawnedMonsterSnapshot } | null {
  if (!nonEmptyString(args.variable)) throw new Error(`${call}: variable must be a string`);
  const iid = context.variables[args.variable];
  if (typeof iid !== "string" || iid.length === 0) return null;
  const state = currentExtensionState(context.ext);
  const monster = state.party.find((candidate) => candidate.iid === iid);
  return monster ? { state, monster } : null;
}

function prepareMonsterRenameCommand(source: BattleDbSource) {
  return (context: ExtensionCommandContext, value: JsonValue) => {
    const args = argsRecord(value, "tux.prepare_monster_rename");
    if (!nonEmptyString(args.nameVariable)) {
      throw new Error("tux.prepare_monster_rename: nameVariable must be a string");
    }
    const target = renameTarget(context, args, "tux.prepare_monster_rename");
    if (!target) return;
    const name = resolveBattleDb(source).monsters[target.monster.slug]?.name;
    if (!nonEmptyString(name)) {
      throw new Error(`tux.prepare_monster_rename: unknown monster '${target.monster.slug}'`);
    }
    return { writes: { [args.nameVariable]: name.slice(0, 15) } };
  };
}

function applyMonsterRenameCommand() {
  return (context: ExtensionCommandContext, value: JsonValue) => {
    const args = argsRecord(value, "tux.apply_monster_rename");
    if (!nonEmptyString(args.nameVariable)) {
      throw new Error("tux.apply_monster_rename: nameVariable must be a string");
    }
    const target = renameTarget(context, args, "tux.apply_monster_rename");
    if (!target) return;
    const nickname = context.variables[args.nameVariable];
    if (!nonEmptyString(nickname) || nickname.length > 15) {
      throw new Error("tux.apply_monster_rename: name must contain 1..15 characters");
    }
    return {
      ext: json(updatePlayerMonsters(target.state, target.monster.iid!, (monster) => ({ ...monster, nickname }))),
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

/** Upstream get_player_monster filter, baked by the importer. String fields
 *  compare equality; numeric fields carry an explicit operator. */
interface PartyFilter {
  field: string;
  value: string | number;
  op?: string;
}

const title = (slug: string): string => slug
  .split("_")
  .map((part) => part ? part[0]!.toUpperCase() + part.slice(1) : part)
  .join(" ");

function filterArgs(value: JsonValue, call: string): { variable?: string; cancelCode?: number; filters: PartyFilter[] } {
  const args = record(value);
  if (!args) throw new Error(`${call}: arguments must be an object`);
  const out: { variable?: string; cancelCode?: number; filters: PartyFilter[] } = { filters: [] };
  if (args.variable !== undefined) {
    if (!nonEmptyString(args.variable)) throw new Error(`${call}: variable must be a non-empty string`);
    out.variable = args.variable;
  }
  if (args.cancelCode !== undefined) {
    if (!safeInteger(args.cancelCode)) throw new Error(`${call}: cancelCode must be a safe integer`);
    out.cancelCode = args.cancelCode;
  }
  if (args.filters !== undefined) {
    if (!Array.isArray(args.filters)) throw new Error(`${call}: filters must be an array`);
    for (const [index, raw] of args.filters.entries()) {
      const filter = record(raw);
      if (!filter || !nonEmptyString(filter.field)) {
        throw new Error(`${call}: filters[${index}] must be an object with a string field`);
      }
      const entry: PartyFilter = { field: filter.field, value: filter.value as string | number };
      if (filter.op !== undefined) {
        if (!nonEmptyString(filter.op)) throw new Error(`${call}: filters[${index}].op must be a string`);
        entry.op = filter.op;
      }
      out.filters.push(entry);
    }
  }
  return out;
}

function monsterMatches(
  monster: SpawnedMonsterSnapshot,
  db: BattleDb,
  filter: PartyFilter,
): boolean {
  const { field, value } = filter;
  switch (field) {
    case "slug": return monster.slug === value;
    case "gender": return monster.gender === value;
    case "evolution_stage": return monster.stage === value;
    case "element": return monster.types?.includes(String(value)) ?? false;
    case "shape": return db.monsters[monster.slug]?.shape === value;
    case "taste_warm": return monster.tasteWarm === value;
    case "taste_cold": return monster.tasteCold === value;
    case "level": return compare(filter.op, monster.level, Number(value));
    case "weight": return compare(filter.op, Math.trunc(monster.weight), Number(value));
    case "height": return compare(filter.op, Math.trunc(monster.height), Number(value));
    case "max_hp": return compare(filter.op, monster.base.hp, Number(value));
    case "current_hp": return compare(filter.op, monster.currentHp ?? 0, Number(value));
    case "armour":
    case "dodge":
    case "melee":
    case "ranged":
    case "speed":
      return compare(filter.op, monster.base[field], Number(value));
    default: return false;
  }
}

function matchingParty(
  state: TuxemonExtensionState,
  db: BattleDb,
  filters: readonly PartyFilter[],
): SpawnedMonsterSnapshot[] {
  return state.party.filter((monster) => filters.every((filter) => monsterMatches(monster, db, filter)));
}

/** KC1: get_player_monster. The importer guards the empty case (upstream
 *  writes "no_options" without opening a menu), so the modal only opens with
 *  at least one row. Cancel writes the enum code for "no_choice"; a select
 *  writes the monster iid, which remove_monster and the monster ext commands
 *  read back. */
function partyMonstersChoice(source: BattleDbSource): NonNullable<ExtensionOptions["choices"]>[string] {
  return {
    options(context, args) {
      const parsed = filterArgs(args, "tux.party_monsters");
      const db = resolveBattleDb(source);
      const state = currentExtensionState(context.ext);
      return matchingParty(state, db, parsed.filters).map((monster) => ({
        key: monster.iid!,
        label: title(monster.slug),
        data: { slug: monster.slug, level: monster.level },
      }));
    },
    resolve(context, args, result) {
      const parsed = filterArgs(args, "tux.party_monsters");
      if (!parsed.variable) throw new Error("tux.party_monsters: resolve requires a variable destination");
      if (result.kind === "cancel") {
        return { writes: { [parsed.variable]: parsed.cancelCode ?? "no_choice" } };
      }
      return { writes: { [parsed.variable]: result.key } };
    },
  };
}

/** KC1: the importer's empty-list guard for get_player_monster. True when at
 *  least one party monster passes every baked filter. */
function partyMatchCondition(source: BattleDbSource) {
  return (context: ExtensionReadContext, value: JsonValue): boolean => {
    const parsed = filterArgs(value, "tux.party_match");
    const db = resolveBattleDb(source);
    const state = currentExtensionState(context.ext);
    return matchingParty(state, db, parsed.filters).length > 0;
  };
}

/** KC1: remove_monster. The variable holds a monster iid (written by
 *  get_player_monster's resolver, get_party_monsters or add_monster).
 *  Upstream looks the iid up globally and removes it from its owner, which
 *  may be an NPC: search the player party, then the kennel, then every NPC
 *  party. A missing iid is a no-op, matching upstream's logged stop. */
function removeMonsterCommand() {
  return (context: ExtensionCommandContext, value: JsonValue) => {
    const args = argsRecord(value, "tux.remove_monster");
    if (!nonEmptyString(args.variable)) throw new Error("tux.remove_monster: variable must be a non-empty string");
    const iid = context.variables[args.variable];
    if (typeof iid !== "string" || iid.length === 0) return;
    const current = currentExtensionState(context.ext);
    const party = current.party.filter((monster) => monster.iid !== iid);
    if (party.length !== current.party.length) {
      return { ext: json({ ...current, party }) };
    }
    const kennel = current.kennel.filter((monster) => monster.iid !== iid);
    if (kennel.length !== current.kennel.length) {
      return { ext: json({ ...current, kennel, kennelBox: true }) };
    }
    for (const [id, box] of Object.entries(current.boxes ?? {})) {
      const monsters = box.monsters.filter((monster) => monster.iid !== iid);
      if (monsters.length !== box.monsters.length) {
        return { ext: json({ ...current, boxes: { ...current.boxes, [id]: { ...box, monsters } } }) };
      }
    }
    for (const [character, monsters] of Object.entries(current.npcParties)) {
      const next = monsters.filter((monster) => monster.iid !== iid);
      if (next.length !== monsters.length) {
        return { ext: json({ ...current, npcParties: { ...current.npcParties, [character]: next } }) };
      }
    }
  };
}

/** An NPC's party lives as long as the NPC. Upstream builds a fresh NPC on
 *  every `create_npc` (all non-persistent NPCs are dropped on each map
 *  transition) and discards it on `remove_npc`; the importer calls this at
 *  both points, and `tux.clear_npc_parties` drops every other NPC's party
 *  on map entry, so a later visit never inherits an earlier visit's party. */
function clearNpcPartyCommand() {
  return (context: ExtensionCommandContext, value: JsonValue) => {
    const args = argsRecord(value, "tux.clear_npc_party");
    if (!nonEmptyString(args.character) || args.character === "player") {
      throw new Error("tux.clear_npc_party: character must name an NPC");
    }
    const current = currentExtensionState(context.ext);
    if (!Object.hasOwn(current.npcParties, args.character)) return;
    const npcParties = { ...current.npcParties };
    delete npcParties[args.character];
    return { ext: json({ ...current, npcParties }) };
  };
}

/** Upstream `change_map` calls `npc_manager.clear_npcs()`, which drops every
 *  NPC without `persistence` (and with it the NPC's party). The importer runs
 *  this once per map entry, before any other event on the new map, passing
 *  the source's persistent NPC slugs in `keep`. */
function clearNpcPartiesCommand() {
  return (context: ExtensionCommandContext, value: JsonValue) => {
    const args = argsRecord(value, "tux.clear_npc_parties");
    const keep = args.keep ?? [];
    if (!Array.isArray(keep) || !keep.every(nonEmptyString)) {
      throw new Error("tux.clear_npc_parties: keep must list NPC slugs");
    }
    const current = currentExtensionState(context.ext);
    const characters = Object.keys(current.npcParties);
    if (characters.every((character) => keep.includes(character))) return;
    const npcParties: typeof current.npcParties = {};
    for (const character of characters) {
      if (keep.includes(character)) npcParties[character] = current.npcParties[character]!;
    }
    return { ext: json({ ...current, npcParties }) };
  };
}

/** KC1: get_party_monster. Upstream opens no menu: it writes each monster's
 *  instance id into the player's `iid_slot_<index>` game variables. The
 *  party is the named NPC's, or the player's when no name is given. */
function getPartyMonstersCommand() {
  return (context: ExtensionCommandContext, value: JsonValue) => {
    const args = argsRecord(value, "tux.get_party_monsters");
    const character = args.character === undefined || args.character === "" ? "player" : args.character;
    if (!nonEmptyString(character)) {
      throw new Error("tux.get_party_monsters: character must be a string");
    }
    const state = currentExtensionState(context.ext);
    const monsters = character === "player" ? state.party : (state.npcParties[character] ?? []);
    const writes: Record<string, string> = {};
    monsters.forEach((monster, index) => {
      writes[`v.iid_slot_${index}`] = monster.iid!;
    });
    return { writes };
  };
}

/** create_kennel: player boxes only (no source map gives an NPC a box).
 *  An existing box is left untouched, exactly like upstream. */
function createKennelCommand() {
  return (context: ExtensionCommandContext, value: JsonValue) => {
    const args = argsRecord(value, "tux.create_kennel");
    if (!nonEmptyString(args.character) || !nonEmptyString(args.kennel)) {
      throw new Error("tux.create_kennel: character and kennel must be strings");
    }
    if (args.character !== "player") return;
    const capacity = args.capacity === undefined ? KENNEL_LIMIT : args.capacity;
    if (!safeInteger(capacity) || capacity < 1 || capacity > KENNEL_LIMIT) {
      throw new Error(`tux.create_kennel: capacity must be 1..${KENNEL_LIMIT}`);
    }
    const current = currentExtensionState(context.ext);
    if (args.kennel === KENNEL_BOX) {
      return kennelExists(current) ? undefined : { ext: json({ ...current, kennelBox: true }) };
    }
    if (current.boxes?.[args.kennel]) return;
    return { ext: json({
      ...current,
      boxes: { ...current.boxes, [args.kennel]: { hidden: args.hidden === true, capacity, monsters: [] } },
    }) };
  };
}

/** set_kennel_visible: a missing box is a silent no-op; the importer folds
 *  the upstream ValueError for the main Kennel out of the event. */
function setKennelVisibleCommand() {
  return (context: ExtensionCommandContext, value: JsonValue) => {
    const args = argsRecord(value, "tux.set_kennel_visible");
    if (!nonEmptyString(args.character) || !nonEmptyString(args.kennel) || typeof args.visible !== "boolean") {
      throw new Error("tux.set_kennel_visible: character, kennel and visible are required");
    }
    if (args.character !== "player" || args.kennel === KENNEL_BOX) return;
    const current = currentExtensionState(context.ext);
    const box = current.boxes?.[args.kennel];
    if (!box || box.hidden === !args.visible) return;
    return { ext: json({
      ...current,
      boxes: { ...current.boxes, [args.kennel]: { ...box, hidden: !args.visible } },
    }) };
  };
}

/** One invocation represents one completed player tile. The engine hook does
 * not mutate unused saves: without a sparse daycare payload this returns no
 * result at all. */
function daycareStepCommand(source: BattleDbSource) {
  let cachedSource: BattleDb | null = null;
  let cachedRules: ReturnType<typeof battleDbToTuxemonBattleDb> | null = null;
  return (context: ExtensionCommandContext) => {
    const current = currentExtensionState(context.ext);
    if (!current.daycare) return;
    const db = resolveBattleDb(source);
    if (db !== cachedSource || cachedRules === null) {
      cachedSource = db;
      cachedRules = battleDbToTuxemonBattleDb(db);
    }
    const result = advanceDaycareStep(current.daycare, context.gold, cachedRules);
    return {
      ext: json({ ...current, daycare: result.daycare }),
      ...(result.gold === context.gold ? {} : { gold: result.gold }),
    };
  };
}

function boxOf(
  state: Readonly<TuxemonExtensionState>,
  id: string,
): { hidden: boolean; monsters: readonly SpawnedMonsterSnapshot[] } | null {
  if (id === KENNEL_BOX) return kennelExists(state) ? { hidden: false, monsters: state.kennel } : null;
  return state.boxes?.[id] ?? null;
}

/** KC1: choice_monster/choice_npc. The importer bakes the static option list
 *  (key, translated label, enum code) so the resolver can write the same
 *  enum code the variable_set conditions compare against. */
interface EnumChoiceOption {
  key: string;
  label: string;
  code: number;
}

function enumChoiceArgs(value: JsonValue): {
  variable: string;
  options: EnumChoiceOption[];
  cancelCode?: number;
} {
  const args = record(value);
  if (!args) throw new Error("tux.enum_choice: arguments must be an object");
  if (!nonEmptyString(args.variable)) throw new Error("tux.enum_choice: variable must be a non-empty string");
  if (!Array.isArray(args.options)) throw new Error("tux.enum_choice: options must be an array");
  const options: EnumChoiceOption[] = [];
  for (const [index, raw] of args.options.entries()) {
    const option = record(raw);
    if (!option || !nonEmptyString(option.key) || !nonEmptyString(option.label)
      || !safeInteger(option.code)) {
      throw new Error(`tux.enum_choice: options[${index}] must have string key/label and integer code`);
    }
    options.push({ key: option.key, label: option.label, code: option.code });
  }
  const out: { variable: string; options: EnumChoiceOption[]; cancelCode?: number } = {
    variable: args.variable,
    options,
  };
  if (args.cancelCode !== undefined) {
    if (!safeInteger(args.cancelCode)) throw new Error("tux.enum_choice: cancelCode must be a safe integer");
    out.cancelCode = args.cancelCode;
  }
  return out;
}

function enumChoiceHandler(): NonNullable<ExtensionOptions["choices"]>[string] {
  return {
    options(_context, args) {
      return enumChoiceArgs(args).options;
    },
    resolve(_context, args, result) {
      const parsed = enumChoiceArgs(args);
      if (result.kind === "cancel") {
        if (parsed.cancelCode === undefined) return;
        return { writes: { [parsed.variable]: parsed.cancelCode } };
      }
      const option = parsed.options.find((candidate) => candidate.key === result.key);
      if (!option) throw new Error(`tux.enum_choice: selected key '${result.key}' is not in the option list`);
      return { writes: { [parsed.variable]: option.code } };
    },
  };
}

/** ui/save-game.ts LEGACY_SAVE_EXT_FORMAT, repeated here so the battle
 * module stays free of UI imports. */
const GAME_SAVE_EXT_FORMAT = "pocket-tuxemon/save-ext/v1";

/** Pure game registration used by createSession, GameView and attract replay. */
export function createTuxemonExtensions(
  source: BattleDbSource,
  options: Readonly<TuxemonExtensionRuntimeOptions> = {},
): ExtensionOptions {
  const weatherSchedule: WeatherSchedule = {
    slugs: [...new Set(options.weatherSchedule?.slugs ?? DEFAULT_WEATHER_SLUGS)].sort(),
    ...(options.weatherSchedule?.minDurationMinutes === undefined
      ? {}
      : { minDurationMinutes: options.weatherSchedule.minDurationMinutes }),
    ...(options.weatherSchedule?.maxDurationMinutes === undefined
      ? {}
      : { maxDurationMinutes: options.weatherSchedule.maxDurationMinutes }),
  };
  const weatherSlugs = new Set(weatherSchedule.slugs);
  const hemisphere = options.hemisphere ?? "northern";
  if (hemisphere !== "northern" && hemisphere !== "southern") {
    throw new Error(`Tuxemon extension: unsupported hemisphere '${String(hemisphere)}'`);
  }
  const initial = json(initialTuxemonExtensionState(options.initialTimeWeather));
  const validationDb = typeof source !== "function" && !("load" in source) ? source : undefined;
  // cloneExtension invokes the validator on every frame. The envelope's
  // packed strings are immutable, so validating each distinct tuple once
  // retains the full boundary check without reparsing an unchanged party.
  let lastValidatedRuntime: string | null = null;
  // A tick result derives from the already validated current state and only
  // replaces clock/weather after checking their complete invariants. Keep a
  // one-shot marker so applyExtensionResult need not parse and re-walk the
  // unchanged party/history before publishing that exact result.
  let trustedTickRuntime: string | null = null;
  return {
    initial,
    immutableConditions: true,
    deterministicConditions: true,
    playerStep: { call: "tux.daycare_step", args: {} },
    commands: {
      "tux.add_monster": addMonsterCommand(source),
      "tux.set_monster_health": healthCommand(),
      "tux.set_monster_status": statusCommand(source),
      "tux.set_tuxepedia": tuxepediaCommand(source),
      "tux.prepare_monster_rename": prepareMonsterRenameCommand(source),
      "tux.apply_monster_rename": applyMonsterRenameCommand(),
      "tux.evolution": evolutionCommand(source),
      "tux.cancel_evolution": (context, value) => {
        const args = argsRecord(value, "tux.cancel_evolution");
        const character = args.character === undefined ? "player" : args.character;
        if (!nonEmptyString(character)) throw new Error("tux.cancel_evolution: character must be a string");
        const current = currentExtensionState(context.ext);
        return { ext: json(character === "player" ? clearPendingEvolution(current) : current) };
      },
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
      "tux.remove_monster": removeMonsterCommand(),
      "tux.get_party_monsters": getPartyMonstersCommand(),
      "tux.clear_npc_party": clearNpcPartyCommand(),
      "tux.clear_npc_parties": clearNpcPartiesCommand(),
      "tux.create_kennel": createKennelCommand(),
      "tux.set_kennel_visible": setKennelVisibleCommand(),
      "tux.daycare_step": daycareStepCommand(source),
      "tux.tick_time_weather": (context, value) => {
        const args = argsRecord(value, "tux.tick_time_weather");
        if (args.daylight !== undefined && typeof args.daylight !== "boolean") {
          throw new Error("tux.tick_time_weather: daylight must be boolean");
        }
        const sourceWasValidated = typeof context.ext === "string"
          && context.ext === lastValidatedRuntime;
        const packed = packTimeWeatherAdvance(context.ext, weatherSchedule);
        // Only an engine-validated predecessor may authorize the one-shot
        // fast validation of its derived tick. Direct handler callers and
        // forged contexts still take the complete validator path.
        trustedTickRuntime = sourceWasValidated ? packed.wire : null;
        if (args.daylight !== true) return { ext: packed.wire };
        // A stage can only change on a game-minute boundary. The initial
        // undefined target is still published immediately after boot.
        if (packed.subMinuteTicks !== 0
          && context.variables[DAYLIGHT_STAGE_VARIABLE] !== undefined) {
          return { ext: packed.wire };
        }
        const stage = stageOfDayFromMinute(packed.minuteOfDay);
        const marker = DAYLIGHT_TINT_PROFILES.find((profile) => profile.stage === stage)!.marker;
        return context.variables[DAYLIGHT_STAGE_VARIABLE] === marker
          ? { ext: packed.wire }
          : { ext: packed.wire, writes: { [DAYLIGHT_TARGET_VARIABLE]: marker } };
      },
      "tux.update_time": (context, value) => {
        const args = argsRecord(value, "tux.update_time");
        const character = args.character === undefined ? "player" : args.character;
        if (!nonEmptyString(character)) {
          throw new Error("tux.update_time: character must be a string");
        }
        const current = currentExtensionState(context.ext);
        return { writes: updateTimeWrites(current.clock, hemisphere) };
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
      "tux.check_evolution": (context, value) => {
        const args = argsRecord(value, "tux.check_evolution");
        const character = args.character === undefined ? "player" : args.character;
        if (!nonEmptyString(character)) return false;
        const state = currentExtensionState(context.ext);
        const waiting = character === "player"
          && state.party.some((monster) => monster.waitingToEvolve === true);
        return negate(waiting, args);
      },
      "tux.environment_is": (context, value) => {
        const args = argsRecord(value, "tux.environment_is");
        if (!nonEmptyString(args.environment)) return false;
        const state = currentExtensionState(context.ext);
        return negate(state.environment === args.environment, args);
      },
      "tux.player_name_is": (context, value) => {
        const args = argsRecord(value, "tux.player_name_is");
        if (typeof args.name !== "string") return false;
        return negate(context.playerName === args.name, args);
      },
      "tux.has_tuxepedia": (context, value) => {
        const args = argsRecord(value, "tux.has_tuxepedia");
        if (args.character !== "player" || !nonEmptyString(args.species)
          || (args.status !== "seen" && args.status !== "caught")) return false;
        const state = currentExtensionState(context.ext);
        const registered = args.status === "seen"
          ? state.seen.includes(args.species)
          : state.caught.includes(args.species);
        return negate(registered, args);
      },
      "tux.char_healed": (context, value) => {
        const args = argsRecord(value, "tux.char_healed");
        if (args.character !== "player") return false;
        const party = currentExtensionState(context.ext).party;
        const healed = party.length > 0 && party.every((monster) =>
          monster.base.hp > 0 && monster.currentHp === monster.base.hp
        );
        return negate(healed, args);
      },
      "tux.time_is": (context, value) => {
        const args = argsRecord(value, "tux.time_is");
        if (!nonEmptyString(args.property) || !nonEmptyString(args.operation)
          || typeof args.value !== "string") return false;
        const tickOffset = args.tickOffset === undefined ? 0 : args.tickOffset;
        if (tickOffset !== 0 && tickOffset !== 1) return false;
        const envelope = runtimeEnvelope(context.ext);
        const clock = envelope
          ? clockFromRuntimeEnvelope(envelope)
          : currentExtensionState(context.ext).clock;
        return negate(timeIs(
          tickOffset === 0 ? clock : advanceClock(clock, tickOffset),
          args.property,
          args.operation,
          args.value,
          hemisphere,
        ), args);
      },
      "tux.has_faint_point": (context, value) => {
        const args = argsRecord(value, "tux.has_faint_point");
        if (!nonEmptyString(args.character)) return false;
        const state = currentExtensionState(context.ext);
        return negate(state.faintPoints[args.character] !== undefined, args);
      },
      "tux.faint_point_is_map": (context, value) => {
        const args = argsRecord(value, "tux.faint_point_is_map");
        if (!nonEmptyString(args.character) || !nonEmptyString(args.map)) return false;
        const state = currentExtensionState(context.ext);
        return negate(state.faintPoints[args.character]?.map === args.map, args);
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
      "tux.party_match": partyMatchCondition(source),
      // `kennel <character>,<box>,visible|hidden|exist`. A missing character
      // or option tests false, so the negated form is true.
      "tux.kennel": (context, value) => {
        const args = argsRecord(value, "tux.kennel");
        if (!nonEmptyString(args.character) || !nonEmptyString(args.kennel)) return negate(false, args);
        const box = args.character === "player"
          ? boxOf(currentExtensionState(context.ext), args.kennel)
          : null;
        const result = box !== null && (args.option === "exist"
          || (args.option === "visible" && !box.hidden)
          || (args.option === "hidden" && box.hidden));
        return negate(result, args);
      },
      // `has_kennel <character>,<box>,<op>,<n>` counts one box. Upstream
      // raises for a missing box and the evaluator then fails the condition
      // for both `is` and `not`, so a missing box is false either way.
      "tux.has_kennel": (context, value) => {
        const args = argsRecord(value, "tux.has_kennel");
        if (!nonEmptyString(args.character) || !nonEmptyString(args.kennel) || !safeInteger(args.value)) {
          return false;
        }
        if (args.character !== "player") return false;
        const box = boxOf(currentExtensionState(context.ext), args.kennel);
        if (box === null) return false;
        return negate(compare(args.operator, box.monsters.length, args.value), args);
      },
    },
    choices: {
      "tux.party_monsters": partyMonstersChoice(source),
      "tux.enum_choice": enumChoiceHandler(),
    },
    codec: {
      encode: (value) => ({
        format: TUXEMON_EXT_SAVE_FORMAT,
        state: tuxemonExtensionState(value, resolveBattleDb(source), weatherSlugs) as unknown as JsonValue,
      }),
      decode: (value) => {
        if (value === null) return initial;
        let saved = record(value);
        // Saves written before the kit stored map runtime wrapped this state
        // together with the character table (ui/save-game.ts). restoreSave()
        // migrates them; a generic kit restore reaches here with the wrapper
        // and loads the extension state alone.
        if (saved?.format === GAME_SAVE_EXT_FORMAT && saved.ext !== undefined) {
          value = saved.ext as JsonValue;
          saved = record(value);
        }
        if (saved?.format === TUXEMON_EXT_SAVE_FORMAT && saved.state !== undefined) {
          const migrated = migrateV1(saved.state as JsonValue);
          return json(tuxemonExtensionState(migrated, resolveBattleDb(source), weatherSlugs));
        }
        // Accept a direct v1 state for development snapshots made before the
        // save wrapper was introduced.
        if (saved?.version === 1) {
          return json(tuxemonExtensionState(migrateV1(value), resolveBattleDb(source), weatherSlugs));
        }
        throw new Error("unsupported Tuxemon extension save format");
      },
    },
    validate: (value) => {
      if (typeof value === "string" && value === lastValidatedRuntime) return;
      if (typeof value === "string" && value === trustedTickRuntime) {
        trustedTickRuntime = null;
        lastValidatedRuntime = value;
        return;
      }
      // Lazy production sources live in the pak. Commands and save restore
      // perform the database-backed check at their boundary; the hot-frame
      // validator still checks the complete numeric/shape invariants here.
      const problem = tuxemonExtensionProblem(value, validationDb, weatherSlugs);
      if (!problem && typeof value === "string") lastValidatedRuntime = value;
      return problem ?? undefined;
    },
  };
}
