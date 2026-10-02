// Weather-driven battle modifiers.
//
// Upstream Tuxemon (pinned 9e6258ff) ships ten weather rows whose modifier
// lists are all empty, and no combat code ever reads `Weather.modifiers`;
// the only scaffolding is the Modifier model and ModifiersHandler in
// tuxemon/modifiers.py plus the unused `additional_factors` slot in
// simple_damage_calculate. This module ports that scaffolding faithfully:
// the same attribute handlers, condition registry, priority ordering,
// max_stacks enforcement and CUMULATIVE stacking resolution, applied as an
// additional damage factor on the damage dealer. With the imported data
// (empty lists) every weather is a no-op, so the oracle baseline is
// untouched; populated rows activate the pipeline without further changes.
//
// Pocket Tuxemon policy where upstream is silent:
//   - the modifier subject is the damage DEALER (attacker), matching the
//     monster-subject design of upstream's attribute handlers;
//   - only the "type" attribute is resolved here, because BattleMonster
//     carries types but not tags/terrains/shape in the reducer state;
//     unsupported attributes are ignored, matching upstream's
//     missing-handler behaviour;
//   - the CUMULATIVE mode is used (upstream's damage-oriented resolution).

import type { WeatherModifier, WeatherRow } from "../importer/battle-schema.ts";
import type { BattleMonster, TuxemonBattleDb, TuxemonBattleState } from "./types.ts";

export interface WeatherModifierSubject {
  types: readonly string[];
  /** currentHp / maxHp in 0..1; used by the hp_* conditions. */
  hpRatio: number;
}

/** Mirrors upstream's CONDITION_REGISTRY (tuxemon/modifiers.py:108-112). */
function conditionApplies(condition: string, subject: WeatherModifierSubject): boolean {
  switch (condition) {
    case "hp_below_50": return subject.hpRatio < 0.5;
    case "hp_above_50": return subject.hpRatio > 0.5;
    case "full_hp": return subject.hpRatio === 1;
    default: return false;
  }
}

/** Upstream resolves attribute handlers against the subject monster; only
 *  "type" has the fields it needs in battle state. Returns null when the
 *  modifier does not apply, exactly like the Python handlers. */
function attributeMultiplier(modifier: WeatherModifier, subject: WeatherModifierSubject): number | null {
  switch (modifier.attribute) {
    case "type":
      return subject.types.some((type) => modifier.values.includes(type)) ? modifier.multiplier : null;
    default:
      return null;
  }
}

function applicableMultiplier(modifier: WeatherModifier, subject: WeatherModifierSubject): number | null {
  if (modifier.conditionName && !conditionApplies(modifier.conditionName, subject)) return null;
  return attributeMultiplier(modifier, subject);
}

/** Upstream's enforce_max_stacks (tuxemon/modifiers.py:280-294): group by
 *  (attribute, sorted values), keep at most the group's max_stacks entries
 *  (highest priority first); groups without a cap keep everything. */
function enforceMaxStacks(modifiers: readonly WeatherModifier[]): WeatherModifier[] {
  const groups = new Map<string, WeatherModifier[]>();
  for (const modifier of modifiers) {
    const key = `${modifier.attribute}\u{0}${[...modifier.values].sort().join("\u{1}")}`;
    const group = groups.get(key);
    if (group) group.push(modifier);
    else groups.set(key, [modifier]);
  }
  const result: WeatherModifier[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => b.priority - a.priority);
    const cap = group[0]!.maxStacks;
    result.push(...(cap === null ? group : group.slice(0, cap)));
  }
  return result;
}

/** Resolve one weather row's modifiers against the subject, using upstream's
 *  CUMULATIVE mode (tuxemon/modifiers.py:235-245). Returns 1.0 when nothing
 *  applies. */
export function weatherRowMultiplier(row: WeatherRow | undefined, subject: WeatherModifierSubject): number {
  if (!row || row.modifiers.length === 0) return 1;
  const applicable = row.modifiers.filter(
    (modifier) => applicableMultiplier(modifier, subject) !== null,
  );
  if (applicable.length === 0) return 1;
  // Sort by priority descending, then cap stacks (upstream lines 220-223).
  const ordered = enforceMaxStacks(applicable.sort((a, b) => b.priority - a.priority));
  let result = 1;
  for (const modifier of ordered) {
    if (modifier.stacking === "additive") result += modifier.multiplier - 1;
    else if (modifier.stacking === "override") {
      result = modifier.multiplier;
      break;
    } else result *= modifier.multiplier;
  }
  return result;
}

/** The battle's current weather row, or null when the battle carries no
 *  weather slug or names an unimported row. */
export function battleWeatherRow(db: TuxemonBattleDb, slug: string | null): WeatherRow | undefined {
  if (slug === null) return undefined;
  return db.weather?.[slug];
}

/** Damage multiplier for the given attacker under the battle's weather.
 *  This is the `additional_factors` product of upstream's damage formula. */
export function weatherDamageFactor(
  db: TuxemonBattleDb,
  state: TuxemonBattleState,
  attacker: BattleMonster,
): number {
  if (state.weather === null) return 1;
  const row = battleWeatherRow(db, state.weather);
  // Every imported row has an empty modifier list today: answer before
  // building the subject, so a technique use allocates nothing for weather.
  if (!row || row.modifiers.length === 0) return 1;
  const maxHp = attacker.base.hp;
  const subject: WeatherModifierSubject = {
    types: attacker.types,
    hpRatio: maxHp > 0 ? Math.max(0, Math.min(1, attacker.currentHp / maxHp)) : 1,
  };
  return weatherRowMultiplier(row, subject);
}
