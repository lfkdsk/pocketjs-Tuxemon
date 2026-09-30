import { describe, expect, test } from "bun:test";
import battleDbJson from "../data/battle-db.json";

import { nextRandom, type RngState } from "../battle/core.ts";
import {
  initialTuxemonExtensionState,
  tuxemonExtensionState,
  type TuxemonExtensionState,
} from "../battle/extension.ts";
import { battleDbToTuxemonBattleDb } from "../battle/from-battle-db.ts";
import {
  BATTLE_EVENT_TICKS,
  createTuxemonBattleRules,
  tuxemonRuntimeBattleState,
  type RuntimeBattleState,
  type VariableEnums,
} from "../battle/runtime.ts";
import { spawnMonster } from "../battle/spawn.ts";
import { createBattle } from "../battle/tuxemon.ts";
import type { SpawnedMonsterSnapshot } from "../battle/types.ts";
import { validateBattleDb } from "../importer/battle-schema.ts";
import type { BattleCompletion, BattleRules } from "../vendor/pocket-rpgkit/src/engine/battle.ts";
import type { JsonValue } from "../vendor/pocket-rpgkit/src/engine/types.ts";

const DB = validateBattleDb(battleDbJson);
const RULE_DB = battleDbToTuxemonBattleDb(DB);
const OPPONENT = "test_trainer";
const ENUMS: VariableEnums = {
  battle_last_result: ["draw", "lost", "won"],
  battle_last_trainer: [OPPONENT],
  battle_last_winner: ["player", OPPONENT],
  battle_last_loser: ["player", OPPONENT],
};

function monster(
  slug: string,
  level: number,
  iid: string,
  seed = 1,
  options: { experienceModifier?: number; moneyModifier?: number } = {},
): SpawnedMonsterSnapshot {
  return spawnMonster(DB, RULE_DB, { rng: seed >>> 0, rngDraws: 0 }, slug, level, {
    iid,
    ...options,
  });
}

function extensionWith(player: SpawnedMonsterSnapshot): TuxemonExtensionState {
  return { ...initialTuxemonExtensionState(), party: [player], environment: "grass", nextMonsterId: 2 };
}

function json(value: unknown): JsonValue {
  return value as JsonValue;
}

function finish(
  rules: BattleRules,
  started: NonNullable<ReturnType<BattleRules["start"]>>,
  ticks = 15,
): { state: RuntimeBattleState; completion: BattleCompletion } {
  let value = started.state;
  for (let guard = 0; guard < 10_000; guard++) {
    let state = tuxemonRuntimeBattleState(value);
    if (state.eventCursor < state.battle.events.length) {
      value = rules.step(value, { buttons: 0 }, ticks);
    } else if (state.battle.awaiting) {
      value = rules.step(value, { buttons: 0, confirmEdge: true }, ticks);
    } else {
      const completion = rules.done(value);
      if (completion) return { state, completion };
      value = rules.step(value, { buttons: 0 }, ticks);
    }
    state = tuxemonRuntimeBattleState(value);
    const completion = rules.done(value);
    if (completion) return { state, completion };
  }
  throw new Error("runtime battle did not finish");
}

describe("Tuxemon BattleRules adapter", () => {
  test("wins a trainer battle, consumes its staged party, and writes persistent rewards", () => {
    const ext = extensionWith(monster("nut", 50, "txmn-player", 91));
    ext.npcParties[OPPONENT] = [{
      iid: "txmn-enemy",
      slug: "budaye",
      level: 2,
      experienceModifier: 5,
      moneyModifier: 10,
    }];
    const rules = createTuxemonBattleRules(DB, ENUMS);
    const started = rules.start(json(ext), json({
      kind: "trainer",
      opponent: OPPONENT,
      environment: "grass",
    }), 101);
    expect(started).not.toBeNull();
    expect(tuxemonExtensionState(started!.ext, DB).npcParties[OPPONENT]).toBeUndefined();

    const before = ext.party[0]!;
    const { state, completion } = finish(rules, started!);
    const persisted = tuxemonExtensionState(completion.ext, DB);
    const after = persisted.party[0]!;
    const finishedMonster = state.battle.parties[0][0]!;
    expect(completion.result).toBe("win");
    expect(finishedMonster.iid).toBe("txmn-player");
    expect(after.currentHp).toBe(finishedMonster.currentHp);
    expect(after.totalExperience!).toBeGreaterThan(before.totalExperience!);
    expect(after.trainingPoints).toEqual(finishedMonster.trainingPoints);
    expect(after.bond).toBe(finishedMonster.bond);
    expect(persisted).toMatchObject({
      history: [
        { fighter: "player", opponent: OPPONENT, outcome: "won" },
        { fighter: OPPONENT, opponent: "player", outcome: "lost" },
      ],
      money: 20,
    });
    expect(completion.writes).toEqual({
      "v.battle_last_result": 3,
      "v.battle_last_trainer": 1,
      [`boc.${OPPONENT}.won`]: 1,
      "v.battle_last_winner": 1,
      "v.battle_last_loser": 2,
    });
    expect(completion.switches).toEqual({
      [`bo.${OPPONENT}.won`]: true,
      [`defeated.${OPPONENT}`]: true,
    });
  });

  test("records a real player defeat without healing or teleporting", () => {
    const ext = extensionWith(monster("budaye", 2, "txmn-player", 17));
    const rules = createTuxemonBattleRules(DB, ENUMS);
    const started = rules.start(json(ext), json({
      kind: "trainer",
      opponent: OPPONENT,
      party: [{ species: "nut", level: 50, experienceModifier: 5, moneyModifier: 10 }],
    }), 202)!;
    const { completion } = finish(rules, started);
    const persisted = tuxemonExtensionState(completion.ext, DB);
    expect(completion.result).toBe("lose");
    expect(persisted.party[0]).toMatchObject({ currentHp: 0, status: "faint" });
    expect(persisted.history).toEqual([
      { fighter: "player", opponent: OPPONENT, outcome: "lost" },
      { fighter: OPPONENT, opponent: "player", outcome: "won" },
    ]);
    expect(completion.writes).toMatchObject({
      "v.battle_last_result": 2,
      "v.battle_last_winner": 2,
      "v.battle_last_loser": 1,
    });
    expect(completion.switches).toEqual({
      [`bo.${OPPONENT}.lost`]: true,
      "defeated.player": true,
    });
    expect(completion.transfer).toBeUndefined();
  });

  test("declines empty, all-fainted, and move-less player parties", () => {
    const rules = createTuxemonBattleRules(DB, ENUMS);
    const setup = json({
      kind: "trainer",
      opponent: OPPONENT,
      party: [{ species: "budaye", level: 5 }],
    });
    expect(rules.start(json(initialTuxemonExtensionState()), setup, 1)).toBeNull();

    const noEnvironment = extensionWith(monster("nut", 5, "txmn-player-env"));
    noEnvironment.environment = null;
    expect(rules.start(json(noEnvironment), setup, 1)).toBeNull();

    const fainted = monster("nut", 5, "txmn-player");
    fainted.currentHp = 0;
    expect(rules.start(json(extensionWith(fainted)), setup, 1)).toBeNull();

    const moveLess = monster("nut", 5, "txmn-player");
    moveLess.moves = [];
    expect(rules.start(json(extensionWith(moveLess)), setup, 1)).toBeNull();
  });

  test("random encounter miss is null; hit preserves probability, row, level, and spawn draw order", () => {
    const rules = createTuxemonBattleRules(DB, ENUMS);
    const ext = extensionWith(monster("nut", 20, "txmn-player"));
    expect(rules.start(json(ext), json({
      kind: "random",
      table: "spyder_route1",
      probability: 0,
    }), 303)).toBeNull();

    const seed = 404;
    const started = rules.start(json(ext), json({
      kind: "random",
      table: "spyder_route1",
      probability: 100,
    }), seed)!;
    const actual = tuxemonRuntimeBattleState(started.state);

    const rng: RngState = { rng: seed, rngDraws: 0 };
    nextRandom(rng); // uniform(0,100) encounter roll
    const rows = DB.encounters.spyder_route1!.monsters;
    const total = rows.reduce((sum, row) => sum + row.weight, 0);
    const target = nextRandom(rng) * total;
    let sum = 0;
    const row = rows.find((candidate) => (sum += candidate.weight) > target)!;
    const chosenLevel = row.level[0] + Math.floor(nextRandom(rng) * (row.level[1] - row.level[0] + 1));
    const enemy = spawnMonster(DB, RULE_DB, rng, row.monster, chosenLevel, {
      experienceModifier: row.experienceModifier,
      moneyModifier: 0,
    });
    expect(rng.rngDraws).toBe(16);
    const expected = createBattle(RULE_DB, {
      seed: rng.rng,
      kind: "wild",
      opponent: `wild:${row.monster}`,
      player: ext.party,
      enemy: [enemy],
      inside: false,
      hour: 12,
      fieldSize: 1,
      moneyMethod: "conserved",
    });
    expect(actual.battle).toEqual(expected);
  });

  test("presentation uses reference ticks and delays completion until the terminal event is shown", () => {
    const rules = createTuxemonBattleRules(DB, ENUMS);
    const ext = extensionWith(monster("nut", 50, "txmn-player", 91));
    const setup = json({
      kind: "trainer",
      opponent: OPPONENT,
      party: [{ species: "budaye", level: 2, experienceModifier: 5, moneyModifier: 10 }],
    });
    const starts = [60, 30, 20, 4].map(() => rules.start(json(ext), setup, 808)!.state);
    const rates = [1, 2, 3, 15];
    const advanced = starts.map((start, index) => {
      let value = start;
      for (let elapsed = 0; elapsed < BATTLE_EVENT_TICKS * 4; elapsed += rates[index]!) {
        value = rules.step(value, { buttons: 0 }, rates[index]!);
      }
      return value;
    });
    expect(advanced.slice(1)).toEqual([advanced[0], advanced[0], advanced[0]]);

    const outcomes = [1, 2, 3, 15].map((ticks) => finish(
      rules,
      rules.start(json(ext), setup, 909)!,
      ticks,
    ));
    const normalized = outcomes.map(({ state, completion }) => ({
      battle: state.battle,
      completion,
    }));
    expect(normalized.slice(1)).toEqual([normalized[0], normalized[0], normalized[0]]);
    const terminal = outcomes[0]!;
    const hidden = {
      ...terminal.state,
      eventCursor: terminal.state.battle.events.length - 1,
      eventTicks: 0,
    };
    expect(rules.done(json(hidden))).toBeNull();
  });
});
