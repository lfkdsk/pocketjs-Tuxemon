// Boot the review bundle at arbitrary starts and capture a still frame + state.
import { writeFileSync } from "node:fs";
const ROOT = "/home/tangollvm/.fleet/worktrees/task-1833";
const { bootWorld, fnv1a } = await import(`${ROOT}/vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts`);
const { encodePNG } = await import(`${ROOT}/vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts`);
const shots = JSON.parse(process.argv[2]!) as { name: string; map: string; x: number; y: number; dir: string; frames?: number }[];
const out: any[] = [];
for (const s of shots) {
  const world = await bootWorld("/var/tmp/fleet/1838/rdist/review-main", 60, { __reviewStart: { map: s.map, x: s.x, y: s.y, dir: s.dir } }, undefined, { width: 480, height: 272 });
  for (let f = 0; f < (s.frames ?? 4); f++) { world.frame(0); world.tick(); }
  const rgba = world.render().slice();
  const st = (globalThis as any).__rpgSessionState, cam = (globalThis as any).__rpgGameCamera;
  writeFileSync(`/var/tmp/fleet/1838/shot-${s.name}.png`, encodePNG(rgba, 480, 272));
  const chars = Object.fromEntries(Object.entries(st.chars?.chars ?? {}).map(([k, c]: any) => [k, { tx: c.tx, ty: c.ty, px: c.px, py: c.py, dir: c.dir ?? c.facing }]));
  out.push({ ...s, fnv: fnv1a(rgba), mapNow: st.mapId, tx: st.move.tx, ty: st.move.ty, px: st.move.px, py: st.move.py, facing: st.move.facing, cam, modal: st.interp.modal ? (st.interp.modal.lines ?? st.interp.modal.options) : null, chars });
}
writeFileSync("/var/tmp/fleet/1838/shots.json", JSON.stringify(out, null, 1));
for (const o of out) console.log(o.name, o.mapNow, o.tx, o.ty, JSON.stringify(o.cam), o.modal ? "MODAL " + JSON.stringify(o.modal).slice(0, 60) : "", Object.keys(o.chars).filter((k) => k.startsWith("npc_")).join(","));
