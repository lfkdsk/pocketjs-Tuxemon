// Composes the kit's audio effects with the weather overlay's state bridge.
// The effects slot is the only GameView child that receives a live
// `state: () => SessionState` accessor; storing it in the bridge lets the
// sibling WeatherOverlay read reducer state without a kit change.

import type { GameEffectsComponent, GameEffectsProps } from "../vendor/pocket-rpgkit/src/ui/GameView.tsx";
import { createAudioEffects } from "../vendor/pocket-rpgkit/src/ui/audio/index.ts";
import type { WeatherStateBridge } from "./weather-overlay.tsx";

export function createGameEffects(
  audioResources: Readonly<Record<string, string>>,
): { Effects: GameEffectsComponent; bridge: WeatherStateBridge } {
  const bridge: WeatherStateBridge = { get: null };
  const Audio = createAudioEffects(audioResources);
  function Effects(props: GameEffectsProps) {
    bridge.get = props.state;
    return <Audio {...props} />;
  }
  return { Effects, bridge };
}
