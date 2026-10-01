// @title Pocket Tuxemon — the imported Tuxemon world on Pocket RPG Kit
import { gp1Mark } from "./ui/gp1-marks.ts";
import {
  mount,
  pakGet,
  fsHost,
  readFileSync,
  createJsonMapRepository,
  GameView,
} from "./ui/gp1-kit-stage.ts";
import type { ProjectShell } from "./vendor/pocket-rpgkit/src/engine/types.ts";
import {
  rawProject,
  GAME_ASSETS,
  ANIMATED_INDEX,
  NPC_SRC_INDEX,
  TERRAIN_STREAM_META,
  TERRAIN_STREAM_GROUND_INDEX,
  TERRAIN_STREAM_UPPER_INDEX,
  BATTLE_ASSET_PATHS,
  NPC_SRC_ASSET_PATHS,
  ANIMATED_ATLAS_NAMES,
  createProductionTuxemonBattle,
  TuxemonBattleScene,
} from "./ui/gp1-data-stage.ts";
import { createAnimatedProvider } from "./ui/animated-repository.ts";
import { createNpcSrcProvider } from "./ui/npc-src-repository.ts";
import { createTerrainStreamProvider } from "./ui/terrain-stream-repository.ts";

// ui/gp1-kit-stage.ts and ui/gp1-data-stage.ts are thin re-export wrappers:
// each one's trailing gp1Mark() call fires right
// after everything it imports has finished evaluating, so
// tools/bench-g6-quickjs.sh can read globalThis.__gp1Marks after boot and
// report which startup stage — engine/kit bundle, JSON literals/module
// init, battle-rule registration, or GameView mount — actually costs time.
const project = rawProject as unknown as ProjectShell;
// splitProjectMaps/splitBattleRuntimeDb/splitAnimatedTiles/splitNpcSrc/
// splitStreamRefs emit ASCII bytes. Supplying bytes, rather than a decoded
// string, selects the bounded QuickJS fast decode path. The desktop
// launcher stages entries in data.fs; web and consoles use the pak that
// their host installs before evaluating this bundle. Maps, battle shards,
// animated-tile shards, NPC sprite shards, and terrain-stream shards all
// share this same entry-keyed convention, so one reader serves all of them.
const readEntry = (entry: string) => fsHost() ? readFileSync(entry) : pakGet(entry);
const repository = createJsonMapRepository(project.mapIndex, { read: readEntry });
const { extensions, rules } = createProductionTuxemonBattle({ read: readEntry });
gp1Mark("battle-registration");
// The generated literal list is the build-time asset root. Battle UI resolves
// these paths dynamically from battle-db at runtime.
void BATTLE_ASSET_PATHS;
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
    project={project}
    maps={repository}
    extensions={extensions}
    battle={rules}
    battleScene={TuxemonBattleScene}
    assets={assets}
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
