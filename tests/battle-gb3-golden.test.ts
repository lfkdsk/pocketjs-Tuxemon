import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

interface RuleRng {
  cursor: number;
  draws: number;
}

interface CaptureGoldenCase {
  id: string;
  seed: number;
  item: string;
  context: { status: string | null };
  expected: {
    success: boolean;
    shakes: number;
    rng: RuleRng;
    error: string | null;
    itemQuantity: number;
  };
}

interface ItemGoldenCase {
  id: string;
  item: string;
  effects: string[];
  expected: {
    valid: boolean;
    success: boolean;
    itemQuantity: number;
    rng: RuleRng;
  };
}

interface RunGoldenCase {
  id: string;
  status: string | null;
  attempts: number;
  expected: {
    valid: boolean;
    success: boolean;
    runAttempts: number;
    battleLastResult: string | null;
    rng: RuleRng;
  };
}

interface Gb3Golden {
  header: {
    version: number;
    source: string;
    captureDevices: number;
    combatItems: number;
    ordinaryItems: number;
    captureCases: number;
    itemCases: number;
    runCases: number;
    captureSeeds: number[];
    runSeeds: number[];
    exemptions: string[];
  };
  captures: CaptureGoldenCase[];
  items: ItemGoldenCase[];
  runs: RunGoldenCase[];
}

const ROOT = join(import.meta.dir, "..");
const GOLDEN = JSON.parse(
  gunzipSync(readFileSync(join(ROOT, "tests/goldens/gb3-rules.json.gz"))).toString("utf8"),
) as Gb3Golden;

describe("Tuxemon GB3 rule oracle", () => {
  test("covers every combat item, capture device, and escape boundary", () => {
    expect(GOLDEN.header).toEqual({
      version: 1,
      source: "Tuxemon 9e6258ff",
      captureDevices: 27,
      combatItems: 52,
      ordinaryItems: 25,
      captureCases: 216,
      itemCases: 25,
      runCases: 88,
      captureSeeds: [1, 7, 0x12345678, 0xffffffff],
      runSeeds: [1, 2, 3, 5, 8, 13, 0x12345678, 0xffffffff],
      exemptions: [
        "captured battles still run normal post-battle cleanup in Pocket Tuxemon",
      ],
    });
    expect(GOLDEN.captures).toHaveLength(GOLDEN.header.captureCases);
    expect(GOLDEN.items).toHaveLength(GOLDEN.header.itemCases);
    expect(GOLDEN.runs).toHaveLength(GOLDEN.header.runCases);
    expect(new Set(GOLDEN.captures.map(({ item }) => item)).size).toBe(27);
    expect(new Set(GOLDEN.items.map(({ item }) => item)).size).toBe(25);
  });

  test("contains successes, failures, status modifiers, and exact capture RNG use", () => {
    expect(GOLDEN.captures.some(({ expected }) => expected.success)).toBe(true);
    expect(GOLDEN.captures.some(({ expected }) => !expected.success)).toBe(true);
    expect(GOLDEN.captures.some(({ context }) => context.status === "grabbed")).toBe(true);
    for (const entry of GOLDEN.captures) {
      expect(entry.expected.shakes).toBeGreaterThanOrEqual(1);
      expect(entry.expected.shakes).toBeLessThanOrEqual(4);
      // One resistance draw, optionally one gambler draw, then one per shake.
      expect(entry.expected.rng.draws).toBeGreaterThanOrEqual(entry.expected.shakes + 1);
      expect(entry.expected.rng.draws).toBeLessThanOrEqual(entry.expected.shakes + 2);
    }
  });

  test("records upstream item consumption and known capture-device quirks", () => {
    expect(GOLDEN.items.every(({ expected }) => expected.valid && expected.success)).toBe(true);
    expect(GOLDEN.items.every(({ expected }) => expected.itemQuantity === 0)).toBe(true);
    expect(GOLDEN.items.every(({ expected }) => expected.rng.draws === 0)).toBe(true);
    expect(new Set(GOLDEN.items.flatMap(({ effects }) => effects))).toEqual(
      new Set(["heal", "restore", "statchange", "switch_type"]),
    );

    const hardenedFailures = GOLDEN.captures.filter(
      ({ item, expected }) => item === "tuxeball_hardened" && !expected.success,
    );
    expect(hardenedFailures.length).toBeGreaterThan(0);
    expect(hardenedFailures.every(({ expected }) => expected.itemQuantity === 1)).toBe(true);

    const candyErrors = GOLDEN.captures.filter(({ expected }) => expected.error !== null);
    expect(candyErrors.map(({ item }) => item)).toEqual(Array(candyErrors.length).fill("tuxeball_candy"));
    expect(candyErrors.every(({ expected }) => expected.error?.startsWith("AttributeError:"))).toBe(true);
  });

  test("records persistent attempts and blocked run attempts without consuming RNG", () => {
    const blocked = GOLDEN.runs.filter(({ expected }) => !expected.valid);
    expect(blocked).toHaveLength(16);
    expect(blocked.every(({ status }) => status === "grabbed" || status === "stuck")).toBe(true);
    expect(blocked.every(({ attempts, expected }) =>
      expected.rng.draws === 0 && expected.runAttempts === attempts
    )).toBe(true);

    const attempted = GOLDEN.runs.filter(({ expected }) => expected.valid);
    expect(attempted.some(({ expected }) => expected.success)).toBe(true);
    expect(attempted.some(({ expected }) => !expected.success)).toBe(true);
    expect(attempted.every(({ expected }) => expected.rng.draws === 1)).toBe(true);
    expect(attempted.every(({ expected }) =>
      expected.success === (expected.battleLastResult === "run")
    )).toBe(true);
  });
});
