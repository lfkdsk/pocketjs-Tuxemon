// Capture two real outdoor seams through the production bundle at both
// supported viewport classes. The maintained G6 tape supplies authentic
// game-entry state; only rendering is observed.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bootWorld, fnv1a } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";
import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import type { CameraState, WorldComponent, WorldPlacement } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import type { PocketTuxemonWorldDiagnostics } from "../ui/world-diagnostics.ts";
import { FIXED_TIME_HOST_GLOBALS } from "../battle/time-weather.ts";

const ROOT = resolve(import.meta.dir, "..");
const BUNDLE = join(ROOT, "dist/main");
const FIXTURE = join(ROOT, "tests/fixtures/world-seam-goldens.json");
const GOLDENS = join(ROOT, "tests/goldens");
const TILE = 16;

interface Journey {
  masks: number[];
  checkpoints: Array<{ name: string; frame: number; map: string; position: [number, number] }>;
}

interface ProjectShellFixture {
  worldLayout: { components: WorldComponent[] };
}

interface Target {
  name: "east-west" | "north-south";
  checkpoint: "paper-town" | "route-1";
  activeMap: string;
  neighbourMap: string;
  /** A fixed component-world pixel owned only by neighbourMap. */
  sampleWorld: [number, number];
}

const targets: readonly Target[] = [
  {
    name: "east-west",
    checkpoint: "paper-town",
    activeMap: "spyder_paper_town",
    neighbourMap: "spyder_routec",
    sampleWorld: [100 * TILE - 24, 180 * TILE + 64],
  },
  {
    name: "north-south",
    checkpoint: "route-1",
    activeMap: "spyder_route1",
    neighbourMap: "spyder_paper_town",
    sampleWorld: [100 * TILE + 25 * TILE, 180 * TILE + 24],
  },
];

const viewports = [
  { width: 480, height: 272 },
  { width: 960, height: 544 },
] as const;

const journey = JSON.parse(readFileSync(join(ROOT, "data/g6-journey.json"), "utf8")) as Journey;
const project = JSON.parse(readFileSync(join(ROOT, "dist/project-shell.json"), "utf8")) as ProjectShellFixture;
if (!existsSync(BUNDLE + ".js") || !existsSync(BUNDLE + ".pak")) {
  throw new Error("world seam goldens: run `bun run build` first");
}
mkdirSync(GOLDENS, { recursive: true });

function placement(mapId: string): { component: WorldComponent; placement: WorldPlacement } {
  for (const component of project.worldLayout.components) {
    const found = component.placements.find((candidate) => candidate.mapId === mapId);
    if (found) return { component, placement: found };
  }
  throw new Error(`world seam goldens: missing placement ${mapId}`);
}

function contains(entry: WorldPlacement, x: number, y: number): boolean {
  return x >= entry.originTileX * TILE && x < (entry.originTileX + entry.width) * TILE &&
    y >= entry.originTileY * TILE && y < (entry.originTileY + entry.height) * TILE;
}

const output: Record<string, unknown>[] = [];
for (const viewport of viewports) {
  const diagnostics: PocketTuxemonWorldDiagnostics = {};
  const globals = {
    ...FIXED_TIME_HOST_GLOBALS,
    __pocketTuxemonWorldDiagnostics: diagnostics,
  };
  const world = await bootWorld(BUNDLE, 60, globals, undefined, viewport);
  const wanted = new Map(targets.map((target) => {
    const checkpoint = journey.checkpoints.find((candidate) => candidate.name === target.checkpoint);
    if (!checkpoint) throw new Error(`world seam goldens: missing checkpoint ${target.checkpoint}`);
    return [checkpoint.frame, { target, checkpoint }] as const;
  }));
  const lastFrame = Math.max(...wanted.keys());

  for (let frame = 0; frame <= lastFrame; frame++) {
    world.frame(journey.masks[frame] ?? 0, 0x8080);
    world.tick();
    const selected = wanted.get(frame);
    if (!selected) continue;
    const { target, checkpoint } = selected;
    const camera = globalThis.__rpgGameCamera as CameraState | undefined;
    const state = globalThis.__rpgSessionState;
    if (!camera || !state || state.mapId !== target.activeMap) {
      throw new Error(`world seam goldens: ${target.name} did not reach ${target.activeMap}`);
    }
    const active = placement(target.activeMap);
    const neighbour = placement(target.neighbourMap);
    if (active.component.componentId !== neighbour.component.componentId) {
      throw new Error(`world seam goldens: ${target.name} maps are in different components`);
    }
    if (
      !contains(neighbour.placement, target.sampleWorld[0], target.sampleWorld[1]) ||
      contains(active.placement, target.sampleWorld[0], target.sampleWorld[1])
    ) {
      throw new Error(`world seam goldens: ${target.name} sample is not neighbour-only`);
    }
    const componentW = (active.component.bounds.maxTileX - active.component.bounds.minTileX) * TILE;
    const componentH = (active.component.bounds.maxTileY - active.component.bounds.minTileY) * TILE;
    const frameX = componentW < viewport.width ? Math.floor((viewport.width - componentW) / 2) : 0;
    const frameY = componentH < viewport.height ? Math.floor((viewport.height - componentH) / 2) : 0;
    const sampleX = Math.floor(frameX + target.sampleWorld[0] - camera.x);
    const sampleY = Math.floor(frameY + target.sampleWorld[1] - camera.y);
    if (sampleX < 0 || sampleX >= viewport.width || sampleY < 0 || sampleY >= viewport.height) {
      throw new Error(`world seam goldens: ${target.name} sample is outside ${viewport.width}x${viewport.height}`);
    }
    const rgba = world.render().slice();
    const offset = (sampleY * viewport.width + sampleX) * 4;
    const sampleRgba = [...rgba.subarray(offset, offset + 4)];
    if (sampleRgba[3] !== 255 || sampleRgba[0] + sampleRgba[1] + sampleRgba[2] === 0) {
      throw new Error(`world seam goldens: ${target.name} neighbour sample is background`);
    }
    const stream = diagnostics.stream?.ground;
    if (!stream?.visibleMaps?.includes(target.activeMap) || !stream.visibleMaps.includes(target.neighbourMap)) {
      throw new Error(`world seam goldens: ${target.name} renderer did not expose both maps`);
    }
    if (stream.pending !== 0) {
      throw new Error(`world seam goldens: ${target.name} still has ${stream.pending} pending chunks`);
    }

    const file = `world-seam-${target.name}.${viewport.width}x${viewport.height}.png`;
    const png = encodePNG(rgba, viewport.width, viewport.height);
    writeFileSync(join(GOLDENS, file), png);
    output.push({
      name: target.name,
      viewport,
      frame: checkpoint.frame,
      activeMap: target.activeMap,
      neighbourMap: target.neighbourMap,
      file,
      camera: [camera.x, camera.y],
      sample: { world: target.sampleWorld, screen: [sampleX, sampleY], rgba: sampleRgba },
      activeRect: [
        active.placement.originTileX * TILE,
        active.placement.originTileY * TILE,
        active.placement.width * TILE,
        active.placement.height * TILE,
      ],
      neighbourRect: [
        neighbour.placement.originTileX * TILE,
        neighbour.placement.originTileY * TILE,
        neighbour.placement.width * TILE,
        neighbour.placement.height * TILE,
      ],
      visibleMaps: stream.visibleMaps,
      terrain: {
        textures: stream.textures,
        resident: stream.resident,
        pooled: stream.pooled,
        created: stream.created,
        pending: stream.pending,
      },
      rgbaFnv1a: fnv1a(rgba),
      pngSha256: createHash("sha256").update(png).digest("hex"),
    });
    console.log(`${target.name} ${viewport.width}x${viewport.height}: sample=${sampleRgba.join(",")} maps=${stream.visibleMaps.join(",")}`);
  }
}

writeFileSync(FIXTURE, JSON.stringify({ format: "pocket-tuxemon/world-seam-goldens/v1", frames: output }, null, 2) + "\n");
