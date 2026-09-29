// Replay the maintained tape on the built bundle; classify every frame with a text/choices
// modal by owner fiber kind (main vs parallel) and input lock; report the unlocked parallel
// text frames and whether the player's position changed during them.
import { readFileSync } from "node:fs";
const ROOT = "/home/tangollvm/.fleet/worktrees/task-1833";
const { bootWorld } = await import(`${ROOT}/vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts`);
const journey = JSON.parse(readFileSync(`${ROOT}/data/g6-journey.json`, "utf8"));
const world = await bootWorld(`${ROOT}/dist/main`, 60, { __reviewStart: undefined }, undefined, { width: 480, height: 272 });
const stats: Record<string, number> = {};
const owners = new Map<string, { frames: number; locked: number; moved: number; dirPressed: number }>();
let prev = "";
for (let f = 0; f < journey.masks.length; f++) {
  world.frame(journey.masks[f]); world.tick();
  const st = (globalThis as any).__rpgSessionState;
  const m = st.interp.modal;
  if (!m) continue;
  const par = !!st.interp.parallels[m.fiber];
  const kind = `${m.kind}/${par ? "parallel" : "main"}/${st.interp.inputLocked ? "locked" : "unlocked"}`;
  stats[kind] = (stats[kind] ?? 0) + 1;
  const okey = m.fiber + (par ? " [P]" : " [M]");
  const o = owners.get(okey) ?? { frames: 0, locked: 0, moved: 0, dirPressed: 0 };
  o.frames++; if (st.interp.inputLocked) o.locked++;
  const pos = `${st.mapId}@${st.move.px},${st.move.py}`;
  if (prev && pos !== prev) o.moved++;
  if (journey.masks[f] & 0xf0) o.dirPressed++;
  owners.set(okey, o);
  prev = pos;
}
console.log(stats);
for (const [k, o] of owners) console.log(k.padEnd(70), JSON.stringify(o));
