import { For } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import type { Component } from "solid-js";

import {
  animationPresentation,
  ballPresentation,
  battlerPresentation,
  CAPTURE_FLIGHT_TICKS,
  CAPTURE_SHAKE_TICKS,
  currentPresentationEvent,
  currentReward,
  presentationActiveMonster,
  presentationExperience,
  presentationHp,
  presentationLevel,
  presentationMaxHp,
  REWARD_TICK,
  trainerPresentation,
} from "../battle/presentation.ts";
import { tuxemonRuntimeBattleState } from "../battle/runtime.ts";
import type { BattleEvent, BattleMonster } from "../battle/types.ts";
import type { BattleImageRef } from "../importer/battle-schema.ts";
import type { BattleSceneViewProps } from "../vendor/pocket-rpgkit/src/ui/GameView.tsx";
import {
  CommandGrid,
  createBattleImageCache,
  FrameStrip,
  LazyImage,
  ListMenu,
  MessageBand,
  NO_EFFECT,
  SpriteSlot,
  StatBar,
  type CommandCell,
  type ListMenuRow,
  type TileImageSource,
} from "../vendor/pocket-rpgkit/src/ui/battle/index.ts";
import {
  BATTLE_BASE_HEIGHT,
  BATTLE_BASE_WIDTH,
  BATTLE_RECTS as R,
  battleSceneLayout,
} from "./battle-layout.ts";

type Runtime = ReturnType<typeof tuxemonRuntimeBattleState>;
type MonsterArt = Runtime["visuals"]["monsters"][string];

const UI_THEME = {
  border: "#183746",
  rim: "#79d8c5",
  paper: "#f5f1d7",
  ink: "#102b3a",
  dim: "#537b80",
  accent: "#d27b2c",
  backdrop: "#06141d",
} as const;

const PARTY_SLOTS = [0, 1, 2, 3, 4, 5] as const;

const title = (slug: string): string => slug
  .split("_")
  .map((part) => part ? part[0]!.toUpperCase() + part.slice(1) : part)
  .join(" ");

const imageSource = (ref: BattleImageRef): TileImageSource => ({
  kind: "tile",
  ref: ref.key,
  sourceWidth: ref.width,
  sourceHeight: ref.height,
});

function eventMessage(state: Runtime, event: BattleEvent | null, monsters: readonly BattleMonster[]): string {
  if (!event) return "Choose an action";
  const monster = (uid: unknown) => monsters.find((candidate) => candidate.uid === uid)?.slug ?? "Tuxemon";
  switch (event.type) {
    case "sendOut": return `${title(monster(event.monster))} enters the battle!`;
    case "decision": return `${title(monster(event.user))} chose ${title(String(event.technique ?? "move"))}.`;
    case "technique": {
      if (state.eventTicks >= 34 && event.hit === false) return "The attack missed!";
      if (state.eventTicks >= 34 && Number(event.damage) > 0) return `${Math.trunc(Number(event.damage))} damage!`;
      return `${title(monster(event.user))} used ${title(String(event.technique ?? "move"))}!`;
    }
    case "faint": {
      const reward = currentReward(state);
      if (reward && state.eventTicks >= REWARD_TICK) {
        const winner = reward.winners[0];
        if (winner?.levelsGained) return `${title(monster(winner.uid))} grew ${winner.levelsGained} level${winner.levelsGained === 1 ? "" : "s"}!`;
        if (winner) return `${title(monster(winner.uid))} gained ${winner.effectiveExperience} XP!`;
      }
      return `${title(monster(event.monster))} fainted!`;
    }
    case "status": return `${title(monster(event.target))}: ${title(String(event.status ?? "status"))}.`;
    case "item": return `${title(String(event.item ?? "item"))} used on ${title(monster(event.target))}.`;
    case "capture": {
      const landed = state.eventTicks - CAPTURE_FLIGHT_TICKS;
      const shakes = Math.max(1, Math.trunc(Number(event.shakes) || 1));
      if (landed >= 0 && landed < shakes * CAPTURE_SHAKE_TICKS) {
        const count = Math.min(shakes, Math.floor(landed / CAPTURE_SHAKE_TICKS) + 1);
        return `${count} shake${count === 1 ? "" : "s"}...`;
      }
      return event.success
        ? `${title(monster(event.target))} was captured!`
        : `${title(monster(event.target))} broke free!`;
    }
    case "run": return event.success ? "Got away safely!" : "Couldn't escape!";
    case "swap": return `${title(monster(event.target))} enters the battle!`;
    case "end": return event.outcome === "won" ? "Victory!"
      : event.outcome === "lost" ? "Your party was defeated."
        : "The battle is over.";
    default: return title(event.type);
  }
}

function wrapMessage(message: string, columns: number): [string, string] {
  if (message.length <= columns) return [message, ""];
  const split = message.lastIndexOf(" ", columns);
  const at = split > columns / 2 ? split : columns;
  return [message.slice(0, at).trimEnd(), message.slice(at).trimStart()];
}

function hpColour(current: number, maximum: number): string {
  const ratio = maximum > 0 ? current / maximum : 0;
  return ratio > 0.5 ? "#49c96d" : ratio > 0.2 ? "#f2c94c" : "#ed5b5b";
}

function genderMark(gender: string): string {
  return gender === "male" ? "M" : gender === "female" ? "F" : "-";
}

function experienceProgress(totalExperience: number, level: number): { current: number; max: number } {
  const floor = Math.max(0, level) ** 3;
  const ceiling = Math.max(1, level + 1) ** 3;
  return {
    current: Math.max(0, totalExperience - floor),
    max: Math.max(1, ceiling - floor),
  };
}

function partyIcon(state: Runtime, side: 0 | 1, slot: number): BattleImageRef {
  const member = state.battle.parties[side][slot];
  const icons = state.visuals.environment.partyIcons;
  if (!member) return icons.icon_empty!;
  if (presentationHp(state, member.uid) <= 0) return icons.icon_faint!;
  if (member.status) return icons.icon_status!;
  return icons.icon_alive!;
}

function menuLabel(entry: Runtime["menu"][number]): string {
  if (entry.kind === "replacement") return "Swap";
  return title(entry.slug);
}

function menuDetail(entry: Runtime["menu"][number]): string {
  if (entry.quantity !== undefined) return `x${entry.quantity}`;
  if (entry.cooldown > 0) return `wait ${entry.cooldown}`;
  if (entry.targetSlug) return `#${entry.targetSlot} ${title(entry.targetSlug)}`;
  return "";
}

function menuTitle(mode: Runtime["menuMode"]): string {
  return mode === "technique" ? "Techniques"
    : mode === "item" ? "Items"
      : mode === "capture" ? "Capture"
        : mode === "swap" ? "Party" : "Commands";
}

/** Read-only projection of the serialised battle scene. All scaling is on
 * this 480x272 root so the 960x544 target is the same nearest-neighbour
 * composition at exactly 2x. */
export const TuxemonBattleScene: Component<BattleSceneViewProps> = (props) => {
  const imageCache = createBattleImageCache(() => props.active);
  // A kept-alive battle subtree can reactivate its image effects in the same
  // batch as the cache-scope effect. Reopen synchronously while deriving an
  // active source so no child can observe the just-ended previous scope.
  const activeImageSource = (ref: BattleImageRef): TileImageSource => {
    if (props.active) imageCache.beginScope();
    return imageSource(ref);
  };
  const runtime = () => tuxemonRuntimeBattleState(props.state);
  const player = () => presentationActiveMonster(runtime(), 0);
  const enemy = () => presentationActiveMonster(runtime(), 1);
  const layout = () => battleSceneLayout(props.width, props.height, player(), enemy());
  const environment = () => runtime().visuals.environment;
  const playerArt = () => runtime().visuals.monsters[player().slug]!;
  const enemyArt = () => runtime().visuals.monsters[enemy().slug]!;
  const allMonsters = () => [...runtime().battle.parties[0], ...runtime().battle.parties[1]];
  const presenting = () => currentPresentationEvent(runtime()) !== null;
  const event = () => currentPresentationEvent(runtime());
  const message = () => {
    const result = runtime().battle.result;
    if (presenting()) return eventMessage(runtime(), event(), allMonsters());
    if (result) return result.outcome === "won" ? "Victory!"
      : result.outcome === "lost" ? "Your party was defeated."
        : "The battle ended.";
    return runtime().menuMode === "root" ? `What will ${title(player().slug)} do?`
      : runtime().menuMode === "technique" ? "Choose a technique"
        : runtime().menuMode === "swap" ? "Choose a Tuxemon"
          : runtime().menuMode === "capture" ? "Choose a capture device"
            : "Choose an item";
  };
  const rootEntries = () => runtime().menuMode === "root" ? runtime().menu : [];
  const rootStart = () => runtime().menuIndex < 4 ? 0 : Math.max(0, rootEntries().length - 4);
  const commandCells = (): readonly [CommandCell, CommandCell, CommandCell, CommandCell] => {
    const start = rootStart();
    return [0, 1, 2, 3].map((offset) => {
      const entry = rootEntries()[start + offset];
      return entry
        ? { label: menuLabel(entry), disabled: !entry.available }
        : { label: " ", disabled: true };
    }) as unknown as readonly [CommandCell, CommandCell, CommandCell, CommandCell];
  };
  const listRows = (): ListMenuRow[] => {
    const rows = runtime().menu.map((entry) => ({
      label: menuLabel(entry),
      // ListMenu owns fixed Text nodes, but Solid's universal renderer
      // replaces a node structurally when its previous value was "". Keep
      // both visible slots on the non-empty replaceText path while menus
      // switch and while the battle presentation is running.
      detail: menuDetail(entry) || " ",
    }));
    while (rows.length < 2) rows.push({ label: " ", detail: " " });
    return rows;
  };
  const menuReady = () => !presenting() && runtime().battle.awaiting !== null;
  const rootVisible = () => menuReady() && runtime().menuMode === "root";
  const listVisible = () => menuReady() && runtime().menuMode !== "root";
  const bandLines = () => wrapMessage(message(), rootVisible() || listVisible() ? 27 : 58);
  const playerLevel = () => presentationLevel(runtime(), player().uid);
  const playerXp = () => experienceProgress(
    presentationExperience(runtime(), player().uid),
    playerLevel(),
  );

  const monsterSlot = (
    monster: () => BattleMonster,
    art: () => MonsterArt,
    side: "front" | "back",
    rect: typeof R.playerMonster,
    debugName: string,
  ) => {
    const source = () => art()[side];
    const pose = () => battlerPresentation(runtime(), monster().uid);
    return (
      <View
        class="absolute overflow-hidden"
        style={{
          posType: 1,
          insetL: rect.x + pose().offsetX,
          insetT: rect.y,
          width: rect.width,
          height: rect.height,
          opacity: pose().opacity,
        }}
        debugName={`${debugName}-clip`}
      >
        <SpriteSlot
          src={activeImageSource(art().sheet)}
          cache={imageCache}
          active={props.active}
          x={-source()[0] * 2}
          y={-source()[1] * 2}
          width={art().sheet.width * 2}
          height={art().sheet.height * 2}
          effect={pose().effect}
          nowTick={runtime().eventTicks}
          debugName={debugName}
        />
      </View>
    );
  };

  const trainerSlot = (side: 0 | 1) => {
    const ref = () => runtime().visuals.trainers[side === 0 ? "player" : "opponent"]
      ?? environment().partyIcons.icon_empty!;
    const pose = () => trainerPresentation(runtime(), side);
    const rect = side === 0 ? R.playerMonster : R.enemyMonster;
    const sourceScale = () => side === 0 && ref().rect[3] > 64 ? 1 : 2;
    const sourceX = () => side === 1 && ref().rect[2] >= 128 ? 64 : 0;
    return (
      <View
        class="absolute overflow-hidden"
        style={{
          posType: 1,
          insetL: rect.x + pose().offsetX,
          insetT: rect.y,
          width: rect.width,
          height: rect.height,
          opacity: pose().opacity,
        }}
        debugName={`${side === 0 ? "player" : "enemy"}-trainer-clip`}
      >
        <View
          class="absolute overflow-hidden"
          style={{
            posType: 1,
            insetL: (rect.width - 64 * sourceScale()) / 2,
            insetT: 0,
            width: 64 * sourceScale(),
            height: rect.height,
          }}
        >
          <SpriteSlot
            src={activeImageSource(ref())}
            cache={imageCache}
            active={props.active}
            x={-sourceX() * sourceScale()}
            y={0}
            width={ref().width * sourceScale()}
            height={ref().height * sourceScale()}
            effect={NO_EFFECT}
            nowTick={runtime().eventTicks}
            debugName={`${side === 0 ? "player" : "enemy"}-trainer`}
          />
        </View>
      </View>
    );
  };

  const ball = () => ballPresentation(runtime());
  const ballRef = () => {
    const item = ball().item ? runtime().visuals.items[ball().item!] : undefined;
    return item?.captureSprite ?? environment().partyIcons.icon_alive!;
  };
  const ballSize = () => ball().kind === "capture" ? 32 : 16;

  const animation = () => animationPresentation(runtime());
  const animationPage = () => animation().page ?? environment().partyIcons.icon_empty!;
  const animationRect = () => runtime().battle.parties[0].some((monster) => monster.uid === animation().target)
    ? R.playerMonster : R.enemyMonster;
  const animationFrames = () => {
    const frames = (animation().animation?.pages ?? []).flatMap((page) =>
      Array.from({ length: page.frames }, () => activeImageSource(page))
    );
    return frames.length > 0 ? frames : [activeImageSource(environment().partyIcons.icon_empty!)];
  };

  const island = (side: "player" | "enemy") => {
    const rect = side === "player" ? R.playerIsland : R.enemyIsland;
    const sourceX = side === "player" ? 0 : -192;
    return (
      <View class="absolute overflow-hidden" style={{ posType: 1, insetL: rect.x, insetT: rect.y, width: rect.width, height: rect.height }}>
        <LazyImage
          src={activeImageSource(environment().island)}
          cache={imageCache}
          active={props.active}
          class="absolute"
          style={{ posType: 1, insetL: sourceX, insetT: 0, width: environment().island.width * 2, height: environment().island.height * 2 }}
          debugName={`${side}-island`}
        />
      </View>
    );
  };

  const hud = (side: 0 | 1) => {
    const monster = side === 0 ? player : enemy;
    const shownHp = () => presentationHp(runtime(), monster().uid);
    const shownLevel = () => presentationLevel(runtime(), monster().uid);
    const shownMaxHp = () => presentationMaxHp(runtime(), monster().uid);
    const rect = side === 0 ? R.playerHud : R.enemyHud;
    const image = () => side === 0 ? environment().hud.player! : environment().hud.opponent!;
    const hp = side === 0 ? R.playerHp : R.enemyHp;
    const status = side === 0 ? R.playerStatus : R.enemyStatus;
    const icon = () => monster().status ? runtime().visuals.statusIcons[monster().status!.slug] : undefined;
    return (
      <>
        <LazyImage
          src={activeImageSource(image())}
          cache={imageCache}
          active={props.active}
          class="absolute"
          style={{ posType: 1, insetL: rect.x, insetT: rect.y, width: image().width * 2, height: image().height * 2 }}
          debugName={`${side === 0 ? "player" : "enemy"}-hud-frame`}
        />
        <Text
          class="text-xs"
          style={{
            posType: 1,
            insetL: side === 0 ? 298 : 30,
            insetT: side === 0 ? 108 : 6,
            width: side === 0 ? 170 : 180,
            height: 14,
            lineHeight: 13,
            textColor: UI_THEME.ink,
          }}
          debugName={`${side === 0 ? "player" : "enemy"}-hud-name`}
        >
          {`${title(monster().slug)}  Lv${shownLevel()} ${genderMark(monster().gender)}`}
        </Text>
        <View class="absolute" style={{ posType: 1, insetL: hp.x, insetT: hp.y }}>
          <StatBar
            current={shownHp()}
            max={shownMaxHp()}
            width={hp.width}
            height={hp.height}
            fill={hpColour(shownHp(), shownMaxHp())}
            track="#263b43"
            showNumbers={side === 0}
            theme={UI_THEME}
            debugName={`${side === 0 ? "player" : "enemy"}-hp`}
          />
        </View>
        <View
          class="absolute overflow-hidden"
          style={{ posType: 1, insetL: status.x, insetT: status.y, width: status.width, height: status.height, opacity: icon() ? 1 : 0 }}
        >
          <LazyImage
            src={activeImageSource(icon() ?? environment().partyIcons.icon_empty!)}
            cache={imageCache}
            active={props.active}
            class="absolute"
            style={{ posType: 1, insetL: 0, insetT: 0, width: (icon() ?? environment().partyIcons.icon_empty!).width * 2, height: (icon() ?? environment().partyIcons.icon_empty!).height * 2 }}
            debugName={`${side === 0 ? "player" : "enemy"}-status`}
          />
        </View>
      </>
    );
  };

  const partyTray = (side: 0 | 1) => {
    const rect = side === 0 ? R.playerTray : R.enemyTray;
    const ref = () => side === 0 ? environment().hud.playerTray! : environment().hud.opponentTray!;
    return (
      <>
        <LazyImage
          src={activeImageSource(ref())}
          cache={imageCache}
          active={props.active}
          class="absolute"
          style={{ posType: 1, insetL: rect.x, insetT: rect.y, width: ref().width * 2, height: ref().height * 2 }}
          debugName={`${side === 0 ? "player" : "enemy"}-party-tray`}
        />
        <For each={PARTY_SLOTS}>
          {(slot) => {
            const icon = () => partyIcon(runtime(), side, slot);
            return (
              <LazyImage
                src={activeImageSource(icon())}
                cache={imageCache}
                active={props.active}
                class="absolute"
                style={{
                  posType: 1,
                  insetL: rect.x + 16 + slot * 16,
                  insetT: rect.y,
                  width: icon().width * 2,
                  height: icon().height * 2,
                }}
                debugName={`${side === 0 ? "player" : "enemy"}-party-${slot}`}
              />
            );
          }}
        </For>
      </>
    );
  };

  return (
    <View
      class="absolute overflow-hidden"
      style={{ posType: 1, insetL: 0, insetT: 0, width: props.width, height: props.height, bgColor: UI_THEME.backdrop }}
      debugName="tux-battle-scene"
    >
      <View
        class="absolute overflow-hidden"
        style={{
          posType: 1,
          insetL: layout().left,
          insetT: layout().top,
          width: BATTLE_BASE_WIDTH,
          height: BATTLE_BASE_HEIGHT,
          scaleX: layout().scale,
          scaleY: layout().scale,
          originX: -0.5,
          originY: -0.5,
          bgColor: UI_THEME.backdrop,
        }}
        debugName="tux-battle-canvas"
      >
        <LazyImage
          src={activeImageSource(environment().background)}
          cache={imageCache}
          active={props.active}
          class="absolute"
          style={{ posType: 1, insetL: R.background.x, insetT: R.background.y, width: R.background.width, height: R.background.height }}
          debugName="battle-background"
        />
        {island("enemy")}
        {island("player")}
        {trainerSlot(1)}
        {trainerSlot(0)}
        {monsterSlot(enemy, enemyArt, "front", R.enemyMonster, "enemy-monster")}
        {monsterSlot(player, playerArt, "back", R.playerMonster, "player-monster")}
        <View
          class="absolute overflow-hidden"
          style={{
            posType: 1,
            insetL: animationRect().x,
            insetT: animationRect().y,
            width: animationRect().width,
            height: animationRect().height,
            opacity: animation().opacity,
          }}
          debugName="battle-animation-clip"
        >
          <FrameStrip
            frames={animationFrames()}
            cache={imageCache}
            active={props.active}
            frameTicks={animation().frameTicks}
            startTick={animation().startTick}
            nowTick={runtime().eventTicks}
            x={(128 - (animation().page?.contentWidth ?? 8) * 2) / 2 - animation().sourceX * 2}
            y={(128 - (animation().page?.contentHeight ?? 8) * 2) / 2 - animation().sourceY * 2}
            width={animationPage().width * 2}
            height={animationPage().height * 2}
            debugName="battle-animation"
          />
        </View>
        <View
          class="absolute overflow-hidden"
          style={{
            posType: 1,
            insetL: ball().x + ball().shake,
            insetT: ball().y,
            width: ballSize(),
            height: ballSize(),
            opacity: ball().opacity,
          }}
          debugName="battle-ball-clip"
        >
          <SpriteSlot
            src={activeImageSource(ballRef())}
            cache={imageCache}
            active={props.active}
            x={0}
            y={0}
            width={ballSize()}
            height={ballSize()}
            effect={NO_EFFECT}
            nowTick={runtime().eventTicks}
            debugName="battle-ball"
          />
        </View>
        {hud(1)}
        {hud(0)}
        {partyTray(1)}
        {partyTray(0)}
        <View class="absolute" style={{ posType: 1, insetL: R.playerXp.x, insetT: R.playerXp.y }}>
          <StatBar
            current={playerXp().current}
            max={playerXp().max}
            width={R.playerXp.width}
            height={R.playerXp.height}
            fill="#4faee8"
            track="#263b43"
            theme={UI_THEME}
            debugName="player-xp"
          />
        </View>
        <MessageBand
          lines={bandLines()}
          legend={presenting() ? "OK" : " "}
          width={rootVisible() || listVisible() ? R.message.width : BATTLE_BASE_WIDTH}
          theme={UI_THEME}
          style={{ insetL: 0, insetT: R.message.y }}
          debugName="battle-message"
        />
        <CommandGrid
          cells={commandCells()}
          index={Math.max(0, runtime().menuIndex - rootStart())}
          theme={UI_THEME}
          style={{ insetL: R.menu.x, insetT: R.menu.y + 4, opacity: rootVisible() ? 1 : 0 }}
          debugName="battle-commands"
        />
        <ListMenu
          title={menuTitle(runtime().menuMode)}
          rows={listRows()}
          index={runtime().menuIndex}
          visibleRows={2}
          width={232}
          labelMax={18}
          theme={UI_THEME}
          style={{ insetL: R.menu.x, insetT: R.menu.y + 3, opacity: listVisible() ? 1 : 0 }}
          debugName="battle-list"
        />
      </View>
    </View>
  );
};
