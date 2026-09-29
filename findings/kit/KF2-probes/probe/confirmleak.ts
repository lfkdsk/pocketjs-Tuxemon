// While an automatic (parallel) dialogue is open, face an action event and press confirm.
import { readFileSync } from "node:fs";
const E = process.env.ENGINE ?? "/home/tangollvm/.fleet/worktrees/task-1868/src/engine";
const { createSession, startSession, stepSession } = await import(`${E}/session.ts`);
const project = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
if (process.env.MBP === "1") project.system = { messageBlocksPlayer: true };
if (process.env.MBP === "0") delete project.system;
const [mapId, sx, sy, dir] = process.argv.slice(3);
const proj = { ...project, start: { map: mapId, x: Number(sx), y: Number(sy), dir } };
const ss = createSession(proj, 60);
let st = startSession(proj, ss);
let last = "";
for (let f = 0; f < 140; f++) {
  const m = st.interp.modal;
  const confirm = !!m && m.kind === "text" && m.complete && f % 2 === 0;
  st = stepSession(ss, st, { buttons: 0, confirmEdge: confirm, cancelEdge: false, upEdge: false, downEdge: false });
  const mm = st.interp.modal;
  const line = `main=${st.interp.main?.key.split("/")[1] ?? "-"} parallels=${Object.keys(st.interp.parallels).map((k) => k.split("/")[1]).filter((k) => /intro|rest|comput/i.test(k)).join(",")} modal=${mm ? `${mm.kind}:${mm.fiber.split("/")[1]}:"${(mm.lines ?? mm.options).join(" / ").slice(0, 45)}"` : "-"}`;
  if (line !== last) console.log(`[${f}]${confirm ? " CONFIRM" : ""} ${line}`);
  last = line;
}
