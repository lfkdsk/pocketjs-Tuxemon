import { Image, Text, View } from "@pocketjs/framework/components";
import type { Component } from "solid-js";

import { currentBattleEvent, tuxemonRuntimeBattleState } from "../battle/runtime.ts";
import type { BattleEvent, BattleMonster } from "../battle/types.ts";
import type { BattleSceneViewProps } from "../vendor/pocket-rpgkit/src/ui/GameView.tsx";
import {
  BATTLE_BASE_HEIGHT as BASE_H,
  BATTLE_BASE_WIDTH as BASE_W,
  BATTLE_HP_WIDTH as HP_W,
  battleSceneLayout,
  hpBarWidth,
} from "./battle-layout.ts";

type MonsterArt = ReturnType<typeof tuxemonRuntimeBattleState>["visuals"]["monsters"][string];

const title = (slug: string): string => slug
  .split("_")
  .map((part) => part ? part[0]!.toUpperCase() + part.slice(1) : part)
  .join(" ");

const pathFor = (key: string): string => key.startsWith("ui:img.") ? key.slice(7) : key;

function eventMessage(event: BattleEvent | null, monsters: readonly BattleMonster[]): string {
  if (!event) return "Choose an action";
  const monster = (uid: unknown) => monsters.find((candidate) => candidate.uid === uid)?.slug ?? "Tuxemon";
  switch (event.type) {
    case "sendOut": return `${title(monster(event.monster))} enters the battle!`;
    case "decision": return `${title(monster(event.user))} chose ${title(String(event.technique ?? "move"))}.`;
    case "technique": return `${title(monster(event.user))} used ${title(String(event.technique ?? "move"))}!`;
    case "faint": return `${title(monster(event.monster))} fainted!`;
    case "status": return `${title(monster(event.target))}: ${title(String(event.status ?? "status"))}.`;
    case "item": return `${title(String(event.item ?? "item"))} used on ${title(monster(event.target))}.`;
    case "capture": return event.success ? `${title(monster(event.target))} was captured!` : `${title(monster(event.target))} broke free!`;
    case "run": return event.success ? "Got away safely!" : "Couldn't escape!";
    case "swap": return `${title(monster(event.target))} enters the battle!`;
    case "reward": return "Experience gained!";
    case "result": return "The battle is over.";
    default: return title(event.type);
  }
}

function hpColour(current: number, maximum: number): string {
  const ratio = maximum > 0 ? current / maximum : 0;
  return ratio > 0.5 ? "#49c96d" : ratio > 0.2 ? "#f2c94c" : "#ed5b5b";
}

function activeMonster(state: ReturnType<typeof tuxemonRuntimeBattleState>, side: 0 | 1): BattleMonster {
  const uid = state.battle.field.find((candidate) =>
    state.battle.parties[side].some((monster) => monster.uid === candidate),
  );
  return state.battle.parties[side].find((monster) => monster.uid === uid)
    ?? state.battle.parties[side][0]!;
}

/** Minimal read-only battle scene. The reducer owns every choice and timer;
 * this component only projects its JSON state into PocketJS nodes. */
export const TuxemonBattleScene: Component<BattleSceneViewProps> = (props) => {
  const runtime = () => tuxemonRuntimeBattleState(props.state);
  const player = () => activeMonster(runtime(), 0);
  const enemy = () => activeMonster(runtime(), 1);
  const layout = () => battleSceneLayout(props.width, props.height, player(), enemy());
  const px = (value: number) => value * layout().scale;
  const x = (value: number) => layout().left + px(value);
  const y = (value: number) => layout().top + px(value);
  const environment = () => runtime().visuals.background;
  const playerArt = () => runtime().visuals.monsters[player().slug]!;
  const enemyArt = () => runtime().visuals.monsters[enemy().slug]!;
  const allMonsters = () => [...runtime().battle.parties[0], ...runtime().battle.parties[1]];
  const message = () => {
    const result = runtime().battle.result;
    const event = currentBattleEvent(runtime());
    return result
      ? result.outcome === "won" ? "Victory!"
        : result.outcome === "lost" ? "Your party was defeated."
          : "The battle ended."
      : event
        ? eventMessage(event, allMonsters())
        : runtime().menuMode === "root" ? "Choose an action"
          : runtime().menuMode === "technique" ? "Choose a technique"
            : runtime().menuMode === "swap" ? "Choose a Tuxemon"
              : runtime().menuMode === "capture" ? "Choose a capture device"
                : "Choose an item";
  };
  const moves = () => runtime().menu;
  const visibleMoves = () => {
    const entries = moves();
    const start = entries.length <= 4 ? 0 : Math.floor(runtime().menuIndex / 4) * 4;
    return entries.slice(start, start + 4).map((entry, offset) => ({ entry, index: start + offset }));
  };
  const menuLabel = (entry: ReturnType<typeof moves>[number]): string => {
    const target = entry.targetSlug ? ` → ${title(entry.targetSlug)} ${entry.targetSlot}` : "";
    const quantity = entry.quantity === undefined ? "" : ` ×${entry.quantity}`;
    const cooldown = entry.cooldown ? ` (${entry.cooldown})` : "";
    return `${title(entry.slug)}${quantity}${target}${cooldown}`;
  };

  const monsterImage = (
    art: () => MonsterArt,
    side: "front" | "back",
    left: number,
    top: number,
    debugName: string,
  ) => {
    const rect = () => art()[side];
    return (
      <View class="absolute overflow-hidden" style={{ posType: 1, insetL: x(left), insetT: y(top), width: px(96), height: px(96) }} debugName={`${debugName}-clip`}>
        <Image
          src={pathFor(art().sheet.key)}
          class="absolute"
          style={{
            posType: 1,
            insetL: -px(rect()[0] * 1.5),
            insetT: -px(rect()[1] * 1.5),
            width: px(art().sheet.width * 1.5),
            height: px(art().sheet.height * 1.5),
          }}
          debugName={debugName}
        />
      </View>
    );
  };

  const hpPanel = (monster: () => BattleMonster, left: number, top: number, side: "player" | "enemy") => (
    <View class="absolute" style={{ posType: 1, insetL: x(left), insetT: y(top), width: px(164), height: px(46), bgColor: "#f5f1d7" }} debugName={`${side}-hud`}>
      <Text class="text-sm" style={{ posType: 1, insetL: px(8), insetT: px(3), width: px(148), height: px(16), lineHeight: px(14), textColor: "#102b3a" }}>
        {`${title(monster().slug)}  Lv${monster().level}`}
      </Text>
      <View class="absolute" style={{ posType: 1, insetL: px(36), insetT: px(24), width: px(HP_W), height: px(10), bgColor: "#263b43" }} debugName={`${side}-hp-track`} />
      <View class="absolute" style={{ posType: 1, insetL: px(36), insetT: px(24), width: px(hpBarWidth(monster().currentHp, monster().base.hp)), height: px(10), bgColor: hpColour(monster().currentHp, monster().base.hp) }} debugName={`${side}-hp-fill`} />
      <Text class="text-xs" style={{ posType: 1, insetL: px(4), insetT: px(22), width: px(28), height: px(12), lineHeight: px(12), textColor: "#102b3a" }}>HP</Text>
    </View>
  );

  return (
    <View class="absolute overflow-hidden" style={{ posType: 1, insetL: 0, insetT: 0, width: props.width, height: props.height, bgColor: "#06141d" }} debugName="tux-battle-scene">
      <View class="absolute overflow-hidden" style={{ posType: 1, insetL: layout().left, insetT: layout().top, width: px(BASE_W), height: px(BASE_H), bgColor: "#8fcbd1" }}>
        <Image src={pathFor(environment().key)} class="absolute" style={{ posType: 1, insetL: 0, insetT: 0, width: px(BASE_W), height: px(204) }} debugName="battle-background" />
      </View>
      {monsterImage(enemyArt, "front", 326, 28, "enemy-monster")}
      {monsterImage(playerArt, "back", 68, 102, "player-monster")}
      {hpPanel(enemy, 24, 20, "enemy")}
      {hpPanel(player, 292, 119, "player")}
      <View class="absolute" style={{ posType: 1, insetL: x(8), insetT: y(198), width: px(464), height: px(66), bgColor: "#102b3a" }} debugName="battle-message-panel">
        <Text class="text-sm" style={{ posType: 1, insetL: px(10), insetT: px(7), width: px(444), height: px(18), lineHeight: px(16), textColor: "#f5f1d7" }}>{message()}</Text>
        {visibleMoves().map(({ entry: move, index }, visibleIndex) => (
          <Text class="text-xs" style={{ posType: 1, insetL: px(12 + (visibleIndex % 2) * 222), insetT: px(31 + Math.floor(visibleIndex / 2) * 15), width: px(210), height: px(14), lineHeight: px(13), textColor: index === runtime().menuIndex ? "#ffd15c" : "#9cc8c1" }}>
            {`${index === runtime().menuIndex ? ">" : " "} ${menuLabel(move)}`}
          </Text>
        ))}
      </View>
    </View>
  );
};
