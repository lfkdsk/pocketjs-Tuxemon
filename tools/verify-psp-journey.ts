// Compare the newest completed PSP journey session with a fresh production
// replay. The build receipt and session marker prevent an appended stale log
// from satisfying a newer build or an incomplete latest run.

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createProductionTuxemonBattle } from "../battle/production.ts";
import { FIXED_INITIAL_CIVIL_TIME, timeWeatherAt } from "../battle/time-weather.ts";
import { canonicalJson } from "../vendor/pocket-rpgkit/src/engine/save.ts";
import {
  createSession,
  startSession,
  stepSession,
} from "../vendor/pocket-rpgkit/src/engine/session.ts";
import type { JsonValue } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import { readShardedProject } from "./generated-project.ts";

interface LogEntry {
  kind?: unknown;
  passed?: unknown;
  buildId?: unknown;
  frame?: unknown;
  state?: unknown;
}

interface BuildReceipt {
  target?: unknown;
  journey?: unknown;
  journeyBuildId?: unknown;
}

const root = resolve(import.meta.dir, "..");
const profilePath = process.argv[2];
if (!profilePath) {
  throw new Error("Usage: bun tools/verify-psp-journey.ts <PSPLINK profile.jsonl>");
}
const receiptPath = join(root, "dist/psp/build-receipt.json");
const ebootPath = join(root, "dist/psp/EBOOT.PBP");
const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as BuildReceipt;
if (receipt.target !== "psp" || receipt.journey !== true ||
    typeof receipt.journeyBuildId !== "string") {
  throw new Error("dist/psp is not a journey-enabled PSP build");
}
if (statSync(profilePath).mtimeMs < statSync(ebootPath).mtimeMs) {
  throw new Error("PSP profile predates the journey EBOOT; run the current build first");
}

const entries = readFileSync(profilePath, "utf8").trim().split("\n").map((line, index) => {
  try {
    return JSON.parse(line) as LogEntry;
  } catch {
    throw new Error(`Malformed PSP profile JSON on line ${index + 1}`);
  }
});
const sessionIndex = entries.findLastIndex((entry) => entry.kind === "session");
if (sessionIndex < 0) throw new Error("No PSP journey session marker found");
const session = entries[sessionIndex]!;
if (session.buildId !== receipt.journeyBuildId) {
  throw new Error("Newest PSP profile session does not match the current journey build");
}
const latest = entries.slice(sessionIndex);
const abi = latest.find((entry) => entry.kind === "abi");
if (abi?.passed !== true || abi.buildId !== receipt.journeyBuildId) {
  throw new Error("Newest PSP journey did not pass the double ABI check");
}
const terminal = latest.findLast((entry) => entry.kind === "terminal");
if (!terminal || terminal.buildId !== receipt.journeyBuildId) {
  throw new Error("Newest PSP journey session did not reach a terminal snapshot");
}

const tape = JSON.parse(readFileSync(join(root, "data/g6-journey.json"), "utf8")).masks as number[];
if (terminal.frame !== tape.length) throw new Error("PSP journey length mismatch");
const { project, repository } = readShardedProject(root);
const { extensions, rules } = createProductionTuxemonBattle(
  { read: (entry) => new Uint8Array(readFileSync(join(root, "dist", entry))) },
  { initialTimeWeather: timeWeatherAt(FIXED_INITIAL_CIVIL_TIME) },
);
const sessionRuntime = createSession(project, 60, {
  maps: repository,
  extensions,
  battle: rules,
  immutableState: true,
});
let state = startSession(project, sessionRuntime);
let previous = 0;
for (const mask of tape) {
  const pressed = mask & ~previous;
  state = stepSession(sessionRuntime, state, {
    buttons: mask,
    confirmEdge: !!(pressed & 0x2000),
    cancelEdge: !!(pressed & 0x4000),
    upEdge: !!(pressed & 0x10),
    downEdge: !!(pressed & 0x40),
  });
  previous = mask;
}
const expected = canonicalJson(state);
const actual = canonicalJson(terminal.state as JsonValue);
if (actual !== expected) {
  throw new Error("PSP terminal snapshot diverged from the production replay");
}
console.log(
  `PSP JOURNEY PASS frames=${tape.length} end=${state.mapId}@${state.move.tx},${state.move.ty} ` +
    `sha256=${createHash("sha256").update(actual).digest("hex")}`,
);
