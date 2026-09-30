// Deterministic battle-stage projection. Every pose is derived from the
// serialised event cursor and its 60 Hz reference-tick offset; there is no
// host clock or component-owned animation state in this module.

import type { BattleAnimationPage, BattleAnimationRef } from "../importer/battle-schema.ts";
import {
  NO_EFFECT,
  frameIndexAt,
  progress,
  shakeOffsetX,
  tweenAt,
  type SpriteEffect,
} from "../vendor/pocket-rpgkit/src/ui/battle/effects.ts";
import type { RuntimeBattleState } from "./runtime.ts";
import type { BattleEvent, BattleMonster, RewardEvent } from "./types.ts";

export const BATTLE_EVENT_TICKS = 12;
export const SEND_OUT_RELEASE_TICK = 22;
export const TECHNIQUE_IMPACT_TICK = 14;
export const TECHNIQUE_HP_TICK = 20;
export const FAINT_SINK_TICK = 4;
export const REWARD_TICK = 36;
export const CAPTURE_FLIGHT_TICKS = 18;
export const CAPTURE_SHAKE_TICKS = 12;

const number = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const uid = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;

function hpMap(value: unknown): Readonly<Record<string, number>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Readonly<Record<string, number>>;
}

function animationFrames(animation: BattleAnimationRef | undefined): number {
  return animation?.pages.reduce((sum, page) => sum + page.frames, 0) ?? 0;
}

export function animationFrameTicks(animation: BattleAnimationRef | undefined): number {
  return Math.max(1, Math.round((animation?.durationMs ?? 100) * 60 / 1000));
}

export function eventAnimation(
  state: RuntimeBattleState,
  event: BattleEvent | null = state.battle.events[state.eventCursor] ?? null,
): BattleAnimationRef | undefined {
  if (!event) return undefined;
  if (event.type === "technique") return state.visuals.techniques[String(event.technique)]?.animation;
  if (event.type === "item" || event.type === "capture") {
    return state.visuals.items[String(event.item)]?.animation;
  }
  return undefined;
}

/** Reference-tick duration of one reducer event's presentation beat. */
export function battleEventDuration(state: RuntimeBattleState, event: BattleEvent): number {
  const animation = eventAnimation(state, event);
  const animated = animationFrames(animation) * animationFrameTicks(animation);
  switch (event.type) {
    case "sendOut": return 48;
    case "round": return 1;
    case "decision": return 8;
    case "technique": return Math.max(48, 10 + animated);
    case "status": return 20;
    case "item": return Math.max(40, 10 + animated);
    case "capture": return Math.max(54 + Math.max(1, number(event.shakes, 1)) * CAPTURE_SHAKE_TICKS, 10 + animated);
    case "run": return 32;
    case "swap": return 44;
    case "faint": return 60;
    case "end": return 36;
    default: return BATTLE_EVENT_TICKS;
  }
}

/** Mechanical bookkeeping beats may be skipped by confirm; authored motion
 * always runs to its reference-tick endpoint so tapes exercise the show. */
export function presentationEventSkippable(event: BattleEvent): boolean {
  return event.type === "round" || event.type === "decision";
}

export function currentPresentationEvent(state: RuntimeBattleState): BattleEvent | null {
  return state.battle.events[state.eventCursor] ?? null;
}

function sideOf(state: RuntimeBattleState, monsterUid: number): 0 | 1 | null {
  if (state.battle.parties[0].some((monster) => monster.uid === monsterUid)) return 0;
  if (state.battle.parties[1].some((monster) => monster.uid === monsterUid)) return 1;
  return null;
}

function applyFieldEvent(field: number[], event: BattleEvent): void {
  if (event.type === "sendOut") {
    const monster = uid(event.monster);
    if (monster !== null && !field.includes(monster)) field.push(monster);
  } else if (event.type === "swap") {
    const user = uid(event.user);
    const target = uid(event.target);
    if (user !== null) {
      const index = field.indexOf(user);
      if (index >= 0) field.splice(index, 1);
    }
    if (target !== null && !field.includes(target)) field.push(target);
  } else if (event.type === "faint") {
    const monster = uid(event.monster);
    if (monster !== null) {
      const index = field.indexOf(monster);
      if (index >= 0) field.splice(index, 1);
    }
  } else if (event.type === "capture" && event.success === true) {
    const target = uid(event.target);
    if (target !== null) {
      const index = field.indexOf(target);
      if (index >= 0) field.splice(index, 1);
    }
  }
}

/** Reconstruct the visible field at the cursor rather than leaking the
 * reducer's already-final field into earlier presentation beats. */
export function presentationField(state: RuntimeBattleState): number[] {
  const field: number[] = [];
  for (let index = 0; index < state.eventCursor; index++) {
    applyFieldEvent(field, state.battle.events[index]!);
  }
  const current = currentPresentationEvent(state);
  if (current?.type === "sendOut") {
    const monster = uid(current.monster);
    if (monster !== null && !field.includes(monster)) field.push(monster);
  } else if (current?.type === "swap" && state.eventTicks >= 22) {
    applyFieldEvent(field, current);
  }
  return field;
}

export function presentationActiveMonster(state: RuntimeBattleState, side: 0 | 1): BattleMonster {
  const active = presentationField(state).find((monsterUid) => sideOf(state, monsterUid) === side);
  return state.battle.parties[side].find((monster) => monster.uid === active)
    ?? state.battle.parties[side].find((monster) => monster.currentHp > 0)
    ?? state.battle.parties[side][0]!;
}

function lastHpBefore(state: RuntimeBattleState, monsterUid: number): number {
  for (let index = state.eventCursor - 1; index >= 0; index--) {
    const value = hpMap(state.battle.events[index]!.hp)?.[String(monsterUid)];
    if (typeof value === "number") return value;
    const event = state.battle.events[index]!;
    if (event.type === "item" && uid(event.target) === monsterUid) {
      const after = hpMap(event.after)?.hp;
      if (typeof after === "number") return after;
    }
  }
  for (let index = state.eventCursor; index < state.battle.events.length; index++) {
    const event = state.battle.events[index]!;
    const value = hpMap(event.hpBefore)?.[String(monsterUid)];
    if (typeof value === "number") return value;
    if (event.type === "item" && uid(event.target) === monsterUid) {
      const before = hpMap(event.before)?.hp;
      if (typeof before === "number") return before;
    }
  }
  return state.battle.parties.flat().find((monster) => monster.uid === monsterUid)?.currentHp ?? 0;
}

/** HP value painted at this exact presentation tick, including hit/item/
 * status interpolation rather than exposing the reducer's future value. */
export function presentationHp(state: RuntimeBattleState, monsterUid: number): number {
  const event = currentPresentationEvent(state);
  const from = lastHpBefore(state, monsterUid);
  if (!event) return from;
  if (event.type === "technique") {
    const explicitFrom = hpMap(event.hpBefore)?.[String(monsterUid)] ?? from;
    const to = hpMap(event.hp)?.[String(monsterUid)] ?? explicitFrom;
    return tweenAt({ from: explicitFrom, to, startTick: TECHNIQUE_HP_TICK, duration: 20 }, state.eventTicks);
  }
  if (event.type === "status") {
    const to = hpMap(event.hp)?.[String(monsterUid)] ?? from;
    return tweenAt({ from, to, startTick: 6, duration: 10 }, state.eventTicks);
  }
  if (event.type === "item" && uid(event.target) === monsterUid) {
    const before = hpMap(event.before)?.hp ?? from;
    const after = hpMap(event.after)?.hp ?? before;
    return tweenAt({ from: before, to: after, startTick: 12, duration: 18 }, state.eventTicks);
  }
  return from;
}

export interface BattlerPresentation {
  offsetX: number;
  opacity: number;
  effect: Readonly<SpriteEffect>;
}

function triangle(start: number, duration: number, now: number): number {
  const p = progress(start, duration, now);
  return p < 0.5 ? p * 2 : (1 - p) * 2;
}

export function battlerPresentation(state: RuntimeBattleState, monsterUid: number): BattlerPresentation {
  const event = currentPresentationEvent(state);
  const field = presentationField(state);
  let opacity = field.includes(monsterUid) ? 1 : 0;
  let offsetX = 0;
  let effect: Readonly<SpriteEffect> = NO_EFFECT;
  if (!event) return { offsetX, opacity, effect };

  if (event.type === "sendOut" && uid(event.monster) === monsterUid) {
    opacity = progress(SEND_OUT_RELEASE_TICK, 10, state.eventTicks);
    effect = { kind: "flash", startTick: SEND_OUT_RELEASE_TICK, duration: 16 };
  } else if (event.type === "technique") {
    if (uid(event.user) === monsterUid) {
      const side = sideOf(state, monsterUid) ?? 0;
      offsetX += Math.round(triangle(4, 16, state.eventTicks) * (side === 0 ? 22 : -22));
    }
    if (uid(event.target) === monsterUid && event.hit !== false) {
      const hit = { kind: "shake", startTick: TECHNIQUE_IMPACT_TICK, duration: 20 } as const;
      offsetX += shakeOffsetX(hit, state.eventTicks, 7, 5);
      effect = { kind: "flash", startTick: TECHNIQUE_IMPACT_TICK, duration: 20 };
    }
  } else if (event.type === "faint" && uid(event.monster) === monsterUid) {
    opacity = 1;
    effect = { kind: "faint", startTick: FAINT_SINK_TICK, duration: 30 };
  } else if (event.type === "capture" && uid(event.target) === monsterUid && event.success === true) {
    effect = { kind: "flash", startTick: CAPTURE_FLIGHT_TICKS, duration: 20 };
    opacity = 1 - progress(CAPTURE_FLIGHT_TICKS + 8, 14, state.eventTicks);
  }
  return { offsetX, opacity, effect };
}

export interface TrainerPresentation { offsetX: number; opacity: number }

export function trainerPresentation(state: RuntimeBattleState, side: 0 | 1): TrainerPresentation {
  const event = currentPresentationEvent(state);
  if (event?.type !== "sendOut" || number(event.side, -1) !== side) return { offsetX: 0, opacity: 0 };
  const prior = state.battle.events.slice(0, state.eventCursor).some((candidate) =>
    candidate.type === "sendOut" && number(candidate.side, -1) === side
  );
  if (prior) return { offsetX: 0, opacity: 0 };
  const slide = progress(0, 16, state.eventTicks);
  return {
    offsetX: Math.round((1 - slide) * (side === 0 ? -150 : 150)),
    opacity: 1 - progress(26, 8, state.eventTicks),
  };
}

export interface BallPresentation {
  kind: "sendOut" | "capture" | "none";
  item: string | null;
  x: number;
  y: number;
  opacity: number;
  shake: number;
}

export function ballPresentation(state: RuntimeBattleState): BallPresentation {
  const event = currentPresentationEvent(state);
  if (event?.type === "sendOut") {
    const side = number(event.side, 0) === 1 ? 1 : 0;
    const p = progress(16, 18, state.eventTicks);
    const fromX = side === 0 ? 20 : 438;
    const toX = side === 0 ? 136 : 352;
    const fromY = side === 0 ? 150 : 30;
    const toY = side === 0 ? 112 : 56;
    return {
      kind: "sendOut",
      item: null,
      x: Math.round(fromX + (toX - fromX) * p),
      y: Math.round(fromY + (toY - fromY) * p - Math.sin(p * Math.PI) * 30),
      opacity: state.eventTicks >= 16 && state.eventTicks < 34 ? 1 : 0,
      shake: 0,
    };
  }
  if (event?.type === "capture") {
    const p = progress(0, CAPTURE_FLIGHT_TICKS, state.eventTicks);
    const landedTicks = Math.max(0, state.eventTicks - CAPTURE_FLIGHT_TICKS);
    const shakes = Math.max(1, Math.trunc(number(event.shakes, 1)));
    const shakeWindow = shakes * CAPTURE_SHAKE_TICKS;
    const shaking = landedTicks < shakeWindow;
    return {
      kind: "capture",
      item: String(event.item ?? ""),
      x: Math.round(150 + (352 - 150) * p),
      y: Math.round(124 + (48 - 124) * p - Math.sin(p * Math.PI) * 48),
      opacity: 1 - progress(CAPTURE_FLIGHT_TICKS + shakeWindow + 8, 10, state.eventTicks),
      shake: shaking ? Math.round(Math.sin(landedTicks / CAPTURE_SHAKE_TICKS * Math.PI * 2) * 7) : 0,
    };
  }
  return { kind: "none", item: null, x: 0, y: 0, opacity: 0, shake: 0 };
}

export interface AnimationPresentation {
  animation: BattleAnimationRef | null;
  frameKeys: string[];
  frameTicks: number;
  startTick: number;
  page: BattleAnimationPage | null;
  sourceX: number;
  sourceY: number;
  target: number | null;
  opacity: number;
}

export function animationPresentation(state: RuntimeBattleState): AnimationPresentation {
  const event = currentPresentationEvent(state);
  const animation = eventAnimation(state, event) ?? null;
  const startTick = 8;
  if (!animation || !event) {
    return { animation: null, frameKeys: [], frameTicks: 1, startTick, page: null, sourceX: 0, sourceY: 0, target: null, opacity: 0 };
  }
  const frameKeys = animation.pages.flatMap((page) => Array.from({ length: page.frames }, () => page.key));
  const ticks = animationFrameTicks(animation);
  const index = frameIndexAt(state.eventTicks, startTick, ticks, frameKeys.length, false);
  const page = animation.pages.find((candidate) =>
    index >= candidate.firstFrame && index < candidate.firstFrame + candidate.frames
  ) ?? animation.pages[0] ?? null;
  const local = page ? index - page.firstFrame : 0;
  return {
    animation,
    frameKeys,
    frameTicks: ticks,
    startTick,
    page,
    sourceX: page ? (local % page.columns) * page.frameWidth : 0,
    sourceY: page ? Math.floor(local / page.columns) * page.frameHeight : 0,
    target: uid(event.target),
    opacity: state.eventTicks >= startTick && state.eventTicks < startTick + frameKeys.length * ticks ? 1 : 0,
  };
}

function rewardForFaint(state: RuntimeBattleState, event: BattleEvent | null): RewardEvent | null {
  if (event?.type !== "faint") return null;
  const loser = uid(event.monster);
  return state.battle.rewards.find((reward) => reward.loser === loser) ?? null;
}

function rewardFaintIndex(state: RuntimeBattleState, reward: RewardEvent): number {
  return state.battle.events.findIndex((event) => event.type === "faint" && uid(event.monster) === reward.loser);
}

export function presentationExperience(state: RuntimeBattleState, monsterUid: number): number {
  const monster = state.battle.parties.flat().find((candidate) => candidate.uid === monsterUid);
  if (!monster) return 0;
  const staged = state.presentationRewards.flatMap((reward) => reward.winners
    .filter((winner) => winner.uid === monsterUid)
    .map((winner) => ({ eventIndex: reward.eventIndex, winner })))
    .sort((a, b) => a.eventIndex - b.eventIndex);
  if (staged.length > 0) {
    let experience = staged[0]!.winner.before.totalExperience;
    for (const { eventIndex, winner } of staged) {
      if (eventIndex < state.eventCursor) experience = winner.after.totalExperience;
      else if (eventIndex === state.eventCursor) {
        experience = tweenAt({
          from: winner.before.totalExperience,
          to: winner.after.totalExperience,
          startTick: REWARD_TICK,
          duration: 20,
        }, state.eventTicks);
      } else break;
    }
    return Math.max(0, experience);
  }
  let experience = monster.totalExperience;
  for (const reward of state.battle.rewards) {
    const winner = reward.winners.find((candidate) => candidate.uid === monsterUid);
    if (!winner) continue;
    const index = rewardFaintIndex(state, reward);
    if (index > state.eventCursor || index < 0) experience -= winner.effectiveExperience;
    else if (index === state.eventCursor) {
      const earned = tweenAt({ from: 0, to: winner.effectiveExperience, startTick: REWARD_TICK, duration: 20 }, state.eventTicks);
      experience -= winner.effectiveExperience - earned;
    }
  }
  return Math.max(0, experience);
}

export function presentationLevel(state: RuntimeBattleState, monsterUid: number): number {
  const monster = state.battle.parties.flat().find((candidate) => candidate.uid === monsterUid);
  if (!monster) return 1;
  const staged = state.presentationRewards.flatMap((reward) => reward.winners
    .filter((winner) => winner.uid === monsterUid)
    .map((winner) => ({ eventIndex: reward.eventIndex, winner })))
    .sort((a, b) => a.eventIndex - b.eventIndex);
  if (staged.length > 0) {
    let level = staged[0]!.winner.before.level;
    for (const { eventIndex, winner } of staged) {
      if (eventIndex < state.eventCursor || (eventIndex === state.eventCursor && state.eventTicks >= REWARD_TICK + 18)) {
        level = winner.after.level;
      } else break;
    }
    return Math.max(1, level);
  }
  let level = monster.level;
  for (const reward of state.battle.rewards) {
    const winner = reward.winners.find((candidate) => candidate.uid === monsterUid);
    if (!winner) continue;
    const index = rewardFaintIndex(state, reward);
    if (index > state.eventCursor || index < 0 || (index === state.eventCursor && state.eventTicks < REWARD_TICK + 18)) {
      level -= winner.levelsGained;
    }
  }
  return Math.max(1, level);
}

export function presentationMaxHp(state: RuntimeBattleState, monsterUid: number): number {
  const monster = state.battle.parties.flat().find((candidate) => candidate.uid === monsterUid);
  if (!monster) return 1;
  const staged = state.presentationRewards.flatMap((reward) => reward.winners
    .filter((winner) => winner.uid === monsterUid)
    .map((winner) => ({ eventIndex: reward.eventIndex, winner })))
    .sort((a, b) => a.eventIndex - b.eventIndex);
  if (staged.length === 0) return monster.base.hp;
  let maxHp = staged[0]!.winner.before.maxHp;
  for (const { eventIndex, winner } of staged) {
    if (eventIndex < state.eventCursor || (eventIndex === state.eventCursor && state.eventTicks >= REWARD_TICK + 18)) {
      maxHp = winner.after.maxHp;
    } else break;
  }
  return Math.max(1, maxHp);
}

export function currentReward(state: RuntimeBattleState): RewardEvent | null {
  return rewardForFaint(state, currentPresentationEvent(state));
}
