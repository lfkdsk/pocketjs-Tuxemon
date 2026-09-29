// Prepare equal-content inline and sharded apps for the KR1 QuickJS A/B.
//
// Usage:
//   bun findings/scripts/kr1-prepare-bench.ts <Tuxemon app dir> <empty output dir>
//
// The source app is the S3 benchmark fixture: it supplies the 263-map
// project, generated render manifest, art, and journey tape. The sharded app
// reads canonical map files synchronously through PocketJS data.fs, keeping
// those bytes out of its JavaScript bundle.

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { splitProjectMaps } from "../../tools/lib/map-project.ts";
import type { Project } from "../../src/engine/types.ts";

const source = resolve(Bun.argv[2] ?? "");
const output = resolve(Bun.argv[3] ?? "");
if (!Bun.argv[2] || !Bun.argv[3]) {
  throw new Error("usage: kr1-prepare-bench.ts <Tuxemon app dir> <empty output dir>");
}
if (!existsSync(join(source, "dist", "project.json"))) {
  throw new Error(`missing source project: ${join(source, "dist", "project.json")}`);
}
if (existsSync(output)) throw new Error(`output already exists: ${output}`);

const kit = resolve(import.meta.dir, "../..");
const project = JSON.parse(readFileSync(join(source, "dist", "project.json"), "utf8")) as Project;
const split = splitProjectMaps(project, { shellEntry: "project-shell.json" });
const sprites = project.sprites ?? {};
const paints = (key: string | null | undefined): boolean => {
  const sprite = key == null ? undefined : sprites[key];
  return !!sprite && (sprite.kind === "walker" || !!sprite.src);
};
const maxActors = Math.max(0, ...project.maps.map((map) =>
  (map.events ?? []).filter((event) => event.pages.some((page) => paints(page.sprite))).length));

function scaffold(variant: "inline" | "sharded"): string {
  const dir = join(output, "apps", variant);
  mkdirSync(join(dir, "dist"), { recursive: true });
  mkdirSync(join(dir, "vendor"), { recursive: true });
  cpSync(join(source, "ui"), join(dir, "ui"), { recursive: true });
  for (const name of ["images.json", "pak.json", "sprites.json", "tsconfig.json"]) {
    copyFileSync(join(source, name), join(dir, name));
  }
  symlinkSync(join(source, "assets"), join(dir, "assets"), "dir");
  symlinkSync(join(kit, "node_modules"), join(dir, "node_modules"), "dir");
  symlinkSync(kit, join(dir, "vendor", "pocket-rpgkit"), "dir");
  return dir;
}

const sharedTail = `
const assets: GameAssets = { ...GAME_ASSETS, maxActors: ${maxActors} };
(globalThis as typeof globalThis & { __kr1MapReads?: number }).__kr1MapReads = 0;
mount(() => <GameView project={project} assets={assets} maps={repository} />);
`;

const inline = scaffold("inline");
copyFileSync(join(source, "dist", "project.json"), join(inline, "dist", "project.json"));
writeFileSync(join(inline, "main.tsx"), `
import { mount } from "@pocketjs/framework";
import rawProject from "./dist/project.json";
import type { Project } from "./vendor/pocket-rpgkit/src/engine/types.ts";
import { GameView } from "./vendor/pocket-rpgkit/src/ui/GameView.tsx";
import type { GameAssets } from "./vendor/pocket-rpgkit/src/ui/game-assets.ts";
import { GAME_ASSETS } from "./ui/game-assets.ts";
const project = rawProject as unknown as Project;
const repository = undefined;
${sharedTail}`.trimStart());

const sharded = scaffold("sharded");
writeFileSync(join(sharded, "dist", "project-shell.json"), split.shellText);
writeFileSync(join(sharded, "main.tsx"), `
import { mount } from "@pocketjs/framework";
import { readFileSync } from "@pocketjs/framework/fs";
import rawProject from "./dist/project-shell.json";
import { createJsonMapRepository } from "./vendor/pocket-rpgkit/src/engine/map-repository.ts";
import type { ProjectShell } from "./vendor/pocket-rpgkit/src/engine/types.ts";
import { GameView } from "./vendor/pocket-rpgkit/src/ui/GameView.tsx";
import type { GameAssets } from "./vendor/pocket-rpgkit/src/ui/game-assets.ts";
import { GAME_ASSETS } from "./ui/game-assets.ts";
const project = rawProject as unknown as ProjectShell;
const reads = globalThis as typeof globalThis & { __kr1MapReads?: number };
const repository = createJsonMapRepository(project.mapIndex, {
  read(entry) {
    reads.__kr1MapReads = (reads.__kr1MapReads ?? 0) + 1;
    return readFileSync(entry, "utf8");
  },
});
${sharedTail}`.trimStart());

const data = join(output, "data", "dev.lfkdsk.kr1-bench", "data");
for (const entry of split.entries) {
  const path = join(data, entry.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, entry.bytes);
}
copyFileSync(join(source, "data", "g6-journey.json"), join(output, "g6-journey.json"));

const inlineBytes = readFileSync(join(source, "dist", "project.json")).byteLength;
const shellBytes = Buffer.byteLength(split.shellText);
const mapBytes = split.entries.reduce((sum, entry) => sum + entry.bytes.byteLength, 0);
console.log(JSON.stringify({ maps: split.entries.length, inlineBytes, shellBytes, mapBytes, maxActors }));
