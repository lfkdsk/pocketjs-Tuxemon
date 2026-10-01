// Compare the PSP's complete terminal snapshot with a fresh production replay.
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { canonicalJson } from "../vendor/pocket-rpgkit/src/engine/save.ts";
import { createSession, startSession, stepSession } from "../vendor/pocket-rpgkit/src/engine/session.ts";
import { createProductionTuxemonBattle } from "../battle/production.ts";
import { readShardedProject } from "./generated-project.ts";
const root = resolve(import.meta.dir, "..");
const path = process.argv[2];
if (!path) throw new Error("Usage: bun tools/verify-psp-journey.ts <PSPLINK profile.jsonl>");
const entries = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line));
const terminal = entries.findLast(entry => entry.kind === "terminal");
if (!terminal) throw new Error("No completed hardware journey found");
const tape = JSON.parse(readFileSync(join(root, "data/g6-journey.json"), "utf8")).masks as number[];
if (terminal.frame !== tape.length) throw new Error("Hardware journey length mismatch");
const { project, repository } = readShardedProject(root);
const { extensions, rules } = createProductionTuxemonBattle({ read: entry => new Uint8Array(readFileSync(join(root, "dist", entry))) });
const session = createSession(project, 60, { maps: repository, extensions, battle: rules, immutableState: true });
let state = startSession(project, session), previous = 0;
for (const mask of tape) {
  const pressed = mask & ~previous;
  state = stepSession(session, state, { buttons: mask, confirmEdge: !!(pressed & 0x2000), cancelEdge: !!(pressed & 0x4000), upEdge: !!(pressed & 0x10), downEdge: !!(pressed & 0x40) });
  previous = mask;
}
const expected = canonicalJson(state), actual = canonicalJson(terminal.state);
if (actual !== expected) throw new Error("PSP terminal snapshot diverged from the production replay");
console.log(`PSP JOURNEY PASS frames=${tape.length} end=${state.mapId}@${state.move.tx},${state.move.ty} sha256=${createHash("sha256").update(actual).digest("hex")}`);
