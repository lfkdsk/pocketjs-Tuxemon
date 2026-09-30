import type { BattleMonster } from "../battle/types.ts";

export const BATTLE_BASE_WIDTH = 480;
export const BATTLE_BASE_HEIGHT = 272;
export const BATTLE_HP_WIDTH = 116;

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
  const scale = Math.min(width / BATTLE_BASE_WIDTH, height / BATTLE_BASE_HEIGHT);
  return {
    scale,
    left: Math.floor((width - BATTLE_BASE_WIDTH * scale) / 2),
    top: Math.floor((height - BATTLE_BASE_HEIGHT * scale) / 2),
    playerHpWidth: hpBarWidth(player.currentHp, player.base.hp),
    enemyHpWidth: hpBarWidth(enemy.currentHp, enemy.base.hp),
  };
}
