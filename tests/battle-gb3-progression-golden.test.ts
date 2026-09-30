import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

interface MonsterResult {
  slug: string;
  level: number;
  stage: string;
  gender: string;
  tasteCold: string;
  tasteWarm: string;
  height: number;
  weight: number;
  birthdate: [number, number];
  individualValues: Record<string, number>;
  totalExperience: number;
  experienceModifier: number;
  moneyModifier: number;
  acquisition: string;
  captureDevice: string;
  currentHp: number;
  base: Record<string, number>;
  moves: string[];
  types: string[];
  status: string | null;
  waitingToEvolve: boolean;
  bond: number;
  trainingPoints: Record<string, number>;
}

interface ProgressionGolden {
  header: {
    version: number;
    source: string;
    defaultForgetIndex: number;
    acquisitions: string[];
    rewardCases: number;
    progressionCases: number;
    evolutionRows: number;
    appliedEvolutionCases: number;
    evolutionSources: number;
    rootMonsters: number;
    evolutionClosureMonsters: number;
    evolutionConditionCounts: Record<string, number>;
    exemptions: string[];
  };
  rewards: Array<{
    id: string;
    input: {
      loser: MonsterResult;
      winnerAcquisition: string;
      winnerExperienceModifier: number;
      participants: number;
    };
    before: MonsterResult;
    expected: {
      awardedExperience: number;
      levelsGained: number;
      learnedMoves: string[];
      after: MonsterResult;
      rng: { cursor: number; draws: number };
    };
  }>;
  progression: Array<{
    id: string;
    before: MonsterResult;
    expected: {
      levelsGained: number;
      learnedMoves: string[];
      forgottenMoves: string[];
      afterGain: MonsterResult;
      afterChoice: MonsterResult;
      evolutionTarget: string | null;
      rng: { cursor: number; draws: number };
    };
  }>;
  evolutions: Array<{
    id: string;
    slug: string;
    row: Record<string, unknown>;
    expected: { satisfied: boolean; unsatisfied: boolean; rng: { cursor: number; draws: number } };
  }>;
  appliedEvolutions: Array<{
    id: string;
    input: { slug: string; target: string; level: number; seed: number };
    before: MonsterResult;
    expected: {
      spawned: MonsterResult;
      transferred: MonsterResult;
      after: MonsterResult;
      afterReload: MonsterResult;
      sameIdentity: boolean;
      caught: string[];
      rng: { cursor: number; draws: number };
    };
  }>;
}

const ROOT = join(import.meta.dir, "..");
const GOLDEN = JSON.parse(
  gunzipSync(readFileSync(join(ROOT, "tests/goldens/gb3-progression.json.gz"))).toString("utf8"),
) as ProgressionGolden;

describe("Tuxemon GB3 progression oracle", () => {
  test("covers reward multipliers and every imported evolution condition", () => {
    expect(GOLDEN.header).toEqual({
      version: 2,
      source: "Tuxemon 9e6258ff",
      defaultForgetIndex: 0,
      acquisitions: ["unknown", "captured", "traded", "bred", "gifted", "purchased", "rescued", "created"],
      rewardCases: 33,
      progressionCases: 18,
      evolutionRows: 122,
      appliedEvolutionCases: 2,
      evolutionSources: 93,
      rootMonsters: 257,
      evolutionClosureMonsters: 257,
      evolutionConditionCounts: {
        at_level: 93,
        bond: 2,
        element: 1,
        gender: 2,
        inside: 1,
        item: 24,
        party_conditions: 1,
        stats: 3,
        tech: 1,
        variables: 4,
      },
      exemptions: [],
    });
    expect(GOLDEN.rewards).toHaveLength(GOLDEN.header.rewardCases);
    expect(GOLDEN.progression).toHaveLength(GOLDEN.header.progressionCases);
    expect(GOLDEN.evolutions).toHaveLength(GOLDEN.header.evolutionRows);
    expect(GOLDEN.appliedEvolutions).toHaveLength(GOLDEN.header.appliedEvolutionCases);
    expect(new Set(GOLDEN.evolutions.map(({ slug }) => slug)).size).toBe(GOLDEN.header.evolutionSources);
    expect(GOLDEN.evolutions.every(({ expected }) => expected.satisfied && !expected.unsatisfied)).toBe(true);
  });

  test("pins L-cubed boundaries, uncapped max-level XP, and zero progression RNG", () => {
    const cases = Object.fromEntries(GOLDEN.progression.map((entry) => [entry.id, entry]));
    expect(cases["boundary:below"]!.expected.afterGain.totalExperience).toBe(999);
    expect(cases["boundary:below"]!.expected.levelsGained).toBe(0);
    expect(cases["boundary:exact-fifth-move"]!.expected.afterGain.totalExperience).toBe(1000);
    expect(cases["boundary:exact-fifth-move"]!.expected.afterGain.level).toBe(10);
    expect(cases["boundary:multi-level-multi-move"]!.expected.afterGain.totalExperience).toBe(2197);
    expect(cases["boundary:multi-level-multi-move"]!.expected.afterGain.level).toBe(13);
    expect(cases["max-level:uncapped-total"]!.expected.afterGain.totalExperience).toBe(1_001_234);
    expect(cases["max-level:uncapped-total"]!.expected.afterGain.level).toBe(100);
    expect(GOLDEN.progression.every(({ expected }) => expected.rng.draws === 0)).toBe(true);
  });

  test("records stat/HP growth, every crossed move, and the deterministic forget choice", () => {
    const exact = GOLDEN.progression.find(({ id }) => id === "boundary:exact-fifth-move")!;
    expect(exact.expected.learnedMoves).toEqual(["muddle"]);
    expect(exact.expected.afterGain.moves).toEqual([
      "bullet", "static_field", "shuriken", "clamp_on", "muddle",
    ]);
    expect(exact.expected.forgottenMoves).toEqual(["bullet"]);
    expect(exact.expected.afterChoice.moves).toEqual([
      "static_field", "shuriken", "clamp_on", "muddle",
    ]);
    expect(exact.expected.afterGain.base.hp).toBeGreaterThan(exact.before.base.hp);
    expect(exact.expected.afterGain.currentHp - exact.before.currentHp)
      .toBe(exact.expected.afterGain.base.hp - exact.before.base.hp);

    const multi = GOLDEN.progression.find(({ id }) => id === "boundary:multi-level-multi-move")!;
    expect(multi.expected.learnedMoves).toEqual(["muddle", "bubble_trap"]);
    expect(multi.expected.forgottenMoves).toEqual(["bullet", "static_field"]);
    expect(multi.expected.afterChoice.moves).toHaveLength(4);
  });

  test("pins acquisition rounding, participant split, and post-level evolution priority", () => {
    const reward = GOLDEN.rewards.find(({ id }) => id === "reward:traded:1:5:L8")!;
    expect(reward.expected.awardedExperience).toBe(188);
    const split = GOLDEN.rewards.find(({ id }) => id === "reward:traded:2:5:L8")!;
    expect(split.expected.awardedExperience).toBe(94);
    const max = GOLDEN.rewards.find(({ id }) => id.endsWith(":L100"))!;
    expect(max.expected.awardedExperience).toBe(0);
    expect(GOLDEN.rewards.every(({ expected }) => expected.rng.draws === 0)).toBe(true);

    const evolutionTargets = Object.fromEntries(
      GOLDEN.progression.filter(({ id }) => id.startsWith("evolution:"))
        .map(({ id, expected }) => [id, expected.evolutionTarget]),
    );
    expect(evolutionTargets["evolution:level"]).toBe("puparmor");
    expect(evolutionTargets["evolution:priority"]).toBe("mk01_alpha");
    expect(evolutionTargets["evolution:variables:winter"]).toBe("angrito");
    expect(evolutionTargets["evolution:variables:summer"]).toBe("happito");
    expect(evolutionTargets["evolution:variables:spring"]).toBe("neutrito");
    expect(evolutionTargets["evolution:variables:autumn"]).toBe("sadito");
    expect(evolutionTargets["evolution:variables:missing"]).toBeNull();
    expect(evolutionTargets["evolution:tech"]).toBe("vivicinder");
    expect(evolutionTargets["evolution:element"]).toBe("viviphyta");
    expect(evolutionTargets["evolution:gender"]).toBe("viviteel");
    expect(evolutionTargets["evolution:level-priority"]).toBe("vivitron");
  });

  test("pins upstream evolution spawning, property transfer, and evolution moves", () => {
    expect(GOLDEN.appliedEvolutions.every(({ expected }) =>
      expected.sameIdentity && expected.rng.draws === 13
    )).toBe(true);

    const stage1 = GOLDEN.appliedEvolutions.find(({ id }) => id === "apply:cataspike:puparmor")!;
    expect(stage1.expected.caught).toEqual(["puparmor"]);
    expect(stage1.expected.after).toMatchObject({
      slug: "puparmor",
      stage: "stage1",
      moves: [...stage1.before.moves, "chameleon"],
      bond: 20,
      acquisition: "unknown",
      experienceModifier: 1,
      moneyModifier: 0,
      waitingToEvolve: false,
    });
    for (const field of [
      "gender", "tasteCold", "tasteWarm", "birthdate", "individualValues",
      "currentHp", "totalExperience", "captureDevice", "trainingPoints", "status",
    ] as const) {
      expect(stage1.expected.after[field]).toEqual(stage1.before[field]);
    }
    expect(stage1.expected.after.height).toBe(stage1.expected.spawned.height);
    expect(stage1.expected.after.weight).toBe(stage1.expected.spawned.weight);
    expect(stage1.expected.after.base).toEqual(stage1.expected.transferred.base);
    expect(stage1.expected.after.base).not.toEqual(stage1.expected.afterReload.base);

    const stage2 = GOLDEN.appliedEvolutions.find(({ id }) => id === "apply:puparmor:weavifly")!;
    expect(stage2.expected.after.bond).toBe(40);
    expect(stage2.expected.after.moves).toEqual(stage2.before.moves);
    expect(stage2.expected.caught).toEqual(["weavifly"]);
  });
});
