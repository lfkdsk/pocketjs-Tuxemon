import type { BattleInput } from "../vendor/pocket-rpgkit/src/engine/battle.ts";
import { battleMenuEntries, type BattleMenuEntry, type BattleMenuMode, type RuntimeBattleState } from "./runtime.ts";
import { calculateDamage, getMonster } from "./tuxemon.ts";
import type { BattleMonster, TuxemonBattleDb } from "./types.ts";

export interface BattleAutoplayOptions {
  /** Heal before choosing an attack when the active monster is at or below this fraction. */
  healAtHpRatio?: number;
  /** Consider a healthy reserve when the active monster is at or below this fraction. */
  switchAtHpRatio?: number;
  /** Throw a capture device at a wanted wild monster at or below this fraction. */
  captureAtHpRatio?: number;
  /** `uncaught` is useful for attract mode; journeys that only grind use `never`. */
  capture?: "never" | "uncaught" | readonly string[];
}

export interface BattleAutoplayChoice {
  mode: BattleMenuMode;
  index: number;
  kind: BattleMenuEntry["kind"];
  slug: string;
  target?: number;
  /** Damage choices expose the exact deterministic comparison value. */
  expectedDamage?: number;
  reason: "damage" | "heal" | "switch" | "capture";
}

const DEFAULTS = {
  healAtHpRatio: 0.35,
  switchAtHpRatio: 0.2,
  captureAtHpRatio: 0.4,
} as const;

function ratio(monster: Pick<BattleMonster, "currentHp" | "base">): number {
  return monster.base.hp <= 0 ? 0 : monster.currentHp / monster.base.hp;
}

function activeEnemy(state: RuntimeBattleState): BattleMonster | null {
  const uid = state.battle.field.find((candidate) =>
    state.battle.parties[1].some((monster) => monster.uid === candidate)
  );
  return uid === undefined ? null : getMonster(state.battle, uid);
}

function activePlayer(state: RuntimeBattleState): BattleMonster | null {
  const awaiting = state.battle.awaiting;
  if (!awaiting) return null;
  return getMonster(state.battle, awaiting.uid);
}

function menuMove(state: RuntimeBattleState, entry: BattleMenuEntry): BattleMonster["moves"][number] | null {
  const user = activePlayer(state);
  if (!user) return null;
  return user.moves.find((move) => move.slug === entry.slug) ?? null;
}

/**
 * Expected direct damage for a visible technique entry.  `calculateDamage`
 * is the production rule formula and already includes the clamped elemental
 * affinity multiplier; multiplying by the technique's hit probability is
 * therefore the only expectation adjustment made here.
 */
export function expectedTechniqueDamage(
  db: TuxemonBattleDb,
  state: RuntimeBattleState,
  entry: BattleMenuEntry,
): number {
  if (entry.kind !== "technique") return 0;
  const user = activePlayer(state);
  const fallbackTarget = activeEnemy(state);
  const target = entry.target === undefined ? fallbackTarget : getMonster(state.battle, entry.target);
  const technique = db.technique[entry.slug];
  if (!user || !target || !technique) return 0;
  const move = menuMove(state, entry) ?? { power: technique.power };
  const [damage] = calculateDamage(db, technique, move, user, target);
  return Math.max(0, damage) * Math.max(0, Math.min(1, technique.accuracy));
}

function bestTechnique(db: TuxemonBattleDb, state: RuntimeBattleState): BattleAutoplayChoice | null {
  const entries = battleMenuEntries(state, db, "technique");
  let best: BattleAutoplayChoice | null = null;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    const expectedDamage = expectedTechniqueDamage(db, state, entry);
    if (best && expectedDamage <= (best.expectedDamage ?? 0)) continue;
    best = {
      mode: "technique",
      index,
      kind: entry.kind,
      slug: entry.slug,
      ...(entry.target === undefined ? {} : { target: entry.target }),
      expectedDamage,
      reason: "damage",
    };
  }
  return best;
}

function healingAmount(db: TuxemonBattleDb, slug: string, target: BattleMonster): number {
  const item = db.item[slug];
  if (!item) return 0;
  let amount = 0;
  for (const effect of item.effects) {
    if (effect.type !== "heal") continue;
    const value = Number(effect.parameters[0]);
    if (!Number.isFinite(value) || value <= 0) continue;
    amount += effect.parameters[1] === "percentage" ? target.base.hp * value : value;
  }
  const modifier = item.stat_modifiers.current_hp;
  if (modifier) {
    amount += modifier.operation === "multiply"
      ? target.base.hp * Math.max(0, modifier.value - 1)
      : Math.max(0, modifier.value);
  }
  return Math.max(0, amount);
}

function bestHealingItem(db: TuxemonBattleDb, state: RuntimeBattleState): BattleAutoplayChoice | null {
  const entries = battleMenuEntries(state, db, "item");
  let best: { choice: BattleAutoplayChoice; useful: number; amount: number } | null = null;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    if (entry.target === undefined) continue;
    const target = getMonster(state.battle, entry.target);
    const amount = healingAmount(db, entry.slug, target);
    if (amount <= 0 || target.currentHp <= 0) continue;
    const useful = Math.min(target.base.hp - target.currentHp, amount);
    const choice: BattleAutoplayChoice = {
      mode: "item",
      index,
      kind: entry.kind,
      slug: entry.slug,
      target: entry.target,
      reason: "heal",
    };
    // Maximise useful healing, then consume the smaller item, then preserve
    // source order.  Every tie is deterministic and independent of RNG.
    if (!best || useful > best.useful || (useful === best.useful && amount < best.amount)) {
      best = { choice, useful, amount };
    }
  }
  return best?.choice ?? null;
}

function bestReserve(db: TuxemonBattleDb, state: RuntimeBattleState): BattleAutoplayChoice | null {
  const entries = battleMenuEntries(state, db, "swap");
  const target = activeEnemy(state);
  let best: { choice: BattleAutoplayChoice; damage: number; hpRatio: number } | null = null;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    if (entry.target === undefined) continue;
    const reserve = getMonster(state.battle, entry.target);
    let damage = 0;
    if (target) {
      for (const move of reserve.moves) {
        if (move.cooldown !== 0) continue;
        const technique = db.technique[move.slug];
        if (!technique) continue;
        const [raw] = calculateDamage(db, technique, move, reserve, target);
        damage = Math.max(damage, Math.max(0, raw) * Math.max(0, Math.min(1, technique.accuracy)));
      }
    }
    const hpRatio = ratio(reserve);
    const choice: BattleAutoplayChoice = {
      mode: "swap",
      index,
      kind: entry.kind,
      slug: entry.slug,
      target: entry.target,
      reason: "switch",
    };
    if (!best || damage > best.damage || (damage === best.damage && hpRatio > best.hpRatio)) {
      best = { choice, damage, hpRatio };
    }
  }
  return best?.choice ?? null;
}

function captureWanted(state: RuntimeBattleState, option: BattleAutoplayOptions["capture"]): boolean {
  if (option === "never") return false;
  const target = activeEnemy(state);
  if (!target) return false;
  if (Array.isArray(option)) return option.includes(target.slug);
  return !state.ext.caught.includes(target.slug);
}

function bestCapture(db: TuxemonBattleDb, state: RuntimeBattleState): BattleAutoplayChoice | null {
  const entries = battleMenuEntries(state, db, "capture");
  let best: { choice: BattleAutoplayChoice; modifier: number } | null = null;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    const device = db.capture_devices.items[entry.slug];
    const modifier = (device?.specific_capdev_modifier ?? device?.positive_modifier ?? 0);
    const choice: BattleAutoplayChoice = {
      mode: "capture",
      index,
      kind: entry.kind,
      slug: entry.slug,
      ...(entry.target === undefined ? {} : { target: entry.target }),
      reason: "capture",
    };
    if (!best || modifier > best.modifier) best = { choice, modifier };
  }
  return best?.choice ?? null;
}

/** Choose the next complete menu action without reading or advancing RNG. */
export function chooseBattleAutoplayAction(
  db: TuxemonBattleDb,
  state: RuntimeBattleState,
  options: BattleAutoplayOptions = {},
): BattleAutoplayChoice | null {
  const player = activePlayer(state);
  if (!player || state.battle.phase === "ended") return null;
  const healAt = options.healAtHpRatio ?? DEFAULTS.healAtHpRatio;
  const switchAt = options.switchAtHpRatio ?? DEFAULTS.switchAtHpRatio;
  const captureAt = options.captureAtHpRatio ?? DEFAULTS.captureAtHpRatio;
  const hpRatio = ratio(player);

  if (hpRatio <= healAt) {
    const heal = bestHealingItem(db, state);
    if (heal) return heal;
  }

  const enemy = activeEnemy(state);
  if (state.battle.kind === "wild" && enemy && ratio(enemy) <= captureAt
    && captureWanted(state, options.capture ?? "uncaught")) {
    const capture = bestCapture(db, state);
    if (capture) return capture;
  }

  const attack = bestTechnique(db, state);
  const reserve = bestReserve(db, state);
  const reserveMonster = reserve?.target === undefined ? null : getMonster(state.battle, reserve.target);
  if (reserve && reserveMonster
    && (attack === null || (attack.expectedDamage ?? 0) <= 0
      || (hpRatio <= switchAt && ratio(reserveMonster) > hpRatio + 0.25))) {
    return reserve;
  }
  return attack;
}

function rootIndex(state: RuntimeBattleState, desired: BattleAutoplayChoice): number {
  const kind = desired.mode === "technique" ? "fight"
    : desired.mode === "swap" ? "replacement"
      : desired.mode;
  return state.menu.findIndex((entry) => entry.kind === kind && entry.available);
}

function indexInput(state: RuntimeBattleState, wanted: number): BattleInput {
  if (state.menuIndex === wanted) return { buttons: 0, confirmEdge: true };
  return { buttons: 0, downEdge: true };
}

/**
 * Convert the pure action choice into the next BattleRules input frame.
 * Presentation is fast-forwarded with confirm; menus use one edge at a time,
 * making the same function safe at 60, 30, or 20 Hz.
 */
export function battleAutoplayInput(
  db: TuxemonBattleDb,
  state: RuntimeBattleState,
  options: BattleAutoplayOptions = {},
): BattleInput {
  if (state.eventCursor < state.battle.events.length) return { buttons: 0, confirmEdge: true };
  const choice = chooseBattleAutoplayAction(db, state, options);
  if (!choice) return { buttons: 0 };
  if (state.menuMode !== choice.mode) {
    if (state.menuMode !== "root") return { buttons: 0, cancelEdge: true };
    const wanted = rootIndex(state, choice);
    return wanted < 0 ? { buttons: 0 } : indexInput(state, wanted);
  }
  return indexInput(state, choice.index);
}

/** Fixed fifth-move rule: forget the weakest expected neutral hit, oldest on ties. */
export function autoplayMoveToForget(
  db: TuxemonBattleDb,
  _monster: Readonly<BattleMonster>,
  moves: readonly string[],
  _newlyLearned: string,
): number {
  let selected = 0;
  let selectedScore = Number.POSITIVE_INFINITY;
  for (let index = 0; index < moves.length; index++) {
    const technique = db.technique[moves[index]!];
    const score = technique
      ? Math.max(0, technique.power) * Math.max(0, Math.min(1, technique.accuracy))
      : 0;
    if (score < selectedScore) {
      selected = index;
      selectedScore = score;
    }
  }
  return selected;
}
