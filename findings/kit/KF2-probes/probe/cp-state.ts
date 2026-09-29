// Print the session state at given journey frames on ENGINE (mover, modal, main, map, frames since map entry).
import { readFileSync } from "node:fs";
const E = process.env.ENGINE ?? "/home/tangollvm/.fleet/worktrees/task-1868/src/engine";
const { createSession, startSession, stepSession } = await import(`${E}/session.ts`);
const ROOT = "/home/tangollvm/.fleet/worktrees/task-1833";
const project = JSON.parse(readFileSync(`${ROOT}/dist/project.json`, "utf8"));
if (process.env.MBP === "1") project.system = { messageBlocksPlayer: true };
const journey = JSON.parse(readFileSync(`${ROOT}/data/g6-journey.json`, "utf8"));
const want = new Set((process.env.FRAMES ?? "1723,1951,2017,3409").split(",").map(Number));
const sess = createSession(project, 60);
let s = startSession(project, sess); let prev = 0; let lastMap = s.mapId; const entries: string[] = [];
for (let f = 0; f < journey.masks.length; f++) {
  const mask = journey.masks[f] >>> 0; const pressed = mask & ~prev;
  s = stepSession(sess, s, { buttons: mask, confirmEdge: !!(pressed & 0x2000), cancelEdge: !!(pressed & 0x4000), upEdge: !!(pressed & 0x10), downEdge: !!(pressed & 0x40) });
  prev = mask;
  if (s.mapId !== lastMap) { entries.push(`f${f}:${s.mapId}`); lastMap = s.mapId; }
  if (want.has(f)) console.log(`f${f} ${s.mapId} move=${JSON.stringify(s.move)} interpFrame=${s.interp.frame} fade=${JSON.stringify(s.fade)} modal=${JSON.stringify(s.interp.modal)?.slice(0, 80)} main=${s.interp.main?.key ?? "-"}`);
}
console.log("map entries:", entries.join(" "));
