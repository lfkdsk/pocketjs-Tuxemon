import { describe, expect, test } from "bun:test";

import battleDb from "../data/battle-db.json";
import { battleDbToTuxemonBattleDb } from "../battle/from-battle-db.ts";
import {
  calculateDamage,
  createBattle,
  reduceBattle,
  type BattleStart,
  type MonsterSnapshot,
} from "../battle/index.ts";
import { validateBattleDb, type WeatherRow } from "../importer/battle-schema.ts";
import { weatherDamageFactor, weatherRowMultiplier } from "../battle/weather-modifiers.ts";
import type { TuxemonBattleDb, TuxemonBattleState } from "../battle/types.ts";

const DB = battleDbToTuxemonBattleDb(validateBattleDb(battleDb));
const BASE = { armour: 10, dodge: 10, hp: 100, melee: 10, ranged: 10, speed: 10 };

function snapshot(slug: string, moves: string[], types: string[], level = 5, base = BASE): MonsterSnapshot {
  return { slug, level, base, moves, types };
}

function start(player: MonsterSnapshot, enemy: MonsterSnapshot, weather?: string | null): BattleStart {
  return { seed: 1, player: [player], enemy: [enemy], weather: weather ?? null };
}

/** Synthetic rows exercise the pipeline; the imported rows are all empty. */
function row(slug: string, modifiers: WeatherRow["modifiers"]): WeatherRow {
  return { slug, name: `weather_${slug}`, temperature: "mild", wind: "calm", modifiers };
}

const mod = (
  attribute: string,
  values: string[],
  multiplier: number,
  extra: Partial<{ priority: number; stacking: "additive" | "multiplicative" | "override"; maxStacks: number | null; conditionName: string | null }> = {},
) => ({
  attribute,
  values,
  multiplier,
  priority: extra.priority ?? 0,
  stacking: extra.stacking ?? "multiplicative" as const,
  maxStacks: extra.maxStacks ?? null,
  conditionName: extra.conditionName ?? null,
});

const SUBJECT = { types: ["water"], hpRatio: 1 };

describe("weather modifier engine (upstream ModifiersHandler semantics)", () => {
  test("empty or absent rows are a no-op", () => {
    expect(weatherRowMultiplier(undefined, SUBJECT)).toBe(1);
    expect(weatherRowMultiplier(row("rain", []), SUBJECT)).toBe(1);
  });

  test("type attribute matches the subject monster's types", () => {
    const rain = row("rain", [mod("type", ["water"], 1.2)]);
    expect(weatherRowMultiplier(rain, { types: ["water"], hpRatio: 1 })).toBeCloseTo(1.2, 12);
    expect(weatherRowMultiplier(rain, { types: ["fire"], hpRatio: 1 })).toBe(1);
    expect(weatherRowMultiplier(rain, { types: ["water", "fire"], hpRatio: 1 })).toBeCloseTo(1.2, 12);
  });

  test("unsupported attributes and unknown conditions are ignored", () => {
    const weird = row("foggy", [
      mod("tag", ["weather"], 1.5),
      mod("type", ["water"], 1.2, { conditionName: "hp_above_90" }),
    ]);
    expect(weatherRowMultiplier(weird, SUBJECT)).toBe(1);
  });

  test("hp conditions follow the upstream registry", () => {
    const desperate = row("rain", [mod("type", ["water"], 1.5, { conditionName: "hp_below_50" })]);
    expect(weatherRowMultiplier(desperate, { types: ["water"], hpRatio: 0.4 })).toBeCloseTo(1.5, 12);
    expect(weatherRowMultiplier(desperate, { types: ["water"], hpRatio: 0.5 })).toBe(1);
    const healthy = row("sunny", [mod("type", ["water"], 0.5, { conditionName: "full_hp" })]);
    expect(weatherRowMultiplier(healthy, { types: ["water"], hpRatio: 1 })).toBeCloseTo(0.5, 12);
    expect(weatherRowMultiplier(healthy, { types: ["water"], hpRatio: 0.9 })).toBe(1);
  });

  test("priority orders applicable modifiers", () => {
    const mixed = row("rain", [
      mod("type", ["water"], 1.2, { priority: 0 }),
      mod("type", ["water"], 1.3, { priority: 5 }),
    ]);
    // multiplicative stacking: priority only orders, both still apply
    expect(weatherRowMultiplier(mixed, SUBJECT)).toBeCloseTo(1.3 * 1.2, 12);
  });

  test("max_stacks keeps only the highest-priority entries per (attribute, values) group", () => {
    const capped = row("rain", [
      mod("type", ["water"], 1.2, { priority: 0 }),
      mod("type", ["water"], 1.3, { priority: 5 }),
      mod("type", ["water"], 1.4, { priority: 9, maxStacks: 1 }),
    ]);
    expect(weatherRowMultiplier(capped, SUBJECT)).toBeCloseTo(1.4, 12);
  });

  test("stacking modes resolve like upstream CUMULATIVE", () => {
    const additive = row("rain", [
      mod("type", ["water"], 1.2, { stacking: "additive" }),
      mod("type", ["water"], 1.2, { stacking: "additive" }),
    ]);
    expect(weatherRowMultiplier(additive, SUBJECT)).toBeCloseTo(1.4, 12);
    const override = row("storm", [
      mod("type", ["water"], 1.2),
      mod("type", ["water"], 1.1, { stacking: "override", priority: -1 }),
    ]);
    expect(weatherRowMultiplier(override, SUBJECT)).toBeCloseTo(1.1, 12);
  });
});

describe("imported weather rows stay dormant", () => {
  test("all ten imported weathers are a damage no-op", () => {
    for (const slug of Object.keys(DB.weather)) {
      expect(DB.weather[slug]!.modifiers, `${slug} modifiers`).toEqual([]);
      expect(weatherDamageFactor(DB, { weather: slug } as TuxemonBattleState, {
        types: ["water"], base: { hp: 100 }, currentHp: 100,
      } as never), slug).toBe(1);
    }
  });
});

describe("weather in the battle pipeline", () => {
  test("createBattle snapshots the weather slug", () => {
    const rainy = createBattle(DB, start(
      snapshot("rockitten", ["struggle"], ["earth"]),
      snapshot("nut", ["beam"], ["metal"]),
      "rain",
    ));
    expect(rainy.weather).toBe("rain");
    expect(createBattle(DB, start(
      snapshot("rockitten", ["struggle"], ["earth"]),
      snapshot("nut", ["beam"], ["metal"]),
    )).weather).toBeNull();
  });

  test("weather factor changes damage but not the returned affinity multiplier", () => {
    const technique = DB.technique["struggle"]!;
    const dry = createBattle(DB, start(
      snapshot("rockitten", ["struggle"], ["earth"]),
      snapshot("nut", ["beam"], ["metal"]),
    ));
    const user = dry.parties[0]![0]!;
    const target = dry.parties[1]![0]!;
    const move = { power: technique.power };
    const [dryDamage, affinity] = calculateDamage(DB, technique, move, user, target, 1);
    const [wetDamage, wetAffinity] = calculateDamage(DB, technique, move, user, target, 2);
    expect(wetDamage).toBe(dryDamage * 2);
    expect(wetAffinity).toBe(affinity);
  });

  test("a populated weather row changes battle damage end to end", () => {
    const rainyDb: TuxemonBattleDb = {
      ...DB,
      weather: {
        ...DB.weather,
        rain: row("rain", [mod("type", ["earth"], 2)]),
      },
    };
    const dry = createBattle(DB, start(
      snapshot("rockitten", ["struggle"], ["earth"]),
      snapshot("nut", ["beam"], ["metal"]),
    ));
    const wet = createBattle(rainyDb, start(
      snapshot("rockitten", ["struggle"], ["earth"]),
      snapshot("nut", ["beam"], ["metal"]),
      "rain",
    ));
    // Both sides use struggle on the first turn; the earth-type dealer hits
    // harder under the synthetic rain row.
    const dryAfter = reduceBattle(DB, dry, { type: "technique", choice: 0 });
    const wetAfter = reduceBattle(rainyDb, wet, { type: "technique", choice: 0 });
    const dryHp = dryAfter.parties[1]![0]!.currentHp;
    const wetHp = wetAfter.parties[1]![0]!.currentHp;
    expect(wetHp).toBeLessThan(dryHp);
  });
});
