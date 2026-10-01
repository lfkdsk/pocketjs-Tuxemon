import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { Project } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import { applyTerrain, importTerrain, TERRAIN_SHEET_ID } from "../importer/terrain.ts";

const revision = "9e6258ff726b786040a267e8bdbbf037b560285e";

function buildDigest(build: ReturnType<typeof importTerrain>): string {
  const hash = createHash("sha256");
  for (const entry of build.entries) {
    hash.update(entry.key);
    hash.update(entry.blob);
  }
  hash.update(JSON.stringify(build.streamMaps));
  hash.update(JSON.stringify(build.fragment));
  hash.update(JSON.stringify(build.animations));
  for (const sequence of build.animationSequences) {
    hash.update(sequence.id);
    for (const frame of sequence.frames) {
      hash.update(String(frame.durationMs));
      hash.update(frame.rgba);
    }
  }
  hash.update(JSON.stringify(build.report));
  return hash.digest("hex");
}

describe("Tuxemon terrain import", () => {
  test("imports the complete pinned corpus", () => {
    const build = importTerrain();
    expect(build.report.sourceRevision).toBe(revision);
    expect(build.report.maps).toBe(263);
    expect(build.report.cells).toBe(175_093);
    expect(build.report.entries).toBe(430);
    expect(build.report.quantizedChunks).toBe(14);
    // First-frame rendering includes animated definitions whose placeholder
    // tile is transparent (notably the 1,488 water cells omitted by Scout S2).
    expect(build.report.animatedCellsBakedAtFirstFrame).toBe(5_785);
    expect(build.report.flipCells).toBe(1_033);
    expect(build.report.collisionLineEdges).toBe(619);
    expect(build.report.yamlCollisionCells).toBe(21);
    expect(build.report.labelledCollisionCells).toBe(14);
    expect(build.report.oneWayEdgesEncoded).toBe(1_161);
    expect(build.report.directedEdgeMismatches).toBe(0);
    expect(Object.keys(build.fragment.sheet.dirEdges ?? {})).not.toHaveLength(0);
    expect(build.animationSequences).toHaveLength(86);
    expect(build.animationSequences.every((sequence) =>
      sequence.frames.length >= 2 && sequence.frames.every((frame) => frame.rgba.byteLength === 16 * 16 * 4)
    )).toBeTrue();
    expect(build.fragment.maps[0]!.id).toBe("37707_tower");
    expect(build.fragment.maps.at(-1)!.id).toBe("witcher_route_7");
  }, 20_000);

  test("selected-map cook is byte deterministic", () => {
    const mapIds = ["taba_house1", "taba_town", "buddha_mountain", "tt_searoute1", "spyder_timber_town", "route3"];
    const first = importTerrain({ mapIds });
    const second = importTerrain({ mapIds });
    expect(buildDigest(second)).toBe(buildDigest(first));
    expect(first.streamMaps.map((map) => map.id)).toEqual([...mapIds].sort());
  });

  test("animation placeholders bake their first visible frame", () => {
    const build = importTerrain({ mapIds: ["water_end_of_desert"] });
    expect(build.report.byMap.water_end_of_desert!.animatedCells).toBe(1_488);
    expect(build.animations.water_end_of_desert).toHaveLength(1_488);
    expect(build.report.byMap.water_end_of_desert!.ground.absent).toBeLessThan(
      build.report.byMap.water_end_of_desert!.ground.entries,
    );
  });

  test("labelled collision cells remain removable event bodies", () => {
    const build = importTerrain({ mapIds: ["spyder_candy_hospital3"] });
    const map = build.fragment.maps[0]!;
    expect(map.collisionLabels.screen).toEqual([173, 174]);
    const staticBlocks = new Set(map.passage.filter(([, flag]) => flag === "block").map(([index]) => index));
    expect(staticBlocks.has(173)).toBeFalse();
    expect(staticBlocks.has(174)).toBeFalse();
    expect(build.report.byMap.spyder_candy_hospital3!.directedEdgeMismatches).toBe(0);
  });

  test("indexes every authored surface label independently from collision keys", () => {
    const build = importTerrain({ mapIds: ["spyder_citypark"] });
    expect(build.fragment.maps[0]!.surfaceLabels).toEqual({
      surfable: [
        322, 323, 324, 325, 326, 327, 328, 329, 330,
        362, 363, 364, 365, 366, 367, 368,
        402, 403, 404, 405, 406, 407, 408,
      ],
    });
    expect(build.fragment.maps[0]!.collisionLabels).toEqual({});
  });

  test("merges legacy same-name YAML collision rectangles after TMX", () => {
    const build = importTerrain({ mapIds: ["spyder_paper_manor"] });
    const map = build.fragment.maps[0]!;
    const blocked = new Set(map.passage.filter(([, flag]) => flag === "block").map(([index]) => index));
    expect(build.report.byMap.spyder_paper_manor!.yamlCollisionCells).toBe(21);
    expect(blocked.has(4 * 10 + 2)).toBeTrue();
    expect(blocked.has(1 * 10 + 9)).toBeTrue();
    expect(blocked.has(7 * 10 + 0)).toBeTrue();
  });

  test("applyTerrain replaces only terrain fields on a G1 document", () => {
    const build = importTerrain({ mapIds: ["taba_house1"] });
    const placeholder = Array<string | null>(9 * 7).fill(null);
    const project: Project = {
      format: "rpgkit-project/v1",
      title: "fixture",
      tileSize: 16,
      start: { map: "taba_house1", x: 4, y: 4, dir: "down" },
      sheets: [{ id: "placeholder", cols: 1, rows: 1 }],
      items: [],
      maps: [{
        id: "taba_house1",
        name: "kept name",
        width: 9,
        height: 7,
        sheets: ["placeholder"],
        ground: placeholder,
        passage: [[0, "pass"]],
        events: [{ id: "kept", x: 1, y: 1, pages: [{ trigger: "action", commands: [] }] }],
      }],
    };
    const merged = applyTerrain(project, build.fragment);
    expect(merged.maps[0]!.name).toBe("kept name");
    expect(merged.maps[0]!.events?.[0]?.id).toBe("kept");
    expect(merged.maps[0]!.ground).toEqual(build.fragment.maps[0]!.ground);
    expect(merged.maps[0]!.passage).toEqual(build.fragment.maps[0]!.passage);
    expect(merged.maps[0]!.passage).not.toContainEqual([0, "pass"]);
    expect(merged.maps[0]!.sheets).toContain(TERRAIN_SHEET_ID);
    expect(merged.sheets.at(-1)?.id).toBe(TERRAIN_SHEET_ID);
  });

  test("rejects unknown requested map ids", () => {
    expect(() => importTerrain({ mapIds: ["not-a-tuxemon-map"] })).toThrow("missing TMX maps");
  });
});
