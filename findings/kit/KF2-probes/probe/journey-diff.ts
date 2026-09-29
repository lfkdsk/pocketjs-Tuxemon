// Replay the G6 journey on two engines in lockstep and describe where their
// states first differ (player, modal, main fiber, switch bank, characters).
import { readFileSync } from "node:fs";
const A = process.env.A ?? "/home/tangollvm/.fleet/worktrees/task-1833/vendor/pocket-rpgkit/src/engine";
const B = process.env.B ?? "/home/tangollvm/.fleet/worktrees/task-1868/src/engine";
const ea = await import(`${A}/session.ts`);
const eb = await import(`${B}/session.ts`);
const ROOT = "/home/tangollvm/.fleet/worktrees/task-1833";
const project = JSON.parse(readFileSync(`${ROOT}/dist/project.json`, "utf8"));
const journey = JSON.parse(readFileSync(`${ROOT}/data/g6-journey.json`, "utf8"));
const CIRCLE = 0x2000, CROSS = 0x4000, UP = 0x0010, DOWN = 0x0040;
const sa = ea.createSession(project, 60), sb = eb.createSession(project, 60);
let a = ea.startSession(project, sa), b = eb.startSession(project, sb);
let prev = 0, reported = 0;
const until = Number(process.env.UNTIL ?? 3410);
for (let f = 0; f < Math.min(until, journey.masks.length); f++) {
  const mask = journey.masks[f] >>> 0;
  const pressed = mask & ~prev;
  const input = { buttons: mask, confirmEdge: !!(pressed & CIRCLE), cancelEdge: !!(pressed & CROSS), upEdge: !!(pressed & UP), downEdge: !!(pressed & DOWN) };
  a = ea.stepSession(sa, a, input); b = eb.stepSession(sb, b, input);
  prev = mask;
  const diffs: string[] = [];
  if (a.mapId !== b.mapId) diffs.push(`map ${a.mapId} vs ${b.mapId}`);
  if (JSON.stringify(a.move) !== JSON.stringify(b.move)) diffs.push(`player ${a.move.tx},${a.move.ty} px${a.move.px},${a.move.py} vs ${b.move.tx},${b.move.ty} px${b.move.px},${b.move.py}`);
  if (JSON.stringify(a.interp.modal) !== JSON.stringify(b.interp.modal)) diffs.push(`modal ${JSON.stringify(a.interp.modal)?.slice(0, 90)} vs ${JSON.stringify(b.interp.modal)?.slice(0, 90)}`);
  if ((a.interp.main?.key ?? null) !== (b.interp.main?.key ?? null)) diffs.push(`main ${a.interp.main?.key} vs ${b.interp.main?.key}`);
  if (JSON.stringify(a.sw) !== JSON.stringify(b.sw)) diffs.push(`sw differs`);
  const ids = new Set([...Object.keys(a.chars.chars), ...Object.keys(b.chars.chars)]);
  for (const id of ids) {
    const ca = a.chars.chars[id], cb = b.chars.chars[id];
    if (!ca || !cb) { diffs.push(`char ${id} ${ca ? "only-base" : "only-branch"}`); continue; }
    if (ca.tx !== cb.tx || ca.ty !== cb.ty || ca.px !== cb.px || ca.py !== cb.py) diffs.push(`char ${id} ${ca.tx},${ca.ty}(${ca.px},${ca.py}) vs ${cb.tx},${cb.ty}(${cb.px},${cb.py})`);
  }
  if (diffs.length && reported < Number(process.env.MAXREP ?? 6)) {
    console.log(`[f${f}] ${a.mapId} player ${a.move.tx},${a.move.ty} main=${a.interp.main?.key ?? "-"}  :: ${diffs.join(" | ")}`);
    reported++;
  }
}
