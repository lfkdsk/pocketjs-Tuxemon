// In the BUILT bundle (real GameView input path), hold LEFT while the opening dialogue is open.
const ROOT = "/home/tangollvm/.fleet/worktrees/task-1833";
const { bootWorld } = await import(`${ROOT}/vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts`);
const { encodePNG } = await import(`${ROOT}/vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts`);
const { writeFileSync } = await import("node:fs");
const LEFT = 0x0080;
const world = await bootWorld(`${ROOT}/dist/main`, 60, { __reviewStart: undefined }, undefined, { width: 480, height: 272 });
for (let f = 0; f < 60; f++) {
  world.frame(LEFT); world.tick();
  const st = (globalThis as any).__rpgSessionState;
  if (f % 10 === 0 || f === 59) console.log(`[${f}] ${st.mapId}@${st.move.tx},${st.move.ty} px=${st.move.px} modal=${st.interp.modal ? (st.interp.modal.lines ?? st.interp.modal.options).join(" / ") : "-"}`);
}
writeFileSync("/var/tmp/fleet/1863/shots/ui-walk-during-intro.png", encodePNG(world.render().slice(), 480, 272));
