import { faintPose, flashOpacity, shakeOffsetX } from "../vendor/pocket-rpgkit/src/ui/battle/effects.ts";
import { animationPresentation, ballPresentation, battlerPresentation, currentPresentationEvent,
  presentationActiveMonster, presentationField, presentationExperience, presentationHp, presentationLevel,
  presentationMaxHp, REWARD_TICK, trainerPresentation, SEND_OUT_RELEASE_TICK, TECHNIQUE_HP_TICK,
  TECHNIQUE_IMPACT_TICK, FAINT_SINK_TICK, CAPTURE_FLIGHT_TICKS } from "../battle/presentation.ts";
import type { RuntimeBattleState as Runtime } from "../battle/runtime.ts";
import type { BattleEvent } from "../battle/types.ts";
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

// A held endpoint has the same pixels at every later tick. Compare both
// cursors so jumping over a window or rewinding into it still evaluates it.
function windowChanged(before: number, now: number, start: number, end: number): boolean {
  return Math.max(start, Math.min(end, before)) !== Math.max(start, Math.min(end, now));
}

function poseChanged(event: BattleEvent | null, uid: number, before: number, now: number): boolean {
  if (event?.type === "sendOut" && event.monster === uid)
    return windowChanged(before, now, SEND_OUT_RELEASE_TICK - 1, SEND_OUT_RELEASE_TICK + 16);
  if (event?.type === "technique")
    return (event.user === uid && windowChanged(before, now, 4, 20)) ||
      (event.target === uid && event.hit !== false && windowChanged(before, now, TECHNIQUE_IMPACT_TICK - 1, TECHNIQUE_IMPACT_TICK + 20));
  if (event?.type === "faint" && event.monster === uid)
    return windowChanged(before, now, FAINT_SINK_TICK, FAINT_SINK_TICK + 30);
  if (event?.type === "capture" && event.target === uid && event.success === true)
    return windowChanged(before, now, CAPTURE_FLIGHT_TICKS - 1, CAPTURE_FLIGHT_TICKS + 22);
  return false;
}

export function battlePaint(state: Runtime, prior?: Runtime, previous?: ReturnType<typeof allBattlePaint>): ReturnType<typeof allBattlePaint> {
  const event = currentPresentationEvent(state);
  if (!prior || !previous || state.battle !== prior.battle || state.visuals !== prior.visuals ||
      state.presentationRewards !== prior.presentationRewards || state.eventCursor !== prior.eventCursor ||
      (event?.type === "swap" && (state.eventTicks >= 22) !== (prior.eventTicks >= 22)) ||
      (event?.type === "faint" && (state.eventTicks >= REWARD_TICK + 18) !== (prior.eventTicks >= REWARD_TICK + 18))) return allBattlePaint(state);
  const before = prior.eventTicks, now = state.eventTicks;
  const hpMoves = event?.type === "technique" ? windowChanged(before, now, TECHNIQUE_HP_TICK, TECHNIQUE_HP_TICK + 20)
    : event?.type === "status" ? windowChanged(before, now, 6, 16)
      : event?.type === "item" && windowChanged(before, now, 12, 30);
  const playerHp = hpMoves ? presentationHp(state, previous.player.uid) : previous.playerHp;
  const enemyHp = hpMoves ? presentationHp(state, previous.enemy.uid) : previous.enemyHp;
  const playerMoves = poseChanged(event, previous.player.uid, before, now);
  const enemyMoves = poseChanged(event, previous.enemy.uid, before, now);
  const playerPose = playerMoves ? battlerPresentation(state, previous.player.uid, previous.field) : previous.playerPose;
  const enemyPose = enemyMoves ? battlerPresentation(state, previous.enemy.uid, previous.field) : previous.enemyPose;
  return {
    ...previous, playerPose, enemyPose,
    playerSprite: playerMoves ? spritePaint(playerPose, now) : previous.playerSprite,
    enemySprite: enemyMoves ? spritePaint(enemyPose, now) : previous.enemySprite,
    playerTrainer: event?.type === "sendOut" && windowChanged(before, now, 0, 34) ? trainerPresentation(state, 0) : previous.playerTrainer,
    enemyTrainer: event?.type === "sendOut" && windowChanged(before, now, 0, 34) ? trainerPresentation(state, 1) : previous.enemyTrainer,
    ball: event?.type === "sendOut" || event?.type === "capture" ? ballPresentation(state) : previous.ball,
    animation: previous.animation.animation ? animationPresentation(state, previous.animation) : previous.animation,
    playerExperience: event?.type === "faint" && windowChanged(before, now, REWARD_TICK, REWARD_TICK + 20) ? presentationExperience(state, previous.player.uid) : previous.playerExperience,
    playerHp, enemyHp,
    playerIcons: hpMoves ? PARTY_SLOTS.map(slot => partyIcon(state, 0, slot, previous.player.uid, playerHp)) : previous.playerIcons,
    enemyIcons: hpMoves ? PARTY_SLOTS.map(slot => partyIcon(state, 1, slot, previous.enemy.uid, enemyHp)) : previous.enemyIcons,
  };
}
