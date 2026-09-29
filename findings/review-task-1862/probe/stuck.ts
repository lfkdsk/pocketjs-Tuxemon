// Run a touch/action cutscene and report where the main/parallel fiber is parked at the end.
import { readFileSync } from "node:fs";
const E = "/home/tangollvm/.fleet/worktrees/task-1833/vendor/pocket-rpgkit/src/engine";
const { BTN_BITS } = await import(`${E}/camera.ts`);
const { createSession, startSession, stepSession } = await import(`${E}/session.ts`);
const { createSwitchState } = await import(`${E}/interpreter.ts`);
const project = JSON.parse(readFileSync(process.env.PROJECT ?? "/home/tangollvm/.fleet/worktrees/task-1833/dist/project.json", "utf8"));
const [mapId, sx, sy, dir, trig, varsJson, framesArg, watch] = process.argv.slice(2);
const DIRS = ["down", "left", "up", "right"]; const BTN = [BTN_BITS.DOWN, BTN_BITS.LEFT, BTN_BITS.UP, BTN_BITS.RIGHT];
const d = DIRS.indexOf(dir!);
const proj = { ...project, start: { map: mapId, x: Number(sx), y: Number(sy), dir } };
const ss = createSession(proj, 60);
let st = startSession(proj, ss, createSwitchState({ variables: JSON.parse(varsJson ?? "{}") }));
const N = Number(framesArg ?? 4000);
let lastMoving = "";
for (let fr = 0; fr < N; fr++) {
  const md = st.interp.modal;
  let buttons = 0, confirm = false;
  if (md) confirm = fr % 2 === 0;
  else if (fr < 40) { if (trig === "touch") buttons = BTN[d]!; else if (trig === "action") { buttons = fr < 4 ? BTN[d]! : 0; confirm = fr === 6; } }
  st = stepSession(ss, st, { buttons, confirmEdge: confirm, cancelEdge: false, upEdge: false, downEdge: false });
}
const f = st.interp.main ?? Object.values(st.interp.parallels).find((p: any) => p.mode !== "run");
console.log("main:", st.interp.main?.key, "mode:", st.interp.main?.mode, "locked:", st.interp.inputLocked);
if (st.interp.main) { const top = st.interp.main.stack[0]; console.log("instr:", JSON.stringify(top.prog[top.pc]).slice(0, 300)); }
const ids = (watch ?? "").split(",").filter(Boolean);
for (const id of ids) { const c = st.chars.chars[id]; console.log(id, c ? `@${c.tx},${c.ty} route=${JSON.stringify(c.route ?? c.moveRoute ?? null).slice(0, 160)}` : "absent"); }
for (const [k, c] of Object.entries<any>(st.chars.chars)) if (Math.abs(c.tx - st.move.tx) <= 3 && Math.abs(c.ty - st.move.ty) <= 5) console.log("  near", k, c.tx, c.ty, "through=", c.through, "page", c.pageIndex);
console.log("player", st.move.tx, st.move.ty, "playerRoute", JSON.stringify(st.playerRoute).slice(0, 200));
