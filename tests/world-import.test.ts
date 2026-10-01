import { describe, expect, test } from "bun:test";
import { loadAllMaps } from "../importer/source.ts";
import { buildOutdoorWorldIndex } from "../importer/world.ts";
import {
  outdoorWorldContentHash,
  outdoorWorldMapRelation,
  validateOutdoorWorldIndex,
  type OutdoorWorldIndex,
} from "../importer/world-schema.ts";

const SOURCE_REVISION = "9e6258ff726b786040a267e8bdbbf037b560285e";

function build() {
  return buildOutdoorWorldIndex(loadAllMaps(), { sourceRevision: SOURCE_REVISION });
}

function world(index: OutdoorWorldIndex, id: string) {
  const value = index.worlds.find((candidate) => candidate.worldId === id);
  if (!value) throw new Error(`missing world ${id}`);
  return value;
}

describe("Tuxemon outdoor world index", () => {
  test("reproduces S5's complete topology census", () => {
    const { index, report } = build();
    expect(validateOutdoorWorldIndex(index)).toBe(index);
    expect(report.totals).toEqual({
      worlds: 4,
      sourceMembers: 139,
      outdoorMaps: 67,
      excludedIndoorMaps: 72,
      geometricContacts: 91,
      acceptedSeams: 71,
      rejectedGeometricContacts: 20,
      rejectedOverlaps: 0,
      rejectedGaps: 14,
      dimensionCorrections: 49,
      outdoorDimensionCorrections: 20,
      portals: 452,
      coordinatePreservingSeams: 41,
      mixedHandoffSeams: 1,
      portalOnlySeams: 19,
      directionOnlySeams: 10,
      coordinatePreservingOpenings: 258,
      portalOnlyOpenings: 39,
      ambiguousDirections: 1,
    });
    expect(report.worlds.map((entry) => ({
      id: entry.worldId,
      maps: entry.outdoorMaps,
      contacts: entry.geometricContacts,
      seams: entry.acceptedSeams,
      components: entry.componentSizes,
    }))).toEqual([
      { id: "classic", maps: 15, contacts: 15, seams: 15, components: [15] },
      { id: "eclipse", maps: 12, contacts: 14, seams: 9, components: [8, 1, 1, 1, 1] },
      { id: "normal", maps: 17, contacts: 18, seams: 15, components: [16, 1] },
      { id: "spyder", maps: 23, contacts: 44, seams: 32, components: [23] },
    ]);
    expect(report.s5Comparison).toEqual({
      expectedSeams: 71,
      actualSeams: 71,
      matches: true,
      differences: [],
    });
  });

  test("allowlists the Classic Route 1 to Hearthrock physical seam", () => {
    const classic = world(build().index, "classic");
    const seam = classic.seams.find((candidate) =>
      candidate.a === "classic_hearthrock_city" && candidate.b === "classic_route_1"
    );
    expect(seam).toMatchObject({
      a: "classic_hearthrock_city",
      sideA: "north",
      spanA: { start: 0, end: 40 },
      b: "classic_route_1",
      sideB: "south",
      spanB: { start: 0, end: 40 },
      coordinateMapping: { axis: "x", offsetAtoB: 0 },
    });
    expect(seam!.evidence.filter((entry) => entry.kind === "transition_teleport")).toHaveLength(2);
    expect(seam!.handoff).toMatchObject({
      mode: "portal-only",
      openings: [
        { compatibility: "portal-only", issues: ["fixed-destination"] },
        { compatibility: "portal-only", issues: ["fixed-destination"] },
      ],
    });
    expect(classic.adjacency.classic_route_1).toContain("classic_hearthrock_city");
  });

  test("rejects portal-shaped and wrong-side geometric false contacts", () => {
    const index = build().index;
    const normal = world(index, "normal");
    const routeTaba = normal.diagnostics.rejectedContacts.find((candidate) =>
      candidate.a === "route1" && candidate.b === "taba_town"
    );
    expect(routeTaba).toMatchObject({
      geometry: "edge",
      code: "portal-away-from-edge",
      sideA: "east",
      sideB: "west",
    });
    expect(routeTaba!.portalIds).toContain("route1:tmx:route1.tmx:23:a0");
    expect(routeTaba!.portalIds).toContain("taba_town:tmx:taba_town.tmx:80:a0");
    expect(normal.seams.some((seam) => seam.a === "route1" && seam.b === "taba_town")).toBeFalse();

    const spyder = world(index, "spyder");
    const candyDiamond = spyder.diagnostics.rejectedContacts.find((candidate) =>
      candidate.a === "spyder_candy_port" && candidate.b === "spyder_diamond_hill"
    );
    expect(candyDiamond).toMatchObject({
      geometry: "edge",
      code: "wrong-side-direction",
      sideA: "west",
      sideB: "east",
    });
  });

  test("pins all twenty geometric false contacts", () => {
    const index = build().index;
    const pairs = (worldId: string) => world(index, worldId).diagnostics.rejectedContacts
      .filter((entry) => entry.geometry === "edge")
      .map((entry) => `${entry.a}--${entry.b}`);
    expect(pairs("eclipse")).toEqual([
      "eclipse_park--eclipse_routei",
      "eclipse_park_south--eclipse_routeh",
      "eclipse_routef--eclipse_routeg",
      "eclipse_routeg--eclipse_routeh",
      "eclipse_routeh--eclipse_routei",
    ]);
    expect(pairs("normal")).toEqual([
      "citypark--cotton_town",
      "cotton_town--leather_town",
      "route1--taba_town",
    ]);
    expect(pairs("spyder")).toEqual([
      "spyder_candy_port--spyder_diamond_hill",
      "spyder_candy_town--spyder_diamond_hill",
      "spyder_candy_town--spyder_dryadsgrove",
      "spyder_citypark--spyder_cotton_town",
      "spyder_cotton_town--spyder_leather_town",
      "spyder_dryadsgrove--spyder_route6",
      "spyder_flower_city--spyder_routeb",
      "spyder_route4--spyder_routed",
      "spyder_route6--spyder_routeb",
      "spyder_route6--spyder_routee",
      "spyder_routeb--spyder_routed",
      "spyder_routeb--spyder_timber_town",
    ]);
  });

  test("uses actual TMX dimensions and excludes inside maps", () => {
    const spyder = world(build().index, "spyder");
    expect(spyder.maps.find((map) => map.mapId === "spyder_routeb")).toEqual({
      mapId: "spyder_routeb",
      directionSlug: "routeb",
      directions: { north: [], east: [], south: [], west: [] },
      originTileX: 40,
      originTileY: 80,
      width: 20,
      height: 40,
    });
    expect(spyder.diagnostics.dimensionCorrections.find((entry) => entry.mapId === "spyder_routeb")).toEqual({
      mapId: "spyder_routeb",
      reason: "stale-size",
      declaredPixels: { width: 256, height: 640 },
      actualPixels: { width: 320, height: 640 },
    });
    expect(spyder.diagnostics.dimensionCorrections.find((entry) => entry.mapId === "spyder_routea")).toMatchObject({
      reason: "zero-size",
      declaredPixels: { width: 0, height: 0 },
      actualPixels: { width: 320, height: 640 },
    });
    expect(spyder.maps.some((map) => map.mapId === "spyder_nimrod_bottom")).toBeFalse();
    expect(spyder.excludedMaps.find((map) => map.mapId === "spyder_nimrod_bottom")).toMatchObject({
      width: 18,
      height: 20,
      reason: "inside",
    });
  });

  test("records portal- and direction-linked gaps without promoting them", () => {
    const index = build().index;
    const normal = world(index, "normal");
    expect(normal.diagnostics.rejectedContacts.find((entry) =>
      entry.a === "dryadsgrove" && entry.b === "taba_town"
    )).toMatchObject({ geometry: "gap", code: "gap" });
    expect(normal.seams.some((seam) =>
      seam.a === "dryadsgrove" && seam.b === "taba_town"
    )).toBeFalse();

    const spyder = world(index, "spyder");
    expect(spyder.diagnostics.rejectedContacts.find((entry) =>
      entry.a === "spyder_diamond_hill" && entry.b === "spyder_routec"
    )).toMatchObject({
      geometry: "gap",
      code: "gap",
      portalIds: [],
      directionEvidence: [{
        sourceMap: "spyder_diamond_hill",
        targetMap: "spyder_routec",
        side: "east",
        value: "routec",
      }],
    });

    const eclipse = world(index, "eclipse");
    expect(eclipse.diagnostics.rejectedContacts.filter((entry) => entry.geometry === "gap")).toHaveLength(0);
    expect(eclipse.diagnostics.ambiguousDirections).toEqual([{
      sourceMap: "eclipse_obsidian_town",
      side: "east",
      value: "lion_mountain",
      candidateMaps: [
        "eclipse_lion_mountain_high",
        "eclipse_lion_mountain_low",
        "eclipse_lion_mountain_middle",
      ],
      reason: "Cardinal token \"lion_mountain\" matches 3 outdoor maps and has 0 geometrically aligned candidates; no unique target was chosen.",
    }]);
  });

  test("classifies corrected edge, overlap, and gap geometry", () => {
    const map = (mapId: string, originTileX: number, originTileY: number) => ({
      mapId,
      directionSlug: mapId,
      directions: { north: [], east: [], south: [], west: [] },
      originTileX,
      originTileY,
      width: 10,
      height: 10,
    });
    expect(outdoorWorldMapRelation(map("a", 0, 0), map("b", 10, 2))).toMatchObject({
      geometry: "edge",
      sideA: "east",
      sideB: "west",
      globalSpan: { start: 2, end: 10 },
    });
    expect(outdoorWorldMapRelation(map("a", 0, 0), map("b", 9, 9))).toEqual({
      geometry: "overlap",
      width: 1,
      height: 1,
    });
    expect(outdoorWorldMapRelation(map("a", 0, 0), map("b", 11, 10))).toEqual({
      geometry: "gap",
      gapX: 1,
      gapY: 0,
    });
  });

  test("classifies each portal opening before W2 handoff", () => {
    const index = build().index;
    const classic = world(index, "classic");
    const fixed = classic.seams.find((entry) => entry.a === "classic_route_3" && entry.b === "classic_route_4")!;
    expect(fixed.handoff.mode).toBe("portal-only");
    expect(fixed.handoff.openings).toHaveLength(2);
    expect(fixed.handoff.openings.every((opening) => opening.issues.includes("fixed-destination"))).toBeTrue();
    expect(fixed.handoff.openings.every((opening) => opening.issues.includes("wrong-target-edge"))).toBeTrue();

    const normal = world(index, "normal");
    const exact = normal.seams.find((entry) => entry.a === "citypark" && entry.b === "leather_town")!;
    expect(exact.handoff.mode).toBe("coordinate-preserving");
    expect(exact.handoff.openings.every((opening) =>
      opening.compatibility === "coordinate-preserving" && opening.issues.length === 0
    )).toBeTrue();
  });

  test("rejects self-consistently rehashed relational corruption", () => {
    const first = build().index;

    const unrelatedPortal = structuredClone(first);
    const classic = world(unrelatedPortal, "classic");
    const seam = classic.seams.find((entry) => entry.a === "classic_aerolume_city" && entry.b === "classic_route_5")!;
    const evidence = seam.evidence.find((entry) => entry.kind === "transition_teleport")!;
    evidence.portalId = classic.portals.find((portal) =>
      portal.sourceMap === "classic_hearthrock_city" && portal.targetMap !== "classic_route_1"
    )!.id;
    unrelatedPortal.contentHash = outdoorWorldContentHash(unrelatedPortal);
    expect(() => validateOutdoorWorldIndex(unrelatedPortal)).toThrow("portal evidence endpoints do not match seam");

    const arbitraryDirection = structuredClone(first);
    const eclipse = world(arbitraryDirection, "eclipse");
    const direction = eclipse.seams.flatMap((entry) => entry.evidence)
      .find((entry) => entry.kind === "direction-property")!;
    direction.value = "not-the-target";
    arbitraryDirection.contentHash = outdoorWorldContentHash(arbitraryDirection);
    expect(() => validateOutdoorWorldIndex(arbitraryDirection)).toThrow("direction evidence value does not name its target");

    const fabricatedDirection = structuredClone(first);
    const fabricatedClassic = world(fabricatedDirection, "classic");
    const fabricatedSeam = fabricatedClassic.seams.find((entry) =>
      entry.a === "classic_aerolume_city" && entry.b === "classic_route_5"
    )!;
    fabricatedSeam.evidence.push({
      kind: "direction-property",
      sourceMap: fabricatedSeam.a,
      targetMap: fabricatedSeam.b,
      side: fabricatedSeam.sideA,
      value: fabricatedClassic.maps.find((map) => map.mapId === fabricatedSeam.b)!.directionSlug,
    });
    fabricatedSeam.evidence.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    fabricatedDirection.contentHash = outdoorWorldContentHash(fabricatedDirection);
    expect(() => validateOutdoorWorldIndex(fabricatedDirection)).toThrow("direction evidence is not present in source declarations");

    const falseGeometry = structuredClone(first);
    const routeTaba = world(falseGeometry, "normal").diagnostics.rejectedContacts.find((entry) =>
      entry.a === "route1" && entry.b === "taba_town"
    )!;
    routeTaba.geometry = "gap";
    routeTaba.code = "gap";
    falseGeometry.contentHash = outdoorWorldContentHash(falseGeometry);
    expect(() => validateOutdoorWorldIndex(falseGeometry)).toThrow("geometry does not match corrected rectangles");

    const missingGap = structuredClone(first);
    const missingNormal = world(missingGap, "normal");
    missingNormal.diagnostics.rejectedContacts = missingNormal.diagnostics.rejectedContacts.filter((entry) =>
      !(entry.a === "dryadsgrove" && entry.b === "taba_town")
    );
    missingGap.contentHash = outdoorWorldContentHash(missingGap);
    expect(() => validateOutdoorWorldIndex(missingGap)).toThrow("linked gap dryadsgrove/taba_town is missing a diagnostic");
  });

  test("is byte/hash stable and rejects stale content hashes", () => {
    const first = build().index;
    const second = build().index;
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const stale = structuredClone(first);
    stale.sourceRevision = `${stale.sourceRevision}-tampered`;
    expect(() => validateOutdoorWorldIndex(stale)).toThrow("contentHash does not match canonical payload");
  });
});
