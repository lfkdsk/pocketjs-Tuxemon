// Replay the maintained G6 journey tape (60 Hz masks) through the session
// reducer of ENGINE (default: this branch) on the G6 project, optionally with
// system.messageBlocksPlayer injected (MBP=1). Prints the checkpoint states,
// the final state and an FNV chain over (map, mover, modal, switch bank) per
// frame, so two engines/configs can be compared frame for frame.
import { readFileSync, writeFileSync } from "node:fs";
const E = process.env.ENGINE ?? "/home/tangollvm/.fleet/worktrees/task-1868/src/engine";
const { createSession, startSession, stepSession } = await import(`${E}/session.ts`);
const ROOT = "/home/tangollvm/.fleet/worktrees/task-1833";
const project = JSON.parse(readFileSync(`${ROOT}/dist/project.json`, "utf8"));
if (process.env.MBP === "1") project.system = { messageBlocksPlayer: true };
const journey = JSON.parse(readFileSync(`${ROOT}/data/g6-journey.json`, "utf8"));
const CIRCLE = 0x2000, CROSS = 0x4000, UP = 0x0010, DOWN = 0x0040;
const sess = createSession(project, 60);
let s = startSession(project, sess);
let prev = 0;
const fnv = (str: string, h = 0x811c9dc5): number => {
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
};
let chain = 0x811c9dc5;
const perFrame: number[] = [];
const cps = new Map<number, string>(journey.checkpoints.map((c: any) => [c.frame, c.name]));
for (let f = 0; f < journey.masks.length; f++) {
  const mask = journey.masks[f] >>> 0;
  const pressed = mask & ~prev;
  s = stepSession(sess, s, {
    buttons: mask,
    confirmEdge: !!(pressed & CIRCLE),
    cancelEdge: !!(pressed & CROSS),
    upEdge: !!(pressed & UP),
    downEdge: !!(pressed & DOWN),
  });
  prev = mask;
  const key = JSON.stringify([s.mapId, s.move, s.interp.modal, s.interp.main?.key ?? null, s.sw]);
  const h = fnv(key);
  perFrame.push(h);
  chain = fnv(String(h), chain);
  if (cps.has(f)) console.log(`checkpoint ${cps.get(f)} f${f}: ${s.mapId}@${s.move.tx},${s.move.ty}`);
}
console.log(`final f${journey.masks.length - 1}: ${s.mapId}@${s.move.tx},${s.move.ty} expected ${journey.map}@${journey.position.join(",")} chain=${chain.toString(16)}`);
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(perFrame));
