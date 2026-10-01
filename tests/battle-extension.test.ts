import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createTuxemonExtensions,
  initialTuxemonExtensionState,
  KENNEL_LIMIT,
  PARTY_LIMIT,
  TUXEMON_EXT_SAVE_FORMAT,
  tuxemonExtensionState,
} from "../battle/extension.ts";
import { snapshotFromClock } from "../battle/time-weather.ts";
import { validateBattleDb } from "../importer/battle-schema.ts";
import { AttractController } from "../vendor/pocket-rpgkit/src/engine/attract.ts";
import { rngNext } from "../vendor/pocket-rpgkit/src/engine/interpreter.ts";
import {
  createSession,
  startSession,
  stepSession,
} from "../vendor/pocket-rpgkit/src/engine/session.ts";
import { createSessionSnapshot, encodeEnvelope } from "../vendor/pocket-rpgkit/src/engine/save.ts";
import { restoreSessionEnvelope } from "../vendor/pocket-rpgkit/src/engine/save-restore.ts";
import type {
  Command,
  JsonValue,
  Project,
} from "../vendor/pocket-rpgkit/src/engine/types.ts";

const ROOT = join(import.meta.dir, "..");
const DB = validateBattleDb(JSON.parse(readFileSync(join(ROOT, "data/battle-db.json"), "utf8")));

function project(commands: Command[]): Project {
  return {
    format: "rpgkit-project/v1",
    title: "Tuxemon extension test",
    tileSize: 16,
    start: { map: "test", x: 2, y: 2, dir: "down" },
    sheets: [{ id: "plain", cols: 1, rows: 1, pak: "chunks", defaultPassage: "pass" }],
    items: [],
    maps: [{
      id: "test",
      name: "test",
      width: 6,
      height: 6,
      ground: new Array(36).fill("plain.0"),
      events: [{
        id: "setup",
        x: 1,
        y: 1,
        pages: [
          { trigger: "autorun", commands: [...commands, { op: "switch", id: "done", value: true }] },
          { trigger: "action", condition: { switch: "done" }, commands: [] },
        ],
      }],
    }],
  };
}

function run(commands: Command[], ext?: JsonValue, variables: Record<string, number | string> = {}) {
  const source = project(commands);
  const session = createSession(source, 60, { extensions: createTuxemonExtensions(DB) });
  const initial = startSession(source, session, undefined, ext);
  Object.assign(initial.sw.variables, variables);
  return { session, initial, state: stepSession(session, initial, { buttons: 0 }) };
}

describe("Tuxemon party extension", () => {
  test("uses the built-in item bank without a mirrored extension inventory", () => {
    const { state } = run([
      { op: "item", item: "potion", set: "add", count: 3 },
      { op: "item", item: "potion", set: "sub", count: 1 },
      {
        op: "if",
        if: { kind: "item", id: "potion", count: 2 },
        then: [{ op: "switch", id: "has-two-potions", value: true }],
      },
    ]);
    expect(state.sw.items.potion).toBe(2);
    expect(tuxemonExtensionState(state.ext, DB)).not.toHaveProperty("inventory");
    expect(state.sw.switches["has-two-potions"]).toBeTrue();
  });

  test("adds variable-backed player monsters and defers NPC spawning without hidden RNG", () => {
    const commands: Command[] = [
      {
        op: "ext",
        call: "tux.add_monster",
        args: {
          species: { variable: "v.billie_choice", values: ["bamboon", "bigfin", "budaye"] },
          level: 5,
          character: "player",
        },
      },
      {
        op: "ext",
        call: "tux.add_monster",
        args: { species: "nut", level: 7, character: "trainer", experienceModifier: 5, moneyModifier: 10 },
      },
      {
        op: "if",
        if: { kind: "ext", call: "tux.party_size", args: { character: "player", operator: "equals", value: 1 } },
        then: [{ op: "switch", id: "party-size", value: true }],
      },
      {
        op: "if",
        if: { kind: "ext", call: "tux.has_monster", args: { character: "player", species: "budaye" } },
        then: [{ op: "switch", id: "has-budaye", value: true }],
      },
    ];
    const { initial, state } = run(commands, undefined, { "v.billie_choice": 3 });
    const ext = tuxemonExtensionState(state.ext, DB);
    expect(ext.party).toHaveLength(1);
    expect(ext.party[0]).toMatchObject({ iid: "txmn-000001", slug: "budaye", level: 5 });
    expect(ext.npcParties.trainer).toEqual([{
      iid: "txmn-000002",
      slug: "nut",
      level: 7,
      experienceModifier: 5,
      moneyModifier: 10,
    }]);
    expect(ext.caught).toEqual(["budaye"]);
    expect(state.sw.variables["v.add_monster"]).toBe("txmn-000002");
    expect(state.sw.switches["party-size"]).toBe(true);
    expect(state.sw.switches["has-budaye"]).toBe(true);
    let expectedCursor = initial.sw.rng;
    for (let draw = 0; draw < 13; draw++) expectedCursor = rngNext(expectedCursor).next;
    expect(state.sw.rng).toBe(expectedCursor);
  });

  test("routes overflow into a bounded kennel and still consumes each spawn", () => {
    const options = createTuxemonExtensions(DB);
    const add = options.commands!["tux.add_monster"]!;
    let ext = options.initial!;
    let draws = 0;
    for (let index = 0; index < PARTY_LIMIT + KENNEL_LIMIT + 1; index++) {
      const result = add({
        ext,
        switches: {},
        variables: {},
        items: {},
        gold: 0,
        playerName: "Player",
        random: () => {
          draws++;
          return 0.25;
        },
      }, { species: "nut", level: 5 });
      expect(result).toBeDefined();
      ext = result!.ext!;
    }
    const state = tuxemonExtensionState(ext, DB);
    expect(state.party).toHaveLength(PARTY_LIMIT);
    expect(state.kennel).toHaveLength(KENNEL_LIMIT);
    expect(state.nextMonsterId).toBe(PARTY_LIMIT + KENNEL_LIMIT + 2);
    expect(draws).toBe((PARTY_LIMIT + KENNEL_LIMIT + 1) * 13);
  });

  test("targeted and whole-party health/status commands use stable monster ids", () => {
    const added = run([{
      op: "ext",
      call: "tux.add_monster",
      args: { species: "nut", level: 5 },
    }]);
    const damaged = run([
      {
        op: "ext",
        call: "tux.set_monster_health",
        args: { variable: "v.target", health: { kind: "fraction", value: 0.1 } },
      },
      {
        op: "ext",
        call: "tux.set_monster_status",
        args: { variable: "v.target", status: "poison" },
      },
    ], added.state.ext, { "v.target": "txmn-000001" });
    const hurt = tuxemonExtensionState(damaged.state.ext, DB).party[0]!;
    expect(hurt.currentHp).toBe(Math.trunc(hurt.base.hp * 0.1));
    expect(hurt.status).toBe("poison");

    const healed = run([
      { op: "ext", call: "tux.set_monster_health", args: {} },
      { op: "ext", call: "tux.set_monster_status", args: {} },
    ], damaged.state.ext);
    const healthy = tuxemonExtensionState(healed.state.ext, DB).party[0]!;
    expect(healthy.currentHp).toBe(healthy.base.hp);
    expect(healthy.status).toBeNull();
  });

  test("checks, confirms, and denies pending evolutions in party order", () => {
    const added = run([{
      op: "ext",
      call: "tux.add_monster",
      args: { species: "cataspike", level: 9 },
    }]);
    const pending = tuxemonExtensionState(added.state.ext, DB);
    pending.party[0] = {
      ...pending.party[0]!,
      waitingToEvolve: true,
      captureDevice: "tuxeball_ancient",
      status: "poison",
    };
    const evolved = run([
      {
        op: "if",
        if: { kind: "ext", call: "tux.check_evolution", args: { character: "player" } },
        then: [{ op: "switch", id: "waiting", value: true }],
      },
      { op: "ext", call: "tux.evolution", args: { character: "player", inside: false } },
    ], pending as unknown as JsonValue);
    const after = tuxemonExtensionState(evolved.state.ext, DB);
    expect(evolved.state.sw.switches.waiting).toBeTrue();
    expect(after.party[0]).toMatchObject({
      iid: pending.party[0]!.iid,
      slug: "puparmor",
      stage: "stage1",
      captureDevice: "tuxeball_ancient",
      status: "poison",
      waitingToEvolve: false,
      acquisition: "unknown",
      experienceModifier: 1,
      moneyModifier: 0,
      bond: 25,
    });
    expect(after.party[0]!.moves).toEqual([...pending.party[0]!.moves, "chameleon"]);
    expect(after.caught).toContain("puparmor");
    let expectedCursor = evolved.initial.sw.rng;
    for (let draw = 0; draw < 13; draw++) expectedCursor = rngNext(expectedCursor).next;
    expect(evolved.state.sw.rng).toBe(expectedCursor);

    const declined = tuxemonExtensionState(added.state.ext, DB);
    declined.party[0] = { ...declined.party[0]!, waitingToEvolve: true };
    const denied = run([
      { op: "ext", call: "tux.cancel_evolution", args: { character: "player" } },
      {
        op: "if",
        if: { kind: "ext", call: "tux.check_evolution", args: { character: "player" } },
        then: [{ op: "switch", id: "still-waiting", value: true }],
      },
    ], declined as unknown as JsonValue);
    expect(tuxemonExtensionState(denied.state.ext, DB).party[0]!.slug).toBe("cataspike");
    expect(tuxemonExtensionState(denied.state.ext, DB).party[0]!.waitingToEvolve).toBeFalse();
    expect(denied.state.sw.switches["still-waiting"]).not.toBeTrue();
    expect(denied.state.sw.rng).toBe(denied.initial.sw.rng);
  });

  test("party defeat and battle-history conditions read extension state", () => {
    const base = initialTuxemonExtensionState();
    const spawned = run([{
      op: "ext",
      call: "tux.add_monster",
      args: { species: "nut", level: 5 },
    }], base as unknown as JsonValue);
    const ext = tuxemonExtensionState(spawned.state.ext, DB);
    ext.party[0] = { ...ext.party[0]!, currentHp: 0, status: "faint" };
    ext.history.push(
      { fighter: "player", opponent: "billie", outcome: "won" },
      { fighter: "player", opponent: "billie", outcome: "won" },
      { fighter: "billie", opponent: "player", outcome: "lost" },
    );
    const commands: Command[] = [
      {
        op: "if",
        if: { kind: "ext", call: "tux.char_defeated", args: { character: "player" } },
        then: [{ op: "switch", id: "defeated", value: true }],
      },
      {
        op: "if",
        if: { kind: "ext", call: "tux.battle_outcome", args: { fighter: "player", opponent: "billie", outcome: "won" } },
        then: [{ op: "switch", id: "won", value: true }],
      },
      {
        op: "if",
        if: { kind: "ext", call: "tux.battle_outcome_count", args: { fighter: "player", opponent: "billie", outcome: "won", count: 2 } },
        then: [{ op: "switch", id: "won-twice", value: true }],
      },
    ];
    const checked = run(commands, ext as unknown as JsonValue);
    expect(checked.state.sw.switches).toMatchObject({ defeated: true, won: true, "won-twice": true });
  });

  test("faint point writes variable-addressed transfer operands", () => {
    const { state } = run([
      { op: "ext", call: "tux.set_faint_point", args: { character: "player", map: "bedroom", x: 3, y: 4 } },
      { op: "ext", call: "tux.prepare_faint_transfer", args: { character: "player" } },
      {
        op: "if",
        if: { kind: "ext", call: "tux.faint_point_is_map", args: { character: "player", map: "bedroom" } },
        then: [{ op: "switch", id: "at-faint-map", value: true }],
      },
      {
        op: "if",
        if: { kind: "ext", call: "tux.faint_point_is_map", args: { character: "player", map: "route", negate: true } },
        then: [{ op: "switch", id: "away-from-faint-map", value: true }],
      },
    ]);
    expect(tuxemonExtensionState(state.ext, DB).faintPoints.player).toEqual({ map: "bedroom", x: 3, y: 4 });
    expect(state.sw.variables).toMatchObject({
      "tux.faint.map": "bedroom",
      "tux.faint.x": 3,
      "tux.faint.y": 4,
    });
    expect(state.sw.switches).toMatchObject({ "at-faint-map": true, "away-from-faint-map": true });
  });

  test("environment and guarded faint recovery live entirely in extension state", () => {
    const added = run([{
      op: "ext",
      call: "tux.add_monster",
      args: { species: "nut", level: 5 },
    }]);
    const hurt = tuxemonExtensionState(added.state.ext, DB);
    hurt.party[0] = { ...hurt.party[0]!, currentHp: 1, status: "poison" };
    const { state } = run([
      { op: "ext", call: "tux.set_environment", args: { environment: "grass" } },
      { op: "ext", call: "tux.set_faint_point", args: { character: "player", map: "bedroom", x: 3, y: 4 } },
      {
        op: "if",
        if: { kind: "ext", call: "tux.environment_is", args: { environment: "grass" } },
        then: [{ op: "switch", id: "grass", value: true }],
      },
      {
        op: "if",
        if: { kind: "ext", call: "tux.has_faint_point", args: { character: "player" } },
        then: [{
          op: "ext",
          call: "tux.prepare_faint_transfer",
          args: { character: "player", healing: true, currentMap: "bedroom" },
        }],
      },
    ], hurt as unknown as JsonValue);
    const recovered = tuxemonExtensionState(state.ext, DB);
    expect(recovered.environment).toBe("grass");
    expect(recovered.party[0]).toMatchObject({ currentHp: recovered.party[0]!.base.hp, status: null });
    expect(state.sw.switches.grass).toBeTrue();
    expect(state.sw.variables["tux.faint.map"]).toBe("bedroom");
  });

  test("codec preserves parties through a checksummed save and rejects malformed state", () => {
    const played = run([{
      op: "ext",
      call: "tux.add_monster",
      args: { species: "nut", level: 5 },
    }]);
    const snapshot = createSessionSnapshot(played.session, played.state, 0);
    expect(snapshot.ext).toMatchObject({ format: TUXEMON_EXT_SAVE_FORMAT });
    const restored = restoreSessionEnvelope(played.session, encodeEnvelope(snapshot));
    expect(restored.ext).toEqual(played.state.ext);

    const legacy = {
      ...tuxemonExtensionState(played.state.ext, DB),
      inventory: { potion: 2 },
      money: 300,
    } as Record<string, unknown>;
    delete legacy.runAttempts;
    delete legacy.clock;
    delete legacy.weather;
    const migrated = createTuxemonExtensions(DB).codec!.decode({
      format: TUXEMON_EXT_SAVE_FORMAT,
      state: legacy as JsonValue,
    });
    const migratedState = tuxemonExtensionState(migrated, DB);
    expect(migratedState).toMatchObject({ runAttempts: 0 });
    expect(snapshotFromClock(migratedState.clock)).toMatchObject({
      year: 2024,
      month: 6,
      day: 15,
      hour: 9,
      minute: 0,
    });
    expect(migratedState.weather).toMatchObject({ slug: "sunny", rngCursor: 0x9e37_79b9 });
    expect(migratedState).not.toHaveProperty("inventory");
    expect(migratedState).not.toHaveProperty("money");

    for (const missing of ["clock", "weather"] as const) {
      const partial = { ...tuxemonExtensionState(played.state.ext, DB) } as Record<string, unknown>;
      delete partial[missing];
      expect(() => createTuxemonExtensions(DB).codec!.decode({
        format: TUXEMON_EXT_SAVE_FORMAT,
        state: partial as JsonValue,
      })).toThrow(/clock and weather must either both be present or both be absent/);
    }

    const invalid = { ...initialTuxemonExtensionState(), nextMonsterId: Number.MAX_SAFE_INTEGER + 1 };
    expect(() => startSession(project([]), played.session, undefined, invalid as unknown as JsonValue))
      .toThrow(/nextMonsterId must be a positive safe integer/);
    const invalidAttempts = { ...initialTuxemonExtensionState(), runAttempts: -1 };
    expect(() => startSession(project([]), played.session, undefined, invalidAttempts as unknown as JsonValue))
      .toThrow(/runAttempts must be a non-negative safe integer/);
  });

  test("rewind refolds monster identity, attributes, and RNG byte-for-byte", () => {
    const source = project([{
      op: "ext",
      call: "tux.add_monster",
      args: { species: "nut", level: 5 },
    }]);
    const extensions = createTuxemonExtensions(DB);
    const rewound = new AttractController(source, [], {
      hz: 60,
      attractEnabled: false,
      rewindSeconds: 2 / 60,
      extensions,
    });
    const fresh = new AttractController(source, [], {
      hz: 60,
      attractEnabled: false,
      rewindSeconds: 2 / 60,
      extensions,
    });
    rewound.startPlay();
    fresh.startPlay();
    for (let frame = 0; frame < 5; frame++) rewound.step(0);
    for (let frame = 0; frame < 3; frame++) fresh.step(0);
    rewound.step(0x0100);
    expect(rewound.length).toBe(3);
    expect(rewound.state).toEqual(fresh.state);
    expect(tuxemonExtensionState(rewound.state.ext, DB).party[0]?.iid).toBe("txmn-000001");
  });
});
