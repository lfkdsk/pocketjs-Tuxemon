import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { battleDbToTuxemonBattleDb } from "../battle/from-battle-db.ts";
import { validateBattleDb } from "../importer/battle-schema.ts";
import {
  compareGoldenCase,
  readBattleGolden,
} from "../tools/battle-oracle/compare-golden.ts";

const ROOT = join(import.meta.dir, "..");
const DB = battleDbToTuxemonBattleDb(validateBattleDb(
  JSON.parse(readFileSync(join(ROOT, "data/battle-db.json"), "utf8")),
));
const GOLDEN = readBattleGolden(join(ROOT, "tests/goldens/gb3-double-traces.ndjson.gz"));
const HEADER = GOLDEN.header as typeof GOLDEN.header & {
  suite: string;
  events: number;
  locations: string[];
};

describe("Tuxemon GB3 double-battle oracle", () => {
  test("covers all eight Spyder event uses and five distinct parties", () => {
    expect(HEADER).toMatchObject({
      version: 1,
      suite: "gb3-double",
      source: "Tuxemon 9e6258ff",
      definitions: 5,
      events: 8,
      seedsPerDefinition: 20,
      policies: ["first", "cycle"],
      cases: 200,
      exemptions: ["stable-active-field-multitarget-order"],
    });
    expect(HEADER.locations.filter((value) => value.startsWith("spyder_route5::"))).toHaveLength(6);
    expect(HEADER.locations.filter((value) => value.startsWith("spyder_dragonscave::"))).toHaveLength(2);
    expect(GOLDEN.cases).toHaveLength(200);
    expect(GOLDEN.cases.every(({ start }) =>
      start.fieldSize === 2 && start.player.length >= 2 && start.enemy.length >= 2
    )).toBeTrue();
  });

  test("exercises explicit second-slot targets and spread damage", () => {
    let secondSlotTargets = 0;
    let spreadDamageEvents = 0;
    for (const entry of GOLDEN.cases) for (const event of entry.expected.trace) {
      if (event.type === "decision" && /[pe]1$/.test(String(event.target))) secondSlotTargets++;
      if (event.type !== "technique") continue;
      const userSide = String(event.user).startsWith("p") ? "p" : "e";
      const targetSide = userSide === "p" ? "e" : "p";
      const before = event.hpBefore as Record<string, number>;
      const after = event.hp as Record<string, number>;
      const damagedOpponents = Object.keys(before).filter((slug) =>
        slug.startsWith(targetSide) && (after[slug] ?? before[slug]!) < before[slug]!
      );
      if (damagedOpponents.length > 1) spreadDamageEvents++;
    }
    expect(secondSlotTargets).toBeGreaterThan(1_000);
    expect(spreadDamageEvents).toBe(15);
  });

  test("matches all focused upstream traces with the production database", () => {
    const differences = GOLDEN.cases.flatMap((entry) => {
      const difference = compareGoldenCase(DB, entry);
      return difference === null ? [] : [`${entry.id}: ${difference}`];
    });
    expect(differences).toEqual([]);
  }, 30_000);
});
