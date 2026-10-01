import { describe, expect, test } from "bun:test";

import {
  createTuxemonExtensions,
  tuxemonExtensionState,
} from "../battle/extension.ts";
import {
  DAYLIGHT_STAGE_VARIABLE,
  DAYLIGHT_TARGET_VARIABLE,
  DAYLIGHT_TINT_LAYER,
  DAYLIGHT_TINT_PROFILES,
  DAYLIGHT_TWEEN_SECONDS,
} from "../battle/daylight.ts";
import { snapshotFromClock, timeWeatherAt } from "../battle/time-weather.ts";
import { buildProject, G6_IMPORT_OPTIONS } from "../importer/project.ts";
import { AttractController } from "../vendor/pocket-rpgkit/src/engine/attract.ts";
import type { BattleRules } from "../vendor/pocket-rpgkit/src/engine/battle.ts";
import {
  createSession,
  startSession,
  stepSession,
  type SessionState,
} from "../vendor/pocket-rpgkit/src/engine/session.ts";
import type { Command, GameEvent, Project } from "../vendor/pocket-rpgkit/src/engine/types.ts";

const TICK_EVENT = {
  id: "tux_runtime_time_weather",
  name: "Tuxemon time and weather clock",
  x: 0,
  y: 0,
  pages: [{
    trigger: "parallel" as const,
    sprite: null,
    commands: [{ op: "ext" as const, call: "tux.tick_time_weather", args: {} }],
  }],
};

function project(events: GameEvent[] = [TICK_EVENT]): Project {
  return {
    format: "rpgkit-project/v1",
    title: "time weather fixture",
    tileSize: 16,
    start: { map: "clock", x: 1, y: 1, dir: "down" },
    sheets: [{ id: "plain", cols: 1, rows: 1, pak: "chunks", defaultPassage: "pass" }],
    items: [],
    maps: [{
      id: "clock",
      name: "clock",
      width: 4,
      height: 4,
      ground: new Array(16).fill("plain.0"),
      events,
    }],
  };
}

function start(hz: 60 | 30 | 20 | 4, battle: BattleRules | null = null) {
  const source = project();
  const extensions = createTuxemonExtensions({} as never, {
    initialTimeWeather: timeWeatherAt({ year: 2024, month: 6, day: 15, hour: 9, minute: 0 }, 60),
  });
  const session = createSession(source, hz, {
    extensions,
    ...(battle ? { battle } : {}),
  });
  return { source, session, state: startSession(source, session), extensions };
}

const clockOf = (state: SessionState) => tuxemonExtensionState(state.ext).clock;

describe("reference-tick time/weather integration", () => {
  test("the G6 importer appends one combined clock and named daylight event", () => {
    const { project: imported } = buildProject(["spyder_paper_town"], G6_IMPORT_OPTIONS);
    const events = imported.maps[0]!.events ?? [];
    const clocks = events.filter((event) => event.id === TICK_EVENT.id);
    expect(clocks).toHaveLength(1);
    expect(events.filter((event) => event.id === "tux_runtime_daylight")).toHaveLength(0);
    expect(clocks[0]!.pages).toHaveLength(1);
    expect(clocks[0]!.pages[0]!.condition).toBeUndefined();
    const morning = DAYLIGHT_TINT_PROFILES.find((profile) => profile.stage === "morning")!;
    const dispatchProfiles = [morning, ...DAYLIGHT_TINT_PROFILES.filter((profile) => profile !== morning)];
    let expectedDispatch: Command | undefined;
    for (let index = dispatchProfiles.length - 1; index >= 0; index--) {
      const profile = dispatchProfiles[index]!;
      expectedDispatch = {
        op: "if",
        if: {
          kind: "variable",
          id: DAYLIGHT_TARGET_VARIABLE,
          op: "==",
          value: profile.marker,
        },
        then: [
          {
            op: "screenTint",
            layer: DAYLIGHT_TINT_LAYER,
            color: profile.color,
            duration: DAYLIGHT_TWEEN_SECONDS,
            wait: false,
          },
          {
            op: "variable",
            id: DAYLIGHT_STAGE_VARIABLE,
            set: { op: "set", value: profile.marker },
          },
          {
            op: "variable",
            id: DAYLIGHT_TARGET_VARIABLE,
            set: { op: "set", value: 0 },
          },
        ],
        ...(expectedDispatch ? { else: [expectedDispatch] } : {}),
      };
    }
    expect(clocks[0]!.pages[0]!.commands).toEqual([
      { op: "ext", call: "tux.tick_time_weather", args: { daylight: true } },
      {
        op: "if",
        if: {
          kind: "variable",
          id: DAYLIGHT_TARGET_VARIABLE,
          op: "!=",
          value: 0,
        },
        then: [expectedDispatch!],
      },
    ]);
    expect(events.at(-1)!.id).toBe(TICK_EVENT.id);
  });

  test("60/30/20/4 Hz advance the same 120 reference ticks", () => {
    for (const hz of [60, 30, 20, 4] as const) {
      const harness = start(hz);
      let state = harness.state;
      for (let frame = 0; frame < hz * 2; frame++) {
        state = stepSession(harness.session, state, { buttons: 0 });
      }
      expect(clockOf(state).refTick, `${hz} Hz refTick`).toBe(120);
      expect(snapshotFromClock(clockOf(state)), `${hz} Hz civil time`).toMatchObject({
        hour: 9,
        minute: 2,
      });
    }
  });

  test("fade and a frozen battle scene do not advance the clock", () => {
    const inertBattle: BattleRules = {
      start: () => null,
      step: (state) => state,
      done: () => null,
    };
    const harness = start(60, inertBattle);
    let state = stepSession(harness.session, harness.state, { buttons: 0 });
    expect(clockOf(state).refTick).toBe(1);

    state = { ...state, fade: { phase: "out", left: 2, half: 2 } };
    state = stepSession(harness.session, state, { buttons: 0 });
    expect(clockOf(state).refTick).toBe(1);

    state = {
      ...state,
      fade: null,
      scene: { kind: "battle", fiber: "fixture", state: {}, pausedTicks: 0 },
    };
    for (let frame = 0; frame < 3; frame++) {
      state = stepSession(harness.session, state, { buttons: 0 });
    }
    expect(clockOf(state).refTick).toBe(1);
    expect(state.scene?.pausedTicks).toBe(3);
  });

  test("L rewind refolds clock state byte-for-byte", () => {
    const source = project();
    const options = createTuxemonExtensions({} as never, {
      initialTimeWeather: timeWeatherAt({ year: 2024, month: 6, day: 15, hour: 9, minute: 0 }, 60),
    });
    const rewound = new AttractController(source, [], {
      hz: 60,
      attractEnabled: false,
      rewindSeconds: 2 / 60,
      extensions: options,
    });
    const fresh = new AttractController(source, [], {
      hz: 60,
      attractEnabled: false,
      rewindSeconds: 2 / 60,
      extensions: options,
    });
    rewound.startPlay();
    fresh.startPlay();
    for (let frame = 0; frame < 5; frame++) rewound.step(0);
    for (let frame = 0; frame < 3; frame++) fresh.step(0);
    rewound.step(0x0100);
    expect(rewound.length).toBe(3);
    expect(rewound.state).toEqual(fresh.state);
    expect(clockOf(rewound.state).refTick).toBe(3);
  });

  test("Paper Town changes from its real day page to its night-only page", () => {
    const imported = buildProject(["spyder_paper_town"], G6_IMPORT_OPTIONS).project;
    const map = imported.maps[0]!;
    const eventId = (name: string): string => {
      const event = map.events?.find((candidate) => candidate.name === name);
      if (!event) throw new Error(`missing Paper Town event: ${name}`);
      return event.id;
    };
    const dayEnvironment = eventId("Environment Day");
    const nightEnvironment = eventId("Environment Night");
    const nightCycle = eventId("Night Day Cycle Outside");
    const wanted = new Set([
      dayEnvironment,
      nightEnvironment,
      nightCycle,
      TICK_EVENT.id,
    ]);
    const source: Project = {
      ...imported,
      start: { map: map.id, x: 10, y: 10, dir: "down" },
      maps: [{ ...map, events: (map.events ?? []).filter((event) => wanted.has(event.id)) }],
    };
    const extensions = createTuxemonExtensions({} as never, {
      // One reference tick per game minute keeps this real 11-hour map
      // transition compact without bypassing the reducer.
      initialTimeWeather: timeWeatherAt(
        { year: 2024, month: 6, day: 15, hour: 9, minute: 0 },
        1,
      ),
    });
    const session = createSession(source, 60, { extensions });
    let state = startSession(source, session);

    state = stepSession(session, state, { buttons: 0 });
    expect(state.chars.chars[dayEnvironment]).toBeDefined();
    expect(state.chars.chars[nightCycle]).toBeUndefined();
    expect(tuxemonExtensionState(state.ext).environment).toBe("grass");

    for (let tick = 1; tick < 660; tick++) {
      state = stepSession(session, state, { buttons: 0 });
    }
    const nightState = tuxemonExtensionState(state.ext);
    expect(snapshotFromClock(nightState.clock)).toMatchObject({
      hour: 20,
      minute: 0,
      stageOfDay: "night",
    });
    // KV1 keeps the previous page's actor slot and hides it when the selected
    // page changes, so assert effective visibility rather than allocation.
    expect(state.chars.chars[dayEnvironment]?.visible).toBe(false);
    expect(state.chars.chars[nightEnvironment]).toBeDefined();
    expect(state.chars.chars[nightCycle]).toBeDefined();
    expect(state.sw.variables[DAYLIGHT_STAGE_VARIABLE]).toBe(5);
    expect(state.interp.screen?.tints?.[DAYLIGHT_TINT_LAYER]?.to).toEqual(
      DAYLIGHT_TINT_PROFILES.find((profile) => profile.stage === "night")!.color,
    );

    const tweenLeft = state.interp.screen!.tints![DAYLIGHT_TINT_LAYER]!.left;
    expect(tweenLeft).toBe(DAYLIGHT_TWEEN_SECONDS * 60);
    state = stepSession(session, state, { buttons: 0 });
    expect(state.interp.screen!.tints![DAYLIGHT_TINT_LAYER]!.left).toBe(tweenLeft - 1);
    // Newly selected parallel pages run on the following reference tick.
    expect(tuxemonExtensionState(state.ext).environment).toBe("night_grass");
  });
});
