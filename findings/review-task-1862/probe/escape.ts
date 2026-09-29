// Decline the intro skip, then walk to the bedroom stairs while the CEO speech is on screen.
import { readFileSync } from "node:fs";
const E = "/home/tangollvm/.fleet/worktrees/task-1833/vendor/pocket-rpgkit/src/engine";
const { BTN_BITS } = await import(`${E}/camera.ts`);
const { createSession, startSession, stepSession } = await import(`${E}/session.ts`);
const project = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const proj = { ...project, start: { map: "spyder_bedroom", x: 4, y: 4, dir: "down" } };
const ss = createSession(proj, 60);
let st = startSession(proj, ss);
let phase = 0, t = 0; let lastMap = st.mapId;
const plan: [number, number][] = JSON.parse(process.argv[3] ?? "[]").map(([b, n]: [string, number]) => [(BTN_BITS as any)[b], n]);
for (let f = 0; f < 600; f++) {
  const m = st.interp.modal;
  let confirm = false, buttons = 0;
  if (phase === 0) {
    if (m && m.kind === "text" && m.complete && f % 2 === 0) confirm = true;
    if (m && m.kind === "choices" && f % 2 === 0) { confirm = true; phase = 1; }
  } else {
    let acc = 0; for (const [b, n] of plan) { if (t < acc + n) { buttons = b; break; } acc += n; }
    t++;
  }
  st = stepSession(ss, st, { buttons, confirmEdge: confirm, cancelEdge: false, upEdge: false, downEdge: false });
  if (st.mapId !== lastMap || f % 30 === 0) {
    const mm = st.interp.modal;
    console.log(`[${f}] ${st.mapId}@${st.move.tx},${st.move.ty} modal=${mm ? `${mm.fiber.split("/")[1]}:"${(mm.lines ?? mm.options).join(" / ").slice(0, 30)}"` : "-"} vars question_intro=${st.sw.variables["v.question_intro"]} spyder_intro=${st.sw.variables["v.spyder_intro"]} intro_scoop=${st.sw.variables["v.intro_scoop"]}`);
    lastMap = st.mapId;
  }
}
