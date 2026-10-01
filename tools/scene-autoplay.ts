import { BTN_BITS } from "../vendor/pocket-rpgkit/src/engine/camera.ts";
import type { JsonValue } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import { NAME_INPUT_SCENE_ID } from "../vendor/pocket-rpgkit/src/engine/name-input.ts";
import {
  TUXEMON_JOURNAL_SCENE_ID,
  TUXEMON_MONSTER_PICKER_SCENE_ID,
} from "../battle/scenes.ts";

const BTN_CONFIRM = 0x2000;
const BTN_CANCEL = 0x4000;

interface ActiveGameScene {
  kind: "scene";
  id: string;
  state: JsonValue;
}

interface NameInputProjection {
  buffer: string;
  cursor: number;
  charset: string[];
}

/** Deterministic policy used only by generated acceptance journeys. It names
 * the player "A", chooses the current party row, and closes read-only journal
 * pages; production input remains entirely user-driven. */
export function utilitySceneAutoplayMask(scene: Readonly<ActiveGameScene>): number {
  if (scene.id === NAME_INPUT_SCENE_ID) {
    const state = scene.state as unknown as NameInputProjection;
    if (state.buffer.length === 0) return BTN_CONFIRM;
    const ok = state.charset.length + 1;
    return state.cursor === ok ? BTN_CONFIRM : BTN_BITS.LEFT;
  }
  if (scene.id === TUXEMON_MONSTER_PICKER_SCENE_ID) return BTN_CONFIRM;
  if (scene.id === TUXEMON_JOURNAL_SCENE_ID) return BTN_CANCEL;
  throw new Error(`journey: no autoplay policy for scene ${JSON.stringify(scene.id)}`);
}
