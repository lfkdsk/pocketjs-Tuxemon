// Temporary demo smoke test: boot the built bundle and exercise the demo
// hook (jump, warp, autoplay, deep-link boot) through the sim host.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { bootWorld } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";

const ROOT = resolve(import.meta.dir, "..");
const BUNDLE = join(ROOT, "dist/main");
if (!existsSync(BUNDLE + ".js") || !existsSync(BUNDLE + ".pak")) {
  throw new Error("missing dist/main.{js,pak}; run `bun run build` first");
}

const world = await bootWorld(BUNDLE, 60, undefined, undefined, { width: 480, height: 272 });
for (let i = 0; i < 30; i++) {
  world.frame(0);
  world.tick();
}
const hook = (globalThis as any).__rpgkitDemo;
if (!hook) throw new Error("__rpgkitDemo not installed");
const state = () => (globalThis as any).__rpgSessionState;
console.log("boot map:", state().mapId, "@", state().move.tx, state().move.ty);
console.log("current:", JSON.stringify(hook.current()));

// 1. Jump to paper-town
hook.jump("paper-town");
for (let i = 0; i < 10; i++) { world.frame(0); world.tick(); }
console.log("after jump paper-town:", state().mapId, "@", state().move.tx, state().move.ty,
  "current:", JSON.stringify(hook.current()));

// 2. Warp to route 1
hook.warp("spyder_route1", 10, 10);
for (let i = 0; i < 10; i++) { world.frame(0); world.tick(); }
console.log("after warp route1:", state().mapId, "@", state().move.tx, state().move.ty);

// 3. Autoplay the starter chapter at 2x
hook.autoplay("starter", 2);
for (let i = 0; i < 30; i++) { world.frame(0); world.tick(); }
const cur = hook.current();
console.log("after autoplay starter:", state().mapId, "autoplay:", cur.autoplay, "speed:", cur.speed,
  "chapter:", cur.chapter);

// 4. Invalid chapter -> visible error (no throw)
hook.jump("no-such-chapter");
for (let i = 0; i < 5; i++) { world.frame(0); world.tick(); }
console.log("after invalid jump (state unchanged):", state().mapId);

console.log("DEMO SMOKE OK");
