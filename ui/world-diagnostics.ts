import { startSession } from "../vendor/pocket-rpgkit/src/engine/session.ts";
import type { AnimatedTilesStats } from "../vendor/pocket-rpgkit/src/ui/AnimatedTiles.tsx";
import type { GameViewOverlayConfig } from "../vendor/pocket-rpgkit/src/ui/demo-contract.ts";
import type { WorldStreamedTerrainStats } from "../vendor/pocket-rpgkit/src/ui/WorldStreamedTerrain.tsx";
import type { GameWorldCacheSnapshot } from "./world-cache.ts";

export interface WorldVisitRequest {
  seq: number;
  mapId: string;
  x?: number;
  y?: number;
}

/** Mutable diagnostics object installed by sim/QuickJS verification before
 * the production bundle evaluates. Normal launches leave it undefined, so
 * GameView receives none of the diagnostic callbacks or overlay wrapper. */
export interface PocketTuxemonWorldDiagnostics {
  /** Visual-test-only: mount the ordinary demo controller in a zh_CN boot
   *  so its translated chrome can be inspected without making the English
   *  journey tape available to Chinese players. */
  enableZhDemo?: boolean;
  request?: WorldVisitRequest;
  acknowledged?: number;
  maps?: readonly string[];
  links?: Readonly<Record<string, readonly string[]>>;
  cache?: GameWorldCacheSnapshot;
  stream?: Partial<Record<"ground" | "upper", WorldStreamedTerrainStats>>;
  animated?: Partial<Record<"below" | "above", AnimatedTilesStats>>;
}

declare global {
  // eslint-disable-next-line no-var
  var __pocketTuxemonWorldDiagnostics: PocketTuxemonWorldDiagnostics | undefined;
}

/** Wrap the ordinary save overlay with a verification-only map-entry driver.
 * Each request starts from the current persistent switch/extension state and
 * performs the same fresh map-entry construction as a normal session start.
 * It does not alter project data, traversal mode, or the production reducer. */
export function withWorldDiagnostics(
  base: GameViewOverlayConfig,
  diagnostics: PocketTuxemonWorldDiagnostics,
): GameViewOverlayConfig {
  return {
    create(host) {
      const runtime = base.create(host);
      let handled = diagnostics.acknowledged ?? -1;
      return {
        isOpen: () => runtime.isOpen(),
        render: (theme, uiText) => runtime.render(theme, uiText),
        step(buttons, pressed) {
          const request = diagnostics.request;
          if (request && request.seq !== handled) {
            const meta = host.session.mapIndex?.get(request.mapId);
            if (!meta) throw new Error(`world diagnostics: unknown map ${JSON.stringify(request.mapId)}`);
            const current = host.getState();
            const x = Math.max(0, Math.min(meta.width - 1, request.x ?? Math.floor(meta.width / 2)));
            const y = Math.max(0, Math.min(meta.height - 1, request.y ?? Math.floor(meta.height / 2)));
            const source = {
              ...host.project,
              start: { map: request.mapId, x, y, dir: "down" as const },
            };
            const next = startSession(source, host.session, current.sw, current.ext);
            host.replaceState(next);
            handled = request.seq;
            diagnostics.acknowledged = request.seq;
            return { consumed: true, stateChanged: true };
          }
          return runtime.step(buttons, pressed);
        },
      };
    },
  };
}
