import type {
  BattleAction,
  BattleCoreState,
  BattleDecision,
  BattleEvent,
  BattleOutcome,
  BattlePhase,
  PendingBattleAction,
} from "./core.ts";

export const STAT_NAMES = ["armour", "dodge", "hp", "melee", "ranged", "speed"] as const;
export type StatName = (typeof STAT_NAMES)[number];
export type Stats = Record<StatName, number>;

export interface DbRule {
  type: string;
  parameters: string[];
  operator?: string;
}

export interface DbStatModifier {
  value: number;
  operation: string;
  step: number | null;
  max_deviation: number;
  max_step_limit: number;
  scaling_mode: "linear" | "nonlinear";
  overridetofull: boolean;
}

export interface DbTechnique {
  slug: string;
  sort: string;
  range: string;
  speed: string;
  accuracy: number;
  potency: number;
  power: number;
  healing_power: number;
  recharge: number;
  min_recharge?: number;
  initial_delay?: number;
  cooldown_multiplier?: number;
  types: string[];
  effects: DbRule[];
  conditions: DbRule[];
  stat_modifiers: Partial<Record<StatName | "current_hp", DbStatModifier>>;
  target: Record<string, boolean>;
}

export interface DbMonster {
  slug: string;
  shape: string;
  types: string[];
  moveset: Array<{
    technique: string;
    learning_method: string;
    level_learned: number;
  }>;
}

export interface DbStatus {
  slug: string;
  category: "positive" | "negative" | "neutral" | null;
  effects: DbRule[];
  conditions?: DbRule[];
  stat_modifiers?: Partial<Record<StatName | "current_hp", DbStatModifier>>;
  on_positive_status?: "replaced" | "removed" | "stacked" | "blocked" | null;
  on_negative_status?: "replaced" | "removed" | "stacked" | "blocked" | null;
  on_tech_use?: string | null;
  on_item_use?: string | null;
  duration?: number | null;
  max_stacks?: number;
  bond?: boolean | null;
  behaviors?: { persists_after_combat?: boolean };
  modifiers?: Array<{
    attribute: string;
    values: string[];
    multiplier: number;
  }>;
}

export interface TuxemonBattleDb {
  monster: Record<string, DbMonster>;
  technique: Record<string, DbTechnique>;
  technique_speed: Record<string, number>;
  element: Record<string, { types: Array<{ against: string; multiplier: number }> }>;
  /** Source database insertion order, which random element-switch moves use. */
  element_order?: string[];
  taste: Record<string, {
    taste_type?: string;
    rarity_score?: number;
    modifiers: Array<{ values: string[]; multiplier: number }>;
  }>;
  shape: Record<string, { attributes: Stats }>;
  status: Record<string, DbStatus>;
}

export interface BattleMove {
  slug: string;
  cooldown: number;
  /** Mutable battle-only values rewritten by grabbed/stuck. */
  power: number;
  potency: number;
  /** Technique.hit persists when every effect is skipped for an absent target. */
  hit: boolean;
}

export interface BattleStatus {
  slug: string;
  turn: number;
  stack: number;
  uses: number;
  linked: number | null;
  appliedEffects: string[];
}

export interface BattleMonster {
  uid: number;
  slug: string;
  level: number;
  originalTypes: string[];
  types: string[];
  base: Stats;
  /** Technique/item stages survive status replacement until battle cleanup. */
  stages: Partial<Record<StatName, number>>;
  /** ON_START status stat changes are withdrawn by ON_END. */
  statusBoosts: Partial<Record<StatName, number>>;
  trainingPoints: Stats;
  currentHp: number;
  totalExperience: number;
  experienceModifier: number;
  moneyModifier: number;
  bond: number;
  moves: BattleMove[];
  fallback: string;
  fallbackHit: boolean;
  status: BattleStatus | null;
  outOfRange: boolean;
  isConfused: boolean;
}

export interface MonsterSnapshot {
  slug: string;
  level: number;
  base: Stats;
  currentHp?: number;
  moves: string[];
  types?: string[];
  totalExperience?: number;
  experienceModifier?: number;
  moneyModifier?: number;
  bond?: number;
  trainingPoints?: Partial<Stats>;
  status?: string | null;
}

export type PlayerPolicy = "first" | "cycle";

export interface RewardEvent {
  loser: number;
  winners: Array<{ uid: number; experience: number; trainingPoints: StatName[] }>;
  prize: number;
}

export interface BattleResult {
  outcome: BattleOutcome;
  /** Draw is deliberately player-defeating while retaining a distinct result. */
  playerDefeated: boolean;
  battleLastResult: "won" | "lost" | "draw" | "run" | "captured";
  gold: number;
}

export interface TuxemonBattleState extends BattleCoreState<BattleMonster> {
  version: 1;
  kind: "trainer" | "wild";
  opponent: string;
  policy: PlayerPolicy;
  inside: boolean;
  hour: number;
  fieldSize: 1 | 2;
  moneyMethod: "participant_scaled" | "conserved";
  rewards: RewardEvent[];
  prize: number;
  techniqueGold: number;
  damageByDefender: Record<string, number[]>;
  result: BattleResult | null;
  /** Reserved now; GB3's escape command keeps this across battles. */
  runAttempts: number;
}

export interface BattleStart {
  seed: number;
  kind?: "trainer" | "wild";
  opponent?: string;
  policy?: PlayerPolicy;
  player: MonsterSnapshot[];
  enemy: MonsterSnapshot[];
  inside?: boolean;
  hour?: number;
  fieldSize?: 1 | 2;
  moneyMethod?: "participant_scaled" | "conserved";
  runAttempts?: number;
}

export interface TechniqueDecision {
  type: "technique";
  /** Index in the current usable-move list, not necessarily the raw move slot. */
  choice: number;
}

/** Reserved reducer inputs for GB3 without committing their mechanics here. */
export type FutureBattleDecision =
  | { type: "item"; item: string; target: number }
  | { type: "capture"; item: string; target: number }
  | { type: "run" }
  | { type: "replacement"; uid: number };

export type TuxemonBattleDecision = TechniqueDecision | FutureBattleDecision;

// Re-export the generic JSON-state vocabulary from one public entry point.
export type {
  BattleAction,
  BattleDecision,
  BattleEvent,
  BattleOutcome,
  BattlePhase,
  PendingBattleAction,
};
