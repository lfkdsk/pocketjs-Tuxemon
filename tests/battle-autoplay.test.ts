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
    playerName: "Player",
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

// Pin a battle monster's max/current HP so ratio thresholds land on exact
// fractions.  Spawned HP is IV-dependent, so boundary tests set it explicitly
// after the battle starts; the autoplay only reads base.hp/currentHp for the
// ratio and percentage healing, never for damage.
function pinHp(state: RuntimeBattleState, side: 0 | 1, index: number, maxHp: number, currentHp: number): void {
  const target = state.battle.parties[side][index]!;
  target.base.hp = maxHp;
  target.currentHp = currentHp;
}

describe("battle autoplay boundary values and tie-breaks", () => {
  test("heal threshold: heals at exactly 0.35 but not 1 HP above", () => {
    // max HP 200 makes 0.35 an exact 70 HP.  The <= comparison means the
    // boundary itself heals; one HP more falls through to attacking.
    for (const [currentHp, expected] of [
      [70, "heal"],
      [71, "damage"],
      [69, "heal"],
    ] as const) {
      const state = start({ player: [monster("cataspike", 20, "player-1", 5)], items: { potion: 1 } });
      pinHp(state, 0, 0, 200, currentHp);
      const choice = chooseBattleAutoplayAction(DB, state, { capture: "never" });
      expect(choice?.reason).toBe(expected);
      if (expected === "heal") expect(choice).toMatchObject({ mode: "item", slug: "potion" });
    }
  });

  test("heal item tie: equal useful healing consumes the smaller nominal item", () => {
    // max HP 40, current 14 (missing 26): both potion (+50) and super_potion
    // (+100) heal the full 26, so the tie-break prefers the smaller item.
    const state = start({
      player: [monster("cataspike", 20, "player-1", 5)],
      items: { potion: 1, super_potion: 1 },
    });
    pinHp(state, 0, 0, 40, 14);
    const choice = chooseBattleAutoplayAction(DB, state, { capture: "never" });
    expect(choice).toMatchObject({ mode: "item", reason: "heal", slug: "potion" });
  });

  test("heal item tie: equal useful and nominal amount keeps sorted source order", () => {
    // max HP 200, current 70 (missing 130): cureall (100% = 200) and
    // mega_potion (+200) are tied on both useful (130) and nominal (200), so
    // the first in sorted slug order wins.
    const state = start({
      player: [monster("cataspike", 20, "player-1", 5)],
      items: { cureall: 1, mega_potion: 1 },
    });
    pinHp(state, 0, 0, 200, 70);
    const choice = chooseBattleAutoplayAction(DB, state, { capture: "never" });
    expect(choice).toMatchObject({ mode: "item", reason: "heal", slug: "cureall" });
  });

  test("capture threshold: captures at exactly 0.4 but not 1 HP above", () => {
    // Wild enemy max HP 200 makes 0.4 an exact 80 HP.
    for (const [currentHp, expected] of [
      [80, "capture"],
      [81, "damage"],
      [79, "capture"],
    ] as const) {
      const state = start({
        kind: "wild",
        enemy: [{ species: "cataspike", level: 20 }],
        items: { tuxeball: 2 },
      });
      pinHp(state, 1, 0, 200, currentHp);
      const choice = chooseBattleAutoplayAction(DB, state);
      expect(choice?.reason).toBe(expected);
      if (expected === "capture") expect(choice).toMatchObject({ mode: "capture", slug: "tuxeball" });
    }
  });

  test("capture device tie: equal modifier keeps sorted source order", () => {
    // tuxeball (specific 1) and tuxeball_candy (fallback positive 1) tie at
    // modifier 1; sorted slug order makes tuxeball the deterministic pick.
    const state = start({
      kind: "wild",
      enemy: [{ species: "cataspike", level: 20 }],
      items: { tuxeball: 1, tuxeball_candy: 1 },
    });
    pinHp(state, 1, 0, 200, 80);
    const choice = chooseBattleAutoplayAction(DB, state);
    expect(choice).toMatchObject({ mode: "capture", reason: "capture", slug: "tuxeball" });
  });

  test("switch threshold: switches at exactly 0.2 with a strictly healthier reserve", () => {
    // Active max HP 200, current 40 = exactly 0.2; reserve at 91/200 = 0.455,
    // strictly more than 0.2 + 0.25 = 0.45, so the switch fires.
    const state = start({
      player: [monster("cataspike", 20, "player-1", 5), monster("cataspike", 20, "player-2", 6)],
      enemy: [{ species: "budaye", level: 20 }],
    });
    pinHp(state, 0, 0, 200, 40);
    pinHp(state, 0, 1, 200, 91);
    const choice = chooseBattleAutoplayAction(DB, state, { capture: "never" });
    expect(choice).toMatchObject({ mode: "swap", reason: "switch", target: state.battle.parties[0][1]!.uid });
  });

  test("switch threshold: reserve advantage is strict at exactly +0.25", () => {
    // Reserve at 90/200 = 0.45 == 0.2 + 0.25 exactly; the strict > comparison
    // means no switch, so the active monster keeps attacking.
    const state = start({
      player: [monster("cataspike", 20, "player-1", 5), monster("cataspike", 20, "player-2", 6)],
      enemy: [{ species: "budaye", level: 20 }],
    });
    pinHp(state, 0, 0, 200, 40);
    pinHp(state, 0, 1, 200, 90);
    const choice = chooseBattleAutoplayAction(DB, state, { capture: "never" });
    expect(choice?.reason).toBe("damage");
    expect((choice?.expectedDamage ?? 0) > 0).toBe(true);
  });

  test("switch threshold: 1 HP above 0.2 does not switch", () => {
    // Active at 41/200 = 0.205 > 0.2, so even a much healthier reserve is not
    // brought in.
    const state = start({
      player: [monster("cataspike", 20, "player-1", 5), monster("cataspike", 20, "player-2", 6)],
      enemy: [{ species: "budaye", level: 20 }],
    });
    pinHp(state, 0, 0, 200, 41);
    pinHp(state, 0, 1, 200, 91);
    const choice = chooseBattleAutoplayAction(DB, state, { capture: "never" });
    expect(choice?.reason).toBe("damage");
  });

  test("reserve tie: equal damage prefers the healthier reserve, then source order", () => {
    // Two same-seed reserves deal identical damage; the higher HP ratio wins,
    // and an exact ratio tie keeps the earlier party slot.
    const make = () => start({
      player: [
        monster("cataspike", 20, "player-1", 5),
        monster("cataspike", 20, "player-2", 6),
        monster("cataspike", 20, "player-3", 6),
      ],
      enemy: [{ species: "budaye", level: 20 }],
    });
    const healthier = make();
    pinHp(healthier, 0, 0, 200, 40);
    pinHp(healthier, 0, 1, 200, 100);
    pinHp(healthier, 0, 2, 200, 150);
    const healthierChoice = chooseBattleAutoplayAction(DB, healthier, { capture: "never" });
    expect(healthierChoice).toMatchObject({ reason: "switch", target: healthier.battle.parties[0][2]!.uid });

    const tied = make();
    pinHp(tied, 0, 0, 200, 40);
    pinHp(tied, 0, 1, 200, 100);
    pinHp(tied, 0, 2, 200, 100);
    const tiedChoice = chooseBattleAutoplayAction(DB, tied, { capture: "never" });
    expect(tiedChoice).toMatchObject({ reason: "switch", target: tied.battle.parties[0][1]!.uid });
  });

  test("damage move tie: equal expected damage keeps the earliest menu move", () => {
    // firomenis's breathe_fire and kindling_flame share range/accuracy/power/
    // type, so against budaye both compute 90.4 expected damage.  The policy
    // keeps the FIRST max (breathe_fire, menu index 1); a last-max convention
    // would pick kindling_flame instead.  This is the convention the mainline
    // tape depends on, so it is pinned here, not left implicit.
    const state = start({
      player: [monster("firomenis", 20, "player-1", 5)],
      enemy: [{ species: "budaye", level: 20 }],
    });
    const entries = battleMenuEntries(state, DB, "technique");
    const expected = entries.map((entry) => expectedTechniqueDamage(DB, state, entry));
    const firstMax = entries[expected.indexOf(Math.max(...expected))]!;
    const choice = chooseBattleAutoplayAction(DB, state, { capture: "never" });
    expect(choice).toMatchObject({ mode: "technique", reason: "damage", slug: firstMax.slug });
    expect(choice?.slug).toBe("breathe_fire");
    expect(choice?.index).toBe(1);
  });

  test("forget-move tie: equal lowest score forgets the oldest move", () => {
    // blade and wall_of_steel both score power*accuracy = 1.25, the lowest of
    // the four; the strict < comparison forgets the first (oldest) of the tie.
    const state = start();
    const user = state.battle.parties[0][0]!;
    const moves = ["blade", "wall_of_steel", "viper", "perfect_cut"];
    const scores = moves.map((slug) => {
      const technique = DB.technique[slug]!;
      return Math.max(0, technique.power) * Math.max(0, Math.min(1, technique.accuracy));
    });
    expect(scores[0]).toBe(scores[1]);
    expect(Math.min(...scores)).toBe(scores[0]);
    expect(autoplayMoveToForget(DB, user, moves, "perfect_cut")).toBe(0);
  });
});
