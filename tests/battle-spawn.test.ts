import { describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { battleDbToTuxemonBattleDb } from "../battle/from-battle-db.ts";
import { learnedMoves } from "../battle/stats.ts";
import { pythonRoundDecimal, spawnMonster } from "../battle/spawn.ts";
import type { SpawnMonsterOptions } from "../battle/spawn.ts";
import type { SpawnedMonsterSnapshot } from "../battle/types.ts";
import { validateBattleDb, type BattleDb } from "../importer/battle-schema.ts";

interface SpawnGoldenCase {
  id: string;
  seed: number;
  monsters: Array<{ slug: string; level: number } & SpawnMonsterOptions>;
  expected: SpawnedMonsterSnapshot[];
  rng: { cursor: number; draws: number };
}

interface SpawnGolden {
  header: {
    version: number;
    source: string;
    trainerDefinitions: number;
    wildSpecies: number;
    seeds: number[];
    cases: number;
    drawsPerMonster: number;
  };
  cases: SpawnGoldenCase[];
}

const ROOT = join(import.meta.dir, "..");
const SOURCE_DB = validateBattleDb(
  JSON.parse(readFileSync(join(ROOT, "data/battle-db.json"), "utf8")),
);
const RUNTIME_DB = JSON.parse(
  readFileSync(join(ROOT, "data/battle-runtime-db.json"), "utf8"),
) as BattleDb;
const RULES_DB = battleDbToTuxemonBattleDb(RUNTIME_DB);
const GOLDEN = JSON.parse(
  gunzipSync(readFileSync(join(ROOT, "tests/goldens/gb4-monster-spawns.json.gz"))).toString("utf8"),
) as SpawnGolden;

describe("Tuxemon Monster.spawn_base", () => {
  test("covers every imported trainer definition and representative wild species", () => {
    expect(GOLDEN.header).toEqual({
      version: 1,
      source: "Tuxemon 9e6258ff",
      trainerDefinitions: SOURCE_DB.trainerParties.length,
      wildSpecies: 12,
      seeds: [1, 0x12345678, 0xffffffff],
      cases: SOURCE_DB.trainerParties.length * 3 + 12 * 3,
      drawsPerMonster: 13,
    });
    expect(new Set(
      GOLDEN.cases
        .filter((entry) => entry.id.startsWith("trainer:"))
        .map((entry) => entry.id.split(":").slice(1, -1).join(":")),
    ).size).toBe(SOURCE_DB.trainerParties.length);
  });

  test("matches every field and final RNG cursor", () => {
    const differences: string[] = [];
    let monsterCount = 0;
    for (const golden of GOLDEN.cases) {
      const rng = { rng: golden.seed >>> 0, rngDraws: 0 };
      const actual = golden.monsters.map(({ slug, level, ...options }) =>
        spawnMonster(RUNTIME_DB, RULES_DB, rng, slug, level, options)
      );
      monsterCount += actual.length;
      if (!isDeepStrictEqual(actual, golden.expected)) {
        differences.push(`${golden.id}: snapshot mismatch`);
      }
      if (rng.rng !== golden.rng.cursor || rng.rngDraws !== golden.rng.draws) {
        differences.push(
          `${golden.id}: rng ${rng.rng}/${rng.rngDraws} != ${golden.rng.cursor}/${golden.rng.draws}`,
        );
      }
      if (rng.rngDraws !== actual.length * GOLDEN.header.drawsPerMonster) {
        differences.push(`${golden.id}: expected exactly 13 draws per monster`);
      }
    }
    expect(differences).toEqual([]);
    expect(monsterCount).toBeGreaterThan(SOURCE_DB.trainerParties.length * 3);
  });

  test("uses Python decimal ties-to-even rounding", () => {
    expect(pythonRoundDecimal(2.675, 2)).toBe(2.67);
    expect(pythonRoundDecimal(1.125, 2)).toBe(1.12);
    expect(pythonRoundDecimal(1.375, 2)).toBe(1.38);
  });

  test("filters level-up moves by evolution stage before taking the final four", () => {
    // GP1's rulesDb.monster is a lazily-resolved Proxy (production only
    // touches the species/techniques a battle actually uses), which
    // structuredClone cannot copy. A plain-object override of just the one
    // monster under test achieves the same isolation from RULES_DB.
    const db = {
      ...RULES_DB,
      monster: {
        ...RULES_DB.monster,
        nut: {
          ...RULES_DB.monster.nut!,
          stage: "basic",
          moveset: [
            { technique: "bullet", learning_method: "level_up", level_learned: 1 },
            { technique: "static_field", learning_method: "level_up", level_learned: 1, evolution_stage_learned: "stage1" },
            { technique: "shuriken", learning_method: "level_up", level_learned: 4, evolution_stage_learned: "basic" },
          ],
        },
      },
    };
    expect(learnedMoves(db, "nut", 5)).toEqual(["bullet", "shuriken"]);
  });
});
