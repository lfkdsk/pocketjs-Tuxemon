import type { Component } from "solid-js";
import { createWorldRenderer } from "../vendor/pocket-rpgkit/src/ui/world/index.ts";
import type {
  GameViewWorldConfig,
  GameViewWorldRenderProps,
} from "../vendor/pocket-rpgkit/src/ui/world-contract.ts";
import { placedMapAccessor } from "./world-renderer-state.ts";

/** Game-side adapter around the kit's opt-in factory. Outdoor rendering is
 * unchanged; unplaced/indoor maps remain on GameView's legacy fast path. */
export function createGameWorldRenderer(): GameViewWorldConfig {
  const factory = createWorldRenderer();
  return {
    create(host) {
      const runtime = factory.create(host);
      const fallbackMapId = host.layout.components[0]?.placements[0]?.mapId;
      if (!fallbackMapId) return runtime;
      const BaseView = runtime.View;
      const SafeView: Component<GameViewWorldRenderProps> = (props) => {
        const activeMapId = placedMapAccessor(props.activeMapId, runtime.hasMap, fallbackMapId);
        return (
          <BaseView
            activeMapId={activeMapId}
            camera={props.camera}
            viewport={props.viewport}
            active={props.active}
            stream={props.stream}
            animated={props.animated}
            ground={props.ground}
            upper={props.upper}
            below={props.below}
            actors={props.actors}
            above={props.above}
            actorHost={props.actorHost}
            onStreamStats={props.onStreamStats}
            onAnimatedStats={props.onAnimatedStats}
          />
        );
      };
      return { ...runtime, View: SafeView };
    },
  };
}
