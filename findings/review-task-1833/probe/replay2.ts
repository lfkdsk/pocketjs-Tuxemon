// Replay the maintained tape through the built bundle; log downstairs states and save frames.
import { readFileSync, writeFileSync } from "node:fs";
const ROOT = "/home/tangollvm/.fleet/worktrees/task-1833";
const { bootWorld } = await import(`${ROOT}/vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts`);
const { encodePNG } = await import(`${ROOT}/vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts`);
const tape = JSON.parse(readFileSync(`${ROOT}/data/g6-journey.json`, "utf8"));
const world = await bootWorld(`${ROOT}/dist/main`, 60, undefined, undefined, { width: 480, height: 272 });
const MAP = process.argv[2] ?? "spyder_downstairs"; const NPC = process.argv[3] ?? "npc_spyder_papertown_mom";
const save = new Set((process.argv[4] ?? "").split(",").filter(Boolean).map(Number));
for (let f = 0; f < tape.masks.length; f++) {
  world.frame(tape.masks[f]); world.tick();
  const st = (globalThis as any).__rpgSessionState;
  if (st.mapId === MAP && (f % 20 === 0 || save.has(f))) {
    const c = st.chars.chars[NPC];
    console.log(f, "player", st.move.tx, st.move.ty, "npc", c ? `${c.tx},${c.ty} px=${c.px},${c.py}` : "-", "var", st.sw.variables[`local.npc.${NPC.replace(/^npc_/, "")}`], st.interp.modal ? "MODAL" : "");
  }
  if (save.has(f)) writeFileSync(`/var/tmp/fleet/1838/replay-${MAP}-${f}.png`, encodePNG(world.render().slice(), 480, 272));
  if (f > 1100) break;
}
