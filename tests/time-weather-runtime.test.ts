import { describe, expect, test } from "bun:test";

import {
  advanceTimeWeather,
  civilFromEpochDay,
  epochDayFromCivil,
  initialTimeWeatherState,
  isLeapYear,
  snapshotFromClock,
  timeIs,
  timeWeatherAt,
  updateTimeWrites,
} from "../battle/time-weather.ts";

const at = (year: number, month: number, day: number, hour: number, minute = 0) =>
  timeWeatherAt({ year, month, day, hour, minute }, 60);

describe("deterministic Tuxemon calendar", () => {
  test("uses a fixed non-holiday 09:00 default for tests, journeys, and legacy saves", () => {
    const snapshot = snapshotFromClock(initialTimeWeatherState().clock);
    expect(snapshot).toMatchObject({
      year: 2024,
      month: 6,
      day: 15,
      hour: 9,
      minute: 0,
      weekday: "saturday",
      daytime: "true",
      stageOfDay: "morning",
    });
  });

  test("round-trips Gregorian epoch days across leap and century boundaries", () => {
    for (const civil of [
      [1970, 1, 1],
      [1999, 12, 31],
      [2000, 2, 29],
      [2024, 6, 15],
      [2100, 3, 1],
      [9999, 12, 31],
    ] as const) {
      expect(civilFromEpochDay(epochDayFromCivil(civil[0], civil[1], civil[2]))).toEqual({
        year: civil[0], month: civil[1], day: civil[2],
      });
    }
    expect([1900, 2000, 2024, 2100].map(isLeapYear)).toEqual([false, true, true, false]);
  });

  test("matches upstream daytime and five stage boundaries", () => {
    const rows = [
      [3, "false", "night"],
      [4, "false", "dawn"],
      [5, "false", "dawn"],
      [6, "true", "dawn"],
      [7, "true", "dawn"],
      [8, "true", "morning"],
      [11, "true", "morning"],
      [12, "true", "afternoon"],
      [15, "true", "afternoon"],
      [16, "true", "dusk"],
      [17, "true", "dusk"],
      [18, "false", "dusk"],
      [19, "false", "dusk"],
      [20, "false", "night"],
      [23, "false", "night"],
    ] as const;
    for (const [hour, daytime, stageOfDay] of rows) {
      expect(snapshotFromClock(at(2024, 6, 15, hour).clock)).toMatchObject({ daytime, stageOfDay });
    }
  });

  test("matches upstream day-of-year season boundaries in both hemispheres", () => {
    const rows = [
      [80, "winter", "summer"],
      [81, "spring", "autumn"],
      [172, "spring", "autumn"],
      [173, "summer", "winter"],
      [264, "summer", "winter"],
      [265, "autumn", "spring"],
      [355, "autumn", "spring"],
      [356, "winter", "summer"],
    ] as const;
    const jan1 = epochDayFromCivil(2023, 1, 1);
    for (const [dayOfYear, north, south] of rows) {
      const state = at(2023, 1, 1, 9);
      state.clock.epochDay = jan1 + dayOfYear - 1;
      expect(snapshotFromClock(state.clock, "northern").season).toBe(north);
      expect(snapshotFromClock(state.clock, "southern").season).toBe(south);
    }
  });
});

describe("time_is and update_time parity", () => {
  const state = at(2024, 4, 30, 18, 42);

  test("uses numeric comparisons for hour/day/year/month/day", () => {
    expect(timeIs(state.clock, "hour", "greater_than", "17")).toBeTrue();
    expect(timeIs(state.clock, "hour", ">=", "18")).toBeTrue();
    expect(timeIs(state.clock, "month", "<", "5")).toBeTrue();
    expect(timeIs(state.clock, "day", "not_equals", "29")).toBeTrue();
    expect(timeIs(state.clock, "year", "==", "2.024e3")).toBeTrue();
    expect(timeIs(state.clock, "hour", "equals", "not-a-number")).toBeFalse();
    expect(timeIs(state.clock, "hour", "equals", "0x12")).toBeFalse();
    expect(timeIs(state.clock, "hour", "not_equals", "nan")).toBeTrue();
  });

  test("uses exact equals/not-equals for string properties", () => {
    expect(timeIs(state.clock, "weekday", "equals", "tuesday")).toBeTrue();
    expect(timeIs(state.clock, "leap_year", "==", "true")).toBeTrue();
    expect(timeIs(state.clock, "daytime", "equals", "false")).toBeTrue();
    expect(timeIs(state.clock, "stage_of_day", "!=", "night")).toBeTrue();
    expect(timeIs(state.clock, "season", "equals", "spring")).toBeTrue();
    expect(timeIs(state.clock, "season", "equals", "Spring")).toBeFalse();
    expect(timeIs(state.clock, "season", "greater_than", "autumn")).toBeFalse();
    expect(timeIs(state.clock, "unknown", "equals", "anything")).toBeFalse();
  });

  test("compares date as an upstream month/day tuple", () => {
    expect(timeIs(state.clock, "date", "equals", "4-30")).toBeTrue();
    expect(timeIs(state.clock, "date", "==", "04-30")).toBeTrue();
    expect(timeIs(state.clock, "date", "less_than", "5-1")).toBeTrue();
    expect(timeIs(state.clock, "date", ">", "2-30")).toBeTrue();
    expect(timeIs(state.clock, "date", ">", "3-100")).toBeTrue();
    expect(timeIs(state.clock, "date", "equals", "4/30")).toBeFalse();
  });

  test("throws for an unknown numeric/date operator like the upstream helper", () => {
    expect(() => timeIs(state.clock, "hour", "approximately", "18")).toThrow("unknown operation");
    expect(() => timeIs(state.clock, "date", "approximately", "4-30")).toThrow("unknown operation");
  });

  test("writes exactly the eight upstream string variables", () => {
    expect(updateTimeWrites(state.clock)).toEqual({
      "v.hour": "18",
      "v.day_of_year": "121",
      "v.year": "2024",
      "v.weekday": "tuesday",
      "v.leap_year": "true",
      "v.daytime": "false",
      "v.stage_of_day": "dusk",
      "v.season": "spring",
    });
  });
});

describe("reference-tick clock and independent weather deadline", () => {
  test("carries sub-minutes through midnight and leap day", () => {
    const state = at(2024, 2, 28, 23, 59);
    state.clock.subMinuteTicks = 59;
    const next = advanceTimeWeather(state, 1);
    expect(snapshotFromClock(next.clock)).toMatchObject({
      year: 2024, month: 2, day: 29, hour: 0, minute: 0,
    });
    expect(next.clock).toMatchObject({ refTick: 1, subMinuteTicks: 0 });
  });

  test("one batch and individual reference ticks produce identical state", () => {
    const start = at(2024, 12, 31, 23, 58);
    start.weather.nextTransitionTick = 2;
    const schedule = { slugs: ["sunny", "rain", "snow"], minDurationMinutes: 2, maxDurationMinutes: 2 };
    const batched = advanceTimeWeather(start, 361, schedule);
    let folded = start;
    for (let tick = 0; tick < 361; tick++) folded = advanceTimeWeather(folded, 1, schedule);
    expect(folded).toEqual(batched);
    expect(snapshotFromClock(batched.clock)).toMatchObject({
      year: 2025, month: 1, day: 1, hour: 0, minute: 4,
    });
  });

  test("changes weather only at saved deadlines with its own saved cursor", () => {
    const state = at(2024, 6, 15, 9);
    state.weather = { slug: "sunny", enteredAtTick: 0, nextTransitionTick: 3, rngCursor: 7 };
    const schedule = { slugs: ["sunny", "rain", "snow"], minDurationMinutes: 2, maxDurationMinutes: 2 };
    const before = advanceTimeWeather(state, 2, schedule);
    expect(before.weather).toEqual(state.weather);
    const due = advanceTimeWeather(before, 1, schedule);
    expect(due.weather.slug).not.toBe("sunny");
    expect(schedule.slugs).toContain(due.weather.slug);
    expect(due.weather).toMatchObject({ enteredAtTick: 3, nextTransitionTick: 123 });
    expect(due.weather.rngCursor).not.toBe(7);
  });
});
