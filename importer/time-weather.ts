// D1: day/night + weather data layer.
//
// S5 §5.2's deterministic state model, fixed as a data format before any
// runtime exists:
//   - ClockState / WeatherState / TimeWeatherState: the virtual-time schema
//     (types, JSON codec draft, validation). D2 wires these into
//     TuxemonExtensionState and implements the 60Hz clock, compare/update and
//     the independent weather RNG/deadline. D1 only fixes the bytes.
//   - The 10-entry weather table exported from mods/tuxemon/db/weather.
//   - The import mapping for time_is / update_time / set_layer -> tux.* ext
//     command/condition shapes. The runtime handlers are placeholders until
//     D2 (clock/weather) and D3 (overlay visuals); the importer emits explicit
//     ext calls instead of silently dropping them, and coverage records
//     Placeholder with the D2 note.
//
// set_layer is a transparent OVERLAY drawn over the map (a colour or an
// image), not a map tile layer. It does not overlap the component kit's KV1
// "runtime layer switching" (which swaps tile layers); its visual home is
// D3's overlay slot.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonValue } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import { TUXEMON_SRC, type Cond, type Rule } from "./source.ts";

// ---------------------------------------------------------------------------
// clock schema (virtual time; hz-independent — advances on the 60Hz reference)
// ---------------------------------------------------------------------------

export const TIME_WEATHER_SAVE_FORMAT = "pocket-tuxemon/time-weather/v1";

/** A virtual game clock anchored to the 60Hz reference tick. The clock never
 *  reads wall time inside the reducer/render; a new game samples wall time
 *  once and writes these fields, after which the clock is pure reducer state
 *  (S5 §5.2). */
export interface ClockState {
  /** Discriminator for future clock modes. Only "game" is defined in v1. */
  mode: "game";
  /** Reference tick (60Hz) at which minuteOfDay/subMinuteTicks were exact. */
  refTick: number;
  /** Days since the game epoch (the date part of the virtual time). */
  epochDay: number;
  /** Minutes since local midnight, 0..1439. */
  minuteOfDay: number;
  /** Ticks accumulated toward the next game-minute, 0..ticksPerGameMinute-1. */
  subMinuteTicks: number;
  /** How many 60Hz reference ticks advance one game-minute. Sets the time
   *  scale and keeps the clock independent of the session's hz. */
  ticksPerGameMinute: number;
}

/** Independent weather stream (S5 §5.2). The PRNG cursor is kept separate
 *  from the battle RNG so battle randomness never perturbs the weather
 *  sequence, and weather rolls happen on reducer ticks, not render frames. */
export interface WeatherState {
  /** Active weather slug (one of the imported weather table). */
  slug: string;
  /** Reference tick when this weather started. */
  enteredAtTick: number;
  /** Reference tick when the next weather change is due (>= enteredAtTick). */
  nextTransitionTick: number;
  /** mulberry32 cursor for weather rolls. */
  rngCursor: number;
}

/** The clock+weather sub-state D2 wires into TuxemonExtensionState. Kept
 *  standalone here so D1 can fix the format and round-trip it without
 *  touching the battle extension codec (that migration is D2). */
export interface TimeWeatherState {
  clock: ClockState;
  weather: WeatherState;
}

/** The P1 fixed fold the D1 placeholder runtime handlers replicate, so
 *  imported events keep their current behavior until D2 lands the virtual
 *  clock. Matches the importer's historical fold: stage_of_day "morning",
 *  daytime "true", everything else false. */
export const P1_FIXED_STAGE_OF_DAY = "morning";
export const P1_FIXED_DAYTIME = "true";

/** Default time scale: one game-minute per real minute at 60Hz. D2 may tune
 *  this; it only sets how fast the virtual clock advances. */
export const DEFAULT_TICKS_PER_GAME_MINUTE = 3_600;

/** Deterministic initial state for tests and fresh-session defaults. D2 owns
 *  the real new-game sampling (wall time -> clock fields, first weather
 *  deadline); this is the fixed morning the P1 fold already implies. */
export function initialTimeWeatherState(): TimeWeatherState {
  return {
    clock: {
      mode: "game",
      refTick: 0,
      epochDay: 0,
      // 08:00 -> stage_of_day "morning", daytime "true" (time_handler.py).
      minuteOfDay: 8 * 60,
      subMinuteTicks: 0,
      ticksPerGameMinute: DEFAULT_TICKS_PER_GAME_MINUTE,
    },
    weather: {
      slug: "sunny",
      enteredAtTick: 0,
      nextTransitionTick: 0,
      rngCursor: 0x9e3779b9,
    },
  };
}

// ---------------------------------------------------------------------------
// validation + JSON codec draft
// ---------------------------------------------------------------------------

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

function nonNegativeSafeInteger(value: unknown, label: string): string | null {
  if (!safeInteger(value) || (value as number) < 0) {
    return `${label} must be a non-negative safe integer`;
  }
  return null;
}

export function clockProblem(value: unknown, label = "clock"): string | null {
  const clock = record(value);
  if (!clock) return `${label} must be an object`;
  if (clock.mode !== "game") return `${label}.mode must be "game"`;
  const tick = nonNegativeSafeInteger(clock.refTick, `${label}.refTick`);
  if (tick) return tick;
  const day = nonNegativeSafeInteger(clock.epochDay, `${label}.epochDay`);
  if (day) return day;
  if (!safeInteger(clock.minuteOfDay) || clock.minuteOfDay < 0 || clock.minuteOfDay > 1_439) {
    return `${label}.minuteOfDay must be an integer in 0..1439`;
  }
  if (!safeInteger(clock.ticksPerGameMinute) || clock.ticksPerGameMinute < 1) {
    return `${label}.ticksPerGameMinute must be a positive safe integer`;
  }
  if (!safeInteger(clock.subMinuteTicks) || clock.subMinuteTicks < 0
      || clock.subMinuteTicks >= clock.ticksPerGameMinute) {
    return `${label}.subMinuteTicks must be an integer in 0..ticksPerGameMinute-1`;
  }
  return null;
}

export function weatherProblem(
  value: unknown,
  label = "weather",
  slugs?: ReadonlySet<string>,
): string | null {
  const weather = record(value);
  if (!weather) return `${label} must be an object`;
  if (typeof weather.slug !== "string" || !weather.slug) {
    return `${label}.slug must be a non-empty string`;
  }
  if (slugs && !slugs.has(weather.slug)) {
    return `${label}.slug must name an imported weather (got ${weather.slug})`;
  }
  const entered = nonNegativeSafeInteger(weather.enteredAtTick, `${label}.enteredAtTick`);
  if (entered) return entered;
  const next = nonNegativeSafeInteger(weather.nextTransitionTick, `${label}.nextTransitionTick`);
  if (next) return next;
  if ((weather.nextTransitionTick as number) < (weather.enteredAtTick as number)) {
    return `${label}.nextTransitionTick must be >= enteredAtTick`;
  }
  // mulberry32 cursor is a uint32.
  if (!safeInteger(weather.rngCursor) || (weather.rngCursor as number) < 0
      || (weather.rngCursor as number) > 0xffff_ffff) {
    return `${label}.rngCursor must be a uint32`;
  }
  return null;
}

export function timeWeatherProblem(
  value: unknown,
  slugs?: ReadonlySet<string>,
): string | null {
  const state = record(value);
  if (!state) return "time-weather state must be an object";
  const clock = clockProblem(state.clock);
  if (clock) return clock;
  const weather = weatherProblem(state.weather, "weather", slugs);
  if (weather) return weather;
  return null;
}

/** Encode to plain JSON. The state is already JSON-safe; this is the draft
 *  codec D2 composes into the extension save format. */
export function encodeTimeWeather(state: TimeWeatherState): JsonValue {
  return {
    format: TIME_WEATHER_SAVE_FORMAT,
    clock: { ...state.clock },
    weather: { ...state.weather },
  } as unknown as JsonValue;
}

/** Validate and decode. Throws on the first problem, mirroring
 *  tuxemonExtensionState's boundary contract. */
export function decodeTimeWeather(
  value: JsonValue,
  slugs?: ReadonlySet<string>,
): TimeWeatherState {
  const state = record(value);
  if (!state) throw new Error("time-weather state must be an object");
  // Accept both the wrapped save form ({format, clock, weather}) and a bare
  // {clock, weather} development snapshot. A present `format` field must
  // carry the v1 marker; any other string/type is rejected instead of being
  // silently treated as a bare snapshot.
  let inner: unknown = value;
  if ("format" in state) {
    if (state.format !== TIME_WEATHER_SAVE_FORMAT) {
      throw new Error(
        `time-weather state: unsupported format ${JSON.stringify(state.format)}`
        + ` (expected ${TIME_WEATHER_SAVE_FORMAT})`,
      );
    }
    inner = state;
  }
  const problem = timeWeatherProblem(inner, slugs);
  if (problem) throw new Error(`time-weather state: ${problem}`);
  const innerRecord = record(inner)!;
  return {
    clock: { ...record(innerRecord.clock)! } as unknown as ClockState,
    weather: { ...record(innerRecord.weather)! } as unknown as WeatherState,
  };
}

// ---------------------------------------------------------------------------
// weather table (mods/tuxemon/db/weather/weathers.yaml)
// ---------------------------------------------------------------------------

export interface WeatherEntry {
  slug: string;
  /** Translation msgid, e.g. "weather_misty". */
  name: string;
  temperature: string;
  wind: string;
  modifiers: readonly unknown[];
}

const WEATHER_DB = join(TUXEMON_SRC, "mods/tuxemon/db/weather/weathers.yaml");

let cachedTable: WeatherEntry[] | null = null;

/** The 10-entry weather database, sorted by slug for a canonical data file.
 *  Cached after the first read; the source file is pinned and immutable. */
export function loadWeatherTable(): WeatherEntry[] {
  if (cachedTable) return cachedTable;
  if (!existsSync(WEATHER_DB)) {
    throw new Error(`weather database not found: ${WEATHER_DB}`);
  }
  const doc = Bun.YAML.parse(readFileSync(WEATHER_DB, "utf8")) as unknown;
  if (!Array.isArray(doc)) throw new Error("weather database must be a list");
  const entries: WeatherEntry[] = [];
  for (const raw of doc) {
    const row = record(raw);
    if (!row) throw new Error("weather entry must be a mapping");
    if (typeof row.slug !== "string" || !row.slug) throw new Error("weather entry missing slug");
    if (typeof row.name !== "string" || !row.name) {
      throw new Error(`weather ${row.slug} missing name`);
    }
    if (typeof row.temperature !== "string" || !row.temperature) {
      throw new Error(`weather ${row.slug} missing temperature`);
    }
    if (typeof row.wind !== "string" || !row.wind) {
      throw new Error(`weather ${row.slug} missing wind`);
    }
    if (!Array.isArray(row.modifiers)) {
      throw new Error(`weather ${row.slug} missing modifiers`);
    }
    entries.push({
      slug: row.slug,
      name: row.name,
      temperature: row.temperature,
      wind: row.wind,
      modifiers: row.modifiers,
    });
  }
  entries.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  cachedTable = entries;
  return entries;
}

export function weatherSlugs(): ReadonlySet<string> {
  return new Set(loadWeatherTable().map((entry) => entry.slug));
}

// ---------------------------------------------------------------------------
// import mapping: time_is / update_time / set_layer -> tux.* ext shapes
// ---------------------------------------------------------------------------

/** time_is <property>,<operation>,<value> -> tux.time_is ext condition args.
 *  The runtime handler is a D2 placeholder that folds against the fixed
 *  morning/daytime above. `negate` carries the source `is`/`not` operator so
 *  the kit's `if` stays un-negated (matching battle_outcome etc.). */
export function timeIsArgs(cond: Cond): {
  property: string;
  operation: string;
  value: string;
  negate: boolean;
} {
  return {
    property: cond.args[0] ?? "",
    operation: cond.args[1] ?? "equals",
    value: cond.args[2] ?? "",
    negate: cond.op === "not",
  };
}

/** update_time <character> -> tux.update_time ext command args. The D2
 *  runtime writes the eight upstream time variables (hour, day_of_year, year,
 *  weekday, leap_year, daytime, stage_of_day, season); the D1 placeholder is
 *  a no-op. */
export function updateTimeArgs(rule: Rule): { character: string } {
  return { character: rule.args[0] ?? "player" };
}

/** set_layer [<value>] -> tux.set_layer ext command args. Upstream accepts an
 *  RGBA colour ("R,G,B,A" or "R:G:B:A"), a .png image path, or nothing/"none"
 *  to clear. The overlay visual is D3; the D1/D2 placeholder handler is a
 *  no-op. */
export type SetLayerArg =
  | { kind: "clear" }
  | { kind: "color"; r: number; g: number; b: number; a: number }
  | { kind: "image"; path: string };

export function setLayerArg(rule: Rule): SetLayerArg {
  const first = (rule.args[0] ?? "").trim();
  if (!first || first.toLowerCase() === "none") return { kind: "clear" };
  if (first.toLowerCase().endsWith(".png")) return { kind: "image", path: first };
  // RGBA: "R:G:B:A" survives the script parser as one arg, while "R,G,B,A"
  // is split into four args (splitEscaped). Accept both upstream forms.
  const channels = rule.args.length >= 4 && rule.args.slice(0, 4).every((p) => /^\d+$/.test(p))
    ? rule.args.slice(0, 4).map(Number)
    : first.split(":").map((part) => Number(part.trim()));
  if (channels.length === 4 && channels.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    return { kind: "color", r: channels[0]!, g: channels[1]!, b: channels[2]!, a: channels[3]! };
  }
  // Unparseable upstream value: clear rather than invent a colour.
  return { kind: "clear" };
}
