// @title Pocket Tuxemon — the imported Tuxemon world on Pocket RPG Kit
import { gp1Mark } from "./ui/gp1-marks.ts";
import { mount, fsHost, GameView } from "./ui/gp1-kit-stage.ts";
import { createGameMapRepository } from "./ui/entry-readers.ts";
import type { ProjectShell } from "./vendor/pocket-rpgkit/src/engine/types.ts";
import {
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
} from "./ui/gp1-data-stage.ts";
import { createAnimatedProvider } from "./ui/animated-repository.ts";
import { createNpcSrcProvider } from "./ui/npc-src-repository.ts";
import { createTerrainStreamProvider } from "./ui/terrain-stream-repository.ts";
import {
  timeWeatherAt,
  timeWeatherFromLocalDate,
  type CivilDateTime,
} from "./battle/time-weather.ts";
import { createAudioEffects } from "./vendor/pocket-rpgkit/src/ui/audio/index.ts";

// ui/gp1-kit-stage.ts and ui/gp1-data-stage.ts are thin re-export wrappers:
// each one's trailing gp1Mark() call fires right
// after everything it imports has finished evaluating, so
// tools/bench-g6-quickjs.sh can read globalThis.__gp1Marks after boot and
// report which startup stage — engine/kit bundle, JSON literals/module
// init, battle-rule registration, or GameView mount — actually costs time.
const project = rawProject as unknown as ProjectShell;
// splitProjectMaps/splitBattleRuntimeDb/splitAnimatedTiles/splitNpcSrc/
// splitStreamRefs emit ASCII JSON. Desktop reads map entries through the
// optional native UTF-8 text channel (KP2) and every other shard through
// data.fs bytes; web and consoles use the pak installed before this bundle
// runs. ui/entry-readers.ts wires both paths for the map repository and
// the battle/animated/npc-src/terrain-stream providers.
const { repository, readEntry } = createGameMapRepository(project.mapIndex, fsHost());
// The effect shell samples local wall time exactly once for a fresh game.
// Reducer, render, save/restore, and rewind only see the resulting plain
// state. Simulators and CI inject the fixed override before bundle eval.
const initialCivilTime = (globalThis as typeof globalThis & {
  __pocketTuxemonInitialCivilTime?: CivilDateTime;
}).__pocketTuxemonInitialCivilTime;
const initialTimeWeather = initialCivilTime === undefined
  ? timeWeatherFromLocalDate(new Date())
  : timeWeatherAt(initialCivilTime);
const { extensions, rules } = createProductionTuxemonBattle(
  { read: readEntry },
  { initialTimeWeather },
);
gp1Mark("battle-registration");
// Same reason: NPC_SRC's sprite-frame paths now live in dist/npc-src shards
// instead of a scanned TS literal, so this keeps them reachable for the pak
// baker. GameView resolves the actual paths dynamically via npcSrc.
void NPC_SRC_ASSET_PATHS;
// Same reason: ANIMATED's atlas names now live in dist/animated shards.
void ANIMATED_ATLAS_NAMES;
const assets = {
  ...GAME_ASSETS,
  animated: createAnimatedProvider(ANIMATED_INDEX, { read: readEntry }),
  npcSrc: createNpcSrcProvider(NPC_SRC_INDEX, { read: readEntry }),
  stream: createTerrainStreamProvider(
    TERRAIN_STREAM_META,
    TERRAIN_STREAM_GROUND_INDEX,
    TERRAIN_STREAM_UPPER_INDEX,
    { read: readEntry },
  ),
};

mount(() => (
  <GameView
    immutableState
    project={project}
    maps={repository}
    extensions={extensions}
    battle={rules}
    battleScene={TuxemonBattleScene}
    assets={assets}
    effects={createAudioEffects(project.audio ?? {})}
    theme={{
      border: "#224f68",
      rim: "#65d5c3",
      paper: "#102b3a",
      ink: "#f5f1d7",
      dim: "#9cc8c1",
      accent: "#ffd15c",
      backdrop: "#06141d",
    }}
  />
));
gp1Mark("mount");
