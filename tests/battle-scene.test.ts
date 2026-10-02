import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { decodePng } from "../importer/png.ts";
import { BATTLE_BASE_WIDTH, BATTLE_RECTS, battleSceneLayout, hpBarWidth } from "../ui/battle-layout.ts";
import {
  GB4_BATTLE_HEIGHT,
  GB4_BATTLE_WIDTH,
  GB4_ENEMY_BAR,
  GB4_ENEMY_HP,
  GB4_PLAYER_BAR,
  GB4_PLAYER_HP,
  renderGb4Battle,
} from "../tools/render-gb4-battle.ts";

const ROOT = resolve(import.meta.dir, "..");
const pixel = (rgba: Uint8Array, width: number, x: number, y: number) =>
  [...rgba.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];

test("battle layout scales exactly at both target resolutions", () => {
  const player = { currentHp: 31, base: { hp: 62 } as any };
  const enemy = { currentHp: 17, base: { hp: 40 } as any };
  expect(battleSceneLayout(480, 272, player, enemy)).toEqual({
    scale: 1, left: 0, top: 0, playerHpWidth: 45, enemyHpWidth: 60,
  });
  expect(battleSceneLayout(960, 544, player, enemy)).toEqual({
    scale: 2, left: 0, top: 0, playerHpWidth: 45, enemyHpWidth: 60,
  });
  expect(BATTLE_BASE_WIDTH - BATTLE_RECTS.playerHp.x - BATTLE_RECTS.playerHp.width - 6).toBeGreaterThanOrEqual(64);
});

test("battle preview is byte-stable and HP fill pixels stop at the computed width", () => {
  const generated = renderGb4Battle(ROOT);
  expect(generated).toEqual(new Uint8Array(readFileSync(join(ROOT, "tests/goldens/GB4-battle.png"))));
  const image = decodePng(generated, "GB4-battle.png");
  expect([image.width, image.height]).toEqual([GB4_BATTLE_WIDTH, GB4_BATTLE_HEIGHT]);
  for (const [bar, hp] of [[GB4_PLAYER_BAR, GB4_PLAYER_HP], [GB4_ENEMY_BAR, GB4_ENEMY_HP]] as const) {
    const filled = hpBarWidth(hp.current, hp.maximum);
    expect(pixel(image.rgba, image.width, bar.x + filled - 1, bar.y + 4)).toEqual([242, 201, 76, 255]);
    expect(pixel(image.rgba, image.width, bar.x + filled, bar.y + 4)).toEqual([38, 59, 67, 255]);
  }
});
