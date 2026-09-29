// Decline the intro skip, then hold LEFT without confirming during the Spyder intro.
import { readFileSync } from "node:fs";
const E = "/home/tangollvm/.fleet/worktrees/task-1833/vendor/pocket-rpgkit/src/engine";
const { BTN_BITS } = await import(`${E}/camera.ts`);
const { createSession, startSession, stepSession } = await import(`${E}/session.ts`);
const project = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const proj = { ...project, start: { map: "spyder_bedroom", x: 4, y: 4, dir: "down" } };
const ss = createSession(proj, 60);
let st = startSession(proj, ss);
let phase = 0; let last = "";
for (let f = 0; f < 400; f++) {
  const m = st.interp.modal;
  let confirm = false, buttons = 0;
  if (phase === 0) { // answer the intro question: advance text, pick option 0 ("No")
    if (m && m.kind === "text" && m.complete && f % 2 === 0) confirm = true;
    if (m && m.kind === "choices" && f % 2 === 0) { confirm = true; phase = 1; }
  } else buttons = BTN_BITS.LEFT;
  st = stepSession(ss, st, { buttons, confirmEdge: confirm, cancelEdge: false, upEdge: false, downEdge: false });
  const mm = st.interp.modal;
  const line = mm ? `${mm.kind} ${mm.fiber.split("/")[1]} par=${!!st.interp.parallels[mm.fiber]} "${(mm.lines ?? mm.options).join(" / ").slice(0, 40)}"` : "-";
  if (line !== last || f % 25 === 0) console.log(`[${f}] phase=${phase} player@${st.move.tx},${st.move.ty} px=${st.move.px} lock=${st.interp.inputLocked} main=${st.interp.main?.key.split("/")[1] ?? "-"} ${line}`);
  last = line;
}
