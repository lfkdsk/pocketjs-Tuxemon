// Render the new-game appearance picker (Tuxemon's choice_npc) in the built
// game (dist/main) at 480x272 and 960x544 and check that every row shows its
// character icon.
//
//   bun run build && bun tools/render-choice-icons.ts
//
// The demo warp drops the player on start_tuxemon; with the scenario picked
// and no appearance yet, its imported appearance event opens the six-row
// choice box. The box shows four rows at a
// time, so the screens are the first rows and, after scrolling, the last.
// Screens land in docs/screenshots/choice-npc/.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { FIXED_TIME_HOST_GLOBALS } from "../battle/time-weather.ts";
import type { ChoiceModal } from "../vendor/pocket-rpgkit/src/engine/interpreter.ts";
import type { SessionState } from "../vendor/pocket-rpgkit/src/engine/session.ts";
import { bootWorld } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";
import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";

const ROOT = resolve(import.meta.dir, "..");
const BUNDLE = join(ROOT, "dist/main");
const OUT = join(ROOT, "docs/screenshots/choice-npc");
const VIEWPORTS = [{ width: 480, height: 272 }, { width: 960, height: 544 }] as const;
const BTN_DOWN = 0x0040;
const SPRITES = ["adventurer", "adventurerblack", "heroine", "brownheroine_brown", "enbyasian", "penguin"];
// The kit's icon box: 248 px wide, docked 12 px from the right edge; 24 px
// rows; the 16 px icon cell starts 12 px inside the box, so it spans
// [width - 248, width - 232). Measured on the 480x272 capture; the box does
// not scale with the viewport.
const BOX_W = 248;
// TUXEMON_UI_THEME.paper (#102b3a)
const PAPER = [0x10, 0x2b, 0x3a];

type World = Awaited<ReturnType<typeof bootWorld>>;

function expect(label: string, condition: boolean): asserts condition {
  if (!condition) throw new Error(`choice icons: ${label}`);
}

function live(): SessionState {
  return globalThis.__rpgSessionState as SessionState;
}

function pump(world: World, frames: number, buttons = 0): void {
  for (let i = 0; i < frames; i++) {
    world.frame(buttons, 0x8080);
    world.tick();
  }
}

function press(world: World, button: number): void {
  pump(world, 1, button);
  pump(world, 2);
}

function modal(): ChoiceModal | null {
  const m = live().interp.modal;
  return m && m.kind === "choices" ? m : null;
}

function waitFor(world: World, label: string, done: () => boolean, limit = 600): void {
  for (let i = 0; i < limit; i++) {
    if (done()) return;
    pump(world, 1);
  }
  throw new Error(`choice icons: timed out waiting for ${label}`);
}

/** Distinct colours in a w x h block: an icon is many colours, an empty
 * panel cell one or two. */
function colours(rgba: Uint8Array, width: number, x0: number, y0: number, w: number, h: number): number {
  const seen = new Set<number>();
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * width + x) * 4;
      seen.add((rgba[i]! << 16) | (rgba[i + 1]! << 8) | rgba[i + 2]!);
    }
  }
  return seen.size;
}

/** Find the icons in the box's 16 px icon column: runs of pixel rows that
 * are inside the panel and have more than the paper colour. An icon is a
 * run of at least 10 such rows; the gaps between rows are plain paper.
 * Returns the first y of every run. */
function iconRows(rgba: Uint8Array, width: number, height: number): number[] {
  const x0 = width - BOX_W;
  const paperAt = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return rgba[i] === PAPER[0] && rgba[i + 1] === PAPER[1] && rgba[i + 2] === PAPER[2];
  };
  const runs: number[] = [];
  let start = -1;
  for (let y = 0; y <= height; y++) {
    // Inside the box the column 8 px left of the icons is plain paper;
    // above the box it is the backdrop.
    const drawn = y < height && paperAt(x0 - 8, y) && colours(rgba, width, x0, y, 16, 1) >= 2;
    if (drawn && start < 0) start = y;
    if (!drawn && start >= 0) {
      if (y - start >= 10) runs.push(start);
      start = -1;
    }
  }
  return runs;
}

mkdirSync(OUT, { recursive: true });
for (const { width, height } of VIEWPORTS) {
  const world = await bootWorld(BUNDLE, 60, FIXED_TIME_HOST_GLOBALS, undefined, { width, height });
  waitFor(world, "boot", () => !!globalThis.__rpgkitDemo && !!globalThis.__rpgSessionState);
  pump(world, 30);
  globalThis.__rpgkitDemo!.warp("start_tuxemon");
  waitFor(world, "start_tuxemon", () => live().mapId === "start_tuxemon");
  // A new game has already chosen; clear the appearance and pick the Spyder
  // scenario so the imported appearance event runs. The probe is read-only
  // in play; this harness writes it before the next pure fold.
  const state = live();
  const variables = { ...state.interp.sw.variables, "v.scenario_choice": 1, "v.race_choice": 0, "v.gender_choice": 0 };
  state.interp.sw = { ...state.interp.sw, variables };
  state.sw = state.interp.sw;
  waitFor(world, "appearance choice", () => modal()?.icons !== undefined);
  pump(world, 20);
  const picker = modal()!;
  expect("six options", picker.options.length === 6);
  expect(
    "icons are the six appearance walkers",
    JSON.stringify(picker.icons!.map((icon) => icon?.sprite)) === JSON.stringify(SPRITES),
  );
  const top = world.render().slice();
  const topRows = iconRows(top, width, height);
  for (let i = 0; i < 5; i++) press(world, BTN_DOWN);
  pump(world, 10);
  expect("cursor on the last row", modal()?.index === 5);
  const bottom = world.render().slice();
  const bottomRows = iconRows(bottom, width, height);
  writeFileSync(join(OUT, `choice-npc-top.${width}x${height}.png`), encodePNG(top, width, height));
  writeFileSync(join(OUT, `choice-npc-bottom.${width}x${height}.png`), encodePNG(bottom, width, height));
  expect(`four icon rows at the top (${topRows.join(",")})`, topRows.length === 4);
  expect(`four icon rows after scrolling (${bottomRows.join(",")})`, bottomRows.length === 4);
  console.log(`${width}x${height}: icon rows top ${topRows.join(",")} bottom ${bottomRows.join(",")}`);
}
