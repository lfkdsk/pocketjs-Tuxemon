// Full-corpus K1 freeze scan. Enter every imported map at a known inbound
// landing (or its centre), auto-advance dialogs, and drive every direction.
// A second long window distinguishes a real stuck fiber/input lock from a
// legitimate wait or cutscene. The report is deterministic JSON.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BTN_BITS } from "../vendor/pocket-rpgkit/src/engine/camera.ts";
import {
  createSession,
  startSession,
  stepSession,
  type SessionState,
} from "../vendor/pocket-rpgkit/src/engine/session.ts";
import type { Command, Project } from "../vendor/pocket-rpgkit/src/engine/types.ts";

const args = process.argv.slice(2);
const projectPath = resolve(args.find((arg) => !arg.startsWith("--")) ?? "dist/project.json");
const outArg = args.find((arg) => arg.startsWith("--out="));
const outPath = resolve(outArg?.slice("--out=".length) ?? "dist/frozen-k1.json");
const project = JSON.parse(readFileSync(projectPath, "utf8")) as Project;
const landing = new Map<string, [number, number]>();

function collectLandings(commands: readonly Command[]): void {
  for (const command of commands) {
    if (command.op === "transfer" && !landing.has(command.map)) {
      landing.set(command.map, [command.x, command.y]);
    } else if (command.op === "if") {
      collectLandings(command.then);
      collectLandings(command.else ?? []);
    } else if (command.op === "choices") {
      for (const option of command.options) collectLandings(option.commands);
      collectLandings(command.cancel?.commands ?? []);
    }
  }
}

for (const map of project.maps) {
  for (const event of map.events ?? []) {
    for (const page of event.pages) collectLandings(page.commands);
  }
}

const pads = [BTN_BITS.UP, BTN_BITS.LEFT, BTN_BITS.DOWN, BTN_BITS.RIGHT];
const WINDOW = 6_000;
const TOTAL_FRAMES = WINDOW * 2;

function step(state: SessionState, session: ReturnType<typeof createSession>, frame: number): SessionState {
  const modal = state.interp.modal;
  return stepSession(session, state, {
    buttons: modal ? 0 : pads[Math.floor(frame / 30) % pads.length]!,
    confirmEdge: !!modal && frame % 2 === 0,
    cancelEdge: false,
    upEdge: false,
    downEdge: false,
  });
}

interface FrozenRow {
  map: string;
  start: [number, number];
  finalMap: string;
  final: [number, number];
  cells: number;
  frames: number;
  inputLocked: boolean;
  blocking: boolean;
  error?: string;
}

const rows: FrozenRow[] = [];
for (const map of project.maps) {
  const start = landing.get(map.id) ?? [Math.floor(map.width / 2), Math.floor(map.height / 2)];
  const localProject: Project = {
    ...project,
    start: { map: map.id, x: start[0], y: start[1], dir: "down" },
  };
  const session = createSession(localProject, 60);
  let state = startSession(localProject, session);
  const cells = new Set<string>();
  let error: string | undefined;
  let frames = 0;
  let lastUnlocked = 0;
  let lastMainProgress = 0;
  let previousMain = "";
  try {
    for (; frames < TOTAL_FRAMES; frames++) {
      state = step(state, session, frames);
      if (state.interp.error) {
        error = state.interp.error.message;
        break;
      }
      if (state.mapId === map.id) cells.add(`${state.move.tx},${state.move.ty}`);
      if (!state.interp.inputLocked) lastUnlocked = frames + 1;
      const main = state.interp.main;
      const fingerprint = main
        ? `${main.key}|${main.pageIndex}|${main.mode}|${main.since}|${main.stack.map((entry) => entry.pc).join(",")}`
        : "";
      if (!main || fingerprint !== previousMain) {
        lastMainProgress = frames + 1;
        previousMain = fingerprint;
      }
    }
  } catch (caught) {
    error = String(caught);
  }
  const row: FrozenRow = {
    map: map.id,
    start,
    finalMap: state.mapId,
    final: [state.move.tx, state.move.ty],
    cells: cells.size,
    frames,
    inputLocked: state.mapId === map.id && state.interp.inputLocked && frames - lastUnlocked >= WINDOW,
    blocking: state.mapId === map.id && state.interp.main !== null && frames - lastMainProgress >= WINDOW,
    ...(error ? { error } : {}),
  };
  if (row.inputLocked || row.blocking || row.error) rows.push(row);
}

const report = {
  format: "pocket-tuxemon/frozen-k1/v1",
  project: projectPath,
  maps: project.maps.length,
  windowFrames: WINDOW,
  scannedFramesPerMap: TOTAL_FRAMES,
  permanentLocks: rows.filter((row) => row.inputLocked).length,
  permanentBlockingFibers: rows.filter((row) => row.blocking).length,
  errors: rows.filter((row) => row.error).length,
  flagged: rows,
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
console.log(
  `K1 freeze scan: ${report.maps} maps; ${report.permanentLocks} permanent input locks; ` +
  `${report.permanentBlockingFibers} permanent blocking fibers; ${report.errors} errors`,
);
console.log(`Report: ${outPath}`);
if (rows.length) {
  for (const row of rows) console.log(JSON.stringify(row));
  process.exitCode = 1;
}
