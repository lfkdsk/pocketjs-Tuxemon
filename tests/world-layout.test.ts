import { describe, expect, test } from "bun:test";
import {
  localToWorld,
  validateWorldLayout,
  worldToLocal,
  type Project,
  type WorldComponent,
} from "../vendor/pocket-rpgkit/src/engine/index.ts";
import { splitProjectMaps } from "../vendor/pocket-rpgkit/tools/lib/map-project.ts";
import { buildProject } from "../importer/project.ts";
import { loadAllMaps } from "../importer/source.ts";
import { buildOutdoorWorldIndex } from "../importer/world.ts";
import { projectOutdoorWorldLayout } from "../importer/world-layout.ts";

const SOURCE_REVISION = "9e6258ff726b786040a267e8bdbbf037b560285e";
const source = buildOutdoorWorldIndex(loadAllMaps(), { sourceRevision: SOURCE_REVISION }).index;
const layout = projectOutdoorWorldLayout(source)!;

const pairKey = (a: string, b: string): string => [a, b].sort().join("--");
const seamKey = (seam: { mapA: string; sideA: string; mapB: string; sideB: string }): string =>
  `${seam.mapA}:${seam.sideA}--${seam.mapB}:${seam.sideB}`;
const sourceSeamKey = (seam: { a: string; sideA: string; b: string; sideB: string }): string =>
  `${seam.a}:${seam.sideA}--${seam.b}:${seam.sideB}`;

function components(worldId: string): WorldComponent[] {
  return layout.components.filter((component) => component.worldId === worldId);
}

describe("runtime WorldLayout projection", () => {
  test("preserves the complete topology census and exact source membership", () => {
    expect(validateWorldLayout(layout)).toBe(layout);
    expect(layout.topologyHash).toBe("c681c230fe432bbbf8809fe11a5bbc42fc8eb4f62c2ec1a6be141fd0c35f2143");
    expect([...new Set(layout.components.map((component) => component.worldId))]).toEqual([
      "classic",
      "eclipse",
      "normal",
      "spyder",
    ]);

    const census = ["classic", "eclipse", "normal", "spyder"].map((worldId) => {
      const group = components(worldId);
      const openings = group.flatMap((component) => component.openings);
      return {
        worldId,
        componentSizes: group.map((component) => component.placements.length).sort((a, b) => b - a),
        placements: group.reduce((sum, component) => sum + component.placements.length, 0),
        seams: group.reduce((sum, component) => sum + component.seams.length, 0),
        safe: openings.filter((opening) => opening.compatibility === "coordinate-preserving").length,
        portalOnly: openings.filter((opening) => opening.compatibility === "portal-only").length,
      };
    });
    expect(census).toEqual([
      { worldId: "classic", componentSizes: [15], placements: 15, seams: 15, safe: 0, portalOnly: 30 },
      { worldId: "eclipse", componentSizes: [8, 1, 1, 1, 1], placements: 12, seams: 9, safe: 0, portalOnly: 0 },
      { worldId: "normal", componentSizes: [16, 1], placements: 17, seams: 15, safe: 104, portalOnly: 4 },
      { worldId: "spyder", componentSizes: [23], placements: 23, seams: 32, safe: 154, portalOnly: 5 },
    ]);

    const projectedSeams = layout.components.flatMap((component) => component.seams.map(seamKey)).sort();
    const sourceSeams = source.worlds.flatMap((world) => world.seams.map(sourceSeamKey)).sort();
    expect(projectedSeams).toEqual(sourceSeams);
    const projectedOpeningIds = layout.components.flatMap((component) =>
      component.openings.map((opening) => opening.portalId)
    ).sort();
    const sourceOpeningIds = source.worlds.flatMap((world) =>
      world.seams.flatMap((seam) => seam.handoff.openings.map((opening) => opening.portalId))
    ).sort();
    expect(projectedOpeningIds).toEqual(sourceOpeningIds);
  });

  test("keeps negative origins and directional offsets signed", () => {
    const normal = components("normal");
    const route1 = normal.flatMap((component) => component.placements)
      .find((placement) => placement.mapId === "route1")!;
    expect(route1).toEqual({
      mapId: "route1",
      originTileX: -1,
      originTileY: 0,
      width: 59,
      height: 42,
    });
    expect(localToWorld(route1, { x: 0, y: 0 })).toEqual({ x: -1, y: 0 });
    expect(worldToLocal(route1, { x: -1, y: 0 })).toEqual({ x: 0, y: 0 });

    const reverse = normal.flatMap((component) => component.openings)
      .find((opening) => opening.portalId === "leather_town:tmx:leather_town.tmx:75:a0")!;
    expect(reverse).toMatchObject({
      source: { mapId: "leather_town" },
      target: { mapId: "citypark" },
      axis: "y",
      offset: -20,
      compatibility: "coordinate-preserving",
    });
  });

  test("retains per-opening safety on the one mixed seam", () => {
    const mixed = components("normal").flatMap((component) => component.seams)
      .find((seam) => seam.mapA === "flower_city" && seam.mapB === "routea")!;
    const openingById = new Map(components("normal").flatMap((component) => component.openings)
      .map((opening) => [opening.portalId, opening]));
    const openings = mixed.openingIds.map((id) => openingById.get(id)!);
    expect(openings).toHaveLength(5);
    expect(openings.filter((opening) => opening.compatibility === "coordinate-preserving")).toHaveLength(4);
    expect(openings.filter((opening) => opening.compatibility === "portal-only").map((opening) => opening.portalId))
      .toEqual(["routea:tmx:routea.tmx:45:a0"]);
  });

  test("does not promote gaps, rejected contacts or overlaps into layout seams", () => {
    const gaps = source.worlds.flatMap((world) => world.diagnostics.rejectedContacts)
      .filter((contact) => contact.geometry === "gap");
    const rejected = source.worlds.flatMap((world) => world.diagnostics.rejectedContacts)
      .filter((contact) => contact.geometry === "edge");
    const overlaps = source.worlds.flatMap((world) => world.diagnostics.rejectedContacts)
      .filter((contact) => contact.geometry === "overlap");
    expect(gaps.map((gap) => pairKey(gap.a, gap.b)).sort()).toEqual([
      "dryadsgrove--leather_town",
      "dryadsgrove--taba_town",
      "flower_city--leather_town",
      "flower_city--timber_town",
      "spyder_candy_port--spyder_flower_city",
      "spyder_candy_port--spyder_leather_town",
      "spyder_candy_port--spyder_paper_town",
      "spyder_candy_port--spyder_timber_town",
      "spyder_diamond_hill--spyder_routec",
      "spyder_flower_city--spyder_leather_town",
      "spyder_flower_city--spyder_paper_town",
      "spyder_leather_town--spyder_paper_town",
      "spyder_leather_town--spyder_timber_town",
      "spyder_paper_town--spyder_timber_town",
    ]);
    expect(rejected).toHaveLength(20);
    expect(overlaps).toHaveLength(0);
    const projectedPairs = new Set(layout.components.flatMap((component) =>
      component.seams.map((seam) => pairKey(seam.mapA, seam.mapB))
    ));
    for (const contact of [...gaps, ...rejected]) {
      expect(projectedPairs.has(pairKey(contact.a, contact.b)), `${contact.a}/${contact.b}`).toBeFalse();
    }

    const mutated = structuredClone(layout);
    const normal = mutated.components.find((component) => component.worldId === "normal")!;
    const route1 = normal.placements.find((placement) => placement.mapId === "route1")!;
    const neighbor = normal.placements.find((placement) => placement.mapId !== "route1")!;
    route1.originTileX = neighbor.originTileX;
    route1.originTileY = neighbor.originTileY;
    expect(() => validateWorldLayout(mutated)).toThrow("overlap");
  });

  test("is deterministic and stays outside every MapDef shard", () => {
    const before = JSON.stringify(source);
    expect(JSON.stringify(projectOutdoorWorldLayout(source))).toBe(JSON.stringify(layout));
    expect(JSON.stringify(source)).toBe(before);

    const imported = buildProject(["spyder_paper_town"]);
    expect(imported.project.worldLayout?.topologyHash).toBe(source.contentHash);
    expect(imported.project.worldLayout?.components.flatMap((component) => component.placements)
      .map((placement) => placement.mapId)).toEqual(["spyder_paper_town"]);
    const withLayout = splitProjectMaps(imported.project);
    const { worldLayout: _worldLayout, ...withoutLayoutGlobals } = imported.project;
    const withoutLayout = splitProjectMaps(withoutLayoutGlobals as Project);
    expect(withLayout.entries.map((entry) => entry.text)).toEqual(withoutLayout.entries.map((entry) => entry.text));
    expect(withLayout.entries.map((entry) => entry.meta.sha256)).toEqual(
      withoutLayout.entries.map((entry) => entry.meta.sha256),
    );
    expect(withLayout.shell.mapManifestHash).not.toBe(withoutLayout.shell.mapManifestHash);

    const changedTopology = structuredClone(imported.project);
    changedTopology.worldLayout!.topologyHash = "f".repeat(64);
    const changed = splitProjectMaps(changedTopology);
    expect(changed.entries.map((entry) => entry.meta.sha256)).toEqual(
      withLayout.entries.map((entry) => entry.meta.sha256),
    );
    expect(changed.shell.mapManifestHash).not.toBe(withLayout.shell.mapManifestHash);
  });
});
