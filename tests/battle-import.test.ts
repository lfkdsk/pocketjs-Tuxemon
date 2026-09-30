import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { battleArtifactPaths, runtimeBattleDb, writeBattleArtifacts } from "../importer/battle.ts";
import { collectBattleArtRefs, validateBattleDb, type BattleDb } from "../importer/battle-schema.ts";
import { decodePng } from "../importer/png.ts";
import { BATTLE_PREVIEW_HEIGHT, BATTLE_PREVIEW_WIDTH, renderBattlePreview } from "../tools/render-battle-preview.ts";
import { BATTLE_ASSET_PATHS } from "../ui/battle-assets.ts";

const ROOT = resolve(import.meta.dir, "..");
const db = JSON.parse(readFileSync(join(ROOT, "data/battle-db.json"), "utf8")) as unknown;
const runtimeDb = JSON.parse(readFileSync(join(ROOT, "data/battle-runtime-db.json"), "utf8")) as unknown;
const report = JSON.parse(readFileSync(join(ROOT, "data/battle-assets-report.json"), "utf8"));
const images = JSON.parse(readFileSync(join(ROOT, "images.json"), "utf8")) as Record<string, { psm: number }>;
const pakManifest = JSON.parse(readFileSync(join(ROOT, "pak.json"), "utf8")) as Array<{ key: string; file: string }>;
const battleKeys = new Set(BATTLE_ASSET_PATHS.map((path) => `ui:img.${path}`));
const validated = validateBattleDb(db, battleKeys);

describe("GB1 battle database", () => {
  test("derives a byte-stable reducer-only production projection", () => {
    expect(runtimeDb).toEqual(runtimeBattleDb(validated));
    expect(report.runtimeDbBytes).toBe(readFileSync(join(ROOT, "data/battle-runtime-db.json")).byteLength);
  });

  test("matches the generated Spyder campaign slice", () => {
    expect(report.scope).toBe("spyder");
    expect(report.sourceRevision).toBe("9e6258ff726b786040a267e8bdbbf037b560285e");
    expect(report.counts).toEqual({
      monsters: 214,
      techniques: 230,
      items: 82,
      elements: 13,
      tastes: 12,
      statuses: 35,
      encounters: 21,
      npcs: 205,
      environments: 8,
      trainerParties: 213,
      trainerMonsterSlots: 611,
      battleSlots: 283,
      randomEncounterUses: 261,
      wildEncounterUses: 17,
    });
    expect(report.art.categories["monster-sheets"].sourceFiles).toBe(214);
    expect(report.art.categories["technique-animations"].sourceFiles).toBe(126);
    expect(report.art.categories.backgrounds.sourceFiles).toBe(8);
    expect(report.art.categories.islands.sourceFiles).toBe(6);
    expect(report.art.categories["trainer-sheets"].sourceFiles).toBe(61);
    expect(report.art.sourceBytes).toBe(1_598_170);
  });

  test("retains the stat, move, capture, status, and encounter rule inputs", () => {
    expect(validated.rules).toMatchObject({
      levelRange: [0, 100],
      trainingPoints: { maxPerStat: 150, maxTotal: 300, defaultGain: 1 },
      statCoefficient: 7,
      ivRange: [0, 15],
      sizeVariation: { height: [-0.1, 0.1], weight: [-0.1, 0.1] },
      maxMoves: 4,
      catchRateRange: [0, 100],
      catchResistanceRange: [0, 2],
      experience: {
        acquisitionMultipliers: { captured: 1, traded: 1.5, gifted: 1.2 },
        groups: { default: { multiplier: 1, experienceCoefficient: 3 } },
      },
      actionOrder: {
        sortOrder: ["potion", "utility", "quest", "meta", "damage"],
        speedTiers: { extremely_slow: -3, normal: 0, extremely_fast: 3 },
        speedFactor: 0.25,
        dodgeModifier: 0.01,
        baseSpeedBonus: 1,
        minSpeedModifier: 1,
      },
      damage: {
        affinityMultiplierRange: [0.25, 4],
        rangeMap: {
          melee: { user: { stat: "melee", weight: 1 }, target: { stat: "armour", weight: 1 } },
          reliable: { user: { stat: "level", weight: 1 }, target: { stat: "resist", weight: 1 } },
        },
      },
    });
    expect(validated.shapes.hunter).toEqual({ armour: 4, dodge: 8, hp: 5, melee: 8, ranged: 4, speed: 7 });
    expect(validated.monsters.rockitten).toMatchObject({
      shape: "hunter",
      stage: "basic",
      types: ["earth"],
      catchRate: 100,
      catchResistance: [0.95, 1.25],
    });
    expect(validated.monsters.rockitten.moveset.map((move) => move.technique)).toContain("mudslide");
    expect(validated.techniques.ram).toMatchObject({
      accuracy: 1,
      power: 1.5,
      range: "melee",
      recharge: 1,
      effects: [{ type: "damage" }],
    });
    expect(validated.statuses.grabbed).toMatchObject({ bond: true, category: "negative" });
    expect(validated.rules.capture).toMatchObject({ total_shakes: 4, shake_constant: 524325, shake_divisor: 65536 });
    expect(validated.rules.captureDevices).toMatchObject({
      statusModifier: 1,
      deviceModifier: 1,
      items: { tuxeball: { specific_capdev_modifier: 1, negative_modifier: 1.2 } },
    });
    expect(validated.elements.fire.multipliers).toMatchObject({ earth: 0.5, metal: 2, water: 0.5, wood: 2 });
    expect(validated.encounters.spyder_route1.monsters.map((row) => row.weight)).toEqual([3.5, 3.5, 3.5, 3.5, 3.5, 3.5]);
  });

  test("resolves variable trainer species and every spawn move", () => {
    const firstFight = validated.trainerParties.find((party) =>
      party.opponent === "spyder_billie" && party.party.length === 1 && party.party[0]?.level === 5
    );
    expect(firstFight?.party[0]).toMatchObject({
      speciesVariable: "billie_choice",
      level: 5,
      experienceModifier: 5,
      moneyModifier: 10,
    });
    expect(firstFight?.party[0]?.species).toHaveLength(10);
    expect(firstFight?.party[0]?.species).toEqual(expect.arrayContaining(["budaye", "dollfin", "grintot", "ignibus", "memnomnom"]));
    // validateBattleDb above computes every trainer's four at-spawn moves and
    // rejects a missing technique. Keep one concrete first-fight assertion too.
    expect(validated.monsters.budaye.moveset.filter((move) => move.level <= 5).map((move) => move.technique))
      .toEqual(["struggle", "stick", "clamp_on"]);
  });

  test("puts every battle art reference in the generated pak input set", () => {
    const files = battleArtifactPaths(ROOT);
    expect(files).toEqual([...BATTLE_ASSET_PATHS]);
    expect(new Set(collectBattleArtRefs(validated).map((ref) => ref.key))).toEqual(battleKeys);
    expect(pakManifest).toContainEqual({ key: "game:battle-db", file: "data/battle-db.json" });
    expect(report.art.files).toBe(files.length);
    for (const relative of files) {
      expect(images[relative]?.psm, relative).toBe(2);
      const image = decodePng(new Uint8Array(readFileSync(join(ROOT, relative))), relative);
      expect(image.width & (image.width - 1), relative).toBe(0);
      expect(image.height & (image.height - 1), relative).toBe(0);
      expect(image.width, relative).toBeLessThanOrEqual(512);
      expect(image.height, relative).toBeLessThanOrEqual(512);
    }
  }, 30_000);

  test("renders a byte-stable battle acceptance sheet with semantic pixels", () => {
    const generated = renderBattlePreview(ROOT);
    const committed = new Uint8Array(readFileSync(join(ROOT, "findings/GB1-preview.png")));
    expect(generated).toEqual(committed);
    const preview = decodePng(generated, "GB1-preview.png");
    expect([preview.width, preview.height]).toEqual([BATTLE_PREVIEW_WIDTH, BATTLE_PREVIEW_HEIGHT]);

    // Uncovered grass at source (8,100) is copied exactly into the 2x scene.
    const grass = decodePng(new Uint8Array(readFileSync(join(ROOT, "assets/battle/gfx/ui/combat/grass_background.png"))), "grass");
    expect([...preview.rgba.slice((200 * preview.width + 16) * 4, (200 * preview.width + 16) * 4 + 4)])
      .toEqual([...grass.rgba.slice((100 * grass.width + 8) * 4, (100 * grass.width + 8) * 4 + 4)]);

    // Every fully opaque Rockitten back-sprite pixel lands as a 2x2 block at
    // the documented player slot; this detects wrong front/back crops or origin.
    const rockitten = decodePng(new Uint8Array(readFileSync(join(ROOT, "assets/battle/gfx/sprites/battle/rockitten-sheet.png"))), "rockitten");
    let opaque = 0;
    for (let y = 0; y < 64; y++) for (let x = 64; x < 128; x++) {
      const sourceOffset = (y * rockitten.width + x) * 4;
      if (rockitten.rgba[sourceOffset + 3] !== 255) continue;
      opaque++;
      const previewOffset = ((88 + y * 2) * preview.width + 96 + (x - 64) * 2) * 4;
      expect([...preview.rgba.slice(previewOffset, previewOffset + 4)]).toEqual([...rockitten.rgba.slice(sourceOffset, sourceOffset + 4)]);
    }
    expect(opaque).toBeGreaterThan(500);

    // The four 64x64 Ram frames occupy the right-hand animation strip.
    const animation = decodePng(new Uint8Array(readFileSync(join(ROOT, "assets/battle/animations/technique/pound.page-0.png"))), "pound");
    let animationOpaque = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 256; x++) {
      const sourceOffset = (y * animation.width + x) * 4;
      if (animation.rgba[sourceOffset + 3] !== 255) continue;
      animationOpaque++;
      const previewOffset = ((128 + y) * preview.width + 512 + x) * 4;
      expect([...preview.rgba.slice(previewOffset, previewOffset + 4)]).toEqual([...animation.rgba.slice(sourceOffset, sourceOffset + 4)]);
    }
    expect(animationOpaque).toBeGreaterThan(800);
  });
});

const scratchParent = "/var/tmp/fleet/1867";
mkdirSync(scratchParent, { recursive: true });
const fullRoot = mkdtempSync(join(scratchParent, "gb1-full-test-"));
afterAll(() => rmSync(fullRoot, { recursive: true, force: true }));

describe("GB1 full database switch", () => {
  test("imports and validates the complete battle database", () => {
    const full = writeBattleArtifacts({ outputRoot: fullRoot, scope: "full" });
    expect(full.report.counts).toMatchObject({
      monsters: 411,
      techniques: 274,
      items: 224,
      elements: 13,
      tastes: 12,
      statuses: 35,
      encounters: 35,
      npcs: 1_139,
      environments: 40,
    });
    expect(full.report.art.categories["monster-sheets"].sourceFiles).toBe(411);
    expect(full.report.art.categories["technique-animations"].sourceFiles).toBe(141);
    expect(full.report.art.categories["trainer-sheets"].sourceFiles).toBe(76);
    expect(full.report.art.categories.backgrounds.sourceFiles).toBe(37);
    expect(full.report.art.categories.islands.sourceFiles).toBe(14);
    expect(full.report.art.maxWidth).toBeLessThanOrEqual(512);
    expect(full.report.art.maxHeight).toBeLessThanOrEqual(512);
    expect(existsSync(join(fullRoot, "data/battle-db.json"))).toBeTrue();
    expect(existsSync(join(fullRoot, "data/battle-runtime-db.json"))).toBeTrue();
  }, 60_000);
});
