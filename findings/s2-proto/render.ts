// findings/s2-proto/render.ts — render the S2 prototype on the wasm sim host to a PNG.
//
//   bun findings/s2-proto/render.ts --mode=chunks --map=taba_town --w=480 --h=272 \
//       --at=512,400 --frames=60 --out=/var/tmp/fleet/task-1783/shots/x.png [--scroll] [--json]
//
// Boots dist/s2-proto.{js,pak} exactly like the kit's tests/helpers/boot.ts
// (same wasm core, same HostOps binding), runs `frames` virtual frames, and
// writes the framebuffer. With --json it also prints the app's counters and
// the JS time per frame measured in Bun (JSC), which is only a sanity number;
// the QuickJS figures come from the desktop bench.

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createWasmUi } from "../../vendor/pocket-rpgkit/vendor/pocketjs/hosts/web/wasm-ops.js";
import { encodePNG } from "../../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";

const ROOT = resolve(import.meta.dir, "../..");
const DIST = process.env.S2_DIST ?? "/var/tmp/fleet/task-1783/dist";
const WASM = join(ROOT, "vendor/pocket-rpgkit/vendor/pocketjs/hosts/web/pocketjs.wasm");

const arg = (name: string, d: string): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? d;
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const mode = arg("mode", "chunks");
const map = arg("map", "taba_town");
const w = Number(arg("w", "480"));
const h = Number(arg("h", "272"));
const frames = Number(arg("frames", "60"));
const at = arg("at", "").split(",").map(Number);
const out = arg("out", `/var/tmp/fleet/task-1783/shots/${mode}-${map}-${w}x${h}.png`);

for (const p of [join(DIST, "s2-proto.js"), join(DIST, "s2-proto.pak"), WASM]) {
  if (!existsSync(p)) throw new Error(`missing ${p}`);
}
const wasm = await createWasmUi(await Bun.file(WASM).arrayBuffer(), { width: w, height: h });
const g = globalThis as Record<string, unknown>;
g.ui = wasm.ops;
g.__pak = await Bun.file(join(DIST, "s2-proto.pak")).arrayBuffer();
g.frame = undefined;
g.offload = undefined;
g.audio = undefined;
g.db = undefined;
g.fs = undefined;
g.__pocketApp = "s2-proto";
g.__simHz = 60;
g.__pocketEffectTrace = (): void => {};
g.__pocketEffectDriver = undefined;
g.__pocketDevtoolsTransport = { send: (): void => {}, recv: () => null };
g.__s2Cmd = { mode, map, scroll: flag("scroll"), ...(at.length === 2 && !Number.isNaN(at[0]) ? { at: [at[0], at[1]] } : {}) };
(0, eval)(await Bun.file(join(DIST, "s2-proto.js")).text());
const appFrame = g.frame as (buttons: number, analog?: number) => void;
if (typeof appFrame !== "function") throw new Error("bundle did not install globalThis.frame");

const times: number[] = [];
for (let i = 0; i < frames; i++) {
  const t0 = performance.now();
  appFrame(0);
  times.push(performance.now() - t0);
  wasm.tick();
}
const rgba = wasm.renderScaled(1);
mkdirSync(dirname(out), { recursive: true });
await Bun.write(out, encodePNG(rgba, w, h));
const sorted = [...times].sort((a, b) => a - b);
const state = g.__s2State as Record<string, unknown>;
const summary = {
  out, mode, map, w, h, frames,
  jsMeanMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3),
  jsP95Ms: +sorted[Math.floor(sorted.length * 0.95)]!.toFixed(3),
  jsMaxMs: +sorted[sorted.length - 1]!.toFixed(3),
  jsFirstMs: +times[0]!.toFixed(3),
  state,
};
console.log(JSON.stringify(summary));
