import { describe, expect, test } from "bun:test";
import {
  advanceBattle,
  enqueueAction,
  nextRandom,
  randomIntInclusive,
  type BattleCoreRules,
  type BattleCoreState,
} from "../battle/core.ts";

describe("battle deterministic core", () => {
  test("mulberry32 matches the interpreter cursor", () => {
    const state = { rng: 1, rngDraws: 0 };
    expect([nextRandom(state), nextRandom(state), nextRandom(state)]).toEqual([
      0.6270739405881613,
      0.002735721180215478,
      0.5274470399599522,
    ]);
    expect(state).toEqual({ rng: 1199730144, rngDraws: 3 });
    expect(randomIntInclusive(state, 3, 8)).toBe(8);
  });

  test("stable queue ties pop in reverse insertion order", () => {
    interface Mon { uid: number; side: 0 | 1; hp: number }
    interface State extends BattleCoreState<Mon> { performed: string[] }
    const state: State = {
      rng: 7, rngDraws: 0, turn: 1, phase: "action",
      parties: [[{ uid: 1, side: 0, hp: 10 }], [{ uid: 2, side: 1, hp: 10 }]],
      field: [2, 1], queue: [], pending: [], hitRolls: {}, decisionQueue: [],
      awaiting: null, outcome: null, events: [], performed: [],
    };
    enqueueAction(state, { kind: "status", user: null, target: 2, ref: "first" });
    enqueueAction(state, { kind: "status", user: null, target: 1, ref: "second" });
    const rules: BattleCoreRules<Mon, State> = {
      uid: (m) => m.uid,
      side: (_s, uid) => uid === 1 ? 0 : 1,
      monster: (s, uid) => [...s.parties[0], ...s.parties[1]].find((m) => m.uid === uid)!,
      fainted: (m) => m.hp <= 0,
      fillPositions() {}, onDecisionStart() {}, skipsDecision: () => false,
      decideAi: () => ({ kind: "technique", user: 2, target: 1, ref: "x" }),
      playerAction: () => ({ kind: "technique", user: 1, target: 2, ref: "x" }),
      sortKey: () => [0, 0, 0],
      perform: (s, action) => { s.performed.push(action.ref); },
      checkParty() {}, queuePostActions() {}, finish() {},
    };
    advanceBattle(state, rules);
    expect(state.performed).toEqual(["second", "first"]);
    expect(state.phase).toBe("decision");
  });

  test("ends before actions when a decision hook faints the last monster", () => {
    interface Mon { uid: number; side: 0 | 1; hp: number }
    interface State extends BattleCoreState<Mon> { performed: string[]; finished: number }
    const state: State = {
      rng: 7, rngDraws: 0, turn: 4, phase: "action",
      parties: [[{ uid: 1, side: 0, hp: 0 }], [{ uid: 2, side: 1, hp: 10 }]],
      field: [2, 1],
      queue: [
        { kind: "technique", user: 2, target: 1, ref: "enemy", subPriority: 0 },
        { kind: "technique", user: 1, target: 2, ref: "player", subPriority: 1 },
      ],
      pending: [], hitRolls: {}, decisionQueue: [], awaiting: null,
      outcome: null, events: [], performed: [], finished: 0,
    };
    const rules: BattleCoreRules<Mon, State> = {
      uid: (m) => m.uid,
      side: (_s, uid) => uid === 1 ? 0 : 1,
      monster: (s, uid) => [...s.parties[0], ...s.parties[1]].find((m) => m.uid === uid)!,
      fainted: (m) => m.hp <= 0,
      fillPositions() {}, onDecisionStart() {}, skipsDecision: () => false,
      decideAi: () => ({ kind: "technique", user: 2, target: 1, ref: "enemy" }),
      playerAction: () => ({ kind: "technique", user: 1, target: 2, ref: "player" }),
      sortKey: () => [0, 0, 0],
      perform: (s, action) => { s.performed.push(action.ref); },
      checkParty() {}, queuePostActions() {}, finish: (s) => { s.finished++; },
    };

    advanceBattle(state, rules);

    expect(state.phase).toBe("ended");
    expect(state.outcome).toBe("lost");
    expect(state.performed).toEqual([]);
    expect(state.finished).toBe(1);
    expect(state.events).toEqual([{ type: "end", turn: 4, outcome: "lost" }]);
  });
});
