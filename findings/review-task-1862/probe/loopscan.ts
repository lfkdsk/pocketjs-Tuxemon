// Apply the corrected frozen-k1 driver to one map from a given start and variables, and report
// whether its no-world-progress criterion would flag the run (and why not).
import { readFileSync } from "node:fs";
const E = "/home/tangollvm/.fleet/worktrees/task-1833/vendor/pocket-rpgkit/src/engine";
const { BTN_BITS } = await import(`${E}/camera.ts`);
const { createSession, startSession, stepSession } = await import(`${E}/session.ts`);
const { createSwitchState } = await import(`${E}/interpreter.ts`);
const project = JSON.parse(readFileSync("/home/tangollvm/.fleet/worktrees/task-1833/dist/project.json", "utf8"));
const [mapId, sx, sy, varsJson] = process.argv.slice(2);
const proj = { ...project, start: { map: mapId, x: Number(sx), y: Number(sy), dir: "down" } };
const ss = createSession(proj, 60);
let st = startSession(proj, ss, createSwitchState({ variables: JSON.parse(varsJson ?? "{}") }));
const pads = [BTN_BITS.UP, BTN_BITS.LEFT, BTN_BITS.DOWN, BTN_BITS.RIGHT];
// same driver as tools/frozen-k1.ts step()
function drive(frame: number) {
  const modal = st.interp.modal;
  return { buttons: pads[Math.floor(frame / 90) % 4]!, confirmEdge: modal ? frame % 2 === 0 : frame % 30 === 0, cancelEdge: false, upEdge: false, downEdge: false };
}
const fp = () => JSON.stringify([st.mapId, st.move.tx, st.move.ty, Object.entries(st.sw.variables).sort(), Object.entries(st.sw.switches).sort(), Object.entries(st.sw.self).sort(), Object.entries(st.sw.items).sort(), st.sw.gold]);
const fpNoPos = () => JSON.stringify([st.mapId, Object.entries(st.sw.variables).sort(), Object.entries(st.sw.switches).sort(), Object.entries(st.sw.self).sort(), Object.entries(st.sw.items).sort(), st.sw.gold]);
let prev = fp(), prevNP = fpNoPos(), lastProg = 0, lastProgNP = 0, lastBusy = -1, texts = 0, lastText = "", moved = 0, px = st.move.tx, py = st.move.ty;
const N = 12000;
for (let f = 0; f < N; f++) {
  st = stepSession(ss, st, drive(f));
  const a = fp(); if (a !== prev) { lastProg = f + 1; prev = a; }
  const b = fpNoPos(); if (b !== prevNP) { lastProgNP = f + 1; prevNP = b; }
  if (st.interp.main || st.interp.modal || st.interp.inputLocked) lastBusy = f + 1;
  const m = st.interp.modal; const t = m ? (m.lines ?? m.options).join("/") : "";
  if (t && t !== lastText) texts++; lastText = t;
  if (st.move.tx !== px || st.move.ty !== py) { moved++; px = st.move.tx; py = st.move.ty; }
}
console.log(JSON.stringify({ map: st.mapId, pos: [st.move.tx, st.move.ty], lastText, textOpenings: texts, playerTileChanges: moved,
  frozenK1_blocking: lastBusy >= N - 2 && N - lastProg >= 6000, lastWorldProgress: lastProg,
  withoutPosition_blocking: lastBusy >= N - 2 && N - lastProgNP >= 6000, lastStoryProgress: lastProgNP }));
