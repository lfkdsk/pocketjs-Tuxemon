import type { ScreenColor } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import type { StageOfDay } from "./time-weather.ts";

/** This layer is intentionally distinct from imported set_layer overlays. */
export const DAYLIGHT_TINT_LAYER = "tux.daylight";
export const DAYLIGHT_STAGE_VARIABLE = "tux.daylight.stage";
export const DAYLIGHT_TARGET_VARIABLE = "tux.daylight.target";
export const DAYLIGHT_TWEEN_SECONDS = 4;

export interface DaylightTintProfile {
  stage: StageOfDay;
  marker: number;
  color: ScreenColor;
}

/**
 * A restrained grade over the original art. Morning is transparent, while
 * dawn/dusk add warmth and night adds a dark blue veil. The screenTint
 * reducer interpolates between these targets on its fixed reference clock.
 */
export const DAYLIGHT_TINT_PROFILES: readonly DaylightTintProfile[] = Object.freeze([
  { stage: "dawn", marker: 1, color: { r: 184, g: 88, b: 72, a: 44 } },
  { stage: "morning", marker: 2, color: { r: 255, g: 255, b: 255, a: 0 } },
  { stage: "afternoon", marker: 3, color: { r: 255, g: 216, b: 128, a: 12 } },
  { stage: "dusk", marker: 4, color: { r: 112, g: 48, b: 128, a: 64 } },
  { stage: "night", marker: 5, color: { r: 8, g: 24, b: 80, a: 120 } },
]);
