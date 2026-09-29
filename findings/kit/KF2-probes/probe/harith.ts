// Trace Harith's forced pathTo in Paper Scoop along the G6 journey on ENGINE.
import { readFileSync } from "node:fs";
const E = process.env.ENGINE ?? "/home/tangollvm/.fleet/worktrees/task-1868/src/engine";
const { createSession, startSession, stepSession } = await import(`${E}/session.ts`);
const ROOT = "/home/tangollvm/.fleet/worktrees/task-1833";
const project = JSON.parse(readFileSync(`${ROOT}/dist/project.json`, "utf8"));
const journey = JSON.parse(readFileSync(`${ROOT}/data/g6-journey.json`, "utf8"));
const sess = createSession(project, 60);
let s = startSession(project, sess); let prev = 0; let last = "";
for (let f = 0; f < 700; f++) {
  const mask = journey.masks[f] >>> 0; const pressed = mask & ~prev;
  s = stepSession(sess, s, { buttons: mask, confirmEdge: !!(pressed & 0x2000), cancelEdge: !!(pressed & 0x4000), upEdge: !!(pressed & 0x10), downEdge: !!(pressed & 0x40) });
  prev = mask;
  const h = s.chars.chars["npc_spyder_papermart_harith"];
  const mat = s.chars.chars["e014_go_outside_r001"];
  const line = h ? `harith ${h.tx},${h.ty} route=${h.route ? JSON.stringify(h.route.steps[h.route.pc] ?? null) : "-"} retriesLeft=${h.route?.pathRetriesLeft ?? "-"} plan=${h.route?.plan ? `dirs${JSON.stringify(h.route.plan.dirs)} blocked${h.route.plan.blockedTicks}` : "-"} | mat char ${mat ? `${mat.tx},${mat.ty} blocks=${mat.blocks}` : "none"}` : "harith absent";
  if (line !== last && (f >= 470)) { console.log(`[f${f}] ${line}`); last = line; }
  if (f === 490) for (const [id, c] of Object.entries<any>(s.chars.chars)) if (c.tx === 6 && c.ty >= 8 && c.ty <= 10) console.log(`   f490 char at column 6: ${id} ${c.tx},${c.ty} blocks=${c.blocks} visible=${c.visible} page=${c.pageIndex}`);
}
