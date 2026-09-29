// Hold a direction while an automatic event's dialogue is open and see if the player walks.
import { readFileSync } from "node:fs";
const E = "/home/tangollvm/.fleet/worktrees/task-1833/vendor/pocket-rpgkit/src/engine";
const { BTN_BITS } = await import(`${E}/camera.ts`);
const { createSession, startSession, stepSession } = await import(`${E}/session.ts`);
const { createSwitchState } = await import(`${E}/interpreter.ts`);
const project = JSON.parse(readFileSync(process.argv[2] ?? "/home/tangollvm/.fleet/worktrees/task-1833/dist/project.json", "utf8"));
const [mapId, sx, sy, dir, btn, varsJson, framesArg] = process.argv.slice(3);
const proj = { ...project, start: { map: mapId, x: Number(sx), y: Number(sy), dir } };
const ss = createSession(proj, 60);
let st = startSession(proj, ss, createSwitchState({ variables: JSON.parse(varsJson ?? "{}") }));
const B = (BTN_BITS as any)[btn!];
let lastLine = "";
for (let f = 0; f < Number(framesArg ?? 90); f++) {
  st = stepSession(ss, st, { buttons: B, confirmEdge: false, cancelEdge: false, upEdge: false, downEdge: false });
  const m = st.interp.modal;
  const line = m ? `${m.kind} fiber=${m.fiber} par=${!!st.interp.parallels[m.fiber]} ${(m.lines ?? m.options).join(" / ").slice(0, 50)}` : "-";
  if (f % 10 === 0 || line !== lastLine) console.log(`[${f}] player ${st.mapId}@${st.move.tx},${st.move.ty} px=${st.move.px},${st.move.py} lock=${st.interp.inputLocked} main=${st.interp.main?.key ?? "-"} modal: ${line}`);
  lastLine = line;
}
