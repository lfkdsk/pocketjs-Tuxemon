// Runtime WorldLayout projection from the diagnostic-rich import-time index.
// The projection is fully generated: no map-specific overrides are accepted.

import {
  validateWorldLayout,
  type WorldComponent,
  type WorldLayout,
  type WorldOpening,
  type WorldPlacement,
  type WorldSeam,
} from "../vendor/pocket-rpgkit/src/engine/index.ts";
import {
  validateOutdoorWorldIndex,
  type OutdoorWorld,
  type OutdoorWorldIndex,
  type OutdoorWorldSeam,
} from "./world-schema.ts";

const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function connectedMapIds(world: OutdoorWorld, included: ReadonlySet<string>): string[][] {
  const remaining = new Set(world.maps.map((map) => map.mapId).filter((mapId) => included.has(mapId)));
  const components: string[][] = [];
  for (const seed of [...remaining].sort(compareText)) {
    if (!remaining.has(seed)) continue;
    const pending = [seed];
    const component: string[] = [];
    remaining.delete(seed);
    while (pending.length) {
      const mapId = pending.pop()!;
      component.push(mapId);
      for (const neighbor of world.adjacency[mapId] ?? []) {
        if (!included.has(neighbor) || !remaining.delete(neighbor)) continue;
        pending.push(neighbor);
      }
    }
    component.sort(compareText);
    components.push(component);
  }
  return components.sort((a, b) => compareText(a[0]!, b[0]!));
}

function projectSeam(seam: OutdoorWorldSeam): WorldSeam {
  return {
    mapA: seam.a,
    sideA: seam.sideA,
    spanA: { ...seam.spanA },
    mapB: seam.b,
    sideB: seam.sideB,
    spanB: { ...seam.spanB },
    axis: seam.coordinateMapping.axis,
    offsetAtoB: seam.coordinateMapping.offsetAtoB,
    openingIds: seam.handoff.openings.map((opening) => opening.portalId).sort(compareText),
  };
}

function projectOpenings(seams: readonly OutdoorWorldSeam[]): WorldOpening[] {
  return seams.flatMap((seam) => seam.handoff.openings.map((opening): WorldOpening => {
    const sourceIsA = opening.sourceMap === seam.a;
    return {
      portalId: opening.portalId,
      source: {
        mapId: opening.sourceMap,
        side: opening.sourceSide,
        span: { ...opening.sourceSpan },
      },
      target: {
        mapId: opening.targetMap,
        side: opening.targetSide,
        span: { ...opening.expectedTargetSpan },
      },
      axis: seam.coordinateMapping.axis,
      offset: sourceIsA ? seam.coordinateMapping.offsetAtoB : -seam.coordinateMapping.offsetAtoB,
      compatibility: opening.compatibility,
    };
  })).sort((a, b) => compareText(a.portalId, b.portalId));
}

function projectComponent(world: OutdoorWorld, mapIds: readonly string[]): WorldComponent {
  const included = new Set(mapIds);
  const placements: WorldPlacement[] = world.maps
    .filter((map) => included.has(map.mapId))
    .map((map) => ({
      mapId: map.mapId,
      originTileX: map.originTileX,
      originTileY: map.originTileY,
      width: map.width,
      height: map.height,
    }))
    .sort((a, b) => compareText(a.mapId, b.mapId));
  const sourceSeams = world.seams.filter((seam) => included.has(seam.a) && included.has(seam.b));
  const seams = sourceSeams.map(projectSeam).sort((a, b) => compareText(
    `${a.mapA}\0${a.sideA}\0${a.mapB}\0${a.sideB}`,
    `${b.mapA}\0${b.sideA}\0${b.mapB}\0${b.sideB}`,
  ));
  return {
    worldId: world.worldId,
    componentId: mapIds[0]!,
    bounds: {
      minTileX: Math.min(...placements.map((placement) => placement.originTileX)),
      minTileY: Math.min(...placements.map((placement) => placement.originTileY)),
      maxTileX: Math.max(...placements.map((placement) => placement.originTileX + placement.width)),
      maxTileY: Math.max(...placements.map((placement) => placement.originTileY + placement.height)),
    },
    placements,
    seams,
    openings: projectOpenings(sourceSeams),
  };
}

/** Project the validated source topology into the compact, runtime-neutral
 * project contract. Only maps present in `includedMapIds` are retained, so
 * sample imports never point at absent MapDefs. Returns undefined when the
 * selected project has no outdoor map. */
export function projectOutdoorWorldLayout(
  index: OutdoorWorldIndex,
  includedMapIds: ReadonlySet<string> = new Set(index.worlds.flatMap((world) => world.maps.map((map) => map.mapId))),
): WorldLayout | undefined {
  validateOutdoorWorldIndex(index);
  const components = index.worlds.flatMap((world) => {
    const overlap = world.diagnostics.rejectedContacts.find((contact) =>
      contact.geometry === "overlap" && includedMapIds.has(contact.a) && includedMapIds.has(contact.b)
    );
    if (overlap) {
      throw new Error(`world layout projection: ${world.worldId} maps ${overlap.a} and ${overlap.b} overlap`);
    }
    return connectedMapIds(world, includedMapIds).map((mapIds) => projectComponent(world, mapIds));
  }).sort((a, b) => compareText(
    `${a.worldId}\0${a.componentId}`,
    `${b.worldId}\0${b.componentId}`,
  ));
  if (components.length === 0) return undefined;
  return validateWorldLayout({ topologyHash: index.contentHash, components });
}
