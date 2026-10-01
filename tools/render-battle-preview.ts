// Compose a deterministic GB1 acceptance sheet from the generated battle
// textures.  The left side is a 2x approximation of Tuxemon's 256x144 battle
// layout; the right side exposes trainer, animation, capture, and icon assets.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import { decodePng } from "../importer/png.ts";
import type { BattleDb, BattleImageRef } from "../importer/battle-schema.ts";

const ROOT = resolve(import.meta.dir, "..");
export const BATTLE_PREVIEW_WIDTH = 768;
export const BATTLE_PREVIEW_HEIGHT = 288;

interface SourceRect {
  ref: BattleImageRef;
  rect?: readonly [number, number, number, number];
}

export function battlePreviewSourcePath(root: string, ref: BattleImageRef): string {
  const legacyPrefix = "ui:img.";
  if (ref.key.startsWith(legacyPrefix)) return join(root, ref.key.slice(legacyPrefix.length));
  const tile = /^ui:tile\.([^#]+)#0$/.exec(ref.key);
  if (!tile) throw new Error(`GB1 preview: unsupported image key ${ref.key}`);
  return join(root, "assets", `${tile[1]}.png`);
}

function fill(rgba: Uint8Array, colour: readonly [number, number, number, number]): void {
  for (let offset = 0; offset < rgba.length; offset += 4) rgba.set(colour, offset);
}

function blit(
  root: string,
  output: Uint8Array,
  source: SourceRect,
  dx: number,
  dy: number,
  scale = 1,
): void {
  const image = decodePng(new Uint8Array(readFileSync(battlePreviewSourcePath(root, source.ref))), source.ref.key);
  const [sx, sy, sw, sh] = source.rect ?? source.ref.rect;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const si = ((sy + y) * image.width + sx + x) * 4;
      const alpha = image.rgba[si + 3]!;
      if (alpha === 0) continue;
      for (let oy = 0; oy < scale; oy++) {
        for (let ox = 0; ox < scale; ox++) {
          const px = dx + x * scale + ox;
          const py = dy + y * scale + oy;
          if (px < 0 || py < 0 || px >= BATTLE_PREVIEW_WIDTH || py >= BATTLE_PREVIEW_HEIGHT) continue;
          const di = (py * BATTLE_PREVIEW_WIDTH + px) * 4;
          if (alpha === 255) {
            output.set(image.rgba.subarray(si, si + 4), di);
          } else {
            const inverse = 255 - alpha;
            output[di] = Math.round((image.rgba[si]! * alpha + output[di]! * inverse) / 255);
            output[di + 1] = Math.round((image.rgba[si + 1]! * alpha + output[di + 1]! * inverse) / 255);
            output[di + 2] = Math.round((image.rgba[si + 2]! * alpha + output[di + 2]! * inverse) / 255);
            output[di + 3] = 255;
          }
        }
      }
    }
  }
}

function solidRect(
  output: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: readonly [number, number, number, number],
): void {
  for (let py = y; py < y + height; py++) {
    for (let px = x; px < x + width; px++) output.set(colour, (py * BATTLE_PREVIEW_WIDTH + px) * 4);
  }
}

/** Return the byte-stable PNG used by the report and semantic pixel test. */
export function renderBattlePreview(root = ROOT): Uint8Array {
  const db = JSON.parse(readFileSync(join(root, "data/battle-db.json"), "utf8")) as BattleDb;
  const output = new Uint8Array(BATTLE_PREVIEW_WIDTH * BATTLE_PREVIEW_HEIGHT * 4);
  fill(output, [20, 25, 34, 255]);

  const grass = db.environments.grass!;
  const rockitten = db.monsters.rockitten!.art;
  const budaye = db.monsters.budaye!.art;

  // 256x144 battle field, nearest-neighbour enlarged to 512x288.
  blit(root, output, { ref: grass.background }, 0, 0, 2);
  blit(root, output, { ref: grass.island, rect: [96, 0, 96, 57] }, 64, 102, 2);
  blit(root, output, { ref: grass.island, rect: [0, 0, 96, 57] }, 280, 14, 2);
  blit(root, output, { ref: rockitten.sheet, rect: rockitten.back }, 96, 88, 2);
  blit(root, output, { ref: budaye.sheet, rect: budaye.front }, 312, 0, 2);
  blit(root, output, { ref: grass.hud.player }, 290, 90, 2);
  blit(root, output, { ref: grass.hud.opponent }, 36, 0, 2);
  blit(root, output, { ref: db.ui.hpBar }, 314, 128, 2);
  blit(root, output, { ref: db.ui.hpBar }, 46, 26, 2);
  blit(root, output, { ref: grass.hud.playerTray }, 290, 178, 2);
  blit(root, output, { ref: grass.hud.opponentTray }, 36, 58, 2);
  for (let slot = 0; slot < 3; slot++) {
    blit(root, output, { ref: grass.partyIcons.icon_alive! }, 306 + slot * 16, 180, 2);
    blit(root, output, { ref: grass.partyIcons.icon_alive! }, 52 + slot * 16, 60, 2);
  }
  solidRect(output, 0, 216, 512, 72, [13, 18, 26, 255]);
  solidRect(output, 8, 224, 496, 56, [244, 238, 216, 255]);
  solidRect(output, 16, 232, 480, 40, [35, 42, 50, 255]);

  // Contact sheet proving the remaining UI categories survive normalization.
  solidRect(output, 512, 0, 256, 288, [25, 31, 42, 255]);
  blit(root, output, { ref: db.ui.trainerSheets.adventurer! }, 512, 0);
  const animation = db.techniques.ram!.animation?.pages[0];
  if (!animation) throw new Error("GB1 preview: ram animation missing");
  blit(root, output, { ref: animation }, 512, 128);
  blit(root, output, { ref: db.items.tuxeball!.captureSprite! }, 520, 208, 2);
  blit(root, output, { ref: db.elements.fire!.icon }, 576, 208, 2);
  blit(root, output, { ref: db.statuses.poison!.icon }, 640, 208, 2);
  blit(root, output, { ref: db.ui.rangeIcons.melee! }, 676, 208, 2);
  blit(root, output, { ref: db.ui.speedIcons.fast! }, 712, 208, 2);
  blit(root, output, { ref: rockitten.sheet, rect: rockitten.menu[0] }, 520, 256);
  blit(root, output, { ref: budaye.sheet, rect: budaye.menu[0] }, 552, 256);

  return encodePNG(output, BATTLE_PREVIEW_WIDTH, BATTLE_PREVIEW_HEIGHT);
}

if (import.meta.main) {
  const output = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, "tests/goldens/GB1-preview.png");
  mkdirSync(dirname(output), { recursive: true });
  const png = renderBattlePreview(ROOT);
  writeFileSync(output, png);
  console.log(`GB1 battle preview: ${output} (${BATTLE_PREVIEW_WIDTH}x${BATTLE_PREVIEW_HEIGHT}, ${png.byteLength} bytes)`);
}
