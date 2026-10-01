// One-command deterministic G6 cook: K1 events + streamed terrain + R2 art.
// Usage: TUXEMON_SRC=/path/to/Tuxemon bun gen-assets.ts

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { encodePNG } from "./vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import { cookAnimationAtlases } from "./vendor/pocket-rpgkit/tools/lib/animated.ts";
import { loadAnimationSheet } from "./vendor/pocket-rpgkit/tools/lib/anim-sheet.ts";
import { splitProjectMaps } from "./vendor/pocket-rpgkit/tools/lib/map-project.ts";
import { pakManifest, type PakManifestEntry } from "./vendor/pocket-rpgkit/tools/lib/stream.ts";
import { assertShellManifestFresh } from "./vendor/pocket-rpgkit/src/engine/map-repository.ts";
import type { GameAssets, GameScreenLayerAssets } from "./vendor/pocket-rpgkit/src/ui/game-assets.ts";
import type { PlayerFrames } from "./vendor/pocket-rpgkit/src/ui/PlayerSprite.tsx";
import type { Project } from "./vendor/pocket-rpgkit/src/engine/types.ts";
import { splitAnimatedTiles, type AnimatedIndexEntry } from "./importer/animated.ts";
import { collectNpcSrcAssetPaths, splitNpcSrc, type NpcSrcIndexEntry } from "./importer/npc-src.ts";
import { cookCharacters } from "./importer/characters.ts";
import { appendBattleDbPakEntry, writeBattleArtifacts } from "./importer/battle.ts";
import { coverageMarkdown, jsonBytes } from "./importer/index.ts";
import { decodePng } from "./importer/png.ts";
import { availableMapIds, buildProject, G6_IMPORT_OPTIONS } from "./importer/project.ts";
import { applyTerrain, DEFAULT_TUXEMON_SRC, writeTerrain } from "./importer/terrain.ts";
import { buildWarpIndex } from "./importer/warp.ts";

// Tests and determinism checks can cook into a disposable root without
// touching the maintained project tree. Source modules still come from this
// checkout; only generated outputs are redirected.
const ROOT = resolve(process.env.G6_OUTPUT_ROOT ?? import.meta.dir);
const DIST = join(ROOT, "dist");
mkdirSync(DIST, { recursive: true });
mkdirSync(join(ROOT, "reports"), { recursive: true });

const terrain = writeTerrain({ outputRoot: ROOT });
const imported = buildProject(
  availableMapIds(),
  G6_IMPORT_OPTIONS,
  Object.fromEntries(terrain.fragment.maps.map((map) => [map.id, map.surfaceLabels])),
);
let project = applyTerrain(imported.project, terrain.fragment);
// The G1 one-tile sheet is now unused: every ground id and passage mask is
// owned by the generated terrain sheet.
project = {
  ...project,
  sheets: project.sheets.filter((sheet) => sheet.id !== "tux"),
  maps: project.maps.map((map) => ({ ...map, sheets: map.sheets?.filter((sheet) => sheet !== "tux") })),
};

const characters = await cookCharacters(project, { outputRoot: ROOT });
project = characters.project;

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

/** PocketJS static IMG entries require power-of-two textures. Resample the
 * complete authored image to the smallest portable texture; the image node
 * then scales it back to its logical size, preserving authored geometry. */
function portableStaticPng(image: {
  width: number;
  height: number;
  rgba: Uint8Array;
}): { png: Uint8Array; width: number; height: number } {
  const width = nextPowerOfTwo(image.width);
  const height = nextPowerOfTwo(image.height);
  if (width > 512 || height > 512) {
    throw new Error(`static image ${image.width}x${image.height} exceeds PocketJS's 512px texture limit`);
  }
  if (width === image.width && height === image.height) {
    return { png: encodePNG(image.rgba, width, height), width, height };
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(image.height - 1, Math.floor((y + 0.5) * image.height / height));
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(image.width - 1, Math.floor((x + 0.5) * image.width / width));
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      rgba.set(image.rgba.subarray(sourceOffset, sourceOffset + 4), (y * width + x) * 4);
    }
  }
  return { png: encodePNG(rgba, width, height), width, height };
}

// KA1 reducer-driven map animations use static per-frame images rather than
// the host-clock sprite atlases used by terrain animation. Cook only the
// definitions collected from source actions into a deterministic manifest.
const mapAnimationDir = join(ROOT, "assets/map-animations");
rmSync(mapAnimationDir, { recursive: true, force: true });
mkdirSync(mapAnimationDir, { recursive: true });
const mapAnimationAssets: Record<string, { frames: string[]; w: number; h: number }> = {};
const mapAnimationImages: Record<string, { psm: number }> = {};
let mapAnimationBytes = 0;
for (const def of [...(project.animations ?? [])].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
  const sourceRoot = process.env.TUXEMON_SRC ?? DEFAULT_TUXEMON_SRC;
  const cookedAnimation = await loadAnimationSheet(
    join(sourceRoot, "mods/tuxemon", def.sheet),
    def,
  );
  const frames: string[] = [];
  cookedAnimation.frames.forEach((sourcePng, index) => {
    const frame = decodePng(new Uint8Array(sourcePng), `${def.id} frame ${index}`);
    const { png } = portableStaticPng(frame);
    const relative = `assets/map-animations/${def.id}-${index}.png`;
    writeFileSync(join(ROOT, relative), png);
    mapAnimationImages[relative] = { psm: 3 };
    mapAnimationBytes += png.byteLength;
    frames.push(relative);
  });
  mapAnimationAssets[def.id] = {
    frames,
    w: cookedAnimation.w,
    h: cookedAnimation.h,
  };
}

// KS1 blocking story backdrops. Indexed upstream PNGs are normalised to
// RGBA, and an optional foreground is centered and source-over composited
// exactly once at build time so the runtime binds a single screen image.
const screenLayerDir = join(ROOT, "assets/screen-layers");
rmSync(screenLayerDir, { recursive: true, force: true });
mkdirSync(screenLayerDir, { recursive: true });
const screenLayerImages: Record<string, { psm: number }> = {};
const backdropVariants: Record<string, { color?: string; image?: string }> = {};
let screenLayerBytes = 0;
const sourceRoot = process.env.TUXEMON_SRC ?? DEFAULT_TUXEMON_SRC;

function compositeBackdrop(
  backgroundPath: string,
  foregroundPath?: string,
  crop?: { x: number; y: number; w: number; h: number },
): Uint8Array {
  const background = decodePng(
    new Uint8Array(readFileSync(join(sourceRoot, "mods/tuxemon", backgroundPath))),
    backgroundPath,
  );
  if (background.width !== 256 || background.height !== 144) {
    throw new Error(`${backgroundPath}: backdrop must be 256x144`);
  }
  const rgba = background.rgba.slice();
  if (foregroundPath) {
    const foreground = decodePng(
      new Uint8Array(readFileSync(join(sourceRoot, "mods/tuxemon", foregroundPath))),
      foregroundPath,
    );
    const source = crop ?? { x: 0, y: 0, w: foreground.width, h: foreground.height };
    if (source.x < 0 || source.y < 0 || source.w <= 0 || source.h <= 0 ||
        source.x + source.w > foreground.width || source.y + source.h > foreground.height) {
      throw new Error(`${foregroundPath}: foreground crop exceeds its source image`);
    }
    if (source.w > background.width || source.h > background.height) {
      throw new Error(`${foregroundPath}: foreground exceeds the 256x144 backdrop`);
    }
    const left = Math.floor((background.width - source.w) / 2);
    const top = Math.floor((background.height - source.h) / 2);
    for (let y = 0; y < source.h; y++) {
      for (let x = 0; x < source.w; x++) {
        const sourceOffset = ((source.y + y) * foreground.width + source.x + x) * 4;
        const target = ((top + y) * background.width + left + x) * 4;
        const sourceAlpha = foreground.rgba[sourceOffset + 3]!;
        const targetAlpha = rgba[target + 3]!;
        const outAlpha = sourceAlpha + Math.round(targetAlpha * (255 - sourceAlpha) / 255);
        for (let channel = 0; channel < 3; channel++) {
          const premultiplied = foreground.rgba[sourceOffset + channel]! * sourceAlpha +
            Math.round(rgba[target + channel]! * targetAlpha * (255 - sourceAlpha) / 255);
          rgba[target + channel] = outAlpha === 0 ? 0 : Math.round(premultiplied / outAlpha);
        }
        rgba[target + 3] = outAlpha;
      }
    }
  }
  return encodePNG(rgba, background.width, background.height);
}

for (const source of imported.presentation.backdrops) {
  if (source.color) {
    backdropVariants[source.variant] = { color: source.color };
    continue;
  }
  if (!source.background) throw new Error(`backdrop ${source.variant} has no source`);
  const composed = decodePng(
    compositeBackdrop(source.background, source.foreground, source.foregroundCrop),
    source.variant,
  );
  const { png } = portableStaticPng(composed);
  const relative = `assets/screen-layers/tux-backdrop-${source.variant}.png`;
  writeFileSync(join(ROOT, relative), png);
  screenLayerImages[relative] = { psm: 3 };
  screenLayerBytes += png.byteLength;
  backdropVariants[source.variant] = { image: relative };
}

const overlayVariants: Record<string, { color?: string; image?: string }> = {};
for (const source of imported.presentation.overlays) {
  if (source.color) {
    overlayVariants[source.variant] = { color: source.color };
    continue;
  }
  if (!source.image) throw new Error(`overlay ${source.variant} has no source`);
  const image = decodePng(
    new Uint8Array(readFileSync(join(sourceRoot, "mods/tuxemon", source.image))),
    source.image,
  );
  const { png } = portableStaticPng(image);
  const relative = `assets/screen-layers/tux-overlay-${source.variant}.png`;
  writeFileSync(join(ROOT, relative), png);
  screenLayerImages[relative] = { psm: 3 };
  screenLayerBytes += png.byteLength;
  overlayVariants[source.variant] = { image: relative };
}

const screenLayers: Record<string, GameScreenLayerAssets> = {
  ...(Object.keys(backdropVariants).length ? {
    tux_backdrop: {
      placement: "screen",
      variants: backdropVariants,
    } satisfies GameScreenLayerAssets,
  } : {}),
  ...(Object.keys(overlayVariants).length ? {
    tux_overlay: {
      placement: "screen",
      defaultVisible: false,
      variants: overlayVariants,
    } satisfies GameScreenLayerAssets,
  } : {}),
};
const battleScope = process.env.BATTLE_DB_SCOPE === "full" ? "full" : "spyder";
const battle = writeBattleArtifacts({ outputRoot: ROOT, scope: battleScope });

// GP1: GameAssets.npcSrc used to bundle every NPC's sprite-frame paths as
// one eager literal. Split it the same way animated tiles are split — one
// canonical entry per NPC art id — so ui/npc-src-repository.ts can
// resolve+cache only the NPCs a session actually spawns.
const npcSrcSplit = splitNpcSrc(characters.npcSrc);
const npcSrcDir = join(DIST, "npc-src");
rmSync(npcSrcDir, { recursive: true, force: true });
mkdirSync(npcSrcDir, { recursive: true });
for (const entry of npcSrcSplit.entries) {
  const path = join(DIST, entry.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, entry.bytes);
}
const npcSrcPakEntries: PakManifestEntry[] = npcSrcSplit.entries.map((entry) => ({
  key: entry.meta.entry,
  file: `dist/${entry.path}`,
}));
// PocketJS bakes an "assets/..." image into the pak only when its literal
// path string is reachable from scanned TS/TSX source. Moving NPC_SRC into
// JSON shards hid these paths from that scanner, so this keeps them reachable.
// Battle art does not use this path: its raw TILESET entries are listed in
// pak.json below and loaded on demand.
const npcSrcAssetPaths = [...new Set(Object.values(characters.npcSrc).flatMap(collectNpcSrcAssetPaths))].sort();
writeFileSync(
  join(ROOT, "ui/npc-src-assets.ts"),
  "// AUTO-GENERATED by gen-assets.ts — do not edit.\n" +
  "// Keeping these literal paths reachable makes PocketJS bake every NPC sprite texture into the app pak.\n" +
  `export const NPC_SRC_ASSET_PATHS = ${JSON.stringify(npcSrcAssetPaths, null, 2)} as const;\n`,
);

// GameView cannot scan unloaded MapDefs, so sharded projects bake the one
// rendering scalar it needs into the asset manifest. The kit's collectMapSlots
// (KV1) reserves one actor slot per map event — runtime appearance ops can
// give any event a walking sprite — so size the pool from event counts, not
// sprite-bearing events. Upstream's isolated `test_*` maps are renderer
// stress fixtures, not world destinations: in particular test_npcs has 501
// events while the largest playable map has 207 (spyder_dryadsgrove,
// including D1's materialized time_is events). Reserving that fixture's
// pool on every playable map makes each battle transition tear down/recreate
// hundreds of images. Keep the complete fixture imported, report its pressure
// separately, and size the shipped world pool from maps that can actually be
// reached in play. A kit-side growable pool can eventually make direct
// rendering of stress fixtures cheap as well.
const actorSlots = (map: (typeof project.maps)[number]) => (map.events ?? []).length;
const actorSlotCounts = project.maps.map((map) => ({ id: map.id, slots: actorSlots(map) }));
const excludedActorStressMaps = actorSlotCounts.filter(({ id }) => id.startsWith("test_"));
const maxActors = Math.max(0, ...actorSlotCounts.map(({ slots }) => slots));
const runtimeMaxActors = Math.max(
  0,
  ...actorSlotCounts.filter(({ id }) => !id.startsWith("test_")).map(({ slots }) => slots),
);

// Animated tile atlases are globally shared by equal RGBA sequences.
const animDir = join(ROOT, "assets/anim");
rmSync(animDir, { recursive: true, force: true });
mkdirSync(animDir, { recursive: true });
const cooked = cookAnimationAtlases(terrain.animationSequences, {
  directory: "assets/anim",
  prefix: "terrain",
});
for (const atlas of cooked.atlases) {
  const path = join(ROOT, atlas.file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, atlas.png);
}
const animatedMaps = Object.entries(terrain.animations).map(([id, cells]) => ({
  id,
  tiles: cells.map((cell) => {
    const sprite = cooked.atlasFor.get(cell.sequence);
    if (!sprite) throw new Error(`gen-assets: no atlas for ${cell.sequence}`);
    return { x: cell.x, y: cell.y, above: cell.above, sprite };
  }),
}));

// GP1: GameAssets.animated used to bundle every map's placements as one
// eager literal (the largest single input in the desktop bundle). Split it
// the same way battle species/techniques are split — one canonical entry
// per map id — so ui/animated-repository.ts can resolve+cache only the
// maps a session actually visits.
const animatedSplit = splitAnimatedTiles(animatedMaps);
const animatedDir = join(DIST, "animated");
rmSync(animatedDir, { recursive: true, force: true });
mkdirSync(animatedDir, { recursive: true });
for (const entry of animatedSplit.entries) {
  const path = join(DIST, entry.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, entry.bytes);
}
const animatedPakEntries: PakManifestEntry[] = animatedSplit.entries.map((entry) => ({
  key: entry.meta.entry,
  file: `dist/${entry.path}`,
}));
// Same reachability requirement as npcSrcAssetPaths below: PocketJS bakes a
// sprites.json-registered atlas only when its literal name string is
// scanned from source. These names used to live inside ANIMATED's inline
// literal; keep them reachable now that they live in dist/animated shards.
const animatedAtlasNames = [...new Set(cooked.atlases.map((atlas) => atlas.name))].sort();
writeFileSync(
  join(ROOT, "ui/animated-assets.ts"),
  "// AUTO-GENERATED by gen-assets.ts — do not edit.\n" +
  "// Keeping these literal names reachable makes PocketJS bake every animated-tile atlas into the app pak.\n" +
  `export const ANIMATED_ATLAS_NAMES = ${JSON.stringify(animatedAtlasNames, null, 2)} as const;\n`,
);

// Keep the inline document as an out-of-bundle parity oracle, while the game
// imports only the compact shell. Prefer the reversible rpgkit-map/1
// transport whenever it is smaller (all current maps qualify), while keeping
// a safe JSON fallback for future maps. Entries are addressed by the exact
// path in shell.mapIndex.
const split = splitProjectMaps(project, {
  shellEntry: "project-shell.json",
  entryEncoding: "auto",
});
const canonicalMapBytes = splitProjectMaps(project, {
  shellEntry: "project-shell.json",
  entryEncoding: "json",
}).entries.reduce((sum, entry) => sum + entry.bytes.byteLength, 0);
const mapsDir = join(DIST, "maps");
rmSync(mapsDir, { recursive: true, force: true });
mkdirSync(mapsDir, { recursive: true });
for (const entry of split.entries) {
  const path = join(DIST, entry.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, entry.bytes);
}

const mapPakEntries: PakManifestEntry[] = split.entries.map((entry) => ({
  key: entry.meta.entry,
  file: `dist/${entry.path}`,
}));
// GM1: the committed transcoded audio (eight mainline QOA music tracks and
// three SFX WAVs) ships as raw pak entries under the keys the audio manifest
// declares; Project.audio maps logical ids to those keys. Hosts without an
// audio module stay silent; QOA playback lands with the kit's streaming
// decoder.
const audioManifest = JSON.parse(
  readFileSync(join(import.meta.dir, "assets/audio/manifest.json"), "utf8"),
) as { files: Record<string, { pakKey: string; bytes: number }> };
const audioPakEntries: PakManifestEntry[] = Object.entries(audioManifest.files)
  .map(([path, entry]) => ({ key: entry.pakKey, file: `assets/audio/${path}` }))
  .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const audioBytes = Object.values(audioManifest.files).reduce((sum, f) => sum + f.bytes, 0);
const pakEntries = [
  ...pakManifest(terrain.entries),
  ...mapPakEntries,
  ...battle.rawPakEntries,
  ...battle.battleRepository.pakEntries,
  ...animatedPakEntries,
  ...npcSrcPakEntries,
  ...terrain.streamPakEntries,
  ...audioPakEntries,
  { key: "world-index.json", file: "dist/world-index.json" },
].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

writeFileSync(join(ROOT, "sprites.json"), jsonBytes(cooked.spritesJson));
const allImages = {
  ...characters.imagesJson,
  ...mapAnimationImages,
  ...screenLayerImages,
  ...battle.imagesJson,
};
writeFileSync(join(ROOT, "images.json"), jsonBytes(allImages));
const allPakEntries = appendBattleDbPakEntry(pakEntries)
  .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
writeFileSync(join(ROOT, "pak.json"), JSON.stringify(allPakEntries, null, 2) + "\n");
writeFileSync(join(DIST, "project.json"), jsonBytes(project));
writeFileSync(join(DIST, "project-shell.json"), split.shellText);
// The runtime trusts the shell's declared mapManifestHash (it no longer
// rehashes at startup), so the packager must prove the bytes on disk are
// fresh: read the shell back and verify the declaration against a recompute.
assertShellManifestFresh(JSON.parse(readFileSync(join(DIST, "project-shell.json"), "utf8")));
writeFileSync(join(DIST, "variable-enums.json"), jsonBytes(imported.variables));
writeFileSync(join(DIST, "world-index.json"), jsonBytes(imported.worldIndex));
writeFileSync(join(DIST, "import-report.json"), jsonBytes(imported.report));
writeFileSync(join(DIST, "weather.json"), jsonBytes({
  format: "pocket-tuxemon/weather/v1",
  source: imported.report.weather.source,
  entries: imported.report.weather.entries,
}));
// One spawn per map for the demo menu's map jump list: a transfer landing
// when one exists, else the first standable cell outside every event area.
writeFileSync(join(ROOT, "data/warp.json"), jsonBytes(buildWarpIndex(project)));
writeFileSync(join(ROOT, "reports/G1-coverage.md"), coverageMarkdown(imported.report));

function gameAssetsSource(
  player: PlayerFrames,
  maxActors: number,
  animatedIndex: readonly AnimatedIndexEntry[],
  npcSrcIndex: readonly NpcSrcIndexEntry[],
  anims: NonNullable<GameAssets["anims"]>,
  layers: Readonly<Record<string, GameScreenLayerAssets>>,
): string {
  return (
    "// AUTO-GENERATED by gen-assets.ts — do not edit.\n" +
    'import type { GameAssets } from "../vendor/pocket-rpgkit/src/ui/game-assets.ts";\n' +
    'import type { PlayerFrames } from "../vendor/pocket-rpgkit/src/ui/PlayerSprite.tsx";\n' +
    'import { TERRAIN_ORDER, TERRAIN_WORLD } from "./terrain-assets.ts";\n\n' +
    `export const PLAYER: PlayerFrames = ${JSON.stringify(player, null, 2)};\n\n` +
    // GP1: the full animated-tile table (48 maps, 5,785 placements) and the
    // full per-NPC sprite-frame table (175 NPCs) are no longer inline
    // literals — together they were the two largest inputs in the desktop
    // bundle this task found. Their INDEX tables (id -> pak/data.fs entry)
    // stay inline because they are tiny; main.tsx builds the lazy Proxies
    // from them via ui/animated-repository.ts and ui/npc-src-repository.ts.
    `export const ANIMATED_INDEX: readonly { id: string; entry: string }[] = ${JSON.stringify(animatedIndex, null, 2)} as const;\n\n` +
    `export const NPC_SRC_INDEX: readonly { id: string; entry: string }[] = ${JSON.stringify(npcSrcIndex, null, 2)} as const;\n\n` +
    "export const GAME_ASSETS: Omit<GameAssets, \"npcSrc\" | \"animated\" | \"stream\"> = {\n" +
    "  ground: {},\n" +
    "  upper: {},\n" +
    "  chunkColumns: {},\n" +
    "  maxChunks: 1,\n" +
    `  maxActors: ${maxActors},\n` +
    "  world: TERRAIN_WORLD,\n" +
    "  order: TERRAIN_ORDER,\n" +
    "  player: PLAYER,\n" +
    "  playerHeight: 32,\n" +
    `  anims: ${JSON.stringify(anims, null, 2)},\n` +
    `  layers: ${JSON.stringify(layers, null, 2)},\n` +
    "};\n"
  );
}

writeFileSync(
  join(ROOT, "ui/game-assets.ts"),
  gameAssetsSource(
    characters.player,
    runtimeMaxActors,
    animatedSplit.index,
    npcSrcSplit.index,
    mapAnimationAssets,
    screenLayers,
  ),
);

const collisionBodies = project.maps.reduce(
  (sum, map) => sum + (map.events ?? []).filter((event) => event.name?.startsWith("collision:")).length,
  0,
);
const assetReport = {
  format: "pocket-tuxemon/g6-assets/v1",
  sourceRevision: terrain.report.sourceRevision,
  project: {
    maps: project.maps.length,
    collisionBodies,
    maxActors,
    runtimeMaxActors,
    excludedActorStressMaps,
    options: G6_IMPORT_OPTIONS,
  },
  mapRepository: {
    encodings: Object.fromEntries(
      ["compact", "json"].map((encoding) => [
        encoding,
        split.entries.filter((entry) => entry.encoding === encoding).length,
      ]),
    ),
    shellBytes: split.files[0]!.bytes.byteLength,
    entryBytes: split.entries.reduce((sum, entry) => sum + entry.bytes.byteLength, 0),
    canonicalJsonBytes: canonicalMapBytes,
    entries: split.entries.length,
    manifestHash: split.shell.mapManifestHash,
    schemaHash: split.shell.mapSchemaHash,
  },
  terrain: {
    entries: terrain.report.entries,
    pakBytes: terrain.report.pakBytes,
    gzipBytes: terrain.report.gzipBytes,
    animatedPlacements: terrain.report.animatedCellsBakedAtFirstFrame,
  },
  animation: {
    sourceSequences: terrain.animationSequences.length,
    atlases: cooked.atlases.length,
    atlasBytes: cooked.atlases.reduce((sum, atlas) => sum + atlas.png.byteLength, 0),
  },
  mapAnimations: {
    definitions: Object.keys(mapAnimationAssets).length,
    frames: Object.values(mapAnimationAssets).reduce((sum, animation) => sum + animation.frames.length, 0),
    imageBytes: mapAnimationBytes,
  },
  screenLayers: {
    layers: Object.keys(screenLayers).length,
    variants: Object.keys(backdropVariants).length + Object.keys(overlayVariants).length,
    imageVariants: Object.keys(screenLayerImages).length,
    imageBytes: screenLayerBytes,
  },
  animatedRepository: {
    entries: animatedSplit.entries.length,
    entryBytes: animatedSplit.entries.reduce((sum, entry) => sum + entry.bytes.byteLength, 0),
  },
  npcSrcRepository: {
    entries: npcSrcSplit.entries.length,
    entryBytes: npcSrcSplit.entries.reduce((sum, entry) => sum + entry.bytes.byteLength, 0),
  },
  audio: {
    entries: audioPakEntries.length,
    entryBytes: audioBytes,
  },
  characters: characters.report,
  battle: battle.report,
};
writeFileSync(join(ROOT, "data/g6-assets-report.json"), jsonBytes(assetReport));

console.log(
  `G6 assets: ${project.maps.length} maps, ${terrain.report.entries} TILESET entries, ` +
  `${characters.report.walkers} NPC walkers + player, ${cooked.atlases.length} animated atlases, ` +
  `${collisionBodies} removable collision bodies`,
);
console.log(
  `map repository: ${split.entries.length} entries, ${split.files[0]!.bytes.byteLength} shell bytes, ` +
  `${split.entries.reduce((sum, entry) => sum + entry.bytes.byteLength, 0)} map bytes`,
);
console.log(`terrain pak: ${terrain.report.pakBytes} bytes (${terrain.report.gzipBytes} gzip)`);
console.log(
  `battle ${battle.report.scope}: ${battle.report.counts.monsters} monsters, ` +
  `${battle.report.counts.techniques} techniques, ${battle.report.art.files} textures, ` +
  `${battle.report.art.pakBytes} battle-only pak bytes`,
);
console.log(
  `battle repository: ${battle.report.battleRepository.entries} entries, ` +
  `${battle.report.battleRepository.shellBytes} shell bytes, ` +
  `${battle.report.battleRepository.entryBytes} shard bytes`,
);
console.log(
  `animated repository: ${animatedSplit.entries.length} entries, ` +
  `${animatedSplit.entries.reduce((sum, entry) => sum + entry.bytes.byteLength, 0)} shard bytes`,
);
console.log(
  `npc-src repository: ${npcSrcSplit.entries.length} entries, ` +
  `${npcSrcSplit.entries.reduce((sum, entry) => sum + entry.bytes.byteLength, 0)} shard bytes`,
);
