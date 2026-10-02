// Render the save/load menu in the built game (dist/main) at 480x272 and
// 960x544 and check a few pixels that only the right screen can produce.
//
//   bun run build && bun tools/render-save-screens.ts
//
// One boot per viewport with browser storage plays the GB6 tape to a save
// point after the first battle, then presses START and saves to slot 1, walks
// on into a dialogue (saving there is refused), and loads slot 1 back. A
// second boot without any storage shows the save-code-only menu (PSP and
// other hosts without data.fs or browser storage) and its code export.
// Screens land in docs/screenshots/save/.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { FIXED_TIME_HOST_GLOBALS } from "../battle/time-weather.ts";
import { bootWorld } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";
import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import type { SessionState } from "../vendor/pocket-rpgkit/src/engine/session.ts";
import { saveBlockReason } from "../ui/save-game.ts";
import type { PocketTuxemonSaveHook } from "../ui/save-menu-runtime.ts";
import { loadGb6Tape, ROOT } from "./save-resume.ts";

const BUNDLE = join(ROOT, "dist/main");
const OUT = join(ROOT, "docs/screenshots/save");
const VIEWPORTS = [{ width: 480, height: 272 }, { width: 960, height: 544 }] as const;
const BTN_START = 0x0008;
const BTN_DOWN = 0x0040;
const BTN_CIRCLE = 0x2000;
const BTN_CROSS = 0x4000;
const BTN_LTRIGGER = 0x0100;
// main.tsx theme
const PAPER = [0x10, 0x2b, 0x3a];
const BACKDROP = [0x06, 0x14, 0x1d];

type World = Awaited<ReturnType<typeof bootWorld>>;

function expect(label: string, condition: boolean): asserts condition {
  if (!condition) throw new Error(`save screens: ${label}`);
}

function live(): SessionState {
  return globalThis.__rpgSessionState as SessionState;
}

function hook(): PocketTuxemonSaveHook {
  return globalThis.__pocketTuxemonSave!;
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

function pixel(rgba: Uint8Array, width: number, x: number, y: number): number[] {
  const i = (y * width + x) * 4;
  return [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
}

function same(a: number[], b: number[]): boolean {
  return a.every((v, i) => Math.abs(v - b[i]!) <= 2);
}

function step(world: World, mask: number): void {
  world.frame(mask);
  world.tick();
}

/** One press: a frame with the button down, then a release frame. */
function press(world: World, mask: number): void {
  step(world, mask);
  step(world, 0);
}

function shot(world: World, viewport: { width: number; height: number }, name: string): Uint8Array {
  const rgba = world.render().slice();
  const file = `${name}.${viewport.width}x${viewport.height}.png`;
  writeFileSync(join(OUT, file), encodePNG(rgba, viewport.width, viewport.height));
  console.log(`wrote docs/screenshots/save/${file}`);
  return rgba;
}

/** Play the tape until the first save point at or after `from`. */
function playToSavePoint(world: World, masks: readonly number[], from: number): number {
  let frame = 0;
  while (frame < from || saveBlockReason(live()) !== null) step(world, masks[frame++]!);
  return frame;
}

const masks = loadGb6Tape().masks;
mkdirSync(OUT, { recursive: true });

for (const viewport of VIEWPORTS) {
  const { width, height } = viewport;
  const center = (rgba: Uint8Array) => pixel(rgba, width, Math.floor(width / 2), Math.floor(height / 2) + 60);
  const corner = (rgba: Uint8Array) => pixel(rgba, width, 4, 4);

  // --- browser slots ------------------------------------------------------
  const world = await bootWorld(BUNDLE, 60, { ...FIXED_TIME_HOST_GLOBALS, localStorage: memoryStorage() }, undefined, viewport);
  expect("browser storage selects the slot menu", hook().channel() === "browser");
  let frame = playToSavePoint(world, masks, 3400);
  const saved = live();
  const savedAt = `${saved.mapId}@${saved.move.tx},${saved.move.ty}`;
  console.log(`${width}x${height}: save point at tape frame ${frame}, ${savedAt}`);

  press(world, BTN_START);
  expect("START opens the root page", hook().menu().kind === "root");
  const menu = shot(world, viewport, "save-menu");
  expect("menu backdrop covers the corner", same(corner(menu), BACKDROP));
  expect("menu panel paper below the rows", same(center(menu), PAPER));

  press(world, BTN_CIRCLE);
  press(world, BTN_CIRCLE);
  const done = hook().menu();
  expect(`slot 1 saved (${JSON.stringify(done)})`, done.kind === "message" && done.title === "SAVED TO SLOT 1");
  shot(world, viewport, "save-done");
  press(world, BTN_CIRCLE);
  press(world, BTN_DOWN);
  press(world, BTN_CIRCLE);
  expect("load page lists slot 1", hook().menu().kind === "slots-load");
  shot(world, viewport, "save-slots");
  press(world, BTN_START);
  expect("START closes the menu", hook().menu().kind === "closed");
  step(world, 0);

  // Walk on into the next dialogue; saving there is refused.
  while (live().interp.modal === null) step(world, masks[frame++]!);
  for (let i = 0; i < 40; i++) step(world, 0); // let the text type out
  const talkAt = `${live().mapId}@${live().move.tx},${live().move.ty}`;
  press(world, BTN_START);
  press(world, BTN_CIRCLE);
  press(world, BTN_CIRCLE);
  const refused = hook().menu();
  expect(`refused in a dialogue (${JSON.stringify(refused)})`,
    refused.kind === "message" && refused.title === "CAN'T SAVE NOW" && refused.body === "Finish the conversation first.");
  shot(world, viewport, "save-refused");

  // Back out to the load page and load slot 1.
  press(world, BTN_CROSS);
  press(world, BTN_CROSS);
  press(world, BTN_DOWN);
  press(world, BTN_CIRCLE);
  press(world, BTN_CIRCLE);
  expect("load closes the menu", hook().menu().kind === "closed");
  expect("load shows a notice", hook().toast() === "Loaded slot 1");
  for (let i = 0; i < 4; i++) step(world, 0);
  const loadedAt = `${live().mapId}@${live().move.tx},${live().move.ty}`;
  expect(`loaded back to ${savedAt}, got ${loadedAt} (was talking at ${talkAt})`, loadedAt === savedAt);
  expect("no dialogue after the load", live().interp.modal === null);
  const loaded = shot(world, viewport, "save-loaded");
  expect("the world is visible again after the load", !same(corner(loaded), BACKDROP));

  // --- save code only -----------------------------------------------------
  delete (globalThis as { localStorage?: unknown }).localStorage;
  const codeWorld = await bootWorld(BUNDLE, 60, FIXED_TIME_HOST_GLOBALS, undefined, viewport);
  expect("no storage selects the code menu", hook().channel() === "code");
  const codeFrame = playToSavePoint(codeWorld, masks, 3400);
  press(codeWorld, BTN_START);
  shot(codeWorld, viewport, "save-code-menu");
  press(codeWorld, BTN_CIRCLE);
  expect("code export page", hook().menu().kind === "code-export" && hook().saveCode().length > 0);
  shot(codeWorld, viewport, "save-code-export");
  console.log(`${width}x${height}: save code is ${hook().saveCode().length} characters`);
  press(codeWorld, BTN_CROSS);
  press(codeWorld, BTN_START);
  step(codeWorld, 0);

  // The save menu is an overlay and adds no rewind, but the demo controls
  // arm the kit's attract controller, which gives live play L rewind: three
  // seconds back is the uninterrupted run's state, and a save menu in the
  // same game must not break it.
  if (width === 480) {
    const rewindTo = new Map<number, string>();
    const probe = await bootWorld(BUNDLE, 60, FIXED_TIME_HOST_GLOBALS, undefined, viewport);
    for (let f = 0; f < codeFrame; f++) {
      step(probe, masks[f]!);
      rewindTo.set(f + 1, `${live().mapId}@${live().move.px},${live().move.py}`);
    }
    step(probe, BTN_LTRIGGER);
    const back = `${live().mapId}@${live().move.px},${live().move.py}`;
    const expected = rewindTo.get(codeFrame - 180);
    expect(`L rewinds three seconds: ${back}, expected ${expected}`, back === expected);
    console.log(`L rewind: tape frame ${codeFrame} -> ${codeFrame - 180} (${back})`);
  }
}
console.log("SAVE SCREENS PASS");
