import {
  loadAllFileEvents,
  type Cond,
  type Rule,
  type TuxEvent,
} from "./source.ts";

export type Disposition = "native" | "degraded" | "placeholder" | "dropped";

export interface CoverageRow {
  type: string;
  total: number;
  native: number;
  degraded: number;
  placeholder: number;
  dropped: number;
}

export interface CoverageSummary {
  types: number;
  uses: number;
  native: number;
  degraded: number;
  placeholder: number;
  dropped: number;
  nativePercent: number;
  executablePercent: number;
  tier1: {
    uses: number;
    percent: number;
    requiredUses: number;
    requiredPercent: number;
    meetsBaseline: boolean;
  };
}

export interface CoverageReport {
  sourceEvents: number;
  actions: { summary: CoverageSummary; rows: CoverageRow[] };
  conditions: { summary: CoverageSummary; rows: CoverageRow[] };
}

const T1_ACTIONS = new Set([
  "add_item",
  "add_tracker",
  "char_stop",
  "char_talk",
  "char_wander",
  "clear_variable",
  "load_yaml",
  "lock_controls",
  "modify_money",
  "play_sound",
  "random_integer",
  "remove_collision",
  "set_random_variable",
  "set_variable",
  "transition_teleport",
  "translated_dialog",
  "translated_dialog_choice",
  "unlock_controls",
  "wait",
]);

const T1_CONDITIONS = new Set([
  "button_pressed",
  "char_at",
  "char_facing_tile",
  "char_moved",
  "has_item",
  "location_inside",
  "location_type",
  "money_is",
  "tracker",
  "variable_set",
]);

const NATIVE_ACTIONS = new Set([
  "add_item",
  "add_tracker",
  "char_talk",
  "clear_variable",
  "modify_money",
  "play_sound",
  "random_integer",
  "set_random_variable",
  "set_variable",
  "transition_teleport",
  "translated_dialog",
  "translated_dialog_choice",
  "wait",
]);

const DEGRADED_ACTIONS = new Set([
  "char_face",
  "char_move",
  "char_stop",
  "char_wander",
  "create_npc",
  "load_yaml",
  "lock_controls",
  "remove_collision",
  "remove_npc",
  "screen_transition",
  "unlock_controls",
]);

const PLACEHOLDER_ACTIONS = new Set([
  "add_monster",
  "choice_monster",
  "choice_npc",
  "random_encounter",
  "random_monster",
  "remove_monster",
  "set_monster_health",
  "set_monster_status",
  "start_battle",
  "start_double_battle",
  "wild_encounter",
]);

const NATIVE_CONDITIONS = new Set([
  "button_pressed",
  "char_at",
  "char_facing_tile",
  "char_moved",
  "has_item",
  "location_inside",
  "location_type",
  "money_is",
  "tracker",
  "variable_set",
]);

const DEGRADED_CONDITIONS = new Set([
  "char_exists",
  "char_facing",
  "current_state",
  "time_is",
]);

const PLACEHOLDER_CONDITIONS = new Set([
  "battle_outcome",
  "battle_outcome_count",
  "char_defeated",
  "has_monster",
  "party_infected",
  "party_size",
]);

function actionDisposition(action: Rule): Disposition {
  if (action.type === "add_item" && action.args[2] && action.args[2] !== "player") {
    return "dropped";
  }
  if (action.type === "modify_money" && (action.args[0] !== "player" || !action.args[1])) {
    return "dropped";
  }
  if (action.type === "random_monster" && action.args[1]) return "dropped";
  if (action.type === "add_monster" && action.args[2] && action.args[2] !== "player") {
    return "dropped";
  }
  if (action.type === "translated_dialog_choice" && action.args[0]!.split(":").length > 4) {
    return "degraded";
  }
  if (NATIVE_ACTIONS.has(action.type)) return "native";
  if (DEGRADED_ACTIONS.has(action.type)) return "degraded";
  if (PLACEHOLDER_ACTIONS.has(action.type)) return "placeholder";
  return "dropped";
}

function conditionDisposition(condition: Cond): Disposition {
  if (condition.type === "money_is") {
    const op = condition.args[1];
    const value = condition.args[2];
    if (!value || !/^\d+$/.test(value) ||
        !["greater_than", "greater_or_equal", "less_than", "less_or_equal"].includes(op ?? "")) {
      return "dropped";
    }
  }
  if (NATIVE_CONDITIONS.has(condition.type)) return "native";
  if (DEGRADED_CONDITIONS.has(condition.type)) return "degraded";
  if (PLACEHOLDER_CONDITIONS.has(condition.type)) return "placeholder";
  return "dropped";
}

function blank(type: string): CoverageRow {
  return { type, total: 0, native: 0, degraded: 0, placeholder: 0, dropped: 0 };
}

function percent(count: number, total: number, digits = 1): number {
  const scale = 10 ** digits;
  return Math.round(count * 100 * scale / total) / scale;
}

function aggregate(
  entries: { key: string; disposition: Disposition; tier1: boolean }[],
  baseline: { uses: number; percent: number },
): { summary: CoverageSummary; rows: CoverageRow[] } {
  const grouped = new Map<string, CoverageRow>();
  let tier1Uses = 0;
  for (const entry of entries) {
    const row = grouped.get(entry.key) ?? blank(entry.key);
    row.total++;
    row[entry.disposition]++;
    grouped.set(entry.key, row);
    if (entry.tier1 && (entry.disposition === "native" || entry.disposition === "degraded")) {
      tier1Uses++;
    }
  }
  const rows = [...grouped.values()].sort((a, b) =>
    a.type < b.type ? -1 : a.type > b.type ? 1 : 0
  );
  const uses = entries.length;
  const total = (key: Disposition) => rows.reduce((sum, row) => sum + row[key], 0);
  const native = total("native");
  const degraded = total("degraded");
  const placeholder = total("placeholder");
  const dropped = total("dropped");
  const tier1Percent = percent(tier1Uses, uses, 2);
  return {
    summary: {
      types: rows.length,
      uses,
      native,
      degraded,
      placeholder,
      dropped,
      nativePercent: percent(native, uses),
      executablePercent: percent(native + degraded + placeholder, uses),
      tier1: {
        uses: tier1Uses,
        percent: tier1Percent,
        requiredUses: baseline.uses,
        requiredPercent: baseline.percent,
        meetsBaseline: tier1Uses >= baseline.uses,
      },
    },
    rows,
  };
}

export function buildCoverageReport(): CoverageReport {
  const events: TuxEvent[] = loadAllFileEvents();
  const actions = events.flatMap((event) => event.acts.map((action) => ({
    key: action.type,
    disposition: actionDisposition(action),
    tier1: T1_ACTIONS.has(action.type),
  })));
  const conditions = events.flatMap((event) => event.conds.map((condition) => ({
    key: `${condition.op} ${condition.type}`,
    disposition: conditionDisposition(condition),
    tier1: T1_CONDITIONS.has(condition.type),
  })));
  return {
    sourceEvents: events.length,
    actions: aggregate(actions, { uses: 6_246, percent: 45.9 }),
    conditions: aggregate(conditions, { uses: 4_591, percent: 53.0 }),
  };
}
