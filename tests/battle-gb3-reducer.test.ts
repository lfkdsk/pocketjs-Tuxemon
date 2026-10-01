import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import battleDbJson from "../data/battle-db.json";
import {
  applyStatus,
  attemptCapture,
  battleDbToTuxemonBattleDb,
  canRun,
  canSwap,
  canUseBattleItem,
  combatStats,
  createBattle,
  getMonster,
  makeRules,
  reduceBattle,
  STAT_NAMES,
  type MonsterSnapshot,
  type Stats,
  type TuxemonBattleState,
} from "../battle/index.ts";
import { validateBattleDb } from "../importer/battle-schema.ts";

interface RngResult { cursor: number; draws: number }
interface GoldenMonster {
  slug: string;
  level: number;
  base: Stats;
  currentHp: number;
  types: string[];
  gender: string;
  status: string | null;
  catchRate: number;
  catchResistance: [number, number];
  tasteWarm: string;
  wild: boolean;
}
interface CaptureCase {
  id: string;
  seed: number;
  item: string;
  context: {
    targetType: string;
    playerType: string;
    gender: string;
    currentHp: "full" | "low";
    status: string | null;
    variables: Record<string, string>;
  };
  target: GoldenMonster;
  expected: {
    statusModifier: number;
    deviceModifier: number;
    shakeCheck: number;
    success: boolean;
    shakes: number;
    rng: RngResult;
    error: string | null;
    itemQuantity: number;
    caught: string[];
    post: GoldenMonster;
  };
}
interface ItemCase {
  id: string;
  item: string;
  effects: string[];
  target: GoldenMonster;
  expected: {
    valid: boolean;
    success: boolean;
    itemQuantity: number;
    currentHp: number;
    status: string | null;
    types: string[];
    combatStats: Stats;
    stages: Stats;
    rng: RngResult;
  };
}
interface RunCase {
  id: string;
  seed: number;
  userLevel: number;
  targetLevel: number;
  attempts: number;
  status: string | null;
  expected: {
    valid: boolean;
    success: boolean;
    runAttempts: number;
    battleLastResult: "run" | null;
    rng: RngResult;
  };
}
interface Gb3Golden {
  captures: CaptureCase[];
  items: ItemCase[];
  runs: RunCase[];
}

const ROOT = join(import.meta.dir, "..");
const DB = battleDbToTuxemonBattleDb(validateBattleDb(battleDbJson));
const GOLDEN = JSON.parse(
  gunzipSync(readFileSync(join(ROOT, "tests/goldens/gb3-rules.json.gz"))).toString("utf8"),
) as Gb3Golden;
const DUMMY_BASE: Stats = { armour: 80, dodge: 80, hp: 80, melee: 80, ranged: 80, speed: 80 };

function snapshot(target: GoldenMonster, overrides: Partial<MonsterSnapshot> = {}): MonsterSnapshot {
  return {
    slug: target.slug,
    level: target.level,
    base: { ...target.base },
    currentHp: target.currentHp,
    moves: ["struggle"],
    types: [...target.types],
    gender: target.gender,
    tasteWarm: target.tasteWarm,
    status: target.status,
    ...overrides,
  };
}

function dummy(slug: "nut" | "rockitten", level = 8, types?: string[]): MonsterSnapshot {
  return { slug, level, base: { ...DUMMY_BASE }, moves: ["struggle"], types };
}

function resetRuleRng(state: TuxemonBattleState, seed: number): void {
  state.rng = seed >>> 0;
  state.rngDraws = 0;
  state.events = [];
}

function captureState(entry: CaptureCase): TuxemonBattleState {
  const state = createBattle(DB, {
    seed: 0,
    kind: "wild",
    player: [dummy("nut", 8, [entry.context.playerType])],
    enemy: [snapshot(entry.target, {
      types: [entry.context.targetType],
      gender: entry.context.gender,
      status: null,
    })],
    inventory: { [entry.item]: 1 },
    variables: entry.context.variables,
  });
  if (entry.context.status) applyStatus(DB, getMonster(state, 2), entry.context.status, null);
  resetRuleRng(state, entry.seed);
  return state;
}

function capturePost(state: TuxemonBattleState, targetUid: number): GoldenMonster {
  const target = getMonster(state, targetUid);
  const species = DB.monster[target.slug];
  return {
    slug: target.slug,
    level: target.level,
    base: { ...target.base },
    currentHp: target.currentHp,
    types: [...target.types],
    gender: target.gender,
    status: target.status?.slug ?? null,
    catchRate: species.catch_rate,
    catchResistance: [...species.catch_resistance],
    tasteWarm: target.tasteWarm,
    wild: state.capturedUid !== targetUid,
  };
}

function itemState(entry: ItemCase): TuxemonBattleState {
  const state = createBattle(DB, {
    seed: 0,
    kind: "wild",
    player: [dummy("nut"), snapshot(entry.target)],
    enemy: [dummy("nut")],
    inventory: { [entry.item]: 1 },
  });
  resetRuleRng(state, 0xc0ffee);
  return state;
}

function runState(entry: RunCase): TuxemonBattleState {
  const state = createBattle(DB, {
    seed: 0,
    kind: "wild",
    player: [dummy("rockitten", entry.userLevel)],
    enemy: [dummy("nut", entry.targetLevel)],
    runAttempts: entry.attempts,
  });
  if (entry.status) applyStatus(DB, getMonster(state, 1), entry.status, null);
  resetRuleRng(state, entry.seed);
  return state;
}

describe("GB3 capture/item/run reducer differential", () => {
  test("matches all 216 capture formulas, mutations, stock results, and failures", () => {
    for (const entry of GOLDEN.captures) {
      const formulaState = captureState(entry);
      const formulaTarget = getMonster(formulaState, 2);
      expect(attemptCapture(DB, formulaState, entry.item, formulaTarget), entry.id).toEqual({
        statusModifier: entry.expected.statusModifier,
        deviceModifier: entry.expected.deviceModifier,
        shakeCheck: entry.expected.shakeCheck,
        success: entry.expected.success,
        shakes: entry.expected.shakes,
      });
      expect({ cursor: formulaState.rng, draws: formulaState.rngDraws }, entry.id)
        .toEqual(entry.expected.rng);

      const state = captureState(entry);
      expect(canUseBattleItem(DB, state, entry.item, 2, true), entry.id).toBe(true);
      let error: string | null = null;
      try {
        makeRules(DB).perform(state, {
          kind: "capture",
          user: 1,
          target: 2,
          ref: entry.item,
          subPriority: 0,
        });
      } catch (caught) {
        error = String(caught);
      }
      expect(error, entry.id).toBe(entry.expected.error);
      expect({ cursor: state.rng, draws: state.rngDraws }, entry.id).toEqual(entry.expected.rng);
      expect(state.inventory[entry.item], entry.id).toBe(entry.expected.itemQuantity);
      expect(state.capturedUid === null ? [] : [getMonster(state, state.capturedUid).slug], entry.id)
        .toEqual(entry.expected.caught);
      expect(capturePost(state, 2), entry.id).toEqual(entry.expected.post);
    }
  });

  test("matches all 25 ordinary battle item effects without consuming effect RNG", () => {
    for (const entry of GOLDEN.items) {
      const state = itemState(entry);
      const target = getMonster(state, 2);
      expect(canUseBattleItem(DB, state, entry.item, target.uid, false), entry.id)
        .toBe(entry.expected.valid);
      makeRules(DB).perform(state, {
        kind: "item",
        user: 1,
        target: target.uid,
        ref: entry.item,
        subPriority: 0,
      });
      const event = state.events.at(-1)!;
      expect(event.success, entry.id).toBe(entry.expected.success);
      expect(state.inventory[entry.item], entry.id).toBe(entry.expected.itemQuantity);
      expect(target.currentHp, entry.id).toBe(entry.expected.currentHp);
      expect(target.status?.slug ?? null, entry.id).toBe(entry.expected.status);
      expect(target.types, entry.id).toEqual(entry.expected.types);
      expect(combatStats(target), entry.id).toEqual(entry.expected.combatStats);
      expect(Object.fromEntries(STAT_NAMES.map((stat) => [stat, target.stages[stat] ?? 0])), entry.id)
        .toEqual(entry.expected.stages);
      expect({ cursor: state.rng, draws: state.rngDraws }, entry.id).toEqual(entry.expected.rng);
    }
  });

  test("matches all 88 escape boundaries and rejects bonds before any RNG draw", () => {
    for (const entry of GOLDEN.runs) {
      const state = runState(entry);
      expect(canRun(state, 1), entry.id).toBe(entry.expected.valid);
      if (entry.expected.valid) {
        makeRules(DB).perform(state, {
          kind: "run",
          user: 1,
          target: 2,
          ref: "menu_run",
          subPriority: 0,
        });
        const event = state.events.findLast((candidate) => candidate.type === "run")!;
        expect(event.success, entry.id).toBe(entry.expected.success);
      }
      expect(state.runAttempts, entry.id).toBe(entry.expected.runAttempts);
      expect(state.result?.battleLastResult ?? null, entry.id).toBe(entry.expected.battleLastResult);
      expect({ cursor: state.rng, draws: state.rngDraws }, entry.id).toEqual(entry.expected.rng);
    }
  });

  test("routes new decisions through the immutable action queue", () => {
    const capture = GOLDEN.captures.find(({ item, expected }) =>
      item === "tuxeball_ancient" && expected.success
    )!;
    const previous = captureState(capture);
    const before = JSON.stringify(previous);
    const next = reduceBattle(DB, previous, { type: "capture", item: capture.item, target: 2 });
    expect(JSON.stringify(previous)).toBe(before);
    expect(next.phase).toBe("ended");
    expect(next.result?.battleLastResult).toBe("captured");
    expect(next.inventory[capture.item]).toBe(0);

    const blocked = GOLDEN.runs.find(({ expected }) => !expected.valid)!;
    const run = runState(blocked);
    const draws = run.rngDraws;
    expect(() => reduceBattle(DB, run, { type: "run" })).toThrow("escape is unavailable");
    expect(run.rngDraws).toBe(draws);
    expect(run.runAttempts).toBe(blocked.attempts);
  });

  test("queues a voluntary replacement, redirects attacks, and rejects bound users", () => {
    const state = createBattle(DB, {
      seed: 0x1918,
      kind: "trainer",
      player: [dummy("nut", 30), dummy("rockitten", 30)],
      enemy: [dummy("nut", 5)],
    });
    expect(state.awaiting?.uid).toBe(1);
    expect(canSwap(state, 1, 2)).toBeTrue();
    const before = JSON.stringify(state);
    const next = reduceBattle(DB, state, { type: "replacement", uid: 2 });
    expect(JSON.stringify(state)).toBe(before);
    expect(state.field).toEqual([3, 1]);
    expect(next.field).toContain(2);
    expect(next.field).not.toContain(1);
    expect(next.events).toContainEqual(expect.objectContaining({
      type: "swap",
      side: 0,
      user: 1,
      target: 2,
    }));
    const enemyTechnique = next.events.find((event) =>
      event.type === "technique" && event.user === 3
    );
    expect(enemyTechnique?.target).toBe(2);

    const bound = createBattle(DB, {
      seed: 0x1918,
      kind: "trainer",
      player: [dummy("nut", 30), dummy("rockitten", 30)],
      enemy: [dummy("nut", 5)],
    });
    applyStatus(DB, getMonster(bound, 1), "grabbed", 3);
    expect(canSwap(bound, 1, 2)).toBeFalse();
    expect(() => reduceBattle(DB, bound, { type: "replacement", uid: 2 }))
      .toThrow("replacement 2 is unavailable");
  });
});
