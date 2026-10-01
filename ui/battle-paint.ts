import { faintPose, flashOpacity, shakeOffsetX } from "../vendor/pocket-rpgkit/src/ui/battle/effects.ts";
import { animationPresentation, ballPresentation, battlerPresentation, currentPresentationEvent,
  presentationActiveMonster, presentationField, presentationExperience, presentationHp, presentationLevel,
  presentationMaxHp, REWARD_TICK, trainerPresentation } from "../battle/presentation.ts";
import type { RuntimeBattleState as Runtime } from "../battle/runtime.ts";
import type { BattleImageRef } from "../importer/battle-schema.ts";
const PARTY_SLOTS = [0, 1, 2, 3, 4, 5] as const;

function partyIcon(state: Runtime, side: 0 | 1, slot: number, activeUid: number, activeHp: number): BattleImageRef {
  const member = state.battle.parties[side][slot];
  const icons = state.visuals.environment.partyIcons;
  if (!member) return icons.icon_empty!;
  if ((member.uid === activeUid ? activeHp : presentationHp(state, member.uid)) <= 0) return icons.icon_faint!;
  if (member.status) return icons.icon_status!;
  return icons.icon_alive!;
}


function spritePaint(pose: ReturnType<typeof battlerPresentation>, tick: number) {
  const faint = faintPose(pose.effect, tick);
  return { dx: shakeOffsetX(pose.effect, tick), sinkY: faint.sinkY,
    opacity: flashOpacity(pose.effect, tick) * faint.opacity };
}

export function allBattlePaint(state: Runtime) {
  const field = presentationField(state);
  const player = presentationActiveMonster(state, 0, field), enemy = presentationActiveMonster(state, 1, field);
  const playerHp = presentationHp(state, player.uid), enemyHp = presentationHp(state, enemy.uid);
  const playerPose = battlerPresentation(state, player.uid, field), enemyPose = battlerPresentation(state, enemy.uid, field);
  return {
    player, enemy, field, playerPose, enemyPose,
    playerSprite: spritePaint(playerPose, state.eventTicks), enemySprite: spritePaint(enemyPose, state.eventTicks),
    playerTrainer: trainerPresentation(state, 0), enemyTrainer: trainerPresentation(state, 1),
    ball: ballPresentation(state), animation: animationPresentation(state),
    playerHp, enemyHp,
    playerLevel: presentationLevel(state, player.uid), enemyLevel: presentationLevel(state, enemy.uid),
    playerMaxHp: presentationMaxHp(state, player.uid), enemyMaxHp: presentationMaxHp(state, enemy.uid),
    playerExperience: presentationExperience(state, player.uid),
    playerIcons: PARTY_SLOTS.map(slot => partyIcon(state, 0, slot, player.uid, playerHp)),
    enemyIcons: PARTY_SLOTS.map(slot => partyIcon(state, 1, slot, enemy.uid, enemyHp)),
  };
}

export function battlePaint(state: Runtime, prior?: Runtime, previous?: ReturnType<typeof allBattlePaint>): ReturnType<typeof allBattlePaint> {
  const event = currentPresentationEvent(state);
  if (!prior || !previous || state.battle !== prior.battle || state.visuals !== prior.visuals ||
      state.presentationRewards !== prior.presentationRewards || state.eventCursor !== prior.eventCursor ||
      (event?.type === "swap" && (state.eventTicks >= 22) !== (prior.eventTicks >= 22)) ||
      (event?.type === "faint" && (state.eventTicks >= REWARD_TICK + 18) !== (prior.eventTicks >= REWARD_TICK + 18))) return allBattlePaint(state);
  const hpMoves = event?.type === "technique" || event?.type === "status" || event?.type === "item";
  const playerHp = hpMoves ? presentationHp(state, previous.player.uid) : previous.playerHp;
  const enemyHp = hpMoves ? presentationHp(state, previous.enemy.uid) : previous.enemyHp;
  const playerPose = battlerPresentation(state, previous.player.uid, previous.field), enemyPose = battlerPresentation(state, previous.enemy.uid, previous.field);
  return {
    ...previous, playerPose, enemyPose,
    playerSprite: spritePaint(playerPose, state.eventTicks), enemySprite: spritePaint(enemyPose, state.eventTicks),
    playerTrainer: event?.type === "sendOut" ? trainerPresentation(state, 0) : previous.playerTrainer,
    enemyTrainer: event?.type === "sendOut" ? trainerPresentation(state, 1) : previous.enemyTrainer,
    ball: event?.type === "sendOut" || event?.type === "capture" ? ballPresentation(state) : previous.ball,
    animation: previous.animation.animation ? animationPresentation(state, previous.animation) : previous.animation,
    playerExperience: event?.type === "faint" ? presentationExperience(state, previous.player.uid) : previous.playerExperience,
    playerHp, enemyHp,
    playerIcons: hpMoves ? PARTY_SLOTS.map(slot => partyIcon(state, 0, slot, previous.player.uid, playerHp)) : previous.playerIcons,
    enemyIcons: hpMoves ? PARTY_SLOTS.map(slot => partyIcon(state, 1, slot, previous.enemy.uid, enemyHp)) : previous.enemyIcons,
  };
}
