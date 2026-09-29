import battleDb from "../../data/battle-db.json";
import { battleDbToTuxemonBattleDb } from "../../battle/from-battle-db.ts";
import {
  createBattle,
  reduceBattle,
  type BattleStart,
  type MonsterSnapshot,
  type Stats,
} from "../../battle/index.ts";
import { validateBattleDb } from "../../importer/battle-schema.ts";

declare const __benchNow: (() => number) | undefined;

const now = typeof __benchNow === "function" ? __benchNow : () => Date.now();
const db = battleDbToTuxemonBattleDb(validateBattleDb(battleDb));
const ZERO_STATS: Stats = { armour: 0, dodge: 0, hp: 0, melee: 0, ranged: 0, speed: 0 };

function monster(
  slug: string,
  level: number,
  base: Stats,
  moves: string[],
  types: string[],
  experienceModifier = 1,
  moneyModifier = 0,
): MonsterSnapshot {
  return {
    slug,
    level,
    base,
    currentHp: base.hp,
    moves,
    types,
    totalExperience: level ** 3,
    experienceModifier,
    moneyModifier,
    bond: 25,
    trainingPoints: ZERO_STATS,
  };
}

// A real 11-turn, two-versus-three Spyder oracle case. It includes damage,
// poison, grab/lifeleech, delayed disappear/appear, replacements, and cleanup.
const START: BattleStart = {
  seed: 3,
  kind: "trainer",
  opponent: "spyder_dryadsgrove_petra",
  policy: "cycle",
  inside: false,
  hour: 12,
  fieldSize: 1,
  moneyMethod: "conserved",
  player: [
    monster(
      "rockitten",
      50,
      { armour: 231, dodge: 415, hp: 312, melee: 471, ranged: 233, speed: 406 },
      ["ice_claw", "surge", "stampede", "earthquake"],
      ["earth"],
    ),
    monster(
      "nut",
      50,
      { armour: 509, dodge: 237, hp: 466, melee: 212, ranged: 468, speed: 235 },
      ["bubble_trap", "beam", "surge", "thunderclap"],
      ["metal"],
    ),
  ],
  enemy: [
    monster(
      "vivitron",
      50,
      { armour: 347, dodge: 345, hp: 346, melee: 216, ranged: 502, speed: 345 },
      ["battery_acid", "electrical_storm", "rift_dash", "electric_multibite"],
      ["lightning"],
      5,
      10,
    ),
    monster(
      "sumchon",
      50,
      { armour: 373, dodge: 292, hp: 403, melee: 503, ranged: 228, speed: 285 },
      ["wall_of_steel", "invictus", "blade", "suplex"],
      ["metal", "heroic"],
      5,
      10,
    ),
    monster(
      "exapode",
      50,
      { armour: 397, dodge: 299, hp: 400, melee: 234, ranged: 458, speed: 290 },
      ["take_cover", "tonguespear", "sand_spray", "rocky_barrage"],
      ["normal"],
      5,
      10,
    ),
  ],
};

interface RunTimings {
  frames: number[];
  rounds: number[];
  total: number;
}

function runBattle(measure: boolean): RunTimings {
  const frames: number[] = [];
  const rounds: number[] = [];
  const totalStart = now();
  const createStart = now();
  let state = createBattle(db, START);
  if (measure) frames.push(now() - createStart);
  while (state.phase !== "ended") {
    if (!state.awaiting) throw new Error(`benchmark stalled in ${state.phase}`);
    const frameStart = now();
    state = reduceBattle(db, state, { type: "technique", choice: state.turn - 1 });
    const duration = now() - frameStart;
    if (measure) {
      frames.push(duration);
      rounds.push(duration);
    }
  }
  if (state.outcome !== "lost" || state.turn !== 11 || state.rngDraws !== 88) {
    throw new Error(`benchmark fixture diverged: ${state.outcome}/${state.turn}/${state.rngDraws}`);
  }
  return { frames, rounds, total: now() - totalStart };
}

function stats(values: number[]): { mean: number; p95: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p95: sorted[Math.ceil((sorted.length - 1) * 0.95)]!,
    max: sorted[sorted.length - 1]!,
  };
}

for (let index = 0; index < 20; index++) runBattle(false);

const frames: number[] = [];
const rounds: number[] = [];
const totals: number[] = [];
for (let index = 0; index < 250; index++) {
  const measured = runBattle(true);
  frames.push(...measured.frames);
  rounds.push(...measured.rounds);
  totals.push(measured.total);
}

const output = JSON.stringify({
  engine: "PocketJS QuickJS",
  fixture: "spyder_dryadsgrove_petra seed=3 policy=cycle",
  battles: totals.length,
  turnsPerBattle: 11,
  activeFramesPerBattle: frames.length / totals.length,
  roundSettlementMs: stats(rounds),
  activeFrameMs: stats(frames),
  completeBattleMs: stats(totals),
  roundSamples: rounds.length,
  frameSamples: frames.length,
  overOneMillisecond: rounds.filter((value) => value > 1).length,
});
(globalThis as { __out?: string }).__out = output;
if (typeof __benchNow !== "function") console.log(output);
