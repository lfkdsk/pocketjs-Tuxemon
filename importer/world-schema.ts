import { createHash } from "node:crypto";

export const OUTDOOR_WORLD_INDEX_FORMAT = "pocket-tuxemon/outdoor-world-index/v1" as const;

export type WorldSide = "north" | "east" | "south" | "west";
export type WorldAxis = "x" | "y";

export interface TileSpan {
  /** Inclusive local tile coordinate on the seam's tangent axis. */
  start: number;
  /** Exclusive local tile coordinate on the seam's tangent axis. */
  end: number;
}

/** One stitchable outdoor TMX member. Dimensions are authoritative TMX tiles. */
export interface OutdoorWorldMap {
  mapId: string;
  /** Tuxemon's cardinal-neighbor token (`slug` property), resolved by evidence. */
  directionSlug: string;
  /** Normalized source cardinal declarations, retained so validation is self-contained. */
  directions: Record<WorldSide, string[]>;
  originTileX: number;
  originTileY: number;
  width: number;
  height: number;
}

/** A `.world` member intentionally excluded from stitching by `inside=true`. */
export interface ExcludedWorldMap extends OutdoorWorldMap {
  reason: "inside";
}

export interface WorldDimensionCorrection {
  mapId: string;
  reason: "zero-size" | "stale-size";
  declaredPixels: { width: number; height: number };
  actualPixels: { width: number; height: number };
}

/** Original source portal. It remains authoritative even when its map pair is a seam. */
export interface WorldPortal {
  id: string;
  sourceMap: string;
  targetMap: string;
  event: string;
  objectId: number | null;
  source: { x: number; y: number; width: number; height: number };
  target: { x: number; y: number };
  touchingSides: WorldSide[];
  raw: string;
}

export interface WorldDirectionEvidence {
  kind: "direction-property";
  sourceMap: string;
  targetMap: string;
  side: WorldSide;
  value: string;
}

export type WorldSeamEvidence =
  | {
    kind: "transition_teleport";
    sourceMap: string;
    side: WorldSide;
    portalId: string;
  }
  | WorldDirectionEvidence;

export type WorldPortalHandoffIssue =
  | "fixed-destination"
  | "offset-mismatch"
  | "wrong-target-edge";

/**
 * Compatibility of one authored edge teleport with coordinate-preserving
 * seamless handoff. A portal-only opening remains authoritative as a normal
 * teleport; W2 must not turn it into direct crossing.
 */
export interface WorldSeamOpening {
  portalId: string;
  sourceMap: string;
  sourceSide: WorldSide;
  sourceSpan: TileSpan;
  targetMap: string;
  targetSide: WorldSide;
  expectedTargetSpan: TileSpan;
  actualTarget: { tangent: number; normal: number };
  compatibility: "coordinate-preserving" | "portal-only";
  issues: WorldPortalHandoffIssue[];
}

/**
 * A topology allowlist entry. The mapping is `targetLocal = sourceLocal +
 * offsetAtoB` on the tangent axis; crossing itself moves to the opposite edge.
 */
export interface OutdoorWorldSeam {
  a: string;
  sideA: WorldSide;
  spanA: TileSpan;
  b: string;
  sideB: WorldSide;
  spanB: TileSpan;
  coordinateMapping: {
    axis: WorldAxis;
    offsetAtoB: number;
  };
  evidence: WorldSeamEvidence[];
  /** Per-opening safety gate for the later atomic-handoff implementation. */
  handoff: {
    mode: "coordinate-preserving" | "mixed" | "portal-only" | "direction-only";
    openings: WorldSeamOpening[];
  };
}

export type RejectedWorldContactCode =
  | "unsupported-contact"
  | "portal-away-from-edge"
  | "wrong-side-direction"
  | "overlap"
  | "gap";

export interface RejectedWorldContact {
  a: string;
  b: string;
  geometry: "edge" | "overlap" | "gap";
  code: RejectedWorldContactCode;
  sideA?: WorldSide;
  sideB?: WorldSide;
  spanA?: TileSpan;
  spanB?: TileSpan;
  portalIds: string[];
  directionEvidence: WorldDirectionEvidence[];
  reason: string;
}

export interface AmbiguousWorldDirection {
  sourceMap: string;
  side: WorldSide;
  value: string;
  candidateMaps: string[];
  reason: string;
}

export interface WorldEdgeContact {
  sideA: WorldSide;
  sideB: WorldSide;
  axis: WorldAxis;
  globalSpan: TileSpan;
  spanA: TileSpan;
  spanB: TileSpan;
  offsetAtoB: number;
}

export type OutdoorWorldMapRelation =
  | ({ geometry: "edge" } & WorldEdgeContact)
  | { geometry: "overlap"; width: number; height: number }
  | { geometry: "gap"; gapX: number; gapY: number };

export interface OutdoorWorld {
  worldId: string;
  sourceFile: string;
  maps: OutdoorWorldMap[];
  excludedMaps: ExcludedWorldMap[];
  /** Symmetric, sorted allowlist adjacency derived exactly from `seams`. */
  adjacency: Record<string, string[]>;
  seams: OutdoorWorldSeam[];
  /** All original `transition_teleport` actions whose source is an outdoor member. */
  portals: WorldPortal[];
  diagnostics: {
    dimensionCorrections: WorldDimensionCorrection[];
    rejectedContacts: RejectedWorldContact[];
    ambiguousDirections: AmbiguousWorldDirection[];
  };
}

export interface OutdoorWorldIndex {
  format: typeof OUTDOOR_WORLD_INDEX_FORMAT;
  sourceRevision: string;
  tileSize: 16;
  worlds: OutdoorWorld[];
  /** SHA-256 of canonical JSON for every preceding field, excluding this field. */
  contentHash: string;
}

type WorldIndexPayload = Omit<OutdoorWorldIndex, "contentHash">;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(object[key])}`
  ).join(",")}}`;
}

export function outdoorWorldContentHash(value: OutdoorWorldIndex | WorldIndexPayload): string {
  const { contentHash: _ignored, ...payload } = value as OutdoorWorldIndex;
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

export function withOutdoorWorldContentHash(payload: WorldIndexPayload): OutdoorWorldIndex {
  return { ...payload, contentHash: outdoorWorldContentHash(payload) };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`outdoor-world-index schema: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]!.localeCompare(value) < 0);
}

const SIDES = new Set<WorldSide>(["north", "east", "south", "west"]);
const OPPOSITE: Readonly<Record<WorldSide, WorldSide>> = {
  north: "south",
  east: "west",
  south: "north",
  west: "east",
};

function assertMap(value: unknown, label: string, requireIntegerOrigin: boolean): asserts value is OutdoorWorldMap {
  assert(isRecord(value), `${label} must be an object`);
  assert(typeof value.mapId === "string" && value.mapId.length > 0, `${label}.mapId must be non-empty`);
  assert(typeof value.directionSlug === "string" && value.directionSlug.length > 0, `${label}.directionSlug must be non-empty`);
  assert(isRecord(value.directions), `${label}.directions must be an object`);
  assert(JSON.stringify(Object.keys(value.directions)) === JSON.stringify([...SIDES]), `${label}.directions must contain four ordered sides`);
  for (const side of SIDES) {
    const tokens = value.directions[side];
    assert(Array.isArray(tokens) && tokens.every((token) => typeof token === "string" && token.length > 0), `${label}.directions.${side} must contain strings`);
    assert(sortedUnique(tokens), `${label}.directions.${side} must be sorted and unique`);
  }
  for (const key of ["originTileX", "originTileY"] as const) {
    assert(Number.isFinite(value[key]), `${label}.${key} must be finite`);
    if (requireIntegerOrigin) assert(Number.isInteger(value[key]), `${label}.${key} must be an integer`);
  }
  for (const key of ["width", "height"] as const) {
    assert(Number.isInteger(value[key]) && (value[key] as number) > 0, `${label}.${key} must be a positive integer`);
  }
}

function assertSpan(value: unknown, label: string): asserts value is TileSpan {
  assert(isRecord(value), `${label} must be an object`);
  assert(Number.isInteger(value.start) && Number.isInteger(value.end), `${label} bounds must be integers`);
  assert((value.end as number) > (value.start as number), `${label} must have positive length`);
}

function spanOverlap(startA: number, endA: number, startB: number, endB: number): TileSpan | null {
  const start = Math.max(startA, startB);
  const end = Math.min(endA, endB);
  return end > start ? { start, end } : null;
}

/** Pure corrected-rectangle classifier shared by import diagnostics and validation. */
export function outdoorWorldMapRelation(a: OutdoorWorldMap, b: OutdoorWorldMap): OutdoorWorldMapRelation {
  const ax2 = a.originTileX + a.width;
  const ay2 = a.originTileY + a.height;
  const bx2 = b.originTileX + b.width;
  const by2 = b.originTileY + b.height;

  if (ax2 === b.originTileX) {
    const globalSpan = spanOverlap(a.originTileY, ay2, b.originTileY, by2);
    if (globalSpan) return {
      geometry: "edge", sideA: "east", sideB: "west", axis: "y", globalSpan,
      spanA: { start: globalSpan.start - a.originTileY, end: globalSpan.end - a.originTileY },
      spanB: { start: globalSpan.start - b.originTileY, end: globalSpan.end - b.originTileY },
      offsetAtoB: a.originTileY - b.originTileY,
    };
  }
  if (bx2 === a.originTileX) {
    const globalSpan = spanOverlap(a.originTileY, ay2, b.originTileY, by2);
    if (globalSpan) return {
      geometry: "edge", sideA: "west", sideB: "east", axis: "y", globalSpan,
      spanA: { start: globalSpan.start - a.originTileY, end: globalSpan.end - a.originTileY },
      spanB: { start: globalSpan.start - b.originTileY, end: globalSpan.end - b.originTileY },
      offsetAtoB: a.originTileY - b.originTileY,
    };
  }
  if (ay2 === b.originTileY) {
    const globalSpan = spanOverlap(a.originTileX, ax2, b.originTileX, bx2);
    if (globalSpan) return {
      geometry: "edge", sideA: "south", sideB: "north", axis: "x", globalSpan,
      spanA: { start: globalSpan.start - a.originTileX, end: globalSpan.end - a.originTileX },
      spanB: { start: globalSpan.start - b.originTileX, end: globalSpan.end - b.originTileX },
      offsetAtoB: a.originTileX - b.originTileX,
    };
  }
  if (by2 === a.originTileY) {
    const globalSpan = spanOverlap(a.originTileX, ax2, b.originTileX, bx2);
    if (globalSpan) return {
      geometry: "edge", sideA: "north", sideB: "south", axis: "x", globalSpan,
      spanA: { start: globalSpan.start - a.originTileX, end: globalSpan.end - a.originTileX },
      spanB: { start: globalSpan.start - b.originTileX, end: globalSpan.end - b.originTileX },
      offsetAtoB: a.originTileX - b.originTileX,
    };
  }

  const width = Math.min(ax2, bx2) - Math.max(a.originTileX, b.originTileX);
  const height = Math.min(ay2, by2) - Math.max(a.originTileY, b.originTileY);
  if (width > 0 && height > 0) return { geometry: "overlap", width, height };
  return {
    geometry: "gap",
    gapX: Math.max(a.originTileX - bx2, b.originTileX - ax2, 0),
    gapY: Math.max(a.originTileY - by2, b.originTileY - ay2, 0),
  };
}

export function resolveWorldDirections(maps: readonly OutdoorWorldMap[]): {
  evidence: WorldDirectionEvidence[];
  ambiguous: AmbiguousWorldDirection[];
} {
  const evidence: WorldDirectionEvidence[] = [];
  const ambiguous: AmbiguousWorldDirection[] = [];
  for (const source of maps) {
    for (const side of SIDES) {
      for (const value of source.directions[side]) {
        const exact = maps.find((candidate) => candidate.mapId !== source.mapId && candidate.mapId === value);
        if (exact) {
          evidence.push({ kind: "direction-property", sourceMap: source.mapId, targetMap: exact.mapId, side, value });
          continue;
        }
        const aliases = maps.filter((candidate) =>
          candidate.mapId !== source.mapId && candidate.directionSlug === value
        );
        const aligned = aliases.filter((candidate) => {
          const relation = outdoorWorldMapRelation(source, candidate);
          return relation.geometry === "edge" && relation.sideA === side;
        });
        const target = aligned.length === 1 ? aligned[0] : aligned.length === 0 && aliases.length === 1 ? aliases[0] : null;
        if (target) {
          evidence.push({ kind: "direction-property", sourceMap: source.mapId, targetMap: target.mapId, side, value });
        } else if (aliases.length > 1) {
          const candidateMaps = aliases.map((candidate) => candidate.mapId).sort((a, b) => a.localeCompare(b));
          ambiguous.push({
            sourceMap: source.mapId,
            side,
            value,
            candidateMaps,
            reason: `Cardinal token ${JSON.stringify(value)} matches ${aliases.length} outdoor maps and has ${aligned.length} geometrically aligned candidates; no unique target was chosen.`,
          });
        }
      }
    }
  }
  evidence.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  ambiguous.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { evidence, ambiguous };
}

function expectedContact(
  a: OutdoorWorldMap,
  sideA: WorldSide,
  b: OutdoorWorldMap,
): { sideB: WorldSide; axis: WorldAxis; spanA: TileSpan; spanB: TileSpan; offset: number } | null {
  const relation = outdoorWorldMapRelation(a, b);
  if (relation.geometry !== "edge" || relation.sideA !== sideA) return null;
  return {
    sideB: relation.sideB,
    axis: relation.axis,
    spanA: relation.spanA,
    spanB: relation.spanB,
    offset: relation.offsetAtoB,
  };
}

function expectedTouchingSides(portal: WorldPortal, map: OutdoorWorldMap): WorldSide[] {
  if (portal.source.width <= 0 || portal.source.height <= 0) return [];
  const horizontal = spanOverlap(portal.source.x, portal.source.x + portal.source.width, 0, map.width) !== null;
  const vertical = spanOverlap(portal.source.y, portal.source.y + portal.source.height, 0, map.height) !== null;
  const sides: WorldSide[] = [];
  if (horizontal && portal.source.y <= 0 && portal.source.y + portal.source.height > 0) sides.push("north");
  if (vertical && portal.source.x < map.width && portal.source.x + portal.source.width >= map.width) sides.push("east");
  if (horizontal && portal.source.y < map.height && portal.source.y + portal.source.height >= map.height) sides.push("south");
  if (vertical && portal.source.x <= 0 && portal.source.x + portal.source.width > 0) sides.push("west");
  return sides;
}

function expectedSeamOpening(
  seam: OutdoorWorldSeam,
  portal: WorldPortal,
  maps: ReadonlyMap<string, OutdoorWorldMap>,
): WorldSeamOpening | null {
  const sourceIsA = portal.sourceMap === seam.a && portal.targetMap === seam.b;
  const sourceIsB = portal.sourceMap === seam.b && portal.targetMap === seam.a;
  if (!sourceIsA && !sourceIsB) return null;
  const sourceSide = sourceIsA ? seam.sideA : seam.sideB;
  const targetSide = sourceIsA ? seam.sideB : seam.sideA;
  if (!portal.touchingSides.includes(sourceSide)) return null;
  const seamSpan = sourceIsA ? seam.spanA : seam.spanB;
  const portalStart = seam.coordinateMapping.axis === "x" ? portal.source.x : portal.source.y;
  const portalLength = seam.coordinateMapping.axis === "x" ? portal.source.width : portal.source.height;
  const sourceSpan = spanOverlap(seamSpan.start, seamSpan.end, portalStart, portalStart + portalLength);
  if (!sourceSpan) return null;

  const offset = sourceIsA ? seam.coordinateMapping.offsetAtoB : -seam.coordinateMapping.offsetAtoB;
  const expectedTargetSpan = { start: sourceSpan.start + offset, end: sourceSpan.end + offset };
  const actualTarget = seam.coordinateMapping.axis === "x"
    ? { tangent: portal.target.x, normal: portal.target.y }
    : { tangent: portal.target.y, normal: portal.target.x };
  const target = maps.get(portal.targetMap);
  if (!target) return null;
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

function expectedHandoffMode(openings: readonly WorldSeamOpening[]): OutdoorWorldSeam["handoff"]["mode"] {
  if (openings.length === 0) return "direction-only";
  const compatible = openings.filter((opening) => opening.compatibility === "coordinate-preserving").length;
  if (compatible === openings.length) return "coordinate-preserving";
  if (compatible === 0) return "portal-only";
  return "mixed";
}

function portalConnects(portal: WorldPortal, a: string, b: string): boolean {
  return (portal.sourceMap === a && portal.targetMap === b) ||
    (portal.sourceMap === b && portal.targetMap === a);
}

function directionConnects(evidence: WorldDirectionEvidence, a: string, b: string): boolean {
  return (evidence.sourceMap === a && evidence.targetMap === b) ||
    (evidence.sourceMap === b && evidence.targetMap === a);
}

function portalSupportsContact(
  portal: WorldPortal,
  a: string,
  contact: Pick<WorldEdgeContact, "sideA" | "sideB" | "axis" | "spanA" | "spanB">,
): boolean {
  const sourceIsA = portal.sourceMap === a;
  const side = sourceIsA ? contact.sideA : contact.sideB;
  const span = sourceIsA ? contact.spanA : contact.spanB;
  const start = contact.axis === "x" ? portal.source.x : portal.source.y;
  const length = contact.axis === "x" ? portal.source.width : portal.source.height;
  return portal.touchingSides.includes(side) && spanOverlap(span.start, span.end, start, start + length) !== null;
}

/** Strict structural and relational validation for W2 consumers. */
export function validateOutdoorWorldIndex(value: unknown): OutdoorWorldIndex {
  assert(isRecord(value), "root must be an object");
  assert(value.format === OUTDOOR_WORLD_INDEX_FORMAT, "unsupported format");
  assert(typeof value.sourceRevision === "string" && value.sourceRevision.length > 0, "sourceRevision must be non-empty");
  assert(value.tileSize === 16, "tileSize must be 16");
  assert(typeof value.contentHash === "string" && /^[0-9a-f]{64}$/.test(value.contentHash), "contentHash must be lowercase SHA-256");
  assert(Array.isArray(value.worlds), "worlds must be an array");

  const index = value as unknown as OutdoorWorldIndex;
  assert(sortedUnique(index.worlds.map((world) => world.worldId)), "worlds must be sorted with unique ids");
  for (const [worldIndex, world] of index.worlds.entries()) {
    const label = `worlds[${worldIndex}]`;
    assert(isRecord(world), `${label} must be an object`);
    assert(typeof world.worldId === "string" && world.worldId.length > 0, `${label}.worldId must be non-empty`);
    assert(typeof world.sourceFile === "string" && world.sourceFile.endsWith(".world"), `${label}.sourceFile must name a .world file`);
    assert(Array.isArray(world.maps) && Array.isArray(world.excludedMaps), `${label} map lists must be arrays`);
    assert(Array.isArray(world.seams) && Array.isArray(world.portals), `${label} seam/portal lists must be arrays`);
    assert(isRecord(world.adjacency), `${label}.adjacency must be an object`);
    assert(isRecord(world.diagnostics), `${label}.diagnostics must be an object`);
    assert(Array.isArray(world.diagnostics.dimensionCorrections), `${label}.dimensionCorrections must be an array`);
    assert(Array.isArray(world.diagnostics.rejectedContacts), `${label}.rejectedContacts must be an array`);
    assert(Array.isArray(world.diagnostics.ambiguousDirections), `${label}.ambiguousDirections must be an array`);

    for (const [i, map] of world.maps.entries()) assertMap(map, `${label}.maps[${i}]`, true);
    for (const [i, map] of world.excludedMaps.entries()) {
      assertMap(map, `${label}.excludedMaps[${i}]`, false);
      assert(map.reason === "inside", `${label}.excludedMaps[${i}].reason must be inside`);
    }
    const mapIds = world.maps.map((map) => map.mapId);
    const excludedIds = world.excludedMaps.map((map) => map.mapId);
    assert(sortedUnique(mapIds), `${label}.maps must be sorted with unique ids`);
    assert(sortedUnique(excludedIds), `${label}.excludedMaps must be sorted with unique ids`);
    assert(!excludedIds.some((id) => mapIds.includes(id)), `${label} map lists overlap`);
    const maps = new Map(world.maps.map((map) => [map.mapId, map]));
    const allMaps = new Map([...world.maps, ...world.excludedMaps].map((map) => [map.mapId, map]));
    const resolvedDirections = resolveWorldDirections(world.maps);
    const resolvedDirectionKeys = new Set(resolvedDirections.evidence.map((entry) => canonicalJson(entry)));

    const adjacencyKeys = Object.keys(world.adjacency);
    assert(JSON.stringify(adjacencyKeys) === JSON.stringify(mapIds), `${label}.adjacency keys must equal sorted outdoor map ids`);
    for (const [mapId, neighbors] of Object.entries(world.adjacency)) {
      assert(Array.isArray(neighbors) && neighbors.every((id) => typeof id === "string"), `${label}.adjacency.${mapId} must be a string array`);
      assert(sortedUnique(neighbors), `${label}.adjacency.${mapId} must be sorted and unique`);
      for (const neighbor of neighbors) {
        assert(maps.has(neighbor), `${label}.adjacency.${mapId} references missing map ${neighbor}`);
        assert(world.adjacency[neighbor]?.includes(mapId), `${label}.adjacency is not symmetric for ${mapId}/${neighbor}`);
      }
    }

    const portalIds = new Set<string>();
    const portalsById = new Map<string, WorldPortal>();
    for (const [i, portal] of world.portals.entries()) {
      const portalLabel = `${label}.portals[${i}]`;
      assert(isRecord(portal), `${portalLabel} must be an object`);
      assert(typeof portal.id === "string" && portal.id.length > 0 && !portalIds.has(portal.id), `${portalLabel}.id must be unique`);
      portalIds.add(portal.id);
      portalsById.set(portal.id, portal);
      assert(maps.has(portal.sourceMap), `${portalLabel}.sourceMap must be outdoor`);
      assert(typeof portal.targetMap === "string" && portal.targetMap.length > 0, `${portalLabel}.targetMap must be non-empty`);
      assert(typeof portal.event === "string" && typeof portal.raw === "string", `${portalLabel} text fields must be strings`);
      assert(portal.objectId === null || Number.isInteger(portal.objectId), `${portalLabel}.objectId must be integer or null`);
      assert(isRecord(portal.source) && isRecord(portal.target), `${portalLabel} coordinates must be objects`);
      for (const coordinate of [portal.source.x, portal.source.y, portal.source.width, portal.source.height, portal.target.x, portal.target.y]) {
        assert(Number.isInteger(coordinate), `${portalLabel} coordinates must be integers`);
      }
      assert(portal.source.width >= 0 && portal.source.height >= 0, `${portalLabel} source dimensions must be nonnegative`);
      assert(Array.isArray(portal.touchingSides) && portal.touchingSides.every((side) => SIDES.has(side)), `${portalLabel}.touchingSides is invalid`);
      assert(
        canonicalJson(portal.touchingSides) === canonicalJson(expectedTouchingSides(portal, maps.get(portal.sourceMap)!)),
        `${portalLabel}.touchingSides does not match source geometry`,
      );
    }
    assert(sortedUnique(world.portals.map((portal) => portal.id)), `${label}.portals must be sorted with unique ids`);

    const seamPairs = new Set<string>();
    const seamNeighbors = new Map(mapIds.map((id) => [id, new Set<string>()]));
    for (const [i, seam] of world.seams.entries()) {
      const seamLabel = `${label}.seams[${i}]`;
      assert(isRecord(seam), `${seamLabel} must be an object`);
      assert(typeof seam.a === "string" && typeof seam.b === "string" && seam.a.localeCompare(seam.b) < 0, `${seamLabel} endpoints must be canonical`);
      assert(maps.has(seam.a) && maps.has(seam.b), `${seamLabel} references missing outdoor map`);
      const pair = `${seam.a}\0${seam.b}`;
      assert(!seamPairs.has(pair), `${seamLabel} duplicates ${seam.a}/${seam.b}`);
      seamPairs.add(pair);
      assert(SIDES.has(seam.sideA) && SIDES.has(seam.sideB), `${seamLabel} has invalid side`);
      assert(OPPOSITE[seam.sideA] === seam.sideB, `${seamLabel} sides are not opposite`);
      assertSpan(seam.spanA, `${seamLabel}.spanA`);
      assertSpan(seam.spanB, `${seamLabel}.spanB`);
      assert(isRecord(seam.coordinateMapping), `${seamLabel}.coordinateMapping must be an object`);
      const expected = expectedContact(maps.get(seam.a)!, seam.sideA, maps.get(seam.b)!);
      assert(expected !== null, `${seamLabel} maps do not share the declared edge`);
      assert(expected.sideB === seam.sideB, `${seamLabel}.sideB does not match geometry`);
      assert(JSON.stringify(expected.spanA) === JSON.stringify(seam.spanA), `${seamLabel}.spanA does not match geometry`);
      assert(JSON.stringify(expected.spanB) === JSON.stringify(seam.spanB), `${seamLabel}.spanB does not match geometry`);
      assert(seam.coordinateMapping.axis === expected.axis, `${seamLabel} mapping axis does not match geometry`);
      assert(seam.coordinateMapping.offsetAtoB === expected.offset, `${seamLabel} mapping offset does not match origins`);
      assert(Array.isArray(seam.evidence) && seam.evidence.length > 0, `${seamLabel} needs evidence`);
      assert(
        sortedUnique(seam.evidence.map((entry) => JSON.stringify(entry))),
        `${seamLabel}.evidence must be sorted and unique`,
      );
      const openingPortalIds: string[] = [];
      for (const evidence of seam.evidence) {
        assert(isRecord(evidence as unknown), `${seamLabel} has invalid evidence`);
        assert(evidence.kind === "transition_teleport" || evidence.kind === "direction-property", `${seamLabel} has invalid evidence kind`);
        assert(evidence.sourceMap === seam.a || evidence.sourceMap === seam.b, `${seamLabel} evidence source is not an endpoint`);
        assert(SIDES.has(evidence.side as WorldSide), `${seamLabel} evidence side is invalid`);
        const expectedSourceSide = evidence.sourceMap === seam.a ? seam.sideA : seam.sideB;
        const expectedTargetMap = evidence.sourceMap === seam.a ? seam.b : seam.a;
        assert(evidence.side === expectedSourceSide, `${seamLabel} evidence side does not match its endpoint`);
        if (evidence.kind === "transition_teleport") {
          assert(typeof evidence.portalId === "string" && portalIds.has(evidence.portalId), `${seamLabel} references missing portal evidence`);
          const portal = portalsById.get(evidence.portalId)!;
          assert(portal.sourceMap === evidence.sourceMap && portal.targetMap === expectedTargetMap, `${seamLabel} portal evidence endpoints do not match seam`);
          assert(expectedSeamOpening(seam, portal, maps) !== null, `${seamLabel} portal evidence does not overlap its declared edge`);
          openingPortalIds.push(portal.id);
        } else {
          assert(typeof evidence.value === "string" && evidence.value.length > 0, `${seamLabel} direction evidence has no value`);
          assert(evidence.targetMap === expectedTargetMap, `${seamLabel} direction evidence target does not match seam`);
          const target = maps.get(expectedTargetMap)!;
          assert(evidence.value === target.mapId || evidence.value === target.directionSlug, `${seamLabel} direction evidence value does not name its target`);
          assert(resolvedDirectionKeys.has(canonicalJson(evidence)), `${seamLabel} direction evidence is not present in source declarations`);
        }
      }
      const pairPortals = world.portals.filter((portal) => portalConnects(portal, seam.a, seam.b));
      const expectedEvidence: WorldSeamEvidence[] = [
        ...pairPortals.filter((portal) => portalSupportsContact(portal, seam.a, {
          sideA: seam.sideA,
          sideB: seam.sideB,
          axis: seam.coordinateMapping.axis,
          spanA: seam.spanA,
          spanB: seam.spanB,
        })).map((portal) => ({
          kind: "transition_teleport" as const,
          sourceMap: portal.sourceMap,
          side: portal.sourceMap === seam.a ? seam.sideA : seam.sideB,
          portalId: portal.id,
        })),
        ...resolvedDirections.evidence.filter((entry) =>
          directionConnects(entry, seam.a, seam.b) &&
          entry.side === (entry.sourceMap === seam.a ? seam.sideA : seam.sideB)
        ),
      ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      assert(canonicalJson(seam.evidence) === canonicalJson(expectedEvidence), `${seamLabel}.evidence is not the complete derived evidence set`);
      assert(isRecord(seam.handoff) && Array.isArray(seam.handoff.openings), `${seamLabel}.handoff is invalid`);
      const expectedOpenings = [...new Set(openingPortalIds)].sort().map((portalId) =>
        expectedSeamOpening(seam, portalsById.get(portalId)!, maps)!
      );
      const expectedHandoff = { mode: expectedHandoffMode(expectedOpenings), openings: expectedOpenings };
      assert(
        canonicalJson(seam.handoff) === canonicalJson(expectedHandoff),
        `${seamLabel}.handoff does not match portal geometry and destinations`,
      );
      seamNeighbors.get(seam.a)!.add(seam.b);
      seamNeighbors.get(seam.b)!.add(seam.a);
    }
    for (const mapId of mapIds) {
      assert(
        JSON.stringify([...seamNeighbors.get(mapId)!].sort()) === JSON.stringify(world.adjacency[mapId]),
        `${label}.adjacency.${mapId} does not equal seams`,
      );
    }

    assert(
      sortedUnique(world.diagnostics.dimensionCorrections.map((entry) => entry.mapId)),
      `${label}.dimensionCorrections must be sorted with unique map ids`,
    );
    for (const [i, correction] of world.diagnostics.dimensionCorrections.entries()) {
      const correctionLabel = `${label}.dimensionCorrections[${i}]`;
      assert(isRecord(correction) && allMaps.has(correction.mapId), `${correctionLabel} references missing member`);
      assert(correction.reason === "zero-size" || correction.reason === "stale-size", `${correctionLabel}.reason is invalid`);
      assert(isRecord(correction.declaredPixels) && isRecord(correction.actualPixels), `${correctionLabel} dimensions must be objects`);
      const member = allMaps.get(correction.mapId)!;
      assert(correction.actualPixels.width === member.width * 16 && correction.actualPixels.height === member.height * 16, `${correctionLabel}.actualPixels does not match TMX size`);
      assert(correction.declaredPixels.width !== correction.actualPixels.width || correction.declaredPixels.height !== correction.actualPixels.height, `${correctionLabel} does not describe a difference`);
      const expectedReason = correction.declaredPixels.width === 0 && correction.declaredPixels.height === 0 ? "zero-size" : "stale-size";
      assert(correction.reason === expectedReason, `${correctionLabel}.reason does not match declared dimensions`);
    }
    assert(
      canonicalJson(world.diagnostics.ambiguousDirections) === canonicalJson(resolvedDirections.ambiguous),
      `${label}.ambiguousDirections does not match source declarations`,
    );
    const rejectedPairs = new Set<string>();
    for (const [i, rejected] of world.diagnostics.rejectedContacts.entries()) {
      const rejectedLabel = `${label}.rejectedContacts[${i}]`;
      assert(isRecord(rejected) && maps.has(rejected.a) && maps.has(rejected.b) && rejected.a.localeCompare(rejected.b) < 0, `${rejectedLabel} endpoints are invalid`);
      const pair = `${rejected.a}\0${rejected.b}`;
      assert(!rejectedPairs.has(pair), `${rejectedLabel} duplicates ${rejected.a}/${rejected.b}`);
      assert(!seamPairs.has(pair), `${rejectedLabel} conflicts with an accepted seam`);
      rejectedPairs.add(pair);
      assert(["edge", "overlap", "gap"].includes(rejected.geometry), `${rejectedLabel}.geometry is invalid`);
      assert(["unsupported-contact", "portal-away-from-edge", "wrong-side-direction", "overlap", "gap"].includes(rejected.code), `${rejectedLabel}.code is invalid`);
      assert(Array.isArray(rejected.portalIds) && sortedUnique(rejected.portalIds) && rejected.portalIds.every((id) => portalIds.has(id)), `${rejectedLabel}.portalIds is invalid`);
      for (const portalId of rejected.portalIds) {
        const portal = portalsById.get(portalId)!;
        assert(
          (portal.sourceMap === rejected.a && portal.targetMap === rejected.b) ||
          (portal.sourceMap === rejected.b && portal.targetMap === rejected.a),
          `${rejectedLabel}.portalIds contains an unrelated portal`,
        );
      }
      assert(Array.isArray(rejected.directionEvidence), `${rejectedLabel}.directionEvidence must be an array`);
      assert(
        sortedUnique(rejected.directionEvidence.map((entry) => JSON.stringify(entry))),
        `${rejectedLabel}.directionEvidence must be sorted and unique`,
      );
      for (const evidence of rejected.directionEvidence) {
        assert(isRecord(evidence) && evidence.kind === "direction-property", `${rejectedLabel} has invalid direction evidence`);
        assert(SIDES.has(evidence.side), `${rejectedLabel} direction evidence side is invalid`);
        assert(typeof evidence.value === "string" && evidence.value.length > 0, `${rejectedLabel} direction evidence value is invalid`);
        assert(
          (evidence.sourceMap === rejected.a && evidence.targetMap === rejected.b) ||
          (evidence.sourceMap === rejected.b && evidence.targetMap === rejected.a),
          `${rejectedLabel} direction evidence endpoints do not match`,
        );
        const target = maps.get(evidence.targetMap)!;
        assert(evidence.value === target.mapId || evidence.value === target.directionSlug, `${rejectedLabel} direction evidence value does not name its target`);
        assert(resolvedDirectionKeys.has(canonicalJson(evidence)), `${rejectedLabel} direction evidence is not present in source declarations`);
      }
      const expectedPortalIds = world.portals
        .filter((portal) => portalConnects(portal, rejected.a, rejected.b))
        .map((portal) => portal.id);
      const expectedDirections = resolvedDirections.evidence.filter((entry) =>
        directionConnects(entry, rejected.a, rejected.b)
      );
      assert(canonicalJson(rejected.portalIds) === canonicalJson(expectedPortalIds), `${rejectedLabel}.portalIds is not the complete pair relation`);
      assert(canonicalJson(rejected.directionEvidence) === canonicalJson(expectedDirections), `${rejectedLabel}.directionEvidence is not the complete pair relation`);
      assert(typeof rejected.reason === "string" && rejected.reason.length > 0, `${rejectedLabel}.reason must be non-empty`);

      const relation = outdoorWorldMapRelation(maps.get(rejected.a)!, maps.get(rejected.b)!);
      assert(relation.geometry === rejected.geometry, `${rejectedLabel}.geometry does not match corrected rectangles`);
      if (relation.geometry === "edge") {
        assert(rejected.code === "unsupported-contact" || rejected.code === "portal-away-from-edge" || rejected.code === "wrong-side-direction", `${rejectedLabel}.code is invalid for an edge`);
        assert(rejected.sideA === relation.sideA && rejected.sideB === relation.sideB, `${rejectedLabel} sides do not match corrected rectangles`);
        assert(canonicalJson(rejected.spanA) === canonicalJson(relation.spanA), `${rejectedLabel}.spanA does not match corrected rectangles`);
        assert(canonicalJson(rejected.spanB) === canonicalJson(relation.spanB), `${rejectedLabel}.spanB does not match corrected rectangles`);
        const alignedPortal = rejected.portalIds.some((portalId) =>
          portalSupportsContact(portalsById.get(portalId)!, rejected.a, relation)
        );
        const alignedDirection = rejected.directionEvidence.some((evidence) =>
          evidence.side === (evidence.sourceMap === rejected.a ? relation.sideA : relation.sideB)
        );
        assert(!alignedPortal && !alignedDirection, `${rejectedLabel} contains aligned evidence and should be a seam`);
        const expectedCode = rejected.portalIds.length > 0
          ? "portal-away-from-edge"
          : rejected.directionEvidence.length > 0 ? "wrong-side-direction" : "unsupported-contact";
        assert(rejected.code === expectedCode, `${rejectedLabel}.code does not match its evidence`);
      } else if (relation.geometry === "overlap") {
        assert(rejected.code === "overlap", `${rejectedLabel}.code must be overlap`);
        assert(rejected.sideA === undefined && rejected.sideB === undefined && rejected.spanA === undefined && rejected.spanB === undefined, `${rejectedLabel} overlap must not declare an edge`);
      } else {
        assert(rejected.code === "gap", `${rejectedLabel}.code must be gap`);
        assert(rejected.portalIds.length + rejected.directionEvidence.length > 0, `${rejectedLabel} gap needs a portal or direction relation`);
        assert(rejected.sideA === undefined && rejected.sideB === undefined && rejected.spanA === undefined && rejected.spanB === undefined, `${rejectedLabel} gap must not declare an edge`);
      }
    }
    assert(
      world.diagnostics.rejectedContacts.every((entry, index, entries) => index === 0 ||
        entries[index - 1]!.a.localeCompare(entry.a) < 0 ||
        (entries[index - 1]!.a === entry.a && entries[index - 1]!.b.localeCompare(entry.b) < 0)),
      `${label}.rejectedContacts must be sorted with unique pairs`,
    );

    for (let aIndex = 0; aIndex < world.maps.length; aIndex++) {
      for (let bIndex = aIndex + 1; bIndex < world.maps.length; bIndex++) {
        const a = world.maps[aIndex]!;
        const b = world.maps[bIndex]!;
        const pair = `${a.mapId}\0${b.mapId}`;
        const relation = outdoorWorldMapRelation(a, b);
        if (relation.geometry === "edge") {
          assert(seamPairs.has(pair) !== rejectedPairs.has(pair), `${label} edge ${a.mapId}/${b.mapId} must be accepted or rejected exactly once`);
        } else if (relation.geometry === "overlap") {
          assert(rejectedPairs.has(pair), `${label} overlap ${a.mapId}/${b.mapId} is missing a diagnostic`);
        } else {
          const linked = world.portals.some((portal) => portalConnects(portal, a.mapId, b.mapId)) ||
            resolvedDirections.evidence.some((entry) => directionConnects(entry, a.mapId, b.mapId));
          if (linked) assert(rejectedPairs.has(pair), `${label} linked gap ${a.mapId}/${b.mapId} is missing a diagnostic`);
        }
      }
    }
  }

  assert(outdoorWorldContentHash(index) === index.contentHash, "contentHash does not match canonical payload");
  return index;
}
