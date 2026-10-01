// Capture the four GB6 mainline route checkpoints at both supported logical
// resolutions from the real built game. The selected frames are after map
// fade-in and outside a battle/dialog scene.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { bootWorld, fnv1a } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";
import { FIXED_TIME_HOST_GLOBALS } from "../battle/time-weather.ts";
import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import type { CameraState } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import type { SessionState } from "../vendor/pocket-rpgkit/src/engine/session.ts";

interface JourneyFile {
  hz: number;
  masks: number[];
}

const ROOT = resolve(import.meta.dir, "..");
const BUNDLE = join(ROOT, "dist/main");
const JOURNEY = join(ROOT, "data/gb6-mainline-journey.json");
const OUT = join(ROOT, "tests/goldens");

if (!existsSync(BUNDLE + ".js") || !existsSync(BUNDLE + ".pak")) {
  throw new Error("GB6 route goldens: missing dist/main.{js,pak}; run `bun run build`");
}

const journey = JSON.parse(readFileSync(JOURNEY, "utf8")) as JourneyFile;
if (journey.hz !== 60) throw new Error(`GB6 route goldens: expected 60 Hz tape, got ${journey.hz}`);

const checkpoints = [
  { name: "cotton-town", frame: 5_700, map: "spyder_cotton_town", position: [21, 39] },
  { name: "route-2", frame: 10_230, map: "spyder_route2", position: [0, 8] },
  { name: "city-park", frame: 43_839, map: "spyder_citypark", position: [10, 39] },
  { name: "route-3-end", frame: 108_615, map: "spyder_route3", position: [4, 6] },
] as const;
const viewports = [
  { width: 480, height: 272 },
  { width: 960, height: 544 },
] as const;

mkdirSync(OUT, { recursive: true });
const frames: Record<string, unknown>[] = [];
for (const viewport of viewports) {
  const wanted = new Map<number, (typeof checkpoints)[number]>(
    checkpoints.map((checkpoint) => [checkpoint.frame, checkpoint]),
  );
  const world = await bootWorld(BUNDLE, 60, FIXED_TIME_HOST_GLOBALS, undefined, viewport);
  for (let frame = 0; frame <= checkpoints.at(-1)!.frame; frame++) {
    world.frame(journey.masks[frame]!);
    world.tick();
    const checkpoint = wanted.get(frame);
    if (!checkpoint) continue;

    const state = globalThis.__rpgSessionState as SessionState | undefined;
    const camera = globalThis.__rpgGameCamera as CameraState | undefined;
    if (!state || !camera) throw new Error(`GB6 route goldens: missing state/camera at f${frame}`);
    if (
      state.mapId !== checkpoint.map ||
      state.move.tx !== checkpoint.position[0] ||
      state.move.ty !== checkpoint.position[1]
    ) {
      throw new Error(
        `GB6 route goldens: ${checkpoint.name} diverged at f${frame}: ` +
          `${state.mapId}@${state.move.tx},${state.move.ty} != ` +
          `${checkpoint.map}@${checkpoint.position.join(",")}`,
      );
    }
    if (state.fade || state.scene) {
      throw new Error(
        `GB6 route goldens: ${checkpoint.name} is not a clear map frame ` +
          `(fade=${state.fade?.phase ?? "none"}, scene=${state.scene?.kind ?? "none"})`,
      );
    }

    const rgba = world.render().slice();
    const file = `gb6-mainline-${checkpoint.name}.${viewport.width}x${viewport.height}.png`;
    const png = encodePNG(rgba, viewport.width, viewport.height);
    writeFileSync(join(OUT, file), png);
    frames.push({
      ...checkpoint,
      ...viewport,
      file,
      rgbaFnv1a: fnv1a(rgba),
      pngSha256: createHash("sha256").update(png).digest("hex"),
      camera: [camera.x, camera.y],
      player: {
        tile: [state.move.tx, state.move.ty],
        pixel: [state.move.px, state.move.py],
        facing: state.move.facing,
        phase: state.move.phase,
      },
    });
    console.log(
      `${checkpoint.name} ${viewport.width}x${viewport.height}: ` +
        `f${frame} ${state.mapId}@${state.move.tx},${state.move.ty} ` +
        `rgba=${fnv1a(rgba)} -> ${file}`,
    );
  }
}

if (frames.length !== checkpoints.length * viewports.length) {
  throw new Error(`GB6 route goldens: captured ${frames.length}/${checkpoints.length * viewports.length}`);
}
writeFileSync(
  join(ROOT, "data/gb6-route-goldens.json"),
  JSON.stringify({ format: "pocket-tuxemon/gb6-route-goldens/v1", frames }, null, 2) + "\n",
);
