import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { runPolicyBattle, type TuxemonBattleDb } from "../battle/index.ts";
import {
  compareGoldenCase,
  readBattleGolden,
} from "../tools/battle-oracle/compare-golden.ts";

const ROOT = join(import.meta.dir, "..");
const DB = JSON.parse(
  readFileSync(join(ROOT, "tools/battle-oracle/tuxemon-battle.json"), "utf8"),
) as TuxemonBattleDb;
const GOLDEN = readBattleGolden(join(ROOT, "tests/goldens/gb2-spyder-traces.ndjson.gz"));

// `tools/battle-oracle/tuxemon-battle.json` is a development fixture for
// differential diagnostics against the pinned Tuxemon engine; it is not a
// runtime data source. Production battles load `data/battle-db.json`
// through `battle/from-battle-db.ts` — see `tests/battle-db-adapter.test.ts`
// for the equivalent corpus run against that adapted data.
describe("Tuxemon battle differential corpus (oracle fixture)", () => {
  test("covers every Spyder party with both policies and twenty seeds", () => {
    expect(GOLDEN.header).toMatchObject({
      version: 1,
      source: "Tuxemon 9e6258ff",
      definitions: 214,
      seedsPerDefinition: 20,
      policies: ["first", "cycle"],
      cases: 8_560,
      exemptions: ["draw-as-player-defeat", "stable-active-field-multitarget-order"],
    });
    expect(GOLDEN.cases).toHaveLength(GOLDEN.header.cases);
  });

  test("matches every committed oracle trace without Python", () => {
    const differences: string[] = [];
    for (const golden of GOLDEN.cases) {
      const difference = compareGoldenCase(DB, golden);
      if (difference !== null) differences.push(`${golden.id}: ${difference}`);
    }
    expect(differences).toEqual([]);
  }, 30_000);

  test("turns the upstream crashing true-draw case into a player defeat", () => {
    const base = { armour: 10, dodge: 10, hp: 10, melee: 10, ranged: 10, speed: 10 };
    const state = runPolicyBattle(DB, {
      seed: 1,
      player: [{ slug: "rockitten", level: 5, base, moves: ["implosion"] }],
      enemy: [{ slug: "rockitten", level: 5, base, moves: ["implosion"] }],
    });

    expect(state.outcome).toBe("draw");
    expect(state.result).toMatchObject({
      outcome: "draw",
      playerDefeated: true,
      battleLastResult: "draw",
    });
  });
});
