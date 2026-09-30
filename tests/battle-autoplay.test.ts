import { describe, expect, test } from "bun:test";
import battleDbJson from "../data/battle-db.json";

import {
  autoplayMoveToForget,
  battleAutoplayInput,
  battleMenuEntries,
  battleDbToTuxemonBattleDb,
  chooseBattleAutoplayAction,
  createTuxemonBattleRules,
  expectedTechniqueDamage,
  initialTuxemonExtensionState,
  packTuxemonExtensionState,
  spawnMonster,
  tuxemonRuntimeBattleState,
  type RuntimeBattleState,
  type SpawnedMonsterSnapshot,
} from "../battle/index.ts";
import { validateBattleDb } from "../importer/battle-schema.ts";
import type { JsonValue } from "../vendor/pocket-rpgkit/src/engine/types.ts";

const SOURCE_DB = validateBattleDb(battleDbJson);
const DB = battleDbToTuxemonBattleDb(SOURCE_DB);
const ENUMS = {
  battle_last_result: ["draw", "lost", "won", "run", "captured"],
  battle_last_trainer: ["autoplay_trainer"],
  battle_last_winner: ["player", "autoplay_trainer"],
  battle_last_loser: ["player", "autoplay_trainer"],
};

function monster(slug: string, level: number, iid: string, seed: number): SpawnedMonsterSnapshot {
  return spawnMonster(SOURCE_DB, DB, { rng: seed, rngDraws: 0 }, slug, level, { iid });
}

function start(options: {
  player?: SpawnedMonsterSnapshot[];
  enemy?: { species: string; level: number }[];
  kind?: "trainer" | "wild";
  items?: Record<string, number>;
} = {}): RuntimeBattleState {
  const player = options.player ?? [monster("nut", 12, "player-1", 11)];
  const ext = {
    ...initialTuxemonExtensionState(),
    party: player,
    environment: "grass",
    nextMonsterId: player.length + 1,
  };
  const kind = options.kind ?? "trainer";
  const setup = kind === "trainer"
    ? {
        kind,
        opponent: "autoplay_trainer",
        party: options.enemy ?? [{ species: "budaye", level: 8 }],
        environment: "grass",
      }
    : {
        kind,
        species: options.enemy?.[0]?.species ?? "budaye",
        level: options.enemy?.[0]?.level ?? 8,
        environment: "grass",
      };
  const rules = createTuxemonBattleRules(SOURCE_DB, ENUMS);
  const extValue = packTuxemonExtensionState(ext);
  const started = rules.start(extValue, setup as unknown as JsonValue, 77, {
    ext: extValue,
    switches: {},
    variables: {},
    items: options.items ?? {},
    gold: 0,
  });
  if (!started) throw new Error("autoplay fixture did not start");
  const state = tuxemonRuntimeBattleState(started.state);
  state.eventCursor = state.battle.events.length;
  return state;
}

describe("battle autoplay policy", () => {
  test("selects the production-formula maximum expected damage without mutation", () => {
    const state = start();
    const before = JSON.stringify(state);
    const choice = chooseBattleAutoplayAction(DB, state, { capture: "never" });
    expect(choice?.reason).toBe("damage");
    expect(choice?.mode).toBe("technique");
    const techniqueEntries = battleMenuEntries(state, DB, "technique");
    const expected = techniqueEntries.map((entry) => expectedTechniqueDamage(DB, state, entry));
    expect(choice?.expectedDamage).toBe(Math.max(...expected));
    expect(JSON.stringify(state)).toBe(before);
    expect(expected.every(Number.isFinite)).toBe(true);
  });

  test("heals a low active monster before attacking", () => {
    const active = monster("nut", 12, "player-1", 21);
    active.currentHp = 1;
    const state = start({ player: [active], items: { potion: 1, super_potion: 1 } });
    const choice = chooseBattleAutoplayAction(DB, state, { capture: "never" });
    expect(choice).toMatchObject({ mode: "item", kind: "item", reason: "heal", slug: "super_potion" });
  });

  test("switches to a healthy reserve when healing is unavailable", () => {
    const active = monster("nut", 12, "player-1", 31);
    active.currentHp = 1;
    const reserve = monster("rockitten", 16, "player-2", 32);
    const state = start({ player: [active, reserve] });
    const choice = chooseBattleAutoplayAction(DB, state, { capture: "never" });
    expect(choice).toMatchObject({ mode: "swap", kind: "replacement", reason: "switch", target: 2 });
  });

  test("captures only wanted weakened wild monsters", () => {
    const state = start({ kind: "wild", items: { tuxeball: 2 } });
    const enemy = state.battle.parties[1][0]!;
    enemy.currentHp = Math.floor(enemy.base.hp * 0.25);
    expect(chooseBattleAutoplayAction(DB, state)?.reason).toBe("capture");
    state.ext.caught.push(enemy.slug);
    expect(chooseBattleAutoplayAction(DB, state)?.reason).toBe("damage");
    expect(chooseBattleAutoplayAction(DB, state, { capture: [enemy.slug] })?.reason).toBe("capture");
    expect(chooseBattleAutoplayAction(DB, state, { capture: "never" })?.reason).toBe("damage");
  });

  test("turns a complete action into deterministic root and submenu edges", () => {
    const state = start();
    expect(battleAutoplayInput(DB, state, { capture: "never" })).toEqual({ buttons: 0, confirmEdge: true });
    state.menuMode = "technique";
    state.menu = battleMenuEntries(state, DB, "technique");
    state.menuIndex = 0;
    const choice = chooseBattleAutoplayAction(DB, state, { capture: "never" })!;
    const input = battleAutoplayInput(DB, state, { capture: "never" });
    expect(input).toEqual(choice.index === 0 ? { buttons: 0, confirmEdge: true } : { buttons: 0, downEdge: true });
  });

  test("uses a stable weakest-neutral-hit rule for a fifth move", () => {
    const state = start();
    const user = state.battle.parties[0][0]!;
    expect(autoplayMoveToForget(DB, user, ["bullet", "shuriken", "static_field", "ram"], "ram")).toBe(2);
    expect(autoplayMoveToForget(DB, user, ["ram", "stick", "bullet"], "bullet")).toBe(2);
  });
});
