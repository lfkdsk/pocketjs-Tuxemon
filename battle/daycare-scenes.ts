import type { ExtensionReadContext } from "../vendor/pocket-rpgkit/src/engine/extensions.ts";
import { rngNext } from "../vendor/pocket-rpgkit/src/engine/interpreter.ts";
import type { SceneCompletion, SceneInput, SceneRules } from "../vendor/pocket-rpgkit/src/engine/scene.ts";
import type { JsonValue } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import {
  daycareMode,
  daycareReady,
  depositDaycareParent,
  produceDaycareNewborn,
} from "./daycare.ts";
import {
  KENNEL_LIMIT,
  PARTY_LIMIT,
  nextMonsterIid,
  packTuxemonExtensionState,
  registerCaughtMonster,
  resolveBattleDb,
  tuxemonExtensionState,
  type BattleDbSource,
  type TuxemonExtensionState,
} from "./extension.ts";
import { battleDbToTuxemonBattleDb } from "./from-battle-db.ts";
import { civilFromEpochDay } from "./time-weather.ts";
import type { DaycareExtensionState, SpawnedMonsterSnapshot, TuxemonBattleDb } from "./types.ts";

export const TUXEMON_DAYCARE_SCENE_ID = "tux.daycare";

type Names = (slug: string) => string;

function record(value: JsonValue | undefined): Record<string, JsonValue> {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : {};
}

function text(value: JsonValue | undefined, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function wrap(index: number, length: number): number {
  return length > 0 ? (index + length) % length : 0;
}

function stateOf<T>(value: JsonValue): T {
  return value as unknown as T;
}

function seededRandom(seed: number): { random: () => number; cursor: () => number } {
  let cursor = seed >>> 0;
  return {
    random() {
      const next = rngNext(cursor);
      cursor = next.next;
      return next.value;
    },
    cursor: () => cursor,
  };
}

export interface DaycareLabels {
  summary: string;
  parents: string;
  empty: string;
  mode: string;
  thanks: string;
  add: string;
  withdraw: string;
  collect: string;
  modeTraining: string;
  modeBreeding: string;
  modeIncompatible: string;
  modeEmpty: string;
  training: string;
  expTotal: string;
  costTotal: string;
  expPerStep: string;
  costPerStep: string;
  expPerStepTotal: string;
  costPerStepTotal: string;
  trainingSingle: string;
  trainingDouble: string;
  trainingInactive: string;
  breeding: string;
  progress: string;
  ready: string;
  halfway: string;
  notReady: string;
  noBreeding: string;
  full: string;
  select: string;
  back: string;
  upKey: string;
  downKey: string;
  leftKey: string;
  rightKey: string;
  primaryKey: string;
  secondaryKey: string;
  male: string;
  female: string;
  neuter: string;
}

const DAYCARE_LABELS: DaycareLabels = {
  summary: "Daycare Summary",
  parents: "Parents in Daycare",
  empty: "No monsters stored.",
  mode: "Mode",
  thanks: "Thanks for using the Daycare!",
  add: "Add Tuxemon",
  withdraw: "Withdraw All",
  collect: "Collect Newborn",
  modeTraining: "Training",
  modeBreeding: "Breeding",
  modeIncompatible: "Training (Incompatible Pair)",
  modeEmpty: "Empty",
  training: "Training Info",
  expTotal: "Total EXP Gained",
  costTotal: "Total Cost Paid",
  expPerStep: "EXP per Step (per monster)",
  costPerStep: "Cost per Step (per monster)",
  expPerStepTotal: "Total EXP per Step",
  costPerStepTotal: "Total Cost per Step",
  trainingSingle: "Training Active (1 monster)",
  trainingDouble: "Training Active (2 monsters)",
  trainingInactive: "Training Inactive",
  breeding: "Breeding Info",
  progress: "Progress",
  ready: "Newborn Ready!",
  halfway: "Halfway There",
  notReady: "Not Ready Yet",
  noBreeding: "No breeding possible.",
  full: "This shelter is full.",
  select: "Select",
  back: "Back",
  upKey: "Up Key",
  downKey: "Down Key",
  leftKey: "Left Key",
  rightKey: "Right Key",
  primaryKey: "Action Key",
  secondaryKey: "Cancel Key",
  male: "Male",
  female: "Female",
  neuter: "Neuter",
};

function labels(raw: JsonValue | undefined): DaycareLabels {
  const source = record(raw);
  const result = { ...DAYCARE_LABELS };
  for (const key of Object.keys(result) as Array<keyof DaycareLabels>) {
    result[key] = text(source[key], result[key]);
  }
  return result;
}

export type DaycareMenuItem = "add" | "collect" | "withdraw" | "exit";

export interface DaycareSceneState {
  kind: "daycare";
  base: JsonValue;
  labels: DaycareLabels;
  party: SpawnedMonsterSnapshot[];
  kennel: SpawnedMonsterSnapshot[];
  daycare?: DaycareExtensionState;
  nextMonsterId: number;
  newbornSlugs: string[];
  monsterNames: Record<string, string>;
  rng: number;
  /** Index into daycareTextPages(); long translations add pages, never ellipses. */
  page: number;
  phase: "summary" | "party" | "done";
  cursor: number;
  partyCursor: number;
  message: string | null;
}

export function daycareMenuItems(state: Readonly<DaycareSceneState>): DaycareMenuItem[] {
  const result: DaycareMenuItem[] = [];
  if ((state.daycare?.parents.length ?? 0) < 2 && state.party.length > 0) result.push("add");
  if (state.daycare && daycareReady(state.daycare)) result.push("collect");
  if ((state.daycare?.parents.length ?? 0) > 0) result.push("withdraw");
  result.push("exit");
  return result;
}

/** Word-wrap plus hard-wrap for an individual overlong token. */
export function daycareWrapAll(value: string, columns = 42): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    let current = "";
    for (const rawWord of paragraph.split(/\s+/).filter(Boolean)) {
      let word = rawWord;
      if (current && current.length + 1 + word.length <= columns) {
        current += ` ${word}`;
        continue;
      }
      if (current) {
        lines.push(current);
        current = "";
      }
      while (word.length > columns) {
        lines.push(word.slice(0, columns));
        word = word.slice(columns);
      }
      current = word;
    }
    if (current) lines.push(current);
    if (paragraph.length === 0) lines.push("");
  }
  return lines.length > 0 ? lines : [""];
}

function daycareModeLabel(state: Readonly<DaycareSceneState>): string {
  switch (daycareMode(state.daycare?.parents ?? [])) {
    case "training": return state.labels.modeTraining;
    case "incompatible": return state.labels.modeIncompatible;
    case "breeding": return state.labels.modeBreeding;
    case "empty": return state.labels.modeEmpty;
  }
}

function genderLabel(state: Readonly<DaycareSceneState>, gender: SpawnedMonsterSnapshot["gender"]): string {
  if (gender === "male") return state.labels.male;
  if (gender === "female") return state.labels.female;
  return state.labels.neuter;
}

/** All localized copy is wrapped and chunked into explicit pages. Nothing is
 * sliced or replaced with an ellipsis. */
export function daycareTextPages(
  state: Readonly<DaycareSceneState>,
  columns = 42,
  linesPerPage = 11,
): string[][] {
  const parents = state.daycare?.parents ?? [];
  const trainingCount = parents.length === 1 ? 1
    : parents.length === 2 && daycareMode(parents) === "incompatible" ? 2
      : 0;
  const groups: string[][] = [[
    state.labels.summary,
    `${state.labels.parents} (${parents.length}/2)`,
    ...(parents.length === 0
      ? [state.labels.empty]
      : parents.map((parent) => `• ${state.monsterNames[parent.iid!] ?? parent.nickname ?? parent.slug} (${parent.level}, ${genderLabel(state, parent.gender)})`)),
    `${state.labels.mode}: ${daycareModeLabel(state)}`,
    state.labels.thanks,
  ], [
    state.labels.training,
    `${state.labels.expTotal}: ${state.daycare?.lastTrainingExp ?? 0}`,
    `${state.labels.costTotal}: ${state.daycare?.lastTrainingCost ?? 0}`,
    `${state.labels.expPerStep}: 0.25 × ${trainingCount}`,
    `${state.labels.costPerStep}: 1 × ${trainingCount}`,
    `${state.labels.expPerStepTotal}: ${0.25 * trainingCount}`,
    `${state.labels.costPerStepTotal}: ${trainingCount}`,
    trainingCount === 1 ? state.labels.trainingSingle
      : trainingCount === 2 ? state.labels.trainingDouble : state.labels.trainingInactive,
  ], [
    state.labels.breeding,
    ...(state.daycare && daycareMode(state.daycare.parents) === "breeding"
      ? [
          `${state.labels.progress}: ${state.daycare.progressSteps}/10000`,
          daycareReady(state.daycare) ? state.labels.ready
            : state.daycare.progressSteps >= 5_000 ? state.labels.halfway : state.labels.notReady,
        ]
      : [state.labels.noBreeding]),
  ]];
  return groups.flatMap((group) => {
    const wrapped = group.flatMap((line) => daycareWrapAll(line, columns));
    const pages: string[][] = [];
    for (let offset = 0; offset < wrapped.length; offset += linesPerPage) {
      pages.push(wrapped.slice(offset, offset + linesPerPage));
    }
    return pages;
  });
}

function freeMonsterSlots(state: Readonly<DaycareSceneState>): number {
  return PARTY_LIMIT - state.party.length + KENNEL_LIMIT - state.kennel.length;
}

function routeMonster(state: DaycareSceneState, monster: SpawnedMonsterSnapshot): void {
  if (state.party.length < PARTY_LIMIT) state.party.push(monster);
  else if (state.kennel.length < KENNEL_LIMIT) state.kennel.push(monster);
  else throw new Error("daycare route has no storage space");
}

function produceNewborn(
  state: DaycareSceneState,
  source: BattleDbSource,
  rulesDb: TuxemonBattleDb,
  names: Names,
): SpawnedMonsterSnapshot {
  const db = resolveBattleDb(source);
  const rng = seededRandom(state.rng);
  const [iid, nextMonsterId] = nextMonsterIid(state.nextMonsterId);
  const civil = civilFromEpochDay(tuxemonExtensionState(state.base).clock.epochDay);
  const produced = produceDaycareNewborn(state.daycare!, {
    sourceDb: db,
    rulesDb,
    iid,
    birthdate: [civil.month, civil.day],
    nameOf: names,
    random: rng.random,
  });
  state.daycare = produced.daycare;
  state.nextMonsterId = nextMonsterId;
  state.newbornSlugs.push(produced.newborn.slug);
  state.rng = rng.cursor();
  return produced.newborn;
}

function daycareStep(
  state: DaycareSceneState,
  input: Readonly<SceneInput>,
  source: BattleDbSource,
  rulesDb: () => TuxemonBattleDb,
  names: Names,
): void {
  const up = input.upEdge === true;
  const down = input.downEdge === true;
  if (state.phase === "summary") {
    const items = daycareMenuItems(state);
    const pages = daycareTextPages(state);
    state.page = Math.min(state.page, pages.length - 1);
    state.cursor = Math.min(state.cursor, items.length - 1);
    if (input.leftEdge) state.page = wrap(state.page - 1, pages.length);
    else if (input.rightEdge) state.page = wrap(state.page + 1, pages.length);
    else if (up) state.cursor = wrap(state.cursor - 1, items.length);
    else if (down) state.cursor = wrap(state.cursor + 1, items.length);
    else if (input.cancelEdge) state.phase = "done";
    else if (input.confirmEdge) {
      state.message = null;
      const selected = items[state.cursor]!;
      if (selected === "exit") state.phase = "done";
      else if (selected === "add") {
        state.phase = "party";
        state.partyCursor = 0;
      } else if (selected === "collect") {
        if (freeMonsterSlots(state) < 1) state.message = state.labels.full;
        else {
          routeMonster(state, produceNewborn(state, source, rulesDb(), names));
          state.phase = "done";
        }
      } else {
        const needs = state.daycare!.parents.length + (daycareReady(state.daycare!) ? 1 : 0);
        if (freeMonsterSlots(state) < needs) state.message = state.labels.full;
        else {
          if (daycareReady(state.daycare!)) {
            routeMonster(state, produceNewborn(state, source, rulesDb(), names));
          }
          for (const parent of state.daycare!.parents) routeMonster(state, parent);
          delete state.daycare;
          state.phase = "done";
        }
      }
    }
    return;
  }
  if (state.phase === "party") {
    if (up) state.partyCursor = wrap(state.partyCursor - 1, state.party.length);
    else if (down) state.partyCursor = wrap(state.partyCursor + 1, state.party.length);
    else if (input.cancelEdge) state.phase = "summary";
    else if (input.confirmEdge) {
      const [parent] = state.party.splice(state.partyCursor, 1);
      if (!parent) return;
      state.daycare = depositDaycareParent(state.daycare, parent);
      state.partyCursor = Math.max(0, Math.min(state.partyCursor, state.party.length - 1));
      state.cursor = 0;
      state.phase = "summary";
    }
  }
}

function commit(state: Readonly<DaycareSceneState>): JsonValue {
  const base = tuxemonExtensionState(state.base);
  const { daycare: _oldDaycare, ...withoutDaycare } = base;
  let next: TuxemonExtensionState = {
    ...withoutDaycare,
    party: state.party,
    kennel: state.kennel,
    nextMonsterId: state.nextMonsterId,
    ...(state.kennel.length > 0 ? { kennelBox: true as const } : {}),
    ...(state.daycare === undefined ? {} : { daycare: state.daycare }),
  };
  for (const slug of state.newbornSlugs) next = registerCaughtMonster(next, slug);
  return packTuxemonExtensionState(next);
}

export function createDaycareSceneRules(source: BattleDbSource, names: Names): SceneRules {
  // A production repository returns the same lazy database object for its
  // lifetime. Convert it once per registered scene rule, never per input.
  let cachedSource: ReturnType<typeof resolveBattleDb> | null = null;
  let cachedRules: TuxemonBattleDb | null = null;
  const rulesDb = (): TuxemonBattleDb => {
    const current = resolveBattleDb(source);
    if (current !== cachedSource || cachedRules === null) {
      cachedSource = current;
      cachedRules = battleDbToTuxemonBattleDb(current);
    }
    return cachedRules;
  };
  return {
    start(ext, rawArgs, seed, _context: ExtensionReadContext) {
      const current = tuxemonExtensionState(ext);
      const state: DaycareSceneState = {
        kind: "daycare",
        base: ext,
        labels: labels(record(rawArgs).labels),
        party: [...current.party],
        kennel: [...current.kennel],
        ...(current.daycare === undefined ? {} : { daycare: structuredClone(current.daycare) }),
        nextMonsterId: current.nextMonsterId,
        newbornSlugs: [],
        monsterNames: Object.fromEntries(
          [...current.party, ...(current.daycare?.parents ?? [])]
            .map((monster) => [monster.iid!, monster.nickname ?? names(monster.slug)]),
        ),
        rng: seed >>> 0,
        page: 0,
        phase: "summary",
        cursor: 0,
        partyCursor: 0,
        message: null,
      };
      return { ext, state: state as unknown as JsonValue };
    },
    step(rawState, input) {
      daycareStep(stateOf<DaycareSceneState>(rawState), input, source, rulesDb, names);
      return rawState;
    },
    done(rawState): SceneCompletion | null {
      const state = stateOf<DaycareSceneState>(rawState);
      return state.phase === "done" ? { ext: commit(state) } : null;
    },
  };
}

export function daycareSceneMode(state: Readonly<DaycareSceneState>): ReturnType<typeof daycareMode> {
  return daycareMode(state.daycare?.parents ?? []);
}
