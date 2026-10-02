import { describe, expect, test } from "bun:test";
import { allBattlePaint, battlePaint } from "../ui/battle-paint.ts";

import {
  animationPresentation,
  ballPresentation,
  battleEventDuration,
  battlerPresentation,
  presentationActiveMonster,
  presentationExperience,
  presentationField,
  presentationHp,
  presentationLevel,
  presentationMaxHp,
  trainerPresentation,
} from "../battle/presentation.ts";
import type { RuntimeBattleState } from "../battle/runtime.ts";
import type { BattleEvent } from "../battle/types.ts";
import { faintPose } from "../vendor/pocket-rpgkit/src/ui/battle/effects.ts";

const image = (key: string, width = 64, height = 64) => ({
  key: `ui:img.${key}`,
  width,
  height,
  rect: [0, 0, width, height] as [number, number, number, number],
});

const EVENTS: BattleEvent[] = [
  { type: "sendOut", turn: 1, side: 1, monster: 2 },
  { type: "sendOut", turn: 1, side: 0, monster: 1 },
  {
    type: "technique",
    turn: 1,
    user: 1,
    target: 2,
    technique: "ram",
    hit: true,
    damage: 25,
    hpBefore: { "1": 100, "2": 50 },
    hp: { "1": 100, "2": 25 },
  },
  { type: "faint", turn: 1, monster: 2 },
  { type: "end", turn: 1, outcome: "won" },
];

function state(cursor: number, ticks: number, events: BattleEvent[] = EVENTS): RuntimeBattleState {
  return {
    format: "pocket-tuxemon/battle-runtime/v1",
    startingGold: 0,
    environment: "grass",
    ext: {} as RuntimeBattleState["ext"],
    battle: {
      version: 1,
      kind: "trainer",
      opponent: "trainer",
      policy: "first",
      inside: false,
      hour: 12,
      weather: null,
      fieldSize: 1,
      moneyMethod: "participant_scaled",
      parties: [[{
        uid: 1, slug: "hero", level: 5, gender: "male", base: { hp: 100 }, currentHp: 100,
        totalExperience: 150,
      }], [{
        uid: 2, slug: "foe", level: 4, gender: "female", base: { hp: 50 }, currentHp: 0,
        totalExperience: 64,
      }]],
      field: [1],
      events,
      rewards: [{
        loser: 2,
        winners: [{
          uid: 1,
          experience: 40,
          effectiveExperience: 40,
          levelsGained: 1,
          learnedMoves: [],
          forgottenMoves: [],
          evolutionTarget: null,
          trainingPoints: [],
        }],
        prize: 10,
      }],
    } as unknown as RuntimeBattleState["battle"],
    visuals: {
      environment: {} as RuntimeBattleState["visuals"]["environment"],
      ui: {} as RuntimeBattleState["visuals"]["ui"],
      trainers: { player: image("player"), opponent: image("opponent") },
      monsters: {} as RuntimeBattleState["visuals"]["monsters"],
      techniques: {
        ram: {
          range: "melee",
          types: ["earth"],
          messages: { use: null, success: null, failure: null },
          animation: {
            slug: "ram",
            durationMs: 100,
            flipAxes: "",
            loops: 0,
            pages: [{
              ...image("ram-0", 128, 64),
              firstFrame: 0,
              frames: 2,
              columns: 2,
              frameWidth: 64,
              frameHeight: 64,
              contentWidth: 64,
              contentHeight: 64,
            }],
          },
        },
      },
      items: {},
      statusIcons: {},
    },
    presentationRewards: [{
      eventIndex: 3,
      loser: 2,
      winners: [{
        uid: 1,
        effectiveExperience: 40,
        levelsGained: 1,
        before: { level: 4, totalExperience: 110, maxHp: 96 },
        after: { level: 5, totalExperience: 150, maxHp: 100 },
      }],
    }],
    menu: [],
    menuMode: "root",
    eventCursor: cursor,
    eventTicks: ticks,
    menuIndex: 0,
  } as unknown as RuntimeBattleState;
}

describe("battle presentation projection", () => {
  test("reconstructs field occupancy and trainer/send-out poses at the cursor", () => {
    const entering = state(0, 0);
    expect(presentationField(entering)).toEqual([2]);
    expect(presentationActiveMonster(entering, 1).uid).toBe(2);
    expect(battlerPresentation(entering, 2).opacity).toBe(0);
    expect(trainerPresentation(entering, 1)).toEqual({ offsetX: 150, opacity: 1 });

    entering.eventTicks = 32;
    expect(battlerPresentation(entering, 2).opacity).toBe(1);
    expect(trainerPresentation(entering, 1).opacity).toBe(0.25);

    const fainting = state(3, 34);
    const pose = battlerPresentation(fainting, 2);
    expect(presentationField(fainting)).toEqual([2, 1]);
    expect(faintPose(pose.effect, fainting.eventTicks)).toEqual({ sinkY: 14, opacity: 0 });
    expect(presentationField(state(4, 0))).toEqual([1]);
  });

  test("tweens HP and rewards solely from the serialised reference tick", () => {
    const hit = state(2, 20);
    expect(presentationHp(hit, 2)).toBe(50);
    hit.eventTicks = 30;
    expect(presentationHp(hit, 2)).toBe(37.5);
    hit.eventTicks = 40;
    expect(presentationHp(hit, 2)).toBe(25);
    hit.eventTicks = 30;
    expect(presentationHp(hit, 2)).toBe(37.5);

    expect(presentationExperience(state(2, 0), 1)).toBe(110);
    expect(presentationMaxHp(state(2, 0), 1)).toBe(96);
    expect(presentationLevel(state(3, 36), 1)).toBe(4);
    expect(presentationExperience(state(3, 46), 1)).toBe(130);
    expect(presentationLevel(state(3, 54), 1)).toBe(5);
    expect(presentationMaxHp(state(3, 54), 1)).toBe(100);
    expect(presentationExperience(state(4, 0), 1)).toBe(150);
  });

  test("selects atlas-strip frames and derives duration from imported timing", () => {
    const beat = state(2, 8);
    const first = animationPresentation(beat);
    expect(first.frameKeys).toEqual(["ui:img.ram-0", "ui:img.ram-0"]);
    expect(first.sourceX).toBe(0);
    expect(first.opacity).toBe(1);
    beat.eventTicks = 14;
    expect(animationPresentation(beat).sourceX).toBe(64);
    expect(battleEventDuration(beat, EVENTS[2]!)).toBe(48);
  });

  test("capture flight and shake count come directly from the reducer event", () => {
    const capture: BattleEvent[] = [
      { type: "sendOut", turn: 1, side: 1, monster: 2 },
      { type: "sendOut", turn: 1, side: 0, monster: 1 },
      { type: "capture", turn: 1, user: 1, target: 2, item: "ball", shakes: 3, success: false },
    ];
    const beat = state(2, 18, capture);
    expect(ballPresentation(beat)).toMatchObject({ kind: "capture", x: 352, y: 48, opacity: 1 });
    beat.eventTicks = 21;
    expect(Math.abs(ballPresentation(beat).shake)).toBe(7);
    expect(battleEventDuration(beat, capture[2]!)).toBe(90);
  });
});


test("incremental battle paint matches full projection at every tick and on rewind", () => {
  const base = state(0, 0, [...EVENTS,
    { type: "item", turn: 2, target: 1, before: { hp: 50 }, after: { hp: 75 } },
    { type: "status", turn: 2, target: 1, hp: { "1": 30 } },
    { type: "capture", turn: 2, target: 2, item: "capture", shakes: 3, success: true },
    { type: "swap", turn: 2, user: 1, target: 3 },
  ]);
  base.battle.parties[0].push({ ...base.battle.parties[0][0]!, uid: 3 });
  base.visuals.environment.partyIcons = Object.fromEntries(["icon_empty", "icon_alive", "icon_faint", "icon_status"].map(key => [key, image(key)]));
  let prior: RuntimeBattleState | undefined;
  let paint: ReturnType<typeof battlePaint> | undefined;
  for (let cursor = 0; cursor < base.battle.events.length; cursor++) {
    const duration = battleEventDuration(base, base.battle.events[cursor]!);
    for (const ticks of [...Array.from({ length: duration + 3 }, (_, i) => i), 20, 0, 10, duration]) {
      const next = { ...base, eventCursor: cursor, eventTicks: ticks };
      paint = battlePaint(next, prior, paint);
      expect(paint).toEqual(allBattlePaint(next));
      prior = next;
    }
  }
});
