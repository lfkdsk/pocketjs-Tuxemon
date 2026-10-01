// Day/night + weather import data shared with the deterministic runtime.
//
// S5 §5.2's deterministic state model:
//   - ClockState / WeatherState / TimeWeatherState: the virtual-time schema
//     (types, JSON codec and validation). The runtime wires these into
//     TuxemonExtensionState and implements the 60Hz clock, compare/update and
//     the independent weather RNG/deadline.
//   - The 10-entry weather table exported from mods/tuxemon/db/weather.
//   - The import mapping for time_is / update_time -> tux.* ext
//     command/condition shapes. Both run against the saved deterministic
//     clock. set_layer is lowered separately by project.ts to native screen
//     layers, so it is not part of this extension interface.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TUXEMON_SRC, type Cond, type Rule } from "./source.ts";

// The codec and deterministic runtime are shared with the browser-safe game
// extension. This importer file retains only source/YAML concerns so Node/Bun
// modules never leak into the PocketJS bundle.
export {
  clockProblem,
  decodeTimeWeather,
  DEFAULT_TICKS_PER_GAME_MINUTE,
  encodeTimeWeather,
  initialTimeWeatherState,
  TIME_WEATHER_SAVE_FORMAT,
  timeWeatherProblem,
  weatherProblem,
  type ClockState,
  type TimeWeatherState,
  type WeatherState,
} from "../battle/time-weather.ts";

/** Historical P1 fold retained as a schema fixture. The live runtime now
 *  reads the saved virtual clock. */
export const P1_FIXED_STAGE_OF_DAY = "morning";
export const P1_FIXED_DAYTIME = "true";

/** Default time scale: one game-minute per real minute at 60Hz. */
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
// import mapping: time_is / update_time -> tux.* ext shapes
// ---------------------------------------------------------------------------

/** time_is <property>,<operation>,<value> -> tux.time_is ext condition args.
 *  `negate` carries the source `is`/`not` operator so the kit's `if` stays
 *  un-negated (matching battle_outcome etc.). */
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

/** update_time <character> -> tux.update_time ext command args. The runtime
 *  writes the eight upstream time variables (hour, day_of_year, year,
 *  weekday, leap_year, daytime, stage_of_day, season). */
export function updateTimeArgs(rule: Rule): { character: string } {
  return { character: rule.args[0] ?? "player" };
}
