// Stage-boundary wrapper for the QuickJS startup bench: re-exports every bundled JSON literal / data module main.tsx
// needs — project-shell.json, ui/game-assets.ts, ui/battle-assets.ts,
// battle/production.ts (which itself imports dist/battle-runtime-shell.json)
// and ui/battle-scene.tsx — then marks "json-literals" as its own trailing
// top-level statement. That mark fires exactly when this stage (the "big
// JSON literals / module init" stage) has finished evaluating, after
// ui/gp1-kit-stage.ts's "engine" mark and before main.tsx's own body (which
// marks "battle-registration" and "mount").
import rawProject from "../dist/project-shell.json";
import { GAME_ASSETS, ANIMATED_INDEX, NPC_SRC_INDEX } from "./game-assets.ts";
import {
  TERRAIN_STREAM_META,
  TERRAIN_STREAM_GROUND_INDEX,
  TERRAIN_STREAM_UPPER_INDEX,
} from "./terrain-assets.ts";
import { NPC_SRC_ASSET_PATHS } from "./npc-src-assets.ts";
import { ANIMATED_ATLAS_NAMES } from "./animated-assets.ts";
import { createProductionTuxemonBattle } from "../battle/production.ts";
import { TuxemonBattleScene } from "./battle-scene.tsx";
import { gp1Mark } from "./gp1-marks.ts";

export {
  rawProject,
  GAME_ASSETS,
  ANIMATED_INDEX,
  NPC_SRC_INDEX,
  TERRAIN_STREAM_META,
  TERRAIN_STREAM_GROUND_INDEX,
  TERRAIN_STREAM_UPPER_INDEX,
  NPC_SRC_ASSET_PATHS,
  ANIMATED_ATLAS_NAMES,
  createProductionTuxemonBattle,
  TuxemonBattleScene,
};

gp1Mark("json-literals");
