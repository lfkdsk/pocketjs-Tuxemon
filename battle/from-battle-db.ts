// Pure adapter: GB1's generated `pocket-tuxemon/battle-db/v1` -> the GB2
// reducer's `TuxemonBattleDb` shape. GB1 stores only what the *importer*
// needs (camelCase field names, flattened taste/shape rows, a map-shaped
// element affinity table); GB2's reducer was built and differentially
// verified against the Tuxemon oracle export, which mirrors upstream
// Pydantic model field names (snake_case) and array-shaped affinity rows.
// This module bridges the two without changing either one.
//
// GB1's `monster.moveset` is a level-up *schedule*
// (`{technique, level, method}[]`), not a "currently known moves" list.
// `TuxemonBattleDb.monster[slug].moveset` is the same kind of schedule
// (`{technique, learning_method, level_learned}[]`), consumed by
// `learnedMoves()` in `stats.ts` — so this adapter only renames fields.
// Code that turns a `BattleDb` trainer party into a battle-ready
// `MonsterSnapshot.moves` (a flat "known now" list) must still call
// `learnedMoves()`; it must not assume the schedule already is that list.

import type {
  BattleDb,
  BattlePlugin,
  BattleStatModifier,
} from "../importer/battle-schema.ts";
import type {
  DbMonster,
  DbRule,
  DbStatModifier,
  DbStatus,
  DbTechnique,
  Stats,
  TuxemonBattleDb,
} from "./types.ts";

function toRules(plugins: BattlePlugin[]): DbRule[] {
  return plugins.map((plugin) => ({
    type: plugin.type,
    parameters: (plugin.parameters ?? []).map(String),
    ...(plugin.operator === undefined ? {} : { operator: plugin.operator }),
  }));
}

function toStatModifier(modifier: BattleStatModifier): DbStatModifier {
  return {
    value: modifier.value,
    operation: modifier.operation,
    step: modifier.step,
    max_deviation: modifier.max_deviation,
    max_step_limit: modifier.max_step_limit,
    scaling_mode: modifier.scaling_mode,
    overridetofull: modifier.overridetofull,
  };
}

function toStatModifiers(
  statModifiers: Record<string, BattleStatModifier>,
): DbTechnique["stat_modifiers"] {
  return Object.fromEntries(
    Object.entries(statModifiers).map(([stat, modifier]) => [stat, toStatModifier(modifier)]),
  ) as DbTechnique["stat_modifiers"];
}

function toMonster(slug: string, monster: BattleDb["monsters"][string]): DbMonster {
  return {
    slug,
    shape: monster.shape,
    stage: monster.stage,
    types: monster.types,
    moveset: monster.moveset.map((move) => ({
      technique: move.technique,
      learning_method: move.method,
      level_learned: move.level,
      ...(move.evolutionStage === undefined ? {} : {
        evolution_stage_learned: move.evolutionStage,
      }),
    })),
  };
}

function toTechnique(slug: string, technique: BattleDb["techniques"][string]): DbTechnique {
  return {
    slug,
    sort: technique.sort,
    range: technique.range,
    speed: technique.speed,
    accuracy: technique.accuracy,
    potency: technique.potency,
    power: technique.power,
    healing_power: technique.healingPower,
    recharge: technique.recharge,
    types: technique.types,
    effects: toRules(technique.effects),
    conditions: toRules(technique.conditions),
    stat_modifiers: toStatModifiers(technique.statModifiers),
    target: technique.target,
  };
}

function toStatus(slug: string, status: BattleDb["statuses"][string]): DbStatus {
  return {
    slug,
    category: status.category as DbStatus["category"],
    effects: toRules(status.effects),
    conditions: toRules(status.conditions),
    stat_modifiers: toStatModifiers(status.statModifiers),
    on_positive_status: status.positiveTransition as DbStatus["on_positive_status"],
    on_negative_status: status.negativeTransition as DbStatus["on_negative_status"],
    on_tech_use: status.onTechniqueUse,
    on_item_use: status.onItemUse,
    duration: status.duration,
    max_stacks: status.maxStacks,
    bond: status.bond,
    behaviors: { persists_after_combat: Boolean(status.behaviors.persists_after_combat) },
    modifiers: status.modifiers,
  };
}

/** Derives each technique's numeric speed tier from its named speed rank. */
function technicalSpeeds(db: BattleDb): Record<string, number> {
  const tiers = db.rules.actionOrder.speedTiers;
  return Object.fromEntries(
    Object.entries(db.techniques).map(([slug, technique]) => [slug, tiers[technique.speed] ?? 0]),
  );
}

/** Pure conversion; throws if GB1 references a rule the reducer cannot use. */
export function battleDbToTuxemonBattleDb(db: BattleDb): TuxemonBattleDb {
  return {
    monster: Object.fromEntries(
      Object.entries(db.monsters).map(([slug, monster]) => [slug, toMonster(slug, monster)]),
    ),
    technique: Object.fromEntries(
      Object.entries(db.techniques).map(([slug, technique]) => [slug, toTechnique(slug, technique)]),
    ),
    technique_speed: technicalSpeeds(db),
    element: Object.fromEntries(
      Object.entries(db.elements).map(([slug, element]) => [slug, {
        types: Object.entries(element.multipliers)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([against, multiplier]) => ({ against, multiplier })),
      }]),
    ),
    element_order: db.elementOrder,
    taste: Object.fromEntries(
      Object.entries(db.tastes).map(([slug, taste]) => [slug, {
        taste_type: taste.type,
        rarity_score: taste.rarity,
        modifiers: [{ values: [taste.stat], multiplier: taste.multiplier }],
      }]),
    ),
    taste_order: db.tasteOrder,
    shape: Object.fromEntries(
      Object.entries(db.shapes).map(([slug, shape]) => [slug, { attributes: shape as Stats }]),
    ),
    status: Object.fromEntries(
      Object.entries(db.statuses).map(([slug, status]) => [slug, toStatus(slug, status)]),
    ),
  };
}
