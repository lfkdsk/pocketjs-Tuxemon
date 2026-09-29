// Exercise every imported lockInput page in isolation and prove that the
// resulting lock is released either by unlockInput or by a map transfer.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BTN_BITS } from "../vendor/pocket-rpgkit/src/engine/camera.ts";
import { createSwitchState, type SwitchState } from "../vendor/pocket-rpgkit/src/engine/interpreter.ts";
import { canStepFrom, type Dir4 } from "../vendor/pocket-rpgkit/src/engine/passability.ts";
import { createSession, startSession, stepSession } from "../vendor/pocket-rpgkit/src/engine/session.ts";
import type { Command, Condition, Dir, GameEvent, Page, PageCondition, Project } from "../vendor/pocket-rpgkit/src/engine/types.ts";

const ROOT = resolve(import.meta.dir, "..");
const DIRS = ["down", "left", "up", "right"] as const satisfies readonly Dir[];
const DX = [0, -1, 0, 1] as const;
const DY = [1, 0, -1, 0] as const;

export interface LockCheckRow {
  map: string;
  event: string;
  name: string;
  page: number;
  trigger: Page["trigger"];
  locks: number;
  outcome: "local-unlock" | "local-transfer" | "unlocked" | "transferred" | "reachable" | "unresolved" | "error";
  lockedAt: number;
  resolvedAt: number;
  finalMap: string;
  resolutionPath?: string[];
  error?: string;
}

export interface LockCheckReport {
  format: "pocket-tuxemon/g6-lock-check/v1";
  pages: number;
  lockCommands: number;
  outcomes: Record<LockCheckRow["outcome"], number>;
  failures: LockCheckRow[];
  rows: LockCheckRow[];
}

function walk(commands: readonly Command[], visit: (command: Command) => void): void {
  for (const command of commands) {
    visit(command);
    if (command.op === "if") {
      walk(command.then, visit);
      walk(command.else ?? [], visit);
    } else if (command.op === "choices") {
      for (const option of command.options) walk(option.commands, visit);
      walk(command.cancel?.commands ?? [], visit);
    }
  }
}

function countOp(commands: readonly Command[], op: Command["op"]): number {
  let count = 0;
  walk(commands, (command) => { if (command.op === op) count++; });
  return count;
}

function containsLock(commands: readonly Command[]): boolean {
  return countOp(commands, "lockInput") > 0;
}

/** Conditions on one executable branch leading to the first lock. */
function lockPath(commands: readonly Command[]): Condition[] {
  for (const command of commands) {
    if (command.op === "lockInput") return [];
    if (command.op === "if") {
      if (containsLock(command.then)) return [command.if, ...lockPath(command.then)];
      if (containsLock(command.else ?? [])) return [...lockPath(command.else ?? [])];
    }
    if (command.op === "choices") {
      for (const option of command.options) {
        if (containsLock(option.commands)) return lockPath(option.commands);
      }
      if (containsLock(command.cancel?.commands ?? [])) return lockPath(command.cancel?.commands ?? []);
    }
  }
  return [];
}

function pageConditions(condition: PageCondition | undefined): Condition[] {
  if (!condition) return [];
  const out = [...(condition.all ?? [])];
  if (condition.switch !== undefined) out.push({ kind: "switch", id: condition.switch, value: true });
  if (condition.variable !== undefined) out.push({ kind: "variable", ...condition.variable });
  if (condition.selfSwitch !== undefined) out.push({ kind: "selfSwitch", key: condition.selfSwitch, value: true });
  if (condition.item !== undefined) out.push({ kind: "item", id: condition.item, count: 1 });
  return out;
}

function satisfy(
  conditions: readonly Condition[],
  eventKey: string,
): { sw: SwitchState; localVariables: Record<string, number>; facing: Dir } {
  const sw = createSwitchState({ variables: { "sys.party_size": 1 }, gold: 999_999 });
  const localVariables: Record<string, number> = {};
  let facing: Dir = "down";
  for (const condition of conditions) {
    if (condition.kind === "variable") {
      const value = condition.op === "!=" ? (condition.value === 0 ? 1 : 0) : condition.value;
      if (condition.id.startsWith("local.")) localVariables[condition.id] = value;
      else sw.variables[condition.id] = value;
    } else if (condition.kind === "switch") {
      sw.switches[condition.id] = condition.value ?? true;
    } else if (condition.kind === "selfSwitch") {
      sw.self[eventKey] = (condition.value ?? true) ? condition.key : undefined;
    } else if (condition.kind === "item") {
      sw.items[condition.id] = condition.count;
    } else if (condition.kind === "gold") {
      sw.gold = condition.amount;
    } else if (condition.kind === "facing") {
      facing = condition.dir;
    }
  }
  return { sw, localVariables, facing };
}

function startCell(project: Project, mapId: string, event: GameEvent, dir: Dir): { x: number; y: number } {
  const session = createSession(project, 60);
  const table = session.tables.get(mapId)!;
  const d = DIRS.indexOf(dir) as Dir4;
  const cells: [number, number][] = [];
  for (let y = event.y; y < event.y + (event.h ?? 1); y++) {
    for (let x = event.x; x < event.x + (event.w ?? 1); x++) cells.push([x, y]);
  }
  for (const [x, y] of cells) {
    const sx = x - DX[d]!;
    const sy = y - DY[d]!;
    if (sx >= 0 && sy >= 0 && sx < table.width && sy < table.height && canStepFrom(table, sx, sy, d)) {
      return { x: sx, y: sy };
    }
  }
  return { x: Math.max(0, event.x - DX[d]!), y: Math.max(0, event.y - DY[d]!) };
}

function checkPage(project: Project, mapId: string, event: GameEvent, page: Page, pageIndex: number): LockCheckRow {
  const locks = countOp(page.commands, "lockInput");
  const eventKey = `${mapId}/${event.id}`;
  const initial = satisfy([...pageConditions(page.condition), ...lockPath(page.commands)], eventKey);
  const start = startCell(project, mapId, event, initial.facing);
  const forced: GameEvent = {
    ...event,
    pages: [{
      ...page,
      trigger: "autorun",
      condition: undefined,
      commands: [...page.commands, { op: "erase" }],
    }],
  };
  const runProject: Project = {
    ...project,
    start: { map: mapId, x: start.x, y: start.y, dir: initial.facing },
    maps: project.maps.map((map) => map.id === mapId
      ? { ...map, events: (map.events ?? []).map((candidate) => candidate.id === event.id ? forced : candidate) }
      : map),
  };
  const session = createSession(runProject, 60);
  let state = startSession(runProject, session, initial.sw);
  Object.assign(state.sw.variables, initial.localVariables);
  let lockedAt = -1;
  let resolvedAt = -1;
  let outcome: LockCheckRow["outcome"] = "unresolved";
  for (let frame = 0; frame < 12_000; frame++) {
    const modal = state.interp.modal;
    state = stepSession(session, state, {
      buttons: 0,
      confirmEdge: modal !== undefined && frame % 2 === 0,
      cancelEdge: false,
      upEdge: false,
      downEdge: false,
    });
    if (state.interp.error) {
      outcome = "error";
      resolvedAt = frame;
      break;
    }
    if (lockedAt < 0 && state.interp.inputLocked) lockedAt = frame;
    if (state.mapId !== mapId) {
      outcome = "transferred";
      resolvedAt = frame;
      break;
    }
    if (lockedAt >= 0 && !state.interp.inputLocked) {
      outcome = "unlocked";
      resolvedAt = frame;
      break;
    }
  }
  return {
    map: mapId,
    event: event.id,
    name: event.name ?? "",
    page: pageIndex,
    trigger: page.trigger,
    locks,
    outcome,
    lockedAt,
    resolvedAt,
    finalMap: state.mapId,
    ...(state.interp.error ? { error: state.interp.error.message } : {}),
  };
}

type Fact =
  | { kind: "variable"; id: string; value: number }
  | { kind: "switch"; id: string; value: boolean };

function factsWritten(commands: readonly Command[]): Fact[] {
  const facts: Fact[] = [];
  walk(commands, (command) => {
    if (command.op === "variable" && command.set.op === "set") {
      facts.push({ kind: "variable", id: command.id, value: command.set.value });
    } else if (command.op === "switch") {
      facts.push({ kind: "switch", id: command.id, value: command.value });
    }
  });
  return facts;
}

function conditionsRead(page: Page): Condition[] {
  const conditions = pageConditions(page.condition);
  walk(page.commands, (command) => { if (command.op === "if") conditions.push(command.if); });
  return conditions;
}

function factSatisfies(fact: Fact, condition: Condition): boolean {
  if (fact.kind === "switch" && condition.kind === "switch") {
    return fact.id === condition.id && fact.value === (condition.value ?? true);
  }
  if (fact.kind !== "variable" || condition.kind !== "variable" || fact.id !== condition.id) return false;
  if (condition.op === "==") return fact.value === condition.value;
  if (condition.op === "!=") return fact.value !== condition.value;
  if (condition.op === ">=") return fact.value >= condition.value;
  return fact.value <= condition.value;
}

interface LockFlowState {
  unresolved: ReadonlySet<number>;
  terminated: boolean;
}

/** Prove each individual lock on at least one executable control-flow path.
 * Branches are kept separate, so an unlock in an `else` arm cannot resolve a
 * lock that only exists in the sibling `then` arm. */
function localResolution(commands: readonly Command[]): "local-unlock" | "local-transfer" | undefined {
  const lockIds = new Map<Command, number>();
  walk(commands, (command) => {
    if (command.op === "lockInput") lockIds.set(command, lockIds.size);
  });
  if (!lockIds.size) return undefined;

  const unlocked = new Set<number>();
  const transferred = new Set<number>();
  const dedupe = (states: readonly LockFlowState[]): LockFlowState[] => {
    const unique = new Map<string, LockFlowState>();
    for (const state of states) {
      const key = `${state.terminated}:${[...state.unresolved].sort((a, b) => a - b).join(",")}`;
      unique.set(key, state);
    }
    return [...unique.values()];
  };
  const run = (sequence: readonly Command[], inputs: readonly LockFlowState[]): LockFlowState[] => {
    let states = [...inputs];
    for (const command of sequence) {
      const outputs: LockFlowState[] = [];
      for (const state of states) {
        if (state.terminated) {
          outputs.push(state);
          continue;
        }
        if (command.op === "lockInput") {
          outputs.push({ unresolved: new Set([...state.unresolved, lockIds.get(command)!]), terminated: false });
        } else if (command.op === "unlockInput" || command.op === "transfer") {
          const sink = command.op === "unlockInput" ? unlocked : transferred;
          for (const id of state.unresolved) sink.add(id);
          outputs.push({ unresolved: new Set(), terminated: command.op === "transfer" });
        } else if (command.op === "if") {
          outputs.push(...run(command.then, [state]));
          outputs.push(...run(command.else ?? [], [state]));
        } else if (command.op === "choices") {
          for (const option of command.options) outputs.push(...run(option.commands, [state]));
          if (command.cancel) outputs.push(...run(command.cancel.commands, [state]));
          if (!command.options.length && !command.cancel) outputs.push(state);
        } else {
          outputs.push(state);
        }
      }
      states = dedupe(outputs);
    }
    return states;
  };
  run(commands, [{ unresolved: new Set(), terminated: false }]);
  const resolved = new Set([...unlocked, ...transferred]);
  if (resolved.size !== lockIds.size) return undefined;
  return transferred.size ? "local-transfer" : "local-unlock";
}

/** Conservative event-dependency proof for locks intentionally handed to a
 * later automatic event. A produced exact variable/switch value enables the
 * next parallel fiber; historical facts are retained because sibling fibers
 * sample their guards together before any of them completes. */
function crossEventPath(map: Project["maps"][number], source: GameEvent, page: Page): string[] | undefined {
  const facts = factsWritten(page.commands).map((fact) => ({ fact, path: [source.id] }));
  const seenFacts = new Set(facts.map(({ fact }) => JSON.stringify(fact)));
  const visited = new Set([source.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const event of map.events ?? []) {
      if (visited.has(event.id)) continue;
      for (const candidate of event.pages) {
        if (candidate.trigger !== "parallel") continue;
        const conditions = conditionsRead(candidate);
        const predecessor = facts.find(({ fact }) =>
          conditions.some((condition) => factSatisfies(fact, condition))
        );
        if (!predecessor) continue;
        visited.add(event.id);
        const path = [...predecessor.path, event.id];
        const resolution = localResolution(candidate.commands);
        if (resolution || countOp(candidate.commands, "unlockInput") || countOp(candidate.commands, "transfer")) return path;
        for (const fact of factsWritten(candidate.commands)) {
          const key = JSON.stringify(fact);
          if (!seenFacts.has(key)) {
            seenFacts.add(key);
            facts.push({ fact, path });
          }
        }
        changed = true;
        break;
      }
    }
  }
  return undefined;
}

export function verifyProjectLocks(project: Project): LockCheckReport {
  const rows: LockCheckRow[] = [];
  for (const map of project.maps) {
    for (const event of map.events ?? []) {
      event.pages.forEach((page, pageIndex) => {
        if (!containsLock(page.commands)) return;
        const local = localResolution(page.commands);
        if (local) {
          rows.push({
            map: map.id, event: event.id, name: event.name ?? "", page: pageIndex,
            trigger: page.trigger, locks: countOp(page.commands, "lockInput"), outcome: local,
            lockedAt: -1, resolvedAt: -1, finalMap: map.id,
          });
          return;
        }
        const dynamic = checkPage(project, map.id, event, page, pageIndex);
        if (dynamic.outcome === "unlocked" || dynamic.outcome === "transferred") {
          rows.push(dynamic);
          return;
        }
        const path = crossEventPath(map, event, page);
        rows.push(path ? { ...dynamic, outcome: "reachable", resolutionPath: path } : dynamic);
      });
    }
  }
  const outcomes: LockCheckReport["outcomes"] = {
    "local-unlock": 0,
    "local-transfer": 0,
    unlocked: 0,
    transferred: 0,
    reachable: 0,
    unresolved: 0,
    error: 0,
  };
  for (const row of rows) outcomes[row.outcome]++;
  return {
    format: "pocket-tuxemon/g6-lock-check/v1",
    pages: rows.length,
    lockCommands: rows.reduce((sum, row) => sum + row.locks, 0),
    outcomes,
    failures: rows.filter((row) => row.outcome === "unresolved" || row.outcome === "error"),
    rows,
  };
}

if (import.meta.main) {
  const projectArg = process.argv.find((arg) => arg.startsWith("--project="));
  const outArg = process.argv.find((arg) => arg.startsWith("--out="));
  const projectPath = resolve(ROOT, projectArg?.slice("--project=".length) ?? "dist/project.json");
  const outPath = resolve(ROOT, outArg?.slice("--out=".length) ?? "findings/G6-lock-report.json");
  const project = JSON.parse(readFileSync(projectPath, "utf8")) as Project;
  const report = verifyProjectLocks(project);
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ pages: report.pages, lockCommands: report.lockCommands, outcomes: report.outcomes }));
  if (report.failures.length) {
    for (const failure of report.failures) console.error(JSON.stringify(failure));
    process.exitCode = 1;
  }
}
