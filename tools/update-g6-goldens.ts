// Regenerate the three maintained G6 journey keyframes from the built app.
// Prerequisite: `bun run build` (bundle + pak). The committed journey is the
// source of truth so a visual refresh never silently replaces preserved masks.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bootWorld, fnv1a } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";
import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import { walkPose } from "../vendor/pocket-rpgkit/src/engine/movement.ts";
import type { CameraState, Project } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import type { SessionState } from "../vendor/pocket-rpgkit/src/engine/session.ts";
import { canonicalJson } from "../vendor/pocket-rpgkit/src/engine/save.ts";
import { NPC_SRC_INDEX, PLAYER } from "../ui/game-assets.ts";
import { FIXED_TIME_HOST_GLOBALS } from "../battle/time-weather.ts";
import { createNpcSrcProvider } from "../ui/npc-src-repository.ts";

interface JourneyFile {
  hz: number;
  frames: number;
  map: string;
  position: [number, number];
  masks: number[];
  checkpoints: { name: string; frame: number; map: string; position: [number, number] }[];
  story: Record<string, number | boolean | string>;
  sha256: string;
}

const ROOT = resolve(import.meta.dir, "..");
const NPC_SRC = createNpcSrcProvider(NPC_SRC_INDEX, { read: (entry) => readFileSync(join(ROOT, "dist", entry)) });
const bundle = join(ROOT, "dist/main");
const journeyPath = join(ROOT, "data/g6-journey.json");
if (!existsSync(bundle + ".js") || !existsSync(bundle + ".pak")) {
  throw new Error("G6 goldens: missing dist/main.{js,pak}; run `bun run build`");
}
if (!existsSync(journeyPath)) throw new Error("G6 goldens: missing committed 60 Hz journey");

const journey = JSON.parse(readFileSync(journeyPath, "utf8")) as JourneyFile;
const project = JSON.parse(readFileSync(join(ROOT, "dist/project.json"), "utf8")) as Project;
const wanted = new Map(journey.checkpoints.map((mark) => [mark.frame, mark]));
const dir = join(ROOT, "tests/goldens");
mkdirSync(dir, { recursive: true });
for (const file of readdirSync(dir)) {
  if (/^g6-.*\.png$/.test(file)) rmSync(join(dir, file));
}
const world = await bootWorld(bundle, 60, FIXED_TIME_HOST_GLOBALS, undefined, { width: 480, height: 272 });
const frames: Record<string, unknown>[] = [];
const actorAt: Readonly<Record<string, string>> = {
  "downstairs-mom": "npc_spyder_papertown_mom",
};
const imageKey = (phase: number, facing: number, frames: typeof PLAYER): string => {
  const pose = walkPose(phase);
  return pose === 1 ? frames.walkL[facing]! : pose === 2 ? frames.walkR[facing]! : frames.idle[facing]!;
};

for (let frame = 0; frame < journey.masks.length; frame++) {
  world.frame(journey.masks[frame]!);
  world.tick();
  const mark = wanted.get(frame);
  if (!mark) continue;
  const state = globalThis.__rpgSessionState as SessionState | undefined;
  if (!state || state.mapId !== mark.map || state.move.tx !== mark.position[0] || state.move.ty !== mark.position[1]) {
    throw new Error(
      `G6 goldens: ${mark.name} diverged at f${frame}: ` +
        `${state?.mapId}@${state?.move.tx},${state?.move.ty} != ${mark.map}@${mark.position.join(",")}`,
    );
  }
  const rgba = world.render().slice();
  const file = `g6-${mark.name}.${frame}.png`;
  const png = encodePNG(rgba, 480, 272);
  writeFileSync(join(dir, file), png);
  const camera = globalThis.__rpgGameCamera as CameraState | undefined;
  if (!camera) throw new Error(`G6 goldens: missing camera at ${mark.name}`);
  const actorId = actorAt[mark.name];
  const ch = actorId ? state.chars.chars[actorId] : undefined;
  const event = actorId
    ? project.maps.find((map) => map.id === state.mapId)?.events?.find((candidate) => candidate.id === actorId)
    : undefined;
  const sprite = ch && event ? event.pages[ch.pageIndex]?.sprite : undefined;
  const art = sprite ? NPC_SRC[sprite] : undefined;
  if (actorId && (!ch || !event || !sprite || !art)) {
    throw new Error(`G6 goldens: ${actorId} is not visibly resolved at ${mark.name}`);
  }
  const actor = ch && sprite && art ? {
    id: actorId,
    tile: [ch.tx, ch.ty],
    pixel: [ch.px, ch.py],
    facing: ch.facing,
    phase: ch.phase,
    sprite,
    image: typeof art === "string" ? art : imageKey(ch.phase, ch.facing, art),
    height: typeof art === "string" ? 16 : art.h,
  } : undefined;
  frames.push({
    ...mark,
    file,
    rgbaFnv1a: fnv1a(rgba),
    pngSha256: createHash("sha256").update(png).digest("hex"),
    camera: [camera.x, camera.y],
    player: {
      tile: [state.move.tx, state.move.ty],
      pixel: [state.move.px, state.move.py],
      facing: state.move.facing,
      phase: state.move.phase,
      image: imageKey(state.move.phase, state.move.facing, PLAYER),
      height: 32,
    },
    ...(actor ? { actor } : {}),
  });
  console.log(`${mark.name}: f${frame} ${mark.map}@${mark.position.join(",")} rgba=${fnv1a(rgba)} -> ${file}`);
}

if (frames.length !== journey.checkpoints.length) {
  throw new Error(`G6 goldens: captured ${frames.length}/${journey.checkpoints.length} checkpoints`);
}
// Pin the terminal state hash into the tape so the QuickJS bench script reads
// its expected value from here instead of a stale literal. canonicalJson
// matches the desktop host's serde_json canonicalization (the GB6 tape's
// hash is verified both ways).
const terminalState = globalThis.__rpgSessionState as SessionState | undefined;
if (!terminalState) throw new Error("G6 goldens: missing terminal session state");
const terminalStateSha256 = createHash("sha256").update(canonicalJson(terminalState)).digest("hex");
const { sha256: _legacySelfHash, ...journeyBody } = journey;
const tape = { format: "pocket-tuxemon/g6-journey/v1", ...journeyBody, terminalStateSha256 };
writeFileSync(
  join(ROOT, "data/g6-journey.json"),
  JSON.stringify({ ...tape, sha256: createHash("sha256").update(JSON.stringify(tape)).digest("hex") }, null, 2) + "\n",
);
writeFileSync(
  join(ROOT, "data/g6-goldens.json"),
  JSON.stringify({ format: "pocket-tuxemon/g6-goldens/v1", width: 480, height: 272, frames }, null, 2) + "\n",
);
