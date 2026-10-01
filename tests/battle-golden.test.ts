import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createBattle, reduceBattle, runPolicyBattle, type TuxemonBattleDb } from "../battle/index.ts";
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


test("battle drafts preserve frozen snapshots for every trainer and policy", () => {
  const seen = new Set<string>();
  for (const golden of GOLDEN.cases) {
    const key = `${golden.definition}:${golden.policy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const frozen = new WeakSet<object>();
    function freeze(value: unknown): void {
      if (value === null || typeof value !== "object" || frozen.has(value)) return;
      frozen.add(value);
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    let state = createBattle(DB, golden.start);
    for (let guard = 0; state.phase !== "ended" && guard < 10000; guard++) {
      freeze(state);
      const choice = state.policy === "cycle" ? state.turn - 1 : 0;
      state = reduceBattle(DB, state, { type: "technique", choice });
    }
    expect(state.phase).toBe("ended");
    expect(String(state.outcome)).toBe(golden.expected.outcome);
    expect(state.rngDraws).toBe(golden.expected.rngDraws);
  }
  expect(seen.size).toBe(428);
});
