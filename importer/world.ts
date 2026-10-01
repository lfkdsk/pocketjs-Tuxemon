// Tiled `.world` -> deterministic outdoor topology index.
//
// `.world` owns placement only. TMX owns map dimensions and `inside`; seams
// are accepted only when exact corrected geometry is corroborated on that
// edge by a teleport or cardinal property. Original portals remain separate.

import { readFileSync, readdirSync } from "node:fs";
import { basename, join, normalize } from "node:path";
import { MAPS_DIR, TUXEMON_SRC, type TuxEvent, type TuxMap } from "./source.ts";
import {
  OUTDOOR_WORLD_INDEX_FORMAT,
  outdoorWorldMapRelation,
  resolveWorldDirections,
  validateOutdoorWorldIndex,
  withOutdoorWorldContentHash,
  type ExcludedWorldMap,
  type OutdoorWorld,
  type OutdoorWorldIndex,
  type OutdoorWorldMap,
  type OutdoorWorldSeam,
  type RejectedWorldContact,
  type TileSpan,
  type WorldDirectionEvidence,
  type WorldDimensionCorrection,
  type WorldPortal,
  type WorldPortalHandoffIssue,
  type WorldSeamOpening,
  type WorldSeamEvidence,
  type WorldSide,
} from "./world-schema.ts";

const TILE_SIZE = 16 as const;
const SIDES = ["north", "east", "south", "west"] as const satisfies readonly WorldSide[];
const S5_EXPECTED_SEAMS: Readonly<Record<string, number>> = {
  classic: 15,
  eclipse: 9,
  normal: 15,
  spyder: 32,
};

interface RawWorldMap {
  fileName: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RawWorld {
  type: string;
  maps: RawWorldMap[];
}

interface SourceMember {
  source: TuxMap;
  map: OutdoorWorldMap;
  declaredPixels: { width: number; height: number };
  inside: boolean;
}

export interface WorldStats {
  worldId: string;
  sourceMembers: number;
  outdoorMaps: number;
  excludedIndoorMaps: number;
  bboxTiles: { x: number; y: number; width: number; height: number };
  geometricContacts: number;
  acceptedSeams: number;
  rejectedGeometricContacts: number;
  rejectedOverlaps: number;
  rejectedGaps: number;
  dimensionCorrections: number;
  outdoorDimensionCorrections: number;
  portals: number;
  coordinatePreservingSeams: number;
  mixedHandoffSeams: number;
  portalOnlySeams: number;
  directionOnlySeams: number;
  coordinatePreservingOpenings: number;
  portalOnlyOpenings: number;
  ambiguousDirections: number;
  componentSizes: number[];
  s5ExpectedSeams: number | null;
}

export interface WorldImportReport {
  format: "pocket-tuxemon/world-import-report/v1";
  artifact: "dist/world-index.json";
  contentHash: string;
  totals: {
    worlds: number;
    sourceMembers: number;
    outdoorMaps: number;
    excludedIndoorMaps: number;
    geometricContacts: number;
    acceptedSeams: number;
    rejectedGeometricContacts: number;
    rejectedOverlaps: number;
    rejectedGaps: number;
    dimensionCorrections: number;
    outdoorDimensionCorrections: number;
    portals: number;
    coordinatePreservingSeams: number;
    mixedHandoffSeams: number;
    portalOnlySeams: number;
    directionOnlySeams: number;
    coordinatePreservingOpenings: number;
    portalOnlyOpenings: number;
    ambiguousDirections: number;
  };
  worlds: WorldStats[];
  s5Comparison: {
    expectedSeams: 71;
    actualSeams: number;
    matches: boolean;
    differences: string[];
  };
}

export interface WorldImportBuild {
  index: OutdoorWorldIndex;
  report: WorldImportReport;
}

export interface WorldImportOptions {
  mapsDir?: string;
  sourceRoot?: string;
  sourceRevision?: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`world importer: ${message}`);
}

function numberField(value: unknown, label: string): number {
  assert(typeof value === "number" && Number.isFinite(value), `${label} must be finite`);
  return value;
}

function parseWorld(path: string): RawWorld {
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${path} must contain an object`);
  const raw = value as Record<string, unknown>;
  assert(raw.type === "world", `${path} has unsupported type ${JSON.stringify(raw.type)}`);
  assert(Array.isArray(raw.maps), `${path}.maps must be an array`);
  const seen = new Set<string>();
  const maps = raw.maps.map((entry, index): RawWorldMap => {
    assert(entry !== null && typeof entry === "object" && !Array.isArray(entry), `${path}.maps[${index}] must be an object`);
    const row = entry as Record<string, unknown>;
    assert(typeof row.fileName === "string" && row.fileName.endsWith(".tmx"), `${path}.maps[${index}].fileName must name a TMX`);
    assert(basename(row.fileName) === row.fileName, `${path}.maps[${index}].fileName must be local`);
    assert(!seen.has(row.fileName), `${path} contains duplicate ${row.fileName}`);
    seen.add(row.fileName);
    return {
      fileName: row.fileName,
      x: numberField(row.x, `${path}.maps[${index}].x`),
      y: numberField(row.y, `${path}.maps[${index}].y`),
      width: numberField(row.width, `${path}.maps[${index}].width`),
      height: numberField(row.height, `${path}.maps[${index}].height`),
    };
  });
  return { type: "world", maps };
}

function sourceRevision(sourceRoot: string, explicit?: string): string {
  if (explicit) return explicit;
  const proc = Bun.spawnSync({
    cmd: ["git", "rev-parse", "HEAD"],
    cwd: sourceRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error(`world importer: cannot read source revision: ${proc.stderr.toString().trim()}`);
  }
  return proc.stdout.toString().trim();
}

function targetMapId(raw: string): string {
  return basename(raw).replace(/\.tmx$/, "");
}

function overlap(startA: number, endA: number, startB: number, endB: number): TileSpan | null {
  const start = Math.max(startA, startB);
  const end = Math.min(endA, endB);
  return end > start ? { start, end } : null;
}

function touchingSides(event: TuxEvent, map: OutdoorWorldMap): WorldSide[] {
  if (event.w <= 0 || event.h <= 0) return [];
  const horizontal = overlap(event.x, event.x + event.w, 0, map.width) !== null;
  const vertical = overlap(event.y, event.y + event.h, 0, map.height) !== null;
  const sides: WorldSide[] = [];
  if (horizontal && event.y <= 0 && event.y + event.h > 0) sides.push("north");
  if (vertical && event.x < map.width && event.x + event.w >= map.width) sides.push("east");
  if (horizontal && event.y < map.height && event.y + event.h >= map.height) sides.push("south");
  if (vertical && event.x <= 0 && event.x + event.w > 0) sides.push("west");
  return sides;
}

function portalsFor(member: SourceMember): WorldPortal[] {
  const portals: WorldPortal[] = [];
  for (const [eventIndex, event] of member.source.events.entries()) {
    // Tiled world topology describes TMX documents. Same-name/scenario YAML
    // events are runtime overlays and can contain legacy copies placed at
    // unrelated coordinates (notably Eclipse); preserve those in the normal
    // project import, but never let them assert physical `.world` adjacency.
    if (event.origin !== "tmx") continue;
    for (const [actionIndex, action] of event.acts.entries()) {
      if (action.type !== "transition_teleport") continue;
      const targetMap = action.args[1] ? targetMapId(action.args[1]) : "";
      const targetX = Number(action.args[2]);
      const targetY = Number(action.args[3]);
      assert(targetMap.length > 0, `${member.map.mapId}/${event.name} has a teleport without target map`);
      assert(Number.isInteger(targetX) && Number.isInteger(targetY), `${member.map.mapId}/${event.name} has non-integer teleport coordinates`);
      portals.push({
        id: `${member.map.mapId}:${event.origin}:${event.source}:${event.objectId ?? `e${eventIndex}`}:a${actionIndex}`,
        sourceMap: member.map.mapId,
        targetMap,
        event: event.name,
        objectId: event.objectId,
        source: { x: event.x, y: event.y, width: event.w, height: event.h },
        target: { x: targetX, y: targetY },
        touchingSides: touchingSides(event, member.map),
        raw: action.raw,
      });
    }
  }
  return portals.sort((a, b) => a.id.localeCompare(b.id));
}

function directionTokens(map: TuxMap, side: WorldSide): string[] {
  return [...new Set((map.props[side] ?? "").split(",").map((value) => value.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function portalOverlapsContact(
  portal: WorldPortal,
  map: OutdoorWorldMap,
  side: WorldSide,
  globalSpan: TileSpan,
): boolean {
  if (!portal.touchingSides.includes(side)) return false;
  const localStart = side === "east" || side === "west" ? portal.source.y : portal.source.x;
  const localLength = side === "east" || side === "west" ? portal.source.height : portal.source.width;
  const origin = side === "east" || side === "west" ? map.originTileY : map.originTileX;
  return overlap(origin + localStart, origin + localStart + localLength, globalSpan.start, globalSpan.end) !== null;
}

function portalEvidence(
  portals: readonly WorldPortal[],
  source: SourceMember,
  side: WorldSide,
  target: SourceMember,
  globalSpan: TileSpan,
): WorldSeamEvidence[] {
  return portals
    .filter((portal) =>
      portal.sourceMap === source.map.mapId &&
      portal.targetMap === target.map.mapId &&
      portalOverlapsContact(portal, source.map, side, globalSpan)
    )
    .map((portal) => ({
      kind: "transition_teleport" as const,
      sourceMap: source.map.mapId,
      side,
      portalId: portal.id,
    }));
}

function relationDirectionEvidence(
  evidence: readonly WorldDirectionEvidence[],
  a: string,
  b: string,
): WorldDirectionEvidence[] {
  return evidence.filter((entry) =>
    (entry.sourceMap === a && entry.targetMap === b) ||
    (entry.sourceMap === b && entry.targetMap === a)
  );
}

function relationPortals(portals: readonly WorldPortal[], a: string, b: string): WorldPortal[] {
  return portals.filter((portal) =>
    (portal.sourceMap === a && portal.targetMap === b) ||
    (portal.sourceMap === b && portal.targetMap === a)
  );
}

function seamOpening(
  seam: Omit<OutdoorWorldSeam, "handoff">,
  portal: WorldPortal,
  maps: ReadonlyMap<string, OutdoorWorldMap>,
): WorldSeamOpening {
  const sourceIsA = portal.sourceMap === seam.a && portal.targetMap === seam.b;
  const sourceIsB = portal.sourceMap === seam.b && portal.targetMap === seam.a;
  assert(sourceIsA || sourceIsB, `${portal.id} does not connect seam ${seam.a}/${seam.b}`);
  const sourceSide = sourceIsA ? seam.sideA : seam.sideB;
  const targetSide = sourceIsA ? seam.sideB : seam.sideA;
  const seamSpan = sourceIsA ? seam.spanA : seam.spanB;
  const portalStart = seam.coordinateMapping.axis === "x" ? portal.source.x : portal.source.y;
  const portalLength = seam.coordinateMapping.axis === "x" ? portal.source.width : portal.source.height;
  const sourceSpan = overlap(seamSpan.start, seamSpan.end, portalStart, portalStart + portalLength);
  assert(portal.touchingSides.includes(sourceSide) && sourceSpan, `${portal.id} does not overlap seam edge ${sourceSide}`);

  const offset = sourceIsA ? seam.coordinateMapping.offsetAtoB : -seam.coordinateMapping.offsetAtoB;
  const expectedTargetSpan = { start: sourceSpan.start + offset, end: sourceSpan.end + offset };
  const actualTarget = seam.coordinateMapping.axis === "x"
    ? { tangent: portal.target.x, normal: portal.target.y }
    : { tangent: portal.target.y, normal: portal.target.x };
  const target = maps.get(portal.targetMap);
  assert(target, `${portal.id} targets a map outside its seam`);
  const expectedNormal = targetSide === "north" || targetSide === "west"
    ? 0
    : targetSide === "south" ? target.height - 1 : target.width - 1;
  const issues: WorldPortalHandoffIssue[] = [];
  if (sourceSpan.end - sourceSpan.start > 1) issues.push("fixed-destination");
  if (actualTarget.tangent < expectedTargetSpan.start || actualTarget.tangent >= expectedTargetSpan.end) {
    issues.push("offset-mismatch");
  }
  if (actualTarget.normal !== expectedNormal) issues.push("wrong-target-edge");
  return {
    portalId: portal.id,
    sourceMap: portal.sourceMap,
    sourceSide,
    sourceSpan,
    targetMap: portal.targetMap,
    targetSide,
    expectedTargetSpan,
    actualTarget,
    compatibility: issues.length === 0 ? "coordinate-preserving" : "portal-only",
    issues,
  };
}

function seamHandoff(
  seam: Omit<OutdoorWorldSeam, "handoff">,
  portals: ReadonlyMap<string, WorldPortal>,
  maps: ReadonlyMap<string, OutdoorWorldMap>,
): OutdoorWorldSeam["handoff"] {
  const openings = seam.evidence
    .filter((entry): entry is Extract<WorldSeamEvidence, { kind: "transition_teleport" }> => entry.kind === "transition_teleport")
    .map((entry) => seamOpening(seam, portals.get(entry.portalId)!, maps))
    .sort((a, b) => a.portalId.localeCompare(b.portalId));
  const compatible = openings.filter((opening) => opening.compatibility === "coordinate-preserving").length;
  const mode = openings.length === 0
    ? "direction-only" as const
    : compatible === openings.length
      ? "coordinate-preserving" as const
      : compatible === 0 ? "portal-only" as const : "mixed" as const;
  return { mode, openings };
}

function buildAdjacency(maps: readonly OutdoorWorldMap[], seams: readonly OutdoorWorldSeam[]): Record<string, string[]> {
  const adjacency = new Map(maps.map((map) => [map.mapId, new Set<string>()]));
  for (const seam of seams) {
    adjacency.get(seam.a)!.add(seam.b);
    adjacency.get(seam.b)!.add(seam.a);
  }
  return Object.fromEntries([...adjacency.entries()].map(([id, neighbors]) => [id, [...neighbors].sort()]));
}

function componentSizes(world: OutdoorWorld): number[] {
  const unseen = new Set(world.maps.map((map) => map.mapId));
  const sizes: number[] = [];
  while (unseen.size) {
    const first = [...unseen].sort()[0]!;
    unseen.delete(first);
    const queue = [first];
    let size = 0;
    while (queue.length) {
      const current = queue.shift()!;
      size++;
      for (const neighbor of world.adjacency[current] ?? []) {
        if (unseen.delete(neighbor)) queue.push(neighbor);
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

function bbox(maps: readonly OutdoorWorldMap[]): WorldStats["bboxTiles"] {
  const minX = Math.min(...maps.map((map) => map.originTileX));
  const minY = Math.min(...maps.map((map) => map.originTileY));
  const maxX = Math.max(...maps.map((map) => map.originTileX + map.width));
  const maxY = Math.max(...maps.map((map) => map.originTileY + map.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function buildWorld(
  worldId: string,
  sourceFile: string,
  raw: RawWorld,
  sourceMaps: ReadonlyMap<string, TuxMap>,
): OutdoorWorld {
  const members: SourceMember[] = raw.maps.map((entry) => {
    const mapId = entry.fileName.slice(0, -4);
    const source = sourceMaps.get(mapId);
    assert(source, `${sourceFile} references missing ${entry.fileName}`);
    const inside = source.props.inside === "true";
    const map: OutdoorWorldMap = {
      mapId,
      directionSlug: source.props.slug ?? mapId,
      directions: {
        north: directionTokens(source, "north").sort((a, b) => a.localeCompare(b)),
        east: directionTokens(source, "east").sort((a, b) => a.localeCompare(b)),
        south: directionTokens(source, "south").sort((a, b) => a.localeCompare(b)),
        west: directionTokens(source, "west").sort((a, b) => a.localeCompare(b)),
      },
      originTileX: entry.x / TILE_SIZE,
      originTileY: entry.y / TILE_SIZE,
      width: source.width,
      height: source.height,
    };
    if (!inside) {
      assert(Number.isInteger(map.originTileX) && Number.isInteger(map.originTileY), `${sourceFile}/${mapId} has a non-tile-aligned outdoor origin`);
    }
    return { source, map, declaredPixels: { width: entry.width, height: entry.height }, inside };
  }).sort((a, b) => a.map.mapId.localeCompare(b.map.mapId));

  const outdoor = members.filter((member) => !member.inside);
  const maps = outdoor.map((member) => member.map);
  const excludedMaps: ExcludedWorldMap[] = members.filter((member) => member.inside).map((member) => ({
    ...member.map,
    reason: "inside",
  }));
  const corrections: WorldDimensionCorrection[] = members.flatMap((member) => {
    const actualPixels = { width: member.map.width * TILE_SIZE, height: member.map.height * TILE_SIZE };
    if (member.declaredPixels.width === actualPixels.width && member.declaredPixels.height === actualPixels.height) return [];
    return [{
      mapId: member.map.mapId,
      reason: member.declaredPixels.width === 0 && member.declaredPixels.height === 0 ? "zero-size" as const : "stale-size" as const,
      declaredPixels: member.declaredPixels,
      actualPixels,
    }];
  });
  const portals = outdoor.flatMap(portalsFor).sort((a, b) => a.id.localeCompare(b.id));
  const portalsById = new Map(portals.map((portal) => [portal.id, portal]));
  const mapsById = new Map(maps.map((map) => [map.mapId, map]));
  const resolvedDirections = resolveWorldDirections(maps);
  const seams: OutdoorWorldSeam[] = [];
  const rejectedContacts: RejectedWorldContact[] = [];

  for (let i = 0; i < outdoor.length; i++) {
    for (let j = i + 1; j < outdoor.length; j++) {
      const a = outdoor[i]!;
      const b = outdoor[j]!;
      const relation = outdoorWorldMapRelation(a.map, b.map);
      const pairPortals = relationPortals(portals, a.map.mapId, b.map.mapId);
      const pairDirections = relationDirectionEvidence(resolvedDirections.evidence, a.map.mapId, b.map.mapId);
      if (relation.geometry === "edge") {
        const contact = relation;
        const evidence = [
          ...portalEvidence(portals, a, contact.sideA, b, contact.globalSpan),
          ...portalEvidence(portals, b, contact.sideB, a, contact.globalSpan),
          ...pairDirections.filter((entry) =>
            entry.side === (entry.sourceMap === a.map.mapId ? contact.sideA : contact.sideB)
          ),
        ].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
        if (evidence.length) {
          const seam: Omit<OutdoorWorldSeam, "handoff"> = {
            a: a.map.mapId,
            sideA: contact.sideA,
            spanA: contact.spanA,
            b: b.map.mapId,
            sideB: contact.sideB,
            spanB: contact.spanB,
            coordinateMapping: { axis: contact.axis, offsetAtoB: contact.offsetAtoB },
            evidence,
          };
          seams.push({ ...seam, handoff: seamHandoff(seam, portalsById, mapsById) });
        } else {
          const wrongSide = pairDirections.length > 0;
          const code = pairPortals.length ? "portal-away-from-edge" : wrongSide ? "wrong-side-direction" : "unsupported-contact";
          const explanation = pairPortals.length
            ? `${pairPortals.length} portal(s) connect the maps away from their shared ${contact.sideA}/${contact.sideB} edge; retain them as portals.`
            : wrongSide
              ? `A cardinal property names the other map on the wrong side of this ${contact.sideA}/${contact.sideB} contact.`
              : `The rectangles touch on ${contact.sideA}/${contact.sideB}, but neither side has an aligned transition_teleport or cardinal-property link.`;
          rejectedContacts.push({
            a: a.map.mapId,
            b: b.map.mapId,
            geometry: "edge",
            code,
            sideA: contact.sideA,
            sideB: contact.sideB,
            spanA: contact.spanA,
            spanB: contact.spanB,
            portalIds: pairPortals.map((portal) => portal.id),
            directionEvidence: pairDirections,
            reason: explanation,
          });
        }
        continue;
      }

      if (relation.geometry === "overlap") {
        rejectedContacts.push({
          a: a.map.mapId,
          b: b.map.mapId,
          geometry: "overlap",
          code: "overlap",
          portalIds: pairPortals.map((portal) => portal.id),
          directionEvidence: pairDirections,
          reason: `Corrected TMX rectangles overlap by ${relation.width}×${relation.height} tiles; ownership is ambiguous.`,
        });
      } else if (pairPortals.length || pairDirections.length) {
        const relationKinds = [
          pairPortals.length ? `${pairPortals.length} portal(s)` : "",
          pairDirections.length ? `${pairDirections.length} cardinal link(s)` : "",
        ].filter(Boolean).join(" and ");
        rejectedContacts.push({
          a: a.map.mapId,
          b: b.map.mapId,
          geometry: "gap",
          code: "gap",
          portalIds: pairPortals.map((portal) => portal.id),
          directionEvidence: pairDirections,
          reason: `${relationKinds} connect maps without a positive-length shared edge (tile gap x=${relation.gapX}, y=${relation.gapY}); retain teleport semantics.`,
        });
      }
    }
  }

  seams.sort((a, b) => (a.a.localeCompare(b.a) || a.b.localeCompare(b.b)));
  rejectedContacts.sort((a, b) =>
    a.a.localeCompare(b.a) || a.b.localeCompare(b.b) || a.geometry.localeCompare(b.geometry) || a.code.localeCompare(b.code)
  );
  return {
    worldId,
    sourceFile,
    maps,
    excludedMaps,
    adjacency: buildAdjacency(maps, seams),
    seams,
    portals,
    diagnostics: {
      dimensionCorrections: corrections,
      rejectedContacts,
      ambiguousDirections: resolvedDirections.ambiguous,
    },
  };
}

function statsFor(world: OutdoorWorld): WorldStats {
  const edgeRejects = world.diagnostics.rejectedContacts.filter((entry) => entry.geometry === "edge").length;
  const expected = S5_EXPECTED_SEAMS[world.worldId] ?? null;
  return {
    worldId: world.worldId,
    sourceMembers: world.maps.length + world.excludedMaps.length,
    outdoorMaps: world.maps.length,
    excludedIndoorMaps: world.excludedMaps.length,
    bboxTiles: bbox(world.maps),
    geometricContacts: world.seams.length + edgeRejects,
    acceptedSeams: world.seams.length,
    rejectedGeometricContacts: edgeRejects,
    rejectedOverlaps: world.diagnostics.rejectedContacts.filter((entry) => entry.geometry === "overlap").length,
    rejectedGaps: world.diagnostics.rejectedContacts.filter((entry) => entry.geometry === "gap").length,
    dimensionCorrections: world.diagnostics.dimensionCorrections.length,
    outdoorDimensionCorrections: world.diagnostics.dimensionCorrections.filter((entry) =>
      world.maps.some((map) => map.mapId === entry.mapId)
    ).length,
    portals: world.portals.length,
    coordinatePreservingSeams: world.seams.filter((seam) => seam.handoff.mode === "coordinate-preserving").length,
    mixedHandoffSeams: world.seams.filter((seam) => seam.handoff.mode === "mixed").length,
    portalOnlySeams: world.seams.filter((seam) => seam.handoff.mode === "portal-only").length,
    directionOnlySeams: world.seams.filter((seam) => seam.handoff.mode === "direction-only").length,
    coordinatePreservingOpenings: world.seams.flatMap((seam) => seam.handoff.openings)
      .filter((opening) => opening.compatibility === "coordinate-preserving").length,
    portalOnlyOpenings: world.seams.flatMap((seam) => seam.handoff.openings)
      .filter((opening) => opening.compatibility === "portal-only").length,
    ambiguousDirections: world.diagnostics.ambiguousDirections.length,
    componentSizes: componentSizes(world),
    s5ExpectedSeams: expected,
  };
}

/** Build and self-validate the complete four-world index from parsed TMX maps. */
export function buildOutdoorWorldIndex(
  sourceMapsInput: readonly TuxMap[],
  options: WorldImportOptions = {},
): WorldImportBuild {
  const mapsDir = normalize(options.mapsDir ?? MAPS_DIR);
  const sourceRoot = normalize(options.sourceRoot ?? TUXEMON_SRC);
  const sourceMaps = new Map(sourceMapsInput.map((map) => [map.slug, map]));
  assert(sourceMaps.size === sourceMapsInput.length, "source map ids must be unique");
  const worldFiles = readdirSync(mapsDir).filter((file) => file.endsWith(".world")).sort();
  const worlds = worldFiles.map((file) => buildWorld(
    file.slice(0, -6),
    `mods/tuxemon/maps/${file}`,
    parseWorld(join(mapsDir, file)),
    sourceMaps,
  ));
  const index = withOutdoorWorldContentHash({
    format: OUTDOOR_WORLD_INDEX_FORMAT,
    sourceRevision: sourceRevision(sourceRoot, options.sourceRevision),
    tileSize: TILE_SIZE,
    worlds,
  });
  validateOutdoorWorldIndex(index);

  const worldStats = worlds.map(statsFor);
  const sum = <K extends keyof WorldStats>(key: K): number => worldStats.reduce((total, world) => {
    const value = world[key];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
  const actualSeams = sum("acceptedSeams");
  const differences = worldStats.flatMap((world) => {
    if (world.s5ExpectedSeams === null || world.acceptedSeams === world.s5ExpectedSeams) return [];
    const rejected = worlds.find((entry) => entry.worldId === world.worldId)!.diagnostics.rejectedContacts
      .filter((entry) => entry.geometry === "edge")
      .map((entry) => `${entry.a}--${entry.b} (${entry.code}: ${entry.reason})`)
      .join("; ");
    return [`${world.worldId}: expected ${world.s5ExpectedSeams}, generated ${world.acceptedSeams}; rejected edge candidates: ${rejected || "none"}`];
  });
  const report: WorldImportReport = {
    format: "pocket-tuxemon/world-import-report/v1",
    artifact: "dist/world-index.json",
    contentHash: index.contentHash,
    totals: {
      worlds: worlds.length,
      sourceMembers: sum("sourceMembers"),
      outdoorMaps: sum("outdoorMaps"),
      excludedIndoorMaps: sum("excludedIndoorMaps"),
      geometricContacts: sum("geometricContacts"),
      acceptedSeams: actualSeams,
      rejectedGeometricContacts: sum("rejectedGeometricContacts"),
      rejectedOverlaps: sum("rejectedOverlaps"),
      rejectedGaps: sum("rejectedGaps"),
      dimensionCorrections: sum("dimensionCorrections"),
      outdoorDimensionCorrections: sum("outdoorDimensionCorrections"),
      portals: sum("portals"),
      coordinatePreservingSeams: sum("coordinatePreservingSeams"),
      mixedHandoffSeams: sum("mixedHandoffSeams"),
      portalOnlySeams: sum("portalOnlySeams"),
      directionOnlySeams: sum("directionOnlySeams"),
      coordinatePreservingOpenings: sum("coordinatePreservingOpenings"),
      portalOnlyOpenings: sum("portalOnlyOpenings"),
      ambiguousDirections: sum("ambiguousDirections"),
    },
    worlds: worldStats,
    s5Comparison: {
      expectedSeams: 71,
      actualSeams,
      matches: actualSeams === 71 && differences.length === 0,
      differences,
    },
  };
  return { index, report };
}
