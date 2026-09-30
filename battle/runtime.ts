import type {
  BattleCompletion,
  BattleInput,
  BattleRules,
} from "../vendor/pocket-rpgkit/src/engine/battle.ts";
import type { ExtensionReadContext } from "../vendor/pocket-rpgkit/src/engine/extensions.ts";
import type { JsonValue } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import type { BattleDb, BattleImageRef } from "../importer/battle-schema.ts";
import {
  initialTuxemonExtensionState,
  KENNEL_LIMIT,
  packTuxemonExtensionState,
  PARTY_LIMIT,
  releaseBattleDb,
  resolveBattleDb,
  tuxemonExtensionState,
  type BattleDbSource,
  type PendingMonster,
  type TuxemonExtensionState,
} from "./extension.ts";
import { battleDbToTuxemonBattleDb } from "./from-battle-db.ts";
import { nextRandom, type RngState } from "./core.ts";
import { spawnMonster } from "./spawn.ts";
import {
  canRun,
  canSwap,
  canUseBattleItem,
  getMonster,
  getSide,
  createBattle,
  reduceBattle,
  usableMoves,
} from "./tuxemon.ts";
import type {
  BattleEvent,
  BattleMonster,
  SpawnedMonsterSnapshot,
  TuxemonBattleDb,
  TuxemonBattleState,
} from "./types.ts";

export const TUXEMON_BATTLE_STATE_FORMAT = "pocket-tuxemon/battle-runtime/v1";
export const BATTLE_EVENT_TICKS = 12;

export type VariableEnums = Readonly<Record<string, readonly string[]>>;

export interface BattlePartyMemberSetup {
  species: string;
  level: number;
  experienceModifier?: number;
  moneyModifier?: number;
  iid?: string;
}

export interface TrainerBattleSetup {
  kind: "trainer";
  opponent: string;
  party?: BattlePartyMemberSetup[];
  fieldSize?: 1 | 2;
  environment?: string;
  inside?: boolean;
  hour?: number;
}

export interface WildBattleSetup {
  kind: "wild";
  species: string;
  level: number;
  experienceModifier?: number;
  moneyModifier?: number;
  environment?: string;
  inside?: boolean;
  hour?: number;
}

export interface RandomBattleSetup {
  kind: "random";
  table: string;
  probability?: number;
  /** Optional already-resolved world values for encounter-row filtering. */
  variables?: Record<string, string | number | boolean>;
  environment?: string;
  inside?: boolean;
  hour?: number;
}

export type TuxemonBattleSetup = TrainerBattleSetup | WildBattleSetup | RandomBattleSetup;

export interface RuntimeBattleState {
  format: typeof TUXEMON_BATTLE_STATE_FORMAT;
  battle: TuxemonBattleState;
  ext: TuxemonExtensionState;
  /** Session wallet at battle entry; rewards are added on completion. */
  startingGold: number;
  environment: string;
  visuals: {
    background: BattleImageRef;
    monsters: Record<string, BattleDb["monsters"][string]["art"]>;
  };
  menu: BattleMenuEntry[];
  menuMode: BattleMenuMode;
  eventCursor: number;
  eventTicks: number;
  menuIndex: number;
}

export type BattleMenuMode = "root" | "technique" | "item" | "capture" | "swap";

export interface BattleMenuEntry {
  kind: "fight" | "technique" | "item" | "capture" | "run" | "replacement";
  slug: string;
  cooldown: number;
  /** Present in doubles, where each move/target pair is a distinct choice. */
  target?: number;
  targetSlug?: string;
  targetSlot?: number;
  quantity?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const safeInteger = (value: unknown): value is number =>
  finite(value) && Number.isSafeInteger(value);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asJson(value: RuntimeBattleState | TuxemonExtensionState): JsonValue {
  return value as unknown as JsonValue;
}

function setupRecord(value: JsonValue): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Tuxemon battle setup must be an object");
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Tuxemon battle setup ${label} must be a non-empty string`);
  }
  return value;
}

function optionalFinite(value: unknown, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!finite(value)) throw new Error(`Tuxemon battle setup ${label} must be finite`);
  return value;
}

function level(value: unknown): number {
  if (!safeInteger(value)) throw new Error("Tuxemon battle setup level must be an integer");
  return value;
}

function commonSetup(raw: Record<string, unknown>, db: BattleDb, activeEnvironment: string | null) {
  const environment = raw.environment === undefined
    ? activeEnvironment
    : requiredString(raw.environment, "environment");
  if (environment === null) return null;
  if (!(environment in db.environments)) {
    throw new Error(`Tuxemon battle setup references unknown environment '${environment}'`);
  }
  const hour = raw.hour === undefined ? 12 : raw.hour;
  if (!safeInteger(hour) || hour < 0 || hour > 23) {
    throw new Error("Tuxemon battle setup hour must be an integer in 0..23");
  }
  if (raw.inside !== undefined && typeof raw.inside !== "boolean") {
    throw new Error("Tuxemon battle setup inside must be boolean");
  }
  return { environment, hour, inside: raw.inside === true };
}

function parsePartyMember(value: unknown): BattlePartyMemberSetup {
  if (!isRecord(value)) throw new Error("Tuxemon battle party member must be an object");
  const member: BattlePartyMemberSetup = {
    species: requiredString(value.species, "party species"),
    level: level(value.level),
    experienceModifier: optionalFinite(value.experienceModifier, 1, "experienceModifier"),
    moneyModifier: optionalFinite(value.moneyModifier, 0, "moneyModifier"),
  };
  if (value.iid !== undefined) member.iid = requiredString(value.iid, "party iid");
  return member;
}

function parseSetup(value: JsonValue, db: BattleDb, activeEnvironment: string | null): TuxemonBattleSetup | null {
  const raw = setupRecord(value);
  const common = commonSetup(raw, db, activeEnvironment);
  if (common === null) return null;
  switch (raw.kind) {
    case "trainer": {
      const opponent = requiredString(raw.opponent ?? raw.npc, "opponent");
      if (raw.party !== undefined && !Array.isArray(raw.party)) {
        throw new Error("Tuxemon battle setup party must be an array");
      }
      if (raw.fieldSize !== undefined && raw.fieldSize !== 1 && raw.fieldSize !== 2) {
        throw new Error("Tuxemon battle setup fieldSize must be 1 or 2");
      }
      return {
        kind: "trainer",
        opponent,
        ...(raw.party === undefined ? {} : { party: raw.party.map(parsePartyMember) }),
        ...(raw.fieldSize === 2 ? { fieldSize: 2 as const } : {}),
        ...common,
      };
    }
    case "wild":
      return {
        kind: "wild",
        species: requiredString(raw.species, "species"),
        level: level(raw.level),
        experienceModifier: optionalFinite(raw.experienceModifier, 1, "experienceModifier"),
        moneyModifier: optionalFinite(raw.moneyModifier, 0, "moneyModifier"),
        ...common,
      };
    case "random": {
      const variables = raw.variables;
      if (variables !== undefined && !isRecord(variables)) {
        throw new Error("Tuxemon battle setup variables must be an object");
      }
      const resolved: Record<string, string | number | boolean> = {};
      for (const [key, entry] of Object.entries(variables ?? {})) {
        if (typeof entry !== "string" && typeof entry !== "number" && typeof entry !== "boolean") {
          throw new Error(`Tuxemon battle setup variable '${key}' must be scalar`);
        }
        resolved[key] = entry;
      }
      return {
        kind: "random",
        table: requiredString(raw.table, "table"),
        probability: optionalFinite(raw.probability ?? raw.p, 1, "probability"),
        ...(variables === undefined ? {} : { variables: resolved }),
        ...common,
      };
    }
    default:
      throw new Error(`Tuxemon battle setup kind '${String(raw.kind)}' is unsupported`);
  }
}

function legalParty(party: readonly { currentHp?: number; moves: readonly string[] }[]): boolean {
  return party.length > 0
    && party.some((monster) => (monster.currentHp ?? 1) > 0)
    && party.every((monster) => monster.moves.length > 0);
}

function enemySnapshot(
  db: BattleDb,
  rulesDb: TuxemonBattleDb,
  rng: RngState,
  member: BattlePartyMemberSetup | PendingMonster,
): SpawnedMonsterSnapshot {
  const species = "species" in member ? member.species : member.slug;
  return spawnMonster(db, rulesDb, rng, species, member.level, {
    iid: member.iid,
    experienceModifier: member.experienceModifier,
    moneyModifier: member.moneyModifier,
  });
}

function encounterRows(
  db: BattleDb,
  table: string,
  variables: RandomBattleSetup["variables"],
): BattleDb["encounters"][string]["monsters"] {
  const encounter = db.encounters[table];
  if (!encounter) throw new Error(`Tuxemon battle setup references unknown encounter '${table}'`);
  if (variables === undefined) return encounter.monsters;
  return encounter.monsters.filter((row) => row.variables.every(({ key, value }) =>
    String(variables[key]) === value
  ));
}

function weightedEncounter<T extends { weight: number }>(rng: RngState, rows: readonly T[]): T {
  if (rows.length === 0) throw new Error("Tuxemon random encounter has no eligible monsters");
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  if (!(total > 0) || !Number.isFinite(total)) {
    throw new Error("Tuxemon random encounter has no positive finite weight");
  }
  const wanted = nextRandom(rng) * total;
  let cumulative = 0;
  for (const row of rows) {
    cumulative += row.weight;
    if (wanted < cumulative) return row;
  }
  return rows[rows.length - 1]!;
}

function randomLevel(rng: RngState, range: readonly [number, number]): number {
  return range[0] + Math.floor(nextRandom(rng) * (range[1] - range[0] + 1));
}

function cloneExtWithoutNpcParty(ext: TuxemonExtensionState, opponent: string): TuxemonExtensionState {
  const npcParties = { ...ext.npcParties };
  delete npcParties[opponent];
  return clone({ ...ext, npcParties });
}

function runtimeState(value: JsonValue): RuntimeBattleState {
  if (!isRecord(value) || value.format !== TUXEMON_BATTLE_STATE_FORMAT
    || !isRecord(value.battle) || !isRecord(value.ext)
    || !isRecord(value.visuals) || !isRecord(value.visuals.background)
    || !isRecord(value.visuals.monsters) || !Array.isArray(value.menu)
    || !["root", "technique", "item", "capture", "swap"].includes(String(value.menuMode))
    || !safeInteger(value.eventCursor) || value.eventCursor < 0
    || !safeInteger(value.eventTicks) || value.eventTicks < 0
    || !safeInteger(value.menuIndex) || value.menuIndex < 0
    || !safeInteger(value.startingGold) || value.startingGold < 0
    || typeof value.environment !== "string") {
    throw new Error("Tuxemon battle runtime state is invalid");
  }
  return value as unknown as RuntimeBattleState;
}

function activeOpponents(state: TuxemonBattleState, uid: number): BattleMonster[] {
  const side = getSide(state, uid);
  const targetSide = side === 0 ? 1 : 0;
  return state.field
    .filter((candidate) => getSide(state, candidate) === targetSide)
    .map((candidate) => getMonster(state, candidate));
}

export function battleMenuEntries(
  state: RuntimeBattleState,
  db: TuxemonBattleDb,
  mode: BattleMenuMode = "technique",
): BattleMenuEntry[] {
  const awaiting = state.battle.awaiting;
  if (!awaiting) return [];
  const monster = getMonster(state.battle, awaiting.uid);
  const targets = activeOpponents(state.battle, awaiting.uid);
  const techniqueEntries = (): BattleMenuEntry[] => {
    if (targets.length === 0) return [];
    const usableByTarget = new Map(targets.map((target) => [
      target.uid,
      new Set(usableMoves(db, monster, target).map(({ moveIndex }) => moveIndex)),
    ]));
    // Keep the reducer/oracle's move-major, target-minor candidate order. This
    // makes a menu index an explicit move/target choice without hidden state.
    const entries = monster.moves.flatMap((move, index) => targets.flatMap((target, targetIndex) =>
      usableByTarget.get(target.uid)!.has(index)
        ? [{
            kind: "technique" as const,
            slug: move.slug,
            cooldown: move.cooldown,
            ...(targets.length > 1 ? {
              target: target.uid,
              targetSlug: target.slug,
              targetSlot: targetIndex + 1,
            } : {}),
          }]
        : []
    ));
    return entries.length > 0
      ? entries
      : [{ kind: "technique", slug: monster.fallback, cooldown: 0 }];
  };
  const itemEntries = (capture: boolean): BattleMenuEntry[] => {
    const itemTargets = capture ? targets : state.battle.parties[0];
    return Object.keys(state.battle.inventory).sort().flatMap((slug) => {
      const quantity = state.battle.inventory[slug] ?? 0;
      if (quantity <= 0) return [];
      return itemTargets.flatMap((target, targetIndex) =>
        canUseBattleItem(db, state.battle, slug, target.uid, capture)
          ? [{
              kind: capture ? "capture" as const : "item" as const,
              slug,
              cooldown: 0,
              quantity,
              target: target.uid,
              targetSlug: target.slug,
              targetSlot: targetIndex + 1,
            }]
          : []
      );
    });
  };
  const swapEntries = (): BattleMenuEntry[] => state.battle.parties[0].flatMap((target, index) =>
    canSwap(state.battle, monster.uid, target.uid)
      ? [{
          kind: "replacement" as const,
          slug: target.slug,
          cooldown: 0,
          target: target.uid,
          targetSlug: target.slug,
          targetSlot: index + 1,
        }]
      : []
  );

  if (mode === "technique") return techniqueEntries();
  if (mode === "item") return itemEntries(false);
  if (mode === "capture") return itemEntries(true);
  if (mode === "swap") return swapEntries();

  const entries: BattleMenuEntry[] = [{ kind: "fight", slug: "fight", cooldown: 0 }];
  if (itemEntries(false).length > 0) entries.push({ kind: "item", slug: "item", cooldown: 0 });
  if (itemEntries(true).length > 0) entries.push({ kind: "capture", slug: "capture", cooldown: 0 });
  if (canRun(state.battle, monster.uid)) entries.push({ kind: "run", slug: "run", cooldown: 0 });
  if (swapEntries().length > 0) entries.push({ kind: "replacement", slug: "swap", cooldown: 0 });
  return entries;
}

function setMenu(state: RuntimeBattleState, db: TuxemonBattleDb, mode: BattleMenuMode): void {
  state.menuMode = mode;
  state.menuIndex = 0;
  state.menu = battleMenuEntries(state, db, mode);
}

function presentationDone(state: RuntimeBattleState): boolean {
  return state.eventCursor >= state.battle.events.length;
}

function advancePresentation(state: RuntimeBattleState, ticks: number, skip: boolean): void {
  if (skip && !presentationDone(state)) state.eventTicks = BATTLE_EVENT_TICKS;
  let remaining = ticks;
  while (!presentationDone(state) && (remaining > 0 || state.eventTicks >= BATTLE_EVENT_TICKS)) {
    const required = Math.max(0, BATTLE_EVENT_TICKS - state.eventTicks);
    if (required > remaining) {
      state.eventTicks += remaining;
      return;
    }
    remaining -= required;
    state.eventCursor++;
    state.eventTicks = 0;
  }
}

function boundedInteger(value: number, label: string): number {
  const integer = Math.trunc(value);
  if (!Number.isSafeInteger(integer)) throw new Error(`Tuxemon battle ${label} exceeds safe integer range`);
  return integer;
}

function writeBackMonster(
  snapshot: SpawnedMonsterSnapshot,
  monster: BattleMonster,
): SpawnedMonsterSnapshot {
  return {
    iid: snapshot.iid,
    slug: monster.slug,
    level: boundedInteger(monster.level, "level"),
    stage: monster.stage,
    gender: monster.gender,
    tasteCold: monster.tasteCold,
    tasteWarm: monster.tasteWarm,
    height: monster.height,
    weight: monster.weight,
    individualValues: { ...monster.individualValues },
    birthdate: [...monster.birthdate],
    base: { ...monster.base },
    currentHp: Math.max(0, Math.min(monster.base.hp, boundedInteger(monster.currentHp, "HP"))),
    moves: monster.moves.map((move) => move.slug),
    types: [...monster.originalTypes],
    totalExperience: Math.max(0, boundedInteger(monster.totalExperience, "experience")),
    experienceModifier: monster.experienceModifier,
    moneyModifier: monster.moneyModifier,
    bond: Math.max(0, Math.min(100, boundedInteger(monster.bond, "bond"))),
    trainingPoints: Object.fromEntries(
      Object.entries(monster.trainingPoints).map(([stat, amount]) => [
        stat,
        Math.max(0, boundedInteger(amount, `training point ${stat}`)),
      ]),
    ) as SpawnedMonsterSnapshot["trainingPoints"],
    status: monster.status?.slug ?? null,
    acquisition: monster.acquisition,
    captureDevice: monster.captureDevice,
    waitingToEvolve: monster.waitingToEvolve,
  };
}

function capturedSnapshot(monster: BattleMonster, iid: string): SpawnedMonsterSnapshot {
  return writeBackMonster({
    iid,
    slug: monster.slug,
    level: monster.level,
    stage: monster.stage,
    gender: monster.gender,
    tasteCold: monster.tasteCold,
    tasteWarm: monster.tasteWarm,
    height: monster.height,
    weight: monster.weight,
    individualValues: { ...monster.individualValues },
    birthdate: [...monster.birthdate],
    base: { ...monster.base },
    moves: monster.moves.map((move) => move.slug),
  }, monster);
}

function nextCapturedIid(state: TuxemonExtensionState): [string, number] {
  if (!Number.isSafeInteger(state.nextMonsterId + 1)) {
    throw new Error("Tuxemon battle capture exhausted the monster id space");
  }
  return [
    `txmn-${state.nextMonsterId.toString(36).padStart(6, "0")}`,
    state.nextMonsterId + 1,
  ];
}

function completedExtension(state: RuntimeBattleState): TuxemonExtensionState {
  const result = state.battle.result;
  if (!result) throw new Error("Tuxemon battle ended without a result");
  const byIid = new Map(
    state.battle.parties[0]
      .filter((monster): monster is BattleMonster & { iid: string } => typeof monster.iid === "string")
      .map((monster) => [monster.iid, monster]),
  );
  const party = state.ext.party.map((snapshot) => {
    const monster = byIid.get(snapshot.iid!);
    return monster ? writeBackMonster(snapshot, monster) : snapshot;
  });
  const kennel = [...state.ext.kennel];
  const caught = [...state.ext.caught];
  let nextMonsterId = state.ext.nextMonsterId;
  if (state.battle.capturedUid !== null) {
    const captured = getMonster(state.battle, state.battle.capturedUid);
    const allocated = nextCapturedIid({ ...state.ext, nextMonsterId });
    nextMonsterId = allocated[1];
    const snapshot = capturedSnapshot(captured, allocated[0]);
    if (party.length < PARTY_LIMIT) party.push(snapshot);
    else if (kennel.length < KENNEL_LIMIT) kennel.push(snapshot);
    if (!caught.includes(captured.slug)) caught.push(captured.slug);
  }
  const history = [...state.ext.history];
  if (state.battle.kind === "trainer") {
    const outcome = result.battleLastResult as "won" | "lost" | "draw";
    const opponentOutcome = outcome === "won" ? "lost" : outcome === "lost" ? "won" : "draw";
    history.push(
      { fighter: "player", opponent: state.battle.opponent, outcome },
      { fighter: state.battle.opponent, opponent: "player", outcome: opponentOutcome },
    );
  }
  return {
    ...clone(state.ext),
    party,
    kennel,
    caught,
    runAttempts: state.battle.runAttempts,
    history,
    nextMonsterId,
  };
}

function enumCode(enums: VariableEnums, variable: string, value: string): number {
  const index = enums[variable]?.indexOf(value) ?? -1;
  if (index < 0) throw new Error(`Tuxemon battle variable enum lacks ${variable}:${value}`);
  return index + 1;
}

function completionFor(state: RuntimeBattleState, enums: VariableEnums): BattleCompletion {
  const result = state.battle.result;
  if (!result) throw new Error("Tuxemon battle ended without a result");
  const ext = completedExtension(state);
  const kitResult = result.outcome === "won" ? "win"
    : result.outcome === "lost" ? "lose"
      : result.outcome === "draw" ? "draw" : "escape";
  const reward = Math.max(0, boundedInteger(result.gold, "reward"));
  const gold = state.startingGold + reward;
  if (!Number.isFinite(gold)) throw new Error("Tuxemon battle gold is not finite");
  const shared = {
    ext: packTuxemonExtensionState(ext),
    result: kitResult,
    items: { ...state.battle.inventory },
    gold,
  } as const;
  if (state.battle.kind !== "trainer") {
    return {
      ...shared,
      writes: {
        "v.battle_last_result": enumCode(enums, "battle_last_result", result.battleLastResult),
      },
    };
  }

  const opponent = state.battle.opponent;
  const outcome = result.battleLastResult as "won" | "lost" | "draw";
  const count = ext.history.filter((entry) =>
    entry.fighter === "player" && entry.opponent === opponent && entry.outcome === outcome
  ).length;
  const writes: Record<string, number> = {
    "v.battle_last_result": enumCode(enums, "battle_last_result", outcome),
    "v.battle_last_trainer": enumCode(enums, "battle_last_trainer", opponent),
    [`boc.${opponent}.${outcome}`]: count,
  };
  if (outcome !== "draw") {
    const winner = outcome === "won" ? "player" : opponent;
    const loser = outcome === "won" ? opponent : "player";
    writes["v.battle_last_winner"] = enumCode(enums, "battle_last_winner", winner);
    writes["v.battle_last_loser"] = enumCode(enums, "battle_last_loser", loser);
  }
  const switches: Record<string, boolean> = { [`bo.${opponent}.${outcome}`]: true };
  if (outcome === "won") switches[`defeated.${opponent}`] = true;
  else if (outcome === "lost") switches["defeated.player"] = true;
  return { ...shared, writes, switches };
}

/**
 * Game-owned adapter between Pocket RPG Kit's Battle Processing lifecycle and
 * the deterministic Tuxemon reducer. Every mutable byte is carried in the
 * returned JSON state; no module-level cursor or clock participates.
 */
export function createTuxemonBattleRules(source: BattleDbSource, enums: VariableEnums): BattleRules {
  let active: { db: BattleDb; rulesDb: TuxemonBattleDb } | null = null;
  const resources = () => {
    if (active) return active;
    const db = resolveBattleDb(source);
    active = { db, rulesDb: battleDbToTuxemonBattleDb(db) };
    return active;
  };
  const release = () => {
    active = null;
    releaseBattleDb(source);
  };
  return {
    start(extValue, setupValue, seed, context: ExtensionReadContext) {
      // Drop only a stale adapter here. A provider may have deliberately
      // warmed the source database in the immediately preceding add_monster
      // event, which keeps first-battle entry off the cold JSON path.
      active = null;
      const { db, rulesDb } = resources();
      try {
        const ext = tuxemonExtensionState(extValue, db);
        const setup = parseSetup(setupValue, db, ext.environment);
        if (setup === null || !legalParty(ext.party)) {
          release();
          return null;
        }

        const rng: RngState = { rng: seed >>> 0, rngDraws: 0 };
        let opponent: string;
        let enemy: SpawnedMonsterSnapshot[];
        let kind: "trainer" | "wild";
        let startedExt = clone(ext);

        if (setup.kind === "trainer") {
          opponent = setup.opponent;
          kind = "trainer";
          const staged = ext.npcParties[opponent] ?? [];
          const inline = setup.party ?? [];
          if (staged.length + inline.length === 0) {
            release();
            return null;
          }
          enemy = [
            ...staged.map((member) => enemySnapshot(db, rulesDb, rng, member)),
            ...inline.map((member) => enemySnapshot(db, rulesDb, rng, member)),
          ];
          if (setup.fieldSize === 2 && ext.party.length + enemy.length < 3) {
            release();
            return null;
          }
          startedExt = cloneExtWithoutNpcParty(ext, opponent);
        } else if (setup.kind === "wild") {
          opponent = `wild:${setup.species}`;
          kind = "wild";
          enemy = [enemySnapshot(db, rulesDb, rng, {
            species: setup.species,
            level: setup.level,
            experienceModifier: setup.experienceModifier,
            moneyModifier: setup.moneyModifier,
          })];
        } else {
          if (nextRandom(rng) * 100 > (setup.probability ?? 1)) {
            release();
            return null;
          }
          const row = weightedEncounter(rng, encounterRows(db, setup.table, setup.variables));
          const chosenLevel = randomLevel(rng, row.level);
          opponent = `wild:${row.monster}`;
          kind = "wild";
          enemy = [enemySnapshot(db, rulesDb, rng, {
            species: row.monster,
            level: chosenLevel,
            experienceModifier: row.experienceModifier,
            moneyModifier: 0,
          })];
        }
        if (!legalParty(enemy)) {
          release();
          return null;
        }

        const battle = createBattle(rulesDb, {
          seed: rng.rng,
          kind,
          opponent,
          player: ext.party,
          enemy,
          inside: setup.inside,
          hour: setup.hour,
          fieldSize: setup.kind === "trainer" ? setup.fieldSize ?? 1 : 1,
          moneyMethod: "conserved",
          inventory: context.items,
          runAttempts: ext.runAttempts,
        });
        const environment = setup.environment ?? ext.environment!;
        const background = db.environments[environment]?.background ?? db.environments.grass?.background;
        if (!background) throw new Error(`Tuxemon battle environment '${environment}' has no background`);
        const monsters = Object.fromEntries(
          battle.parties.flat().map((monster) => [monster.slug, db.monsters[monster.slug]!.art]),
        );
        const state: RuntimeBattleState = {
          format: TUXEMON_BATTLE_STATE_FORMAT,
          battle,
          ext: startedExt,
          startingGold: context.gold,
          environment,
          visuals: { background, monsters },
          menu: [],
          menuMode: "root",
          eventCursor: 0,
          eventTicks: 0,
          menuIndex: 0,
        };
        state.menu = battleMenuEntries(state, rulesDb, "root");
        return { state: asJson(state), ext: packTuxemonExtensionState(startedExt) };
      } catch (error) {
        release();
        throw error;
      }
    },

    step(value, input: Readonly<BattleInput>, ticks) {
      if (!safeInteger(ticks) || ticks < 0) throw new Error("Tuxemon battle ticks must be non-negative integer");
      const state = clone(runtimeState(value));
      if (!presentationDone(state)) {
        advancePresentation(state, ticks, input.confirmEdge === true);
        return asJson(state);
      }
      if (state.battle.phase === "ended" || !state.battle.awaiting) return asJson(state);

      const { rulesDb } = resources();
      const choices = state.menu;
      if (input.cancelEdge && state.menuMode !== "root") {
        setMenu(state, rulesDb, "root");
        return asJson(state);
      }
      if (choices.length === 0) return asJson(state);
      if (input.upEdge) state.menuIndex = (state.menuIndex + choices.length - 1) % choices.length;
      if (input.downEdge) state.menuIndex = (state.menuIndex + 1) % choices.length;
      if (input.confirmEdge) {
        const index = Math.min(state.menuIndex, choices.length - 1);
        const selected = choices[index]!;
        if (state.menuMode === "root" && selected.kind !== "run") {
          const mode = selected.kind === "fight" ? "technique"
            : selected.kind === "replacement" ? "swap"
              : selected.kind;
          setMenu(state, rulesDb, mode);
          return asJson(state);
        }
        if (selected.kind === "technique") {
          state.battle = reduceBattle(rulesDb, state.battle, { type: "technique", choice: index });
        } else if (selected.kind === "item" || selected.kind === "capture") {
          state.battle = reduceBattle(rulesDb, state.battle, {
            type: selected.kind,
            item: selected.slug,
            target: selected.target!,
          });
        } else if (selected.kind === "replacement") {
          state.battle = reduceBattle(rulesDb, state.battle, { type: "replacement", uid: selected.target! });
        } else if (selected.kind === "run") {
          state.battle = reduceBattle(rulesDb, state.battle, { type: "run" });
        }
        state.eventTicks = 0;
        setMenu(state, rulesDb, "root");
      }
      return asJson(state);
    },

    done(value) {
      const state = runtimeState(value);
      if (state.battle.phase !== "ended" || !presentationDone(state)) return null;
      try {
        return completionFor(state, enums);
      } finally {
        release();
      }
    },
  };
}

export function currentBattleEvent(state: RuntimeBattleState): BattleEvent | null {
  return state.battle.events[state.eventCursor] ?? null;
}

/** Test/UI helper: validates and narrows the opaque scene JSON. */
export function tuxemonRuntimeBattleState(value: JsonValue): RuntimeBattleState {
  return runtimeState(value);
}

/** Allows isolated renderer fixtures to start from a valid empty extension. */
export function emptyRuntimeExtension(): JsonValue {
  return packTuxemonExtensionState(initialTuxemonExtensionState());
}
