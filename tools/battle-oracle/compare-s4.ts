/**
 * Compare the product battle reducer against Scout S4's 200 one-on-one
 * traces. This is a development bridge; committed GB2 golden tests use the
 * same normalizer without requiring Python or files outside this repository.
 *
 * Usage:
 *   bun tools/battle-oracle/compare-s4.ts ORACLE.json TUXDB.json
 */
import { readFileSync } from "node:fs";

import { runPolicyBattle } from "../../battle/index.ts";
import type {
  BattleEvent,
  MonsterSnapshot,
  TuxemonBattleDb,
  TuxemonBattleState,
} from "../../battle/index.ts";

interface OracleMonster {
  slug: string;
  level: number;
  stats: MonsterSnapshot["base"];
  moves: string[];
}

interface OracleBattle {
  player: string;
  billie: string;
  battle_seed: number;
  battle_draws: number;
  policy: "first" | "cycle";
  monsters: { player: OracleMonster; billie: OracleMonster };
  log: Array<Record<string, unknown>>;
  error?: string;
}

type JsonRecord = Record<string, unknown>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as JsonRecord).sort().map((key) => [
        key,
        canonical((value as JsonRecord)[key]),
      ]),
    );
  }
  return value;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function oracleOutcome(event: JsonRecord): string {
  const remaining = event.remaining as string[] | undefined;
  if (!remaining || remaining.length === 0) return "draw";
  return remaining[0] === "player" ? "won" : "lost";
}

export function normalizeOracle(log: OracleBattle["log"]): unknown[] {
  return log.map((event) => {
    const normalized: JsonRecord = { ...event };
    if (normalized.ev === "round") {
      normalized.hit = Object.values(normalized.hit as Record<string, number>)
        .map(round6)
        .sort((a, b) => a - b);
    }
    if (normalized.ev === "tech") {
      delete normalized.mult;
      delete normalized.success;
    }
    if (normalized.ev === "status") {
      delete normalized.success;
      delete normalized.hp;
    }
    if (normalized.ev === "decide") delete normalized.who;
    if (normalized.ev === "end") {
      return canonical({ ev: "end", turn: normalized.turn, outcome: oracleOutcome(normalized) });
    }
    return canonical(normalized);
  });
}

function keyedBySlug(
  values: Record<string, unknown>,
  slugByUid: Record<string, string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([uid, value]) => [slugByUid[uid]!, value]),
  );
}

export function normalizeReducer(state: TuxemonBattleState): unknown[] {
  const monsters = [...state.parties[0], ...state.parties[1]];
  const slugByUid = Object.fromEntries(monsters.map((monster) => [String(monster.uid), monster.slug]));
  const slug = (uid: unknown): string => slugByUid[String(uid)]!;
  const result: unknown[] = [];

  for (const raw of state.events) {
    const event = raw as BattleEvent & JsonRecord;
    switch (event.type) {
      case "round":
        result.push(canonical({
          ev: "round",
          turn: event.turn,
          hit: Object.values(event.hit as Record<string, number>).map(round6).sort((a, b) => a - b),
        }));
        break;
      case "decision":
        result.push(canonical({ ev: "decide", turn: event.turn, tech: event.technique }));
        break;
      case "technique": {
        const statuses = keyedBySlug(event.statuses as Record<string, string | null>, slugByUid);
        result.push(canonical({
          ev: "tech",
          turn: event.turn,
          user: slug(event.user),
          tech: event.technique,
          target: slug(event.target),
          hit: event.hit,
          damage: event.damage,
          hp: keyedBySlug(event.hp as Record<string, number>, slugByUid),
          hp_before: keyedBySlug(event.hpBefore as Record<string, number>, slugByUid),
          status: Object.fromEntries(
            Object.entries(statuses).map(([name, status]) => [name, status ? [status] : []]),
          ),
        }));
        break;
      }
      case "status":
        result.push(canonical({
          ev: "status",
          turn: event.turn,
          status: event.status,
          target: slug(event.target),
        }));
        break;
      case "faint":
        result.push(canonical({ ev: "faint", turn: event.turn, mon: slug(event.monster) }));
        break;
      case "end":
        result.push(canonical({ ev: "end", turn: event.turn, outcome: event.outcome }));
        break;
      case "sendOut":
        // Initial/swap presentation is outside S4's headless trace hook.
        break;
      default:
        throw new Error(`unmapped reducer event '${event.type}'`);
    }
  }
  return result;
}

function snapshot(monster: OracleMonster): MonsterSnapshot {
  return {
    slug: monster.slug,
    level: monster.level,
    base: monster.stats,
    moves: monster.moves,
  };
}

export function compareS4Battle(db: TuxemonBattleDb, oracle: OracleBattle): string | null {
  const state = runPolicyBattle(db, {
    seed: oracle.battle_seed,
    policy: oracle.policy,
    player: [snapshot(oracle.monsters.player)],
    enemy: [snapshot(oracle.monsters.billie)],
  });
  const expected = normalizeOracle(oracle.log);
  const actual = normalizeReducer(state);
  if (state.rngDraws !== oracle.battle_draws) {
    return `RNG draws ${state.rngDraws} != ${oracle.battle_draws}`;
  }
  const count = Math.max(expected.length, actual.length);
  for (let index = 0; index < count; index++) {
    if (JSON.stringify(expected[index]) !== JSON.stringify(actual[index])) {
      return `event ${index}\n  py: ${JSON.stringify(expected[index])}\n  ts: ${JSON.stringify(actual[index])}`;
    }
  }
  return null;
}

if (import.meta.main) {
  const oraclePath = process.argv[2];
  const dbPath = process.argv[3];
  if (!oraclePath || !dbPath) {
    throw new Error("usage: bun tools/battle-oracle/compare-s4.ts ORACLE.json TUXDB.json");
  }
  const db = JSON.parse(readFileSync(dbPath, "utf8")) as TuxemonBattleDb;
  const battles = JSON.parse(readFileSync(oraclePath, "utf8")) as OracleBattle[];
  let identical = 0;
  let different = 0;
  let skipped = 0;
  for (const battle of battles) {
    if (battle.error) {
      skipped++;
      continue;
    }
    const difference = compareS4Battle(db, battle);
    if (!difference) {
      identical++;
      continue;
    }
    different++;
    console.error(
      `DIFF ${battle.player} vs ${battle.billie} seed=${battle.battle_seed} policy=${battle.policy}: ${difference}`,
    );
  }
  const summary = { battles: battles.length, identical, different, skipped };
  console.log(JSON.stringify(summary));
  if (different > 0 || skipped > 0) process.exitCode = 1;
}
