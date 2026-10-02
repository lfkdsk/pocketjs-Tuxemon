import type { BattleMonster } from "../battle/types.ts";

/** Pocket-sized battle canvas. The top 216 px are Tuxemon's 256x108 scene
 * enlarged 2x and centre-cropped by 16 px on each side; the final 56 px are
 * the native kit message/menu band. A 960x544 viewport scales this whole
 * canvas exactly 2x. */
export const BATTLE_BASE_WIDTH = 480;
export const BATTLE_BASE_HEIGHT = 272;
export const BATTLE_SCENE_HEIGHT = 216;
export const BATTLE_SCENE_CROP_X = 16;
// Leave a 64 px number cell at 480x272. The largest imported early-game
// readout ("109 / 109") is wider than the former 54 px cell and lost its
// final digit against the right edge of the battle canvas.
export const BATTLE_PLAYER_HP_WIDTH = 90;
export const BATTLE_ENEMY_HP_WIDTH = 140;
export const BATTLE_XP_WIDTH = 140;
// Compatibility width used by the GB3/GB4 software-preview helpers. The live
// battle scene passes the asymmetric HUD widths above explicitly.
export const BATTLE_HP_WIDTH = 116;

export const BATTLE_RECTS = Object.freeze({
  background: { x: -16, y: 0, width: 512, height: 256 },
  playerIsland: { x: 48, y: 136, width: 192, height: 114 },
  enemyIsland: { x: 264, y: 48, width: 192, height: 114 },
  playerMonster: { x: 80, y: 88, width: 128, height: 128 },
  enemyMonster: { x: 296, y: 0, width: 128, height: 128 },
  playerHud: { x: 274, y: 90, width: 208, height: 74 },
  enemyHud: { x: 20, y: 0, width: 200, height: 58 },
  playerHp: { x: 320, y: 126, width: BATTLE_PLAYER_HP_WIDTH, height: 8 },
  enemyHp: { x: 64, y: 24, width: BATTLE_ENEMY_HP_WIDTH, height: 8 },
  playerXp: { x: 326, y: 152, width: BATTLE_XP_WIDTH, height: 5 },
  playerTray: { x: 274, y: 178, width: 208, height: 12 },
  enemyTray: { x: 20, y: 58, width: 208, height: 12 },
  playerStatus: { x: 304, y: 152, width: 18, height: 18 },
  enemyStatus: { x: 10, y: 26, width: 18, height: 18 },
  message: { x: 0, y: 216, width: 244, height: 56 },
  menu: { x: 244, y: 216, width: 236, height: 56 },
});

export interface BattleSceneLayout {
  scale: number;
  left: number;
  top: number;
  playerHpWidth: number;
  enemyHpWidth: number;
}

export function hpBarWidth(current: number, maximum: number, width = BATTLE_HP_WIDTH): number {
  if (!(maximum > 0)) return 0;
  return Math.max(0, Math.min(width, Math.round(width * current / maximum)));
}

export function battleSceneLayout(
  width: number,
  height: number,
  player: Pick<BattleMonster, "currentHp" | "base">,
  enemy: Pick<BattleMonster, "currentHp" | "base">,
): BattleSceneLayout {
  return {
    ...battleViewportLayout(width, height),
    playerHpWidth: hpBarWidth(player.currentHp, player.base.hp, BATTLE_PLAYER_HP_WIDTH),
    enemyHpWidth: hpBarWidth(enemy.currentHp, enemy.base.hp, BATTLE_ENEMY_HP_WIDTH),
  };
}

/** Canvas geometry depends on the viewport; combat HP does not move it. */
export function battleViewportLayout(width: number, height: number): Pick<BattleSceneLayout, "scale" | "left" | "top"> {
  const scale = Math.min(width / BATTLE_BASE_WIDTH, height / BATTLE_BASE_HEIGHT);
  return {
    scale,
    left: Math.floor((width - BATTLE_BASE_WIDTH * scale) / 2),
    top: Math.floor((height - BATTLE_BASE_HEIGHT * scale) / 2),
  };
}
