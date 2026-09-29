// G5 verification harness: render the generated stream through the real R1
// StreamedChunkLayer.  It is intentionally tiny and is not the eventual G1
// game entry point.

import { mount } from "@pocketjs/framework";
import { View } from "@pocketjs/framework/components";
import { jump } from "@pocketjs/framework/animation";
import { getOps, hostViewport } from "@pocketjs/framework/host";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { createElement, insertNode, setProp } from "@pocketjs/framework/renderer";
import { StreamedChunkLayer, type StreamedChunkLayerStats } from "./vendor/pocket-rpgkit/src/ui/StreamedChunkLayer.tsx";
import { TERRAIN_STREAM, TERRAIN_WORLD, TERRAIN_ORDER } from "./ui/terrain-assets.ts";

interface PreviewCommand {
  map?: string;
  /** World-pixel top-left of the 16px player marker. */
  at?: readonly [number, number];
  marker?: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __terrainPreview: PreviewCommand | undefined;
  // eslint-disable-next-line no-var
  var __terrainPreviewState: Record<string, unknown> | undefined;
  // eslint-disable-next-line no-var
  var __terrainPreviewMaps: readonly string[] | undefined;
}

function Preview() {
  const viewport = hostViewport(getOps()) ?? { w: 480, h: 272 };
  let mapId = "";
  let px = 0;
  let py = 0;
  let camX = 0;
  let camY = 0;

  const resolveCommand = (): void => {
    const command = globalThis.__terrainPreview ?? {};
    const nextMap = command.map ?? TERRAIN_ORDER[0]!;
    const bounds = TERRAIN_WORLD[nextMap as keyof typeof TERRAIN_WORLD];
    if (!bounds) throw new Error(`terrain preview: unknown map ${JSON.stringify(nextMap)}`);
    mapId = nextMap;
    px = command.at?.[0] ?? Math.max(0, Math.floor((bounds.w - 16) / 2));
    py = command.at?.[1] ?? Math.max(0, Math.floor((bounds.h - 16) / 2));
    camX = bounds.w <= viewport.w
      ? -Math.floor((viewport.w - bounds.w) / 2)
      : Math.max(0, Math.min(bounds.w - viewport.w, Math.floor(px + 8 - viewport.w / 2)));
    camY = bounds.h <= viewport.h
      ? -Math.floor((viewport.h - bounds.h) / 2)
      : Math.max(0, Math.min(bounds.h - viewport.h, Math.floor(py + 8 - viewport.h / 2)));
  };
  resolveCommand();

  const frameRoot = createElement("view");
  setProp(frameRoot, "style", {
    posType: 1,
    insetL: 0,
    insetT: 0,
    width: viewport.w,
    height: viewport.h,
    bgColor: "#000000",
  });
  const world = createElement("view");
  setProp(world, "style", { posType: 1, insetL: 0, insetT: 0, width: 0, height: 0 });
  jump(world, "translateX", -camX);
  jump(world, "translateY", -camY);
  insertNode(frameRoot, world);

  let marker: ReturnType<typeof createElement> | undefined;
  let frame = 0;
  let groundStats: StreamedChunkLayerStats | undefined;
  let upperStats: StreamedChunkLayerStats | undefined;

  // Registered before the two stream callbacks so a host-issued command is
  // visible to both layers in the same measured frame. This is also the
  // QuickJS benchmark's map-switch control path.
  onFrame(() => {
    const before = `${mapId}|${px}|${py}`;
    resolveCommand();
    if (`${mapId}|${px}|${py}` !== before) {
      jump(world, "translateX", -camX);
      jump(world, "translateY", -camY);
      if (marker) {
        jump(marker, "translateX", px);
        jump(marker, "translateY", py);
      }
    }
  });

  insertNode(world, StreamedChunkLayer({
    get mapId() { return mapId; },
    columns: TERRAIN_STREAM.columns,
    chunkPx: TERRAIN_STREAM.chunkPx,
    camera: () => ({ x: camX, y: camY }),
    viewport: () => viewport,
    margin: TERRAIN_STREAM.margin,
    loadBudget: TERRAIN_STREAM.loadBudget,
    refs: TERRAIN_STREAM.ground,
    debugName: "terrain-preview-ground",
    onStats: (stats) => { groundStats = stats; },
  }) as never);

  if (globalThis.__terrainPreview?.marker !== false) {
    marker = createElement("view");
    setProp(marker, "style", {
      posType: 1,
      insetL: 0,
      insetT: 0,
      width: 16,
      height: 16,
      bgColor: "#ff40c0",
    });
    jump(marker, "translateX", px);
    jump(marker, "translateY", py);
    insertNode(world, marker);
  }

  insertNode(world, StreamedChunkLayer({
    get mapId() { return mapId; },
    columns: TERRAIN_STREAM.columns,
    chunkPx: TERRAIN_STREAM.chunkPx,
    camera: () => ({ x: camX, y: camY }),
    viewport: () => viewport,
    margin: TERRAIN_STREAM.margin,
    loadBudget: TERRAIN_STREAM.loadBudget,
    refs: TERRAIN_STREAM.upper,
    debugName: "terrain-preview-upper",
    onStats: (stats) => { upperStats = stats; },
  }) as never);

  onFrame(() => {
    frame++;
    globalThis.__terrainPreviewState = {
      frame,
      map: mapId,
      px,
      py,
      camX,
      camY,
      viewport,
      ground: groundStats,
      upper: upperStats,
    };
  });

  return (
    <View class="w-full h-full overflow-hidden bg-black">
      {frameRoot as never}
    </View>
  );
}

globalThis.__terrainPreviewMaps = TERRAIN_ORDER;
mount(() => <Preview />);
