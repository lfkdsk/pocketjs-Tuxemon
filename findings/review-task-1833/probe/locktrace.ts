// Trace one lock scenario: variables written, fibers, texts, until frame N.
import { readFileSync } from "node:fs";
const E = "/home/tangollvm/.fleet/worktrees/task-1833/vendor/pocket-rpgkit/src/engine";
const { BTN_BITS } = await import(`${E}/camera.ts`);
const { createSession, startSession, stepSession } = await import(`${E}/session.ts`);
const { createSwitchState } = await import(`${E}/interpreter.ts`);
const project = JSON.parse(readFileSync("/var/tmp/fleet/1838/project-g6.json", "utf8"));
const [mapId, sx, sy, dir, trig, varsJson, framesArg] = process.argv.slice(2);
const DIRS = ["down", "left", "up", "right"]; const BTN = [BTN_BITS.DOWN, BTN_BITS.LEFT, BTN_BITS.UP, BTN_BITS.RIGHT];
const d = DIRS.indexOf(dir!);
const proj = { ...project, start: { map: mapId, x: Number(sx), y: Number(sy), dir } };
const ss = createSession(proj, 60);
const vars = JSON.parse(varsJson ?? "{}");
let st = startSession(proj, ss, createSwitchState({ variables: vars }));
let prevVars = JSON.stringify(st.sw.variables); let lastText = ""; let lastMain = ""; let lastLock = false;
const N = Number(framesArg ?? 4000);
for (let fr = 0; fr < N; fr++) {
  const md = st.interp.modal;
  let buttons = 0, confirm = false;
  if (md) confirm = fr % 2 === 0;
  else if (fr < 40) { if (trig === "touch") buttons = BTN[d]!; else if (trig === "action") { buttons = fr < 4 ? BTN[d]! : 0; confirm = fr === 6; } }
  st = stepSession(ss, st, { buttons, confirmEdge: confirm, cancelEdge: false, upEdge: false, downEdge: false });
  const v = JSON.stringify(st.sw.variables);
  if (v !== prevVars) { const a = JSON.parse(prevVars), b = st.sw.variables; for (const k of Object.keys(b)) if (a[k] !== b[k]) console.log(`[${fr}] VAR ${k}=${b[k]}`); prevVars = v; }
  const mm = st.interp.modal; const t = mm ? (mm.kind === "text" ? mm.lines.join(" / ") : "CHOICE " + mm.options.join("|")) : "";
  if (t && t !== lastText) console.log(`[${fr}] TEXT ${t.slice(0, 90)}`); lastText = t;
  const mk = st.interp.main ? st.interp.main.key : ""; if (mk !== lastMain) { console.log(`[${fr}] MAIN ${mk || "-"}`); lastMain = mk; }
  if (st.interp.inputLocked !== lastLock) { console.log(`[${fr}] LOCK ${st.interp.inputLocked}`); lastLock = st.interp.inputLocked; }
  if (st.mapId !== mapId) { console.log(`[${fr}] TRANSFER ${st.mapId}`); break; }
}
console.log("final", st.move.tx, st.move.ty, "parallels", Object.keys(st.interp.parallels).join(","), "chars", Object.keys(st.chars.chars).join(","));
