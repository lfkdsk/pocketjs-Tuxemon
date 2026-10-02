import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import battleDb from "../data/battle-db.json";
import { battleDbToTuxemonBattleDb } from "../battle/from-battle-db.ts";
import { createBattle } from "../battle/index.ts";
import { validateBattleDb } from "../importer/battle-schema.ts";
import {
  compareGoldenCase,
  readBattleGolden,
} from "../tools/battle-oracle/compare-golden.ts";

const ROOT = join(import.meta.dir, "..");
// The weather corpus runs against the converted production database: its
// weather table is the exact import the runtime battles use, so this also
// covers the import path. The pinned engine has no weather combat effects,
// so the Python traces are identical to no-weather battles; the corpus
// proves the TypeScript side threads the slug and applies its (empty)
// modifier pipeline without perturbing a single event.
const DB = battleDbToTuxemonBattleDb(validateBattleDb(battleDb));
const GOLDEN = readBattleGolden(join(ROOT, "tests/goldens/gb5-weather-traces.ndjson.gz"));
const SLUGS = ["cloudy", "foggy", "freezing", "hot", "misty", "rain", "snow", "sunny", "thunderstorm", "windy"];

describe("weather battle differential corpus", () => {
  test("covers every Spyder party under all ten weathers", () => {
    expect(GOLDEN.header).toMatchObject({
      version: 1,
      source: "Tuxemon 9e6258ff",
      mode: "weather",
      definitions: 214,
      seedsPerDefinition: 1,
      policies: ["first", "cycle"],
      weather: SLUGS,
      cases: 4_280,
    });
    expect(GOLDEN.cases).toHaveLength(GOLDEN.header.cases);
    const slugs = new Set(GOLDEN.cases.map((testCase) => testCase.start.weather));
    expect(slugs).toEqual(new Set(SLUGS));
  });

  test("createBattle snapshots the threaded weather slug", () => {
    for (const slug of SLUGS) {
      const sample = GOLDEN.cases.find((testCase) => testCase.start.weather === slug)!;
      expect(createBattle(DB, sample.start).weather).toBe(slug);
    }
  });

  test("matches every committed oracle trace without Python", () => {
    const differences: string[] = [];
    for (const golden of GOLDEN.cases) {
      const difference = compareGoldenCase(DB, golden);
      if (difference !== null) differences.push(`${golden.id}: ${difference}`);
    }
    expect(differences).toEqual([]);
  }, 60_000);
});
