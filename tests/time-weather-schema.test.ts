import { describe, expect, test } from "bun:test";
import {
  clockProblem,
  decodeTimeWeather,
  encodeTimeWeather,
  initialTimeWeatherState,
  loadWeatherTable,
  P1_FIXED_DAYTIME,
  P1_FIXED_STAGE_OF_DAY,
  timeIsArgs,
  TIME_WEATHER_SAVE_FORMAT,
  timeWeatherProblem,
  updateTimeArgs,
  weatherProblem,
  weatherSlugs,
} from "../importer/time-weather.ts";
import { parseAction, parseCondition } from "../importer/source.ts";

describe("time-weather schema codec", () => {
  test("round-trips the initial state through encode/decode", () => {
    const state = initialTimeWeatherState();
    const decoded = decodeTimeWeather(encodeTimeWeather(state), weatherSlugs());
    expect(decoded).toEqual(state);
  });

  test("round-trips an arbitrary valid state", () => {
    const state = {
      clock: {
        mode: "game" as const,
        refTick: 123_456,
        epochDay: 42,
        minuteOfDay: 23 * 60 + 59,
        subMinuteTicks: 3_599,
        ticksPerGameMinute: 3_600,
      },
      weather: {
        slug: "rain",
        enteredAtTick: 1_000,
        nextTransitionTick: 125_000,
        rngCursor: 0xdead_beef,
      },
    };
    const decoded = decodeTimeWeather(encodeTimeWeather(state), weatherSlugs());
    expect(decoded).toEqual(state);
  });

  test("encodes the save format wrapper", () => {
    const encoded = encodeTimeWeather(initialTimeWeatherState()) as Record<string, unknown>;
    expect(encoded.format).toBe(TIME_WEATHER_SAVE_FORMAT);
    expect(encoded.clock).toBeTypeOf("object");
    expect(encoded.weather).toBeTypeOf("object");
  });

  test("accepts a bare {clock, weather} snapshot without the wrapper", () => {
    const state = initialTimeWeatherState();
    const bare = { clock: state.clock, weather: state.weather };
    expect(decodeTimeWeather(bare as never, weatherSlugs())).toEqual(state);
  });

  test("rejects an explicit format that is not the v1 marker", () => {
    // R1: a present `format` field must be the v1 string. Wrong versions,
    // unrelated ids, empty string, null and numbers are all rejected
    // instead of being silently treated as a bare snapshot.
    const wrapped = encodeTimeWeather(initialTimeWeatherState()) as Record<string, unknown>;
    const invalidFormats: { format: unknown; label: string }[] = [
      { format: "pocket-tuxemon/time-weather/v2", label: "wrong version" },
      { format: "unrelated-format", label: "unrelated id" },
      { format: "", label: "empty string" },
      { format: null, label: "null" },
      { format: 7, label: "number" },
    ];
    for (const { format, label } of invalidFormats) {
      const probe = { ...wrapped, format };
      expect(() => decodeTimeWeather(probe as never, weatherSlugs()))
        .toThrow(/unsupported format/);
      try {
        decodeTimeWeather(probe as never, weatherSlugs());
        throw new Error(`decoder accepted ${label}`);
      } catch (error) {
        expect(String(error)).toContain(TIME_WEATHER_SAVE_FORMAT);
        expect(String(error)).toContain(JSON.stringify(format));
      }
    }
  });

  test("rejects a present-but-undefined format marker", () => {
    // `{format: undefined}` still has the field; it must not fall through
    // to the bare-snapshot branch.
    const state = initialTimeWeatherState();
    const probe = { format: undefined, clock: state.clock, weather: state.weather };
    expect(() => decodeTimeWeather(probe as never, weatherSlugs()))
      .toThrow(/unsupported format/);
  });

  test("the P1 fixed fold matches morning/daytime", () => {
    // The D1 placeholder handlers fold against these constants; they must
    // match the importer's historical fold so tapes keep their behavior.
    expect(P1_FIXED_STAGE_OF_DAY).toBe("morning");
    expect(P1_FIXED_DAYTIME).toBe("true");
    const state = initialTimeWeatherState();
    expect(Math.floor(state.clock.minuteOfDay / 60)).toBe(9);
  });
});

describe("time-weather validation", () => {
  const valid = () => initialTimeWeatherState();

  test("rejects a non-object", () => {
    expect(timeWeatherProblem(null)).toBe("time-weather state must be an object");
    expect(timeWeatherProblem("x")).toBe("time-weather state must be an object");
  });

  test("rejects an unknown clock mode", () => {
    const clock = { ...valid().clock, mode: "wall" as unknown as "game" };
    expect(clockProblem(clock)).toBe('clock.mode must be "game"');
  });

  test("rejects out-of-range minuteOfDay", () => {
    const state = valid();
    expect(clockProblem({ ...state.clock, minuteOfDay: -1 })).toContain("minuteOfDay");
    expect(clockProblem({ ...state.clock, minuteOfDay: 1_440 })).toContain("minuteOfDay");
  });

  test("rejects subMinuteTicks outside [0, ticksPerGameMinute)", () => {
    const state = valid();
    expect(clockProblem({ ...state.clock, subMinuteTicks: 3_600 })).toContain("subMinuteTicks");
    expect(clockProblem({ ...state.clock, subMinuteTicks: -1 })).toContain("subMinuteTicks");
  });

  test("rejects a non-positive ticksPerGameMinute", () => {
    const state = valid();
    expect(clockProblem({ ...state.clock, ticksPerGameMinute: 0 })).toContain("ticksPerGameMinute");
  });

  test("rejects negative ticks and days", () => {
    const state = valid();
    expect(clockProblem({ ...state.clock, refTick: -1 })).toContain("refTick");
    expect(clockProblem({ ...state.clock, epochDay: -1 })).toContain("epochDay");
  });

  test("rejects an unknown weather slug when a table is supplied", () => {
    const state = valid();
    expect(weatherProblem({ ...state.weather, slug: "hail" }, "weather", weatherSlugs()))
      .toContain("hail");
    expect(weatherProblem({ ...state.weather, slug: "rain" }, "weather", weatherSlugs()))
      .toBeNull();
  });

  test("rejects nextTransitionTick before enteredAtTick", () => {
    const state = valid();
    expect(weatherProblem({
      ...state.weather,
      enteredAtTick: 100,
      nextTransitionTick: 50,
    })).toContain("nextTransitionTick");
  });

  test("rejects an out-of-range rngCursor", () => {
    const state = valid();
    expect(weatherProblem({ ...state.weather, rngCursor: -1 })).toContain("rngCursor");
    expect(weatherProblem({ ...state.weather, rngCursor: 0x1_0000_0000 })).toContain("rngCursor");
  });

  test("decode throws on the first problem", () => {
    const bad = { ...valid(), clock: { ...valid().clock, minuteOfDay: 9_999 } };
    expect(() => decodeTimeWeather(bad as never)).toThrow("minuteOfDay");
  });

  test("timeWeatherProblem propagates a weather error when the clock is valid", () => {
    // Pins the weather leg of the combined check: a mutation that swallows
    // weather problems (returning only the clock result) must go red.
    const state = valid();
    expect(timeWeatherProblem({
      clock: state.clock,
      weather: { ...state.weather, slug: "hail" },
    }, weatherSlugs())).toContain("hail");
    expect(timeWeatherProblem({
      clock: state.clock,
      weather: { ...state.weather, enteredAtTick: 100, nextTransitionTick: 50 },
    })).toContain("nextTransitionTick");
  });

  test("rejects a stale or future-entered weather stream relative to the clock", () => {
    const state = valid();
    expect(timeWeatherProblem({
      clock: { ...state.clock, refTick: Number.MAX_SAFE_INTEGER },
      weather: { ...state.weather, enteredAtTick: 0, nextTransitionTick: 1 },
    })).toContain("must be > clock.refTick");
    expect(timeWeatherProblem({
      clock: state.clock,
      weather: { ...state.weather, enteredAtTick: 1 },
    })).toContain("must be <= clock.refTick");
  });

  test("decode throws the weather problem when only the weather is bad", () => {
    const state = valid();
    expect(() => decodeTimeWeather({
      clock: state.clock,
      weather: { ...state.weather, slug: "hail" },
    } as never, weatherSlugs())).toThrow("hail");
  });

  test("timeWeatherProblem reports the clock problem before the weather problem", () => {
    // The "first problem" ordering contract: clock is checked first.
    const state = valid();
    const both = {
      clock: { ...state.clock, minuteOfDay: 9_999 },
      weather: { ...state.weather, slug: "hail" },
    };
    expect(timeWeatherProblem(both, weatherSlugs())).toContain("minuteOfDay");
    expect(timeWeatherProblem(both, weatherSlugs())).not.toContain("hail");
  });
});

describe("weather table", () => {
  test("exports the 10 upstream weathers deterministically", () => {
    const table = loadWeatherTable();
    expect(table.map((entry) => entry.slug)).toEqual([
      "cloudy", "foggy", "freezing", "hot", "misty",
      "rain", "snow", "sunny", "thunderstorm", "windy",
    ]);
    // S5 §5.1: every entry has empty modifiers in this mod.
    expect(table.every((entry) => entry.modifiers.length === 0)).toBe(true);
  });

  test("is stable across reads (cached, byte-identical)", () => {
    expect(loadWeatherTable()).toBe(loadWeatherTable());
    expect(JSON.stringify(loadWeatherTable())).toBe(JSON.stringify(loadWeatherTable()));
  });

  test("every slug validates against the table", () => {
    const slugs = weatherSlugs();
    for (const entry of loadWeatherTable()) {
      expect(slugs.has(entry.slug)).toBe(true);
    }
  });
});

describe("import mapping shapes", () => {
  test("time_is carries property/operation/value and the is/not negate flag", () => {
    const night = parseCondition("is time_is stage_of_day,equals,night");
    expect(timeIsArgs(night)).toEqual({
      property: "stage_of_day",
      operation: "equals",
      value: "night",
      negate: false,
    });
    const notNight = parseCondition("not time_is stage_of_day,equals,night");
    expect(timeIsArgs(notNight).negate).toBe(true);
    const date = parseCondition("is time_is date,equals,4-30");
    expect(timeIsArgs(date)).toEqual({
      property: "date",
      operation: "equals",
      value: "4-30",
      negate: false,
    });
  });

  test("update_time defaults to player", () => {
    expect(updateTimeArgs(parseAction("update_time player"))).toEqual({ character: "player" });
    expect(updateTimeArgs(parseAction("update_time"))).toEqual({ character: "player" });
  });
});
