import { Show, type Component } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";

import {
  journalEntryStatus,
  selectedJournalEntry,
  type JournalSceneState,
  type MonsterPickerSceneState,
  type TuxemonSceneCatalog,
} from "../battle/scenes.ts";
import type { BattleSceneViewProps } from "../vendor/pocket-rpgkit/src/ui/GameView.tsx";
import { Panel } from "../vendor/pocket-rpgkit/src/ui/Panel.tsx";
import {
  createBattleImageCache,
  LazyImage,
  type TileImageSource,
} from "../vendor/pocket-rpgkit/src/ui/battle/index.ts";
import type { BattleImageRef } from "../importer/battle-schema.ts";
import { TUXEMON_UI_THEME } from "./tuxemon-theme.ts";

export { TUXEMON_UI_THEME } from "./tuxemon-theme.ts";

const BASE_WIDTH = 480;
const BASE_HEIGHT = 272;
const VISIBLE_ROWS = 8;

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

function canvas(width: number, height: number) {
  const scale = Math.min(width / BASE_WIDTH, height / BASE_HEIGHT);
  return {
    scale,
    left: Math.floor((width - BASE_WIDTH * scale) / 2),
    top: Math.floor((height - BASE_HEIGHT * scale) / 2),
  };
}

function wrapped(text: string, columns: number, lines: number): string {
  const output: string[] = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (!current) current = word;
      else if (current.length + 1 + word.length <= columns) current += ` ${word}`;
      else {
        output.push(current);
        current = word;
      }
      if (output.length === lines) break;
    }
    if (output.length < lines && current) output.push(current);
    if (output.length === lines) break;
  }
  if (output.length === lines && output[lines - 1]!.length > columns - 3) {
    output[lines - 1] = `${output[lines - 1]!.slice(0, columns - 3)}...`;
  }
  return output.join("\n");
}

function SceneCanvas(props: BattleSceneViewProps & { children: unknown; debugName: string }) {
  const layout = () => canvas(props.width, props.height);
  return (
    <View
      class="absolute overflow-hidden"
      style={{ posType: 1, insetL: 0, insetT: 0, width: props.width, height: props.height, bgColor: TUXEMON_UI_THEME.backdrop }}
      debugName={props.debugName}
    >
      <View
        class="absolute overflow-hidden"
        style={{
          posType: 1,
          insetL: layout().left,
          insetT: layout().top,
          width: BASE_WIDTH,
          height: BASE_HEIGHT,
          scaleX: layout().scale,
          scaleY: layout().scale,
          originX: -0.5,
          originY: -0.5,
          bgColor: TUXEMON_UI_THEME.backdrop,
        }}
      >
        {props.children as never}
      </View>
    </View>
  );
}

export function createTuxemonJournalScene(catalog: Readonly<TuxemonSceneCatalog>): Component<BattleSceneViewProps> {
  return (props) => {
    const imageCache = createBattleImageCache(() => props.active, { maxEntries: 2 });
    const activeImageSource = (ref: BattleImageRef): TileImageSource => {
      if (props.active) imageCache.beginScope();
      return imageSource(ref);
    };
    const state = (): JournalSceneState => props.state as unknown as JournalSceneState;
    const selected = () => selectedJournalEntry(state(), catalog);
    const status = () => selected() ? journalEntryStatus(state(), selected()!.id) : "unknown";
    // Unknown rows deliberately do not touch the lazy monster repository.
    // Selecting a known/revealed row resolves exactly that one shard.
    const detail = () => (status() === "unknown" && state().revealed !== selected()?.id) || !selected()
      ? undefined
      : catalog.monster(selected()!.id);
    const rowStart = () => Math.max(0, Math.min(
      Math.max(0, catalog.index.length - VISIBLE_ROWS),
      state().cursor - Math.floor(VISIBLE_ROWS / 2),
    ));
    const visible = () => catalog.index.slice(rowStart(), rowStart() + VISIBLE_ROWS);
    const statusLabel = () => status() === "caught" ? "CAUGHT"
      : status() === "seen" ? "SEEN"
        : state().revealed === selected()?.id ? "PREVIEW" : "UNKNOWN";

    return (
      <SceneCanvas {...props} debugName="tux-journal-scene">
        <Text
          class="text-lg"
          style={{ posType: 1, insetL: 14, insetT: 7, width: 300, height: 22, lineHeight: 20, textColor: TUXEMON_UI_THEME.accent }}
          debugName="journal-title"
        >
          TUXEPEDIA
        </Text>
        <Text
          class="text-xs"
          style={{ posType: 1, insetR: 12, insetT: 10, width: 200, height: 16, lineHeight: 14, textColor: TUXEMON_UI_THEME.dim }}
        >
          {state().revealed === null ? "D-pad: browse  A/B: close" : "A/B: close"}
        </Text>

        <Panel
          theme={TUXEMON_UI_THEME}
          style={{ posType: 1, insetL: 8, insetT: 32, width: 190, height: 232 }}
          debugName="journal-list-panel"
        >
          {visible().map((entry, offset) => {
            const index = rowStart() + offset;
            const selectedRow = () => index === state().cursor;
            const entryStatus = () => journalEntryStatus(state(), entry.id);
            const preview = () => state().revealed === entry.id && entryStatus() === "unknown";
            const marker = () => entryStatus() === "caught" ? "C"
              : entryStatus() === "seen" ? "S" : preview() ? "P" : "?";
            const label = () => entryStatus() === "unknown" && !preview() ? "???" : entry.name;
            return (
              <View
                class="absolute"
                style={{
                  posType: 1,
                  insetL: 5,
                  insetT: 7 + offset * 27,
                  width: 176,
                  height: 24,
                  ...(selectedRow() ? { bgColor: TUXEMON_UI_THEME.accent } : {}),
                }}
                debugName={`journal-row-${index}`}
              >
                <Text
                  class="text-xs"
                  style={{ posType: 1, insetL: 4, insetT: 3, width: 38, height: 18, lineHeight: 16, textColor: selectedRow() ? TUXEMON_UI_THEME.paper : TUXEMON_UI_THEME.dim }}
                >
                  {`#${String(entry.txmnId).padStart(3, "0")}`}
                </Text>
                <Text
                  class="text-xs"
                  style={{ posType: 1, insetL: 47, insetT: 3, width: 108, height: 18, lineHeight: 16, textColor: selectedRow() ? TUXEMON_UI_THEME.paper : TUXEMON_UI_THEME.ink }}
                >
                  {label().slice(0, 16)}
                </Text>
                <Text
                  class="text-xs"
                  style={{ posType: 1, insetR: 4, insetT: 3, width: 10, height: 18, lineHeight: 16, textColor: selectedRow() ? TUXEMON_UI_THEME.paper : TUXEMON_UI_THEME.accent }}
                >
                  {marker()}
                </Text>
              </View>
            );
          })}
        </Panel>

        <Panel
          theme={TUXEMON_UI_THEME}
          style={{ posType: 1, insetL: 204, insetT: 32, width: 268, height: 232 }}
          debugName="journal-detail-panel"
        >
          <Text
            class="text-lg"
            style={{ posType: 1, insetL: 12, insetT: 8, width: 180, height: 24, lineHeight: 21, textColor: TUXEMON_UI_THEME.accent }}
            debugName="journal-monster-name"
          >
            {status() === "unknown" && state().revealed !== selected()?.id
              ? "Unknown Tuxemon"
              : selected()?.name ?? "Tuxemon"}
          </Text>
          <Text
            class="text-xs"
            style={{ posType: 1, insetR: 10, insetT: 10, width: 58, height: 16, lineHeight: 14, textColor: TUXEMON_UI_THEME.dim }}
            debugName="journal-status"
          >
            {statusLabel()}
          </Text>
          <Show
            when={detail()}
            fallback={
              <Text
                class="text-lg"
                style={{ posType: 1, insetL: 104, insetT: 83, width: 64, height: 30, lineHeight: 26, textColor: TUXEMON_UI_THEME.dim }}
                debugName="journal-unknown"
              >
                ???
              </Text>
            }
          >
            {(monster) => (
              <>
                <View
                  class="absolute overflow-hidden"
                  style={{ posType: 1, insetL: 68, insetT: 30, width: 128, height: 128 }}
                  debugName="journal-monster-clip"
                >
                  <LazyImage
                    src={activeImageSource(monster().art.sheet)}
                    cache={imageCache}
                    active={props.active}
                    class="absolute"
                    style={{
                      posType: 1,
                      insetL: -monster().art.front[0] * 2,
                      insetT: -monster().art.front[1] * 2,
                      width: monster().art.sheet.width * 2,
                      height: monster().art.sheet.height * 2,
                    }}
                    debugName="journal-monster-art"
                  />
                </View>
                <Text
                  class="text-xs"
                  style={{ posType: 1, insetL: 12, insetT: 160, width: 244, height: 17, lineHeight: 15, textColor: TUXEMON_UI_THEME.dim }}
                  debugName="journal-facts"
                >
                  {`${monster().types.map(title).join(" / ")}   ${monster().height} cm   ${monster().weight} kg`}
                </Text>
                <Text
                  class="text-xs"
                  style={{ posType: 1, insetL: 12, insetT: 179, width: 244, height: 48, lineHeight: 12, textColor: TUXEMON_UI_THEME.ink }}
                  debugName="journal-description"
                >
                  {wrapped(monster().description, 38, 4)}
                </Text>
              </>
            )}
          </Show>
        </Panel>
      </SceneCanvas>
    );
  };
}

export const TuxemonMonsterPickerScene: Component<BattleSceneViewProps> = (props) => {
  const state = (): MonsterPickerSceneState => props.state as unknown as MonsterPickerSceneState;
  return (
    <SceneCanvas {...props} debugName="tux-monster-picker-scene">
      <Panel
        theme={TUXEMON_UI_THEME}
        style={{ posType: 1, insetL: 70, insetT: 28, width: 340, height: 216 }}
        debugName="monster-picker-panel"
      >
        <Text
          class="text-lg"
          style={{ posType: 1, insetL: 14, insetT: 10, width: 280, height: 24, lineHeight: 21, textColor: TUXEMON_UI_THEME.accent }}
        >
          {state().title}
        </Text>
        {state().entries.map((entry, index) => (
          <View
            class="absolute"
            style={{
              posType: 1,
              insetL: 12,
              insetT: 40 + index * 24,
              width: 312,
              height: 21,
              ...(index === state().cursor ? { bgColor: TUXEMON_UI_THEME.accent } : {}),
            }}
            debugName={`monster-picker-row-${index}`}
          >
            <Text
              class="text-sm"
              style={{ posType: 1, insetL: 8, insetT: 2, width: 260, height: 19, lineHeight: 17, textColor: index === state().cursor ? TUXEMON_UI_THEME.paper : TUXEMON_UI_THEME.ink }}
            >
              {entry.label}
            </Text>
          </View>
        ))}
        <Text
          class="text-xs"
          style={{ posType: 1, insetL: 14, insetB: 8, width: 280, height: 16, lineHeight: 14, textColor: TUXEMON_UI_THEME.dim }}
        >
          A: rename  B: return
        </Text>
      </Panel>
    </SceneCanvas>
  );
};
