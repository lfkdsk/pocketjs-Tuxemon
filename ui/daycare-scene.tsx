import { Show, type Component } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";

import {
  daycareMenuItems,
  daycareTextPages,
  daycareWrapAll,
  type DaycareMenuItem,
  type DaycareSceneState,
} from "../battle/daycare-scenes.ts";
import type { BattleSceneViewProps } from "../vendor/pocket-rpgkit/src/ui/GameView.tsx";
import { Panel } from "../vendor/pocket-rpgkit/src/ui/Panel.tsx";
import { SceneCanvas } from "./journal-scene.tsx";
import { TUXEMON_UI_THEME } from "./tuxemon-theme.ts";

const THEME = TUXEMON_UI_THEME;

function itemLabel(state: Readonly<DaycareSceneState>, item: DaycareMenuItem): string {
  switch (item) {
    case "add": return state.labels.add;
    case "collect": return state.labels.collect;
    case "withdraw": return state.labels.withdraw;
    case "exit": return state.labels.thanks;
  }
}

function ActionRows(props: { state: DaycareSceneState }) {
  const items = () => daycareMenuItems(props.state);
  return (
    <>
      {items().map((item, index) => (
        <View
          class="absolute"
          style={{
            posType: 1,
            insetL: 5,
            insetT: 8 + index * 43,
            width: 142,
            height: 39,
            ...(props.state.phase === "summary" && index === props.state.cursor
              ? { bgColor: THEME.accent }
              : {}),
          }}
          debugName={`daycare-action-${item}`}
        >
          <Text
            class="text-xs"
            style={{
              posType: 1,
              insetL: 6,
              insetT: 4,
              width: 130,
              height: 32,
              lineHeight: 14,
              textColor: props.state.phase === "summary" && index === props.state.cursor
                ? THEME.paper
                : THEME.ink,
            }}
          >
            {daycareWrapAll(itemLabel(props.state, item), 19).join("\n")}
          </Text>
        </View>
      ))}
    </>
  );
}

function PartyRows(props: { state: DaycareSceneState }) {
  return (
    <>
      {props.state.party.map((monster, index) => (
        <View
          class="absolute"
          style={{
            posType: 1,
            insetL: 8,
            insetT: 34 + index * 27,
            width: 287,
            height: 24,
            ...(index === props.state.partyCursor ? { bgColor: THEME.accent } : {}),
          }}
          debugName={`daycare-party-${index}`}
        >
          <Text
            class="text-xs"
            style={{
              posType: 1,
              insetL: 6,
              insetT: 3,
              width: 210,
              height: 18,
              lineHeight: 16,
              textColor: index === props.state.partyCursor ? THEME.paper : THEME.ink,
            }}
          >
            {props.state.monsterNames[monster.iid!] ?? monster.nickname ?? monster.slug}
          </Text>
          <Text
            class="text-xs"
            style={{
              posType: 1,
              insetR: 6,
              insetT: 3,
              width: 66,
              height: 18,
              lineHeight: 16,
              textColor: index === props.state.partyCursor ? THEME.paper : THEME.dim,
            }}
          >
            {String(monster.level)}
          </Text>
        </View>
      ))}
    </>
  );
}

function partyHint(state: Readonly<DaycareSceneState>): string {
  return [
    `${state.labels.upKey}/${state.labels.downKey}: ${state.labels.select}`,
    `${state.labels.primaryKey}: ${state.labels.add}`,
    `${state.labels.secondaryKey}: ${state.labels.back}`,
  ].flatMap((line) => daycareWrapAll(line, 19)).join("\n");
}

function footerText(state: Readonly<DaycareSceneState>): string {
  if (state.message) return daycareWrapAll(state.message, 66).join("\n");
  if (state.phase === "party") {
    return `${state.labels.select}: ${state.labels.add}\n${state.labels.secondaryKey}: ${state.labels.back}`;
  }
  return "";
}

function SummaryFooter(props: { state: DaycareSceneState }) {
  const style = { posType: 1, width: 440, height: 11, lineHeight: 11, textColor: THEME.dim } as const;
  return (
    <>
      <Text class="text-xs" style={{ ...style, insetL: 10, insetT: 2 }}>
        {props.state.labels.leftKey}/{props.state.labels.rightKey}: {props.state.labels.summary}
      </Text>
      <Text class="text-xs" style={{ ...style, insetL: 10, insetT: 13 }}>
        {props.state.labels.upKey}/{props.state.labels.downKey}: {props.state.labels.select}
      </Text>
      <Text class="text-xs" style={{ ...style, insetL: 10, insetT: 24, width: 220 }}>
        {props.state.labels.primaryKey}: {props.state.labels.select}
      </Text>
      <Text class="text-xs" style={{ ...style, insetL: 230, insetT: 24, width: 220 }}>
        {props.state.labels.secondaryKey}: {props.state.labels.back}
      </Text>
    </>
  );
}

/** Daycare uses explicit content pagination. Unlike the shared short-copy
 * helper, no localized string is sliced or ellipsized. */
export const TuxemonDaycareScene: Component<BattleSceneViewProps> = (props) => {
  const state = (): DaycareSceneState => props.state as unknown as DaycareSceneState;
  const pages = () => daycareTextPages(state());
  const visiblePage = () => pages()[Math.min(state().page, pages().length - 1)] ?? [];
  return (
    <SceneCanvas {...props} debugName="tux-daycare-scene">
      <Text
        class="text-lg"
        style={{ posType: 1, insetL: 14, insetT: 7, width: 330, height: 22, lineHeight: 20, textColor: THEME.accent }}
        debugName="daycare-title"
      >
        {state().labels.summary}
      </Text>
      <Text
        class="text-xs"
        style={{ posType: 1, insetR: 12, insetT: 10, width: 124, height: 16, lineHeight: 14, textColor: THEME.dim }}
        debugName="daycare-page-number"
      >
        {state().phase === "summary" ? `${state().page + 1}/${pages().length}` : state().labels.add}
      </Text>

      <Panel
        theme={THEME}
        style={{ posType: 1, insetL: 8, insetT: 32, width: 312, height: 194 }}
        debugName="daycare-content-panel"
      >
        <Show
          when={state().phase !== "party"}
          fallback={
            <>
              <Text
                class="text-sm"
                style={{ posType: 1, insetL: 10, insetT: 8, width: 286, height: 20, lineHeight: 18, textColor: THEME.accent }}
                debugName="daycare-party-title"
              >
                {state().labels.add}
              </Text>
              <PartyRows state={state()} />
            </>
          }
        >
          <Text
            class="text-xs"
            style={{ posType: 1, insetL: 10, insetT: 8, width: 288, height: 176, lineHeight: 15, textColor: THEME.ink }}
            debugName="daycare-content-text"
          >
            {visiblePage().join("\n")}
          </Text>
        </Show>
      </Panel>

      <Panel
        theme={THEME}
        style={{ posType: 1, insetL: 326, insetT: 32, width: 146, height: 194 }}
        debugName="daycare-actions-panel"
      >
        <Show
          when={state().phase === "summary"}
          fallback={
            <Text
              class="text-xs"
              style={{ posType: 1, insetL: 9, insetT: 10, width: 126, height: 168, lineHeight: 15, textColor: THEME.dim }}
              debugName="daycare-party-hint"
            >
              {partyHint(state())}
            </Text>
          }
        >
          <ActionRows state={state()} />
        </Show>
      </Panel>

      <Panel
        theme={THEME}
        style={{ posType: 1, insetL: 8, insetT: 228, width: 464, height: 40 }}
        debugName="daycare-footer"
      >
        <Show
          when={state().message !== null || state().phase === "party"}
          fallback={<SummaryFooter state={state()} />}
        >
          <Text
            class="text-xs"
            style={{ posType: 1, insetL: 10, insetT: 2, width: 440, height: 35, lineHeight: 11, textColor: state().message ? THEME.ink : THEME.dim }}
            debugName="daycare-footer-text"
          >
            {footerText(state())}
          </Text>
        </Show>
      </Panel>
    </SceneCanvas>
  );
};
