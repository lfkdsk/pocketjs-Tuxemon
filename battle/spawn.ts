import type { BattleDb } from "../importer/battle-schema.ts";
import { nextRandom, type RngState } from "./core.ts";
import { calculateBaseStats, learnedMoves, zeroStats } from "./stats.ts";
import type {
  SpawnedMonsterSnapshot,
  Stats,
  TuxemonBattleDb,
} from "./types.ts";
import { STAT_NAMES } from "./types.ts";

export interface SpawnMonsterOptions {
  iid?: string;
  experienceModifier?: number;
  moneyModifier?: number;
}

type RandomSource = () => number;

function weightedChoice(
  random: RandomSource,
  choices: ReadonlyArray<readonly [string, number]>,
): string {
  if (choices.length === 0) throw new Error("battle spawn: empty weighted choice");
  const total = choices.reduce((sum, [, weight]) => sum + weight, 0);
  if (!(total > 0) || !Number.isFinite(total)) {
    throw new Error("battle spawn: weighted choice has no positive finite weight");
  }
  const target = random() * total;
  let accumulated = 0;
  for (const [value, weight] of choices) {
    accumulated += weight;
    // Python random.choices uses bisect(), so an exact boundary belongs to
    // the following bucket rather than this one.
    if (target < accumulated) return value;
  }
  return choices[choices.length - 1]![0];
}

function randomIntInclusive(random: RandomSource, min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new Error(`battle spawn: invalid randint range ${min}..${max}`);
  }
  return min + Math.floor(random() * (max - min + 1));
}

function uniform(random: RandomSource, min: number, max: number): number {
  return min + (max - min) * random();
}

/**
 * Round an IEEE-754 value to decimal places with Python's ties-to-even rule.
 * BigInt avoids the false tie introduced by multiplying a binary float first
 * (the classic `round(2.675, 2)` case).
 */
export function pythonRoundDecimal(value: number, digits: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(digits) || digits < 0 || digits > 9) {
    throw new Error(`battle spawn: invalid decimal round ${value}/${digits}`);
  }
  if (value === 0) return value;
  const negative = value < 0;
  const absolute = Math.abs(value);
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, absolute, false);
  const high = view.getUint32(0, false);
  const low = view.getUint32(4, false);
  const exponentBits = (high >>> 20) & 0x7ff;
  const fraction = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
  const significand = exponentBits === 0 ? fraction : fraction | (1n << 52n);
  const binaryExponent = (exponentBits === 0 ? -1022 : exponentBits - 1023) - 52;
  const scale = 10n ** BigInt(digits);
  let numerator = significand * scale;
  let denominator = 1n;
  if (binaryExponent >= 0) numerator <<= BigInt(binaryExponent);
  else denominator <<= BigInt(-binaryExponent);

  let rounded = numerator / denominator;
  const remainder = numerator % denominator;
  const comparison = remainder * 2n - denominator;
  if (comparison > 0n || (comparison === 0n && rounded % 2n !== 0n)) rounded++;
  const result = Number(rounded) / Number(scale);
  return negative ? -result : result;
}

function personalizedSize(
  random: RandomSource,
  base: number,
  variation: readonly [number, number],
): number {
  const min = base * (1 + variation[0]);
  const max = base * (1 + variation[1]);
  return pythonRoundDecimal(uniform(random, min, max), 2);
}

function randomMonthDay(random: RandomSource): [number, number] {
  const month = randomIntInclusive(random, 1, 12);
  const maxDays = month === 2 ? 29 : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return [month, randomIntInclusive(random, 1, maxDays)];
}

/**
 * Bit-for-bit port of `Monster.spawn_base`: exactly thirteen draws are made
 * in upstream order. The caller owns the RNG cursor and deterministic iid.
 */
export function spawnMonster(
  sourceDb: BattleDb,
  rulesDb: TuxemonBattleDb,
  state: RngState,
  slug: string,
  requestedLevel: number,
  options: SpawnMonsterOptions = {},
): SpawnedMonsterSnapshot {
  return spawnMonsterWithRandom(
    sourceDb,
    rulesDb,
    () => nextRandom(state),
    slug,
    requestedLevel,
    options,
  );
}

/** Callback form used by event extensions, whose random() owns session RNG. */
export function spawnMonsterWithRandom(
  sourceDb: BattleDb,
  rulesDb: TuxemonBattleDb,
  random: RandomSource,
  slug: string,
  requestedLevel: number,
  options: SpawnMonsterOptions = {},
): SpawnedMonsterSnapshot {
  const species = sourceDb.monsters[slug];
  if (!species) throw new Error(`battle spawn: unknown monster '${slug}'`);
  const level = Math.max(
    sourceDb.rules.levelRange[0],
    Math.min(sourceDb.rules.levelRange[1], Math.trunc(requestedLevel)),
  );
  const gender = weightedChoice(random, Object.entries(species.genderWeights));
  const tasteSlugs = sourceDb.tasteOrder;
  const tasteCold = weightedChoice(
    random,
    tasteSlugs.filter((name) => sourceDb.tastes[name]!.type === "cold")
      .map((name) => [name, sourceDb.tastes[name]!.rarity] as const),
  );
  const tasteWarm = weightedChoice(
    random,
    tasteSlugs.filter((name) => sourceDb.tastes[name]!.type === "warm")
      .map((name) => [name, sourceDb.tastes[name]!.rarity] as const),
  );
  const height = personalizedSize(random, species.height, sourceDb.rules.sizeVariation.height);
  const weight = personalizedSize(random, species.weight, sourceDb.rules.sizeVariation.weight);
  const individualValues = {} as Stats;
  for (const stat of STAT_NAMES) {
    individualValues[stat] = randomIntInclusive(
      random,
      sourceDb.rules.ivRange[0],
      sourceDb.rules.ivRange[1],
    );
  }
  const birthdate = randomMonthDay(random);
  const trainingPoints = zeroStats();
  const base = calculateBaseStats(
    rulesDb,
    slug,
    level,
    individualValues,
    tasteCold,
    tasteWarm,
    trainingPoints,
  );
  const experience = sourceDb.rules.experience.groups.default!;
  const snapshot: SpawnedMonsterSnapshot = {
    ...(options.iid === undefined ? {} : { iid: options.iid }),
    slug,
    level,
    stage: species.stage,
    gender,
    tasteCold,
    tasteWarm,
    height,
    weight,
    individualValues,
    birthdate,
    base,
    currentHp: base.hp,
    moves: learnedMoves(rulesDb, slug, level, species.stage, sourceDb.rules.maxMoves),
    types: [...species.types],
    totalExperience: Math.trunc(experience.multiplier * level ** experience.experienceCoefficient),
    experienceModifier: options.experienceModifier ?? 1,
    moneyModifier: options.moneyModifier ?? 0,
    bond: 25,
    trainingPoints,
    status: null,
  };
  return snapshot;
}
