// @title Pocket Tuxemon — the imported Tuxemon world on Pocket RPG Kit
import { gp1Mark } from "./ui/gp1-marks.ts";
import {
  mount,
  fsHost,
  GameView,
  NAME_INPUT_SCENE_ID,
  NameInputScene,
} from "./ui/gp1-kit-stage.ts";
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
  createTuxemonJournalScene,
  TUXEMON_JOURNAL_SCENE_ID,
  TUXEMON_MONSTER_PICKER_SCENE_ID,
  TUXEMON_UI_THEME,
  TuxemonBattleScene,
  TuxemonMonsterPickerScene,
  createTuxemonMonsterShopScene,
  createTuxemonTradeScene,
  TuxemonPcScene,
  TUXEMON_MONSTER_SHOP_SCENE_ID,
  TUXEMON_PC_SCENE_ID,
  TUXEMON_TRADE_SCENE_ID,
  TUXEMON_DAYCARE_SCENE_ID,
  TuxemonDaycareScene,
} from "./ui/gp1-data-stage.ts";
import { createAnimatedProvider } from "./ui/animated-repository.ts";
import { createSaveMenu } from "./ui/save-menu.tsx";
import { createNpcSrcProvider } from "./ui/npc-src-repository.ts";
import { createTerrainStreamProvider } from "./ui/terrain-stream-repository.ts";
import { createGameWorldAssetCache } from "./ui/world-cache.ts";
import {
  type PocketTuxemonWorldDiagnostics,
  withWorldDiagnostics,
} from "./ui/world-diagnostics.ts";
import { createGameWorldRenderer } from "./ui/world-renderer.tsx";
import { ChoiceIconBox } from "./vendor/pocket-rpgkit/src/ui/ChoiceIconBox.tsx";
import { createDemo } from "./vendor/pocket-rpgkit/src/ui/demo/index.ts";
import { createWorldCacheDriver } from "./vendor/pocket-rpgkit/src/ui/world-cache-driver.ts";
import type { WorldStreamedTerrainStats } from "./vendor/pocket-rpgkit/src/ui/WorldStreamedTerrain.tsx";
import { createDemoOptions } from "./ui/demo-tape.ts";
import type {
  GameViewDemoConfig,
  GameViewDemoRuntime,
  GameViewOverlayConfig,
} from "./vendor/pocket-rpgkit/src/ui/demo-contract.ts";
import {
  DEFAULT_TICKS_PER_GAME_MINUTE,
  timeWeatherAt,
  timeWeatherFromLocalDate,
  type CivilDateTime,
} from "./battle/time-weather.ts";
import { WeatherOverlay } from "./ui/weather-overlay.tsx";
import { weatherOverlaySuspended } from "./ui/weather-overlay-policy.ts";
import { createGameEffects } from "./ui/weather-effects.tsx";

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
// Deterministic builds may also pin the opening weather (screenshots,
// weather fixtures); production always starts sunny.
const initialWeather = (globalThis as typeof globalThis & {
  __pocketTuxemonInitialWeather?: { slug: string };
}).__pocketTuxemonInitialWeather;
const initialTimeWeather = initialCivilTime === undefined
  ? timeWeatherFromLocalDate(new Date())
  : timeWeatherAt(
    initialCivilTime,
    DEFAULT_TICKS_PER_GAME_MINUTE,
    initialWeather?.slug ?? "sunny",
  );
const { extensions, rules, scenes, catalog } = createProductionTuxemonBattle(
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
const animated = createAnimatedProvider(ANIMATED_INDEX, { read: readEntry });
const npcSrc = createNpcSrcProvider(NPC_SRC_INDEX, { read: readEntry });
const stream = createTerrainStreamProvider(
  TERRAIN_STREAM_META,
  TERRAIN_STREAM_GROUND_INDEX,
  TERRAIN_STREAM_UPPER_INDEX,
  { read: readEntry },
);
const assets = {
  ...GAME_ASSETS,
  animated,
  npcSrc,
  stream,
};
const worldDiagnostics: PocketTuxemonWorldDiagnostics | undefined =
  globalThis.__pocketTuxemonWorldDiagnostics;
if (worldDiagnostics) {
  worldDiagnostics.maps = project.worldLayout!.components.flatMap((component) =>
    component.placements.map((placement) => placement.mapId)
  );
  const links: Record<string, string[]> = Object.fromEntries(
    worldDiagnostics.maps.map((mapId) => [mapId, []]),
  );
  for (const component of project.worldLayout!.components) {
    for (const opening of component.openings) {
      links[opening.source.mapId]!.push(opening.target.mapId);
    }
  }
  for (const values of Object.values(links)) {
    values.splice(0, values.length, ...new Set(values));
    values.sort();
  }
  worldDiagnostics.links = links;
}
const worldAssetCache = createGameWorldAssetCache(project.worldLayout!, {
  stream,
  animated,
  npcSrc,
}, worldDiagnostics
  ? (stats) => { worldDiagnostics.cache = stats; }
  : undefined);
const { Effects, bridge: weatherBridge } = createGameEffects(project.audio ?? {});

// Allocation-regression switch: when false, the particle overlay is not
// mounted at all, so the QuickJS mem-walk probe can diff overlay on/off on
// the same tape window. Production builds leave the global unset.
const weatherOverlayEnabled = (globalThis as typeof globalThis & {
  __pocketTuxemonWeatherOverlay?: boolean;
}).__pocketTuxemonWeatherOverlay !== false;

// START opens the save/load menu. It is a GameView overlay: it reads and
// replaces the live session through the overlay host, independent of the
// demo menu on SELECT, and START does nothing while the demo menu is open.
let demoMenu: GameViewDemoRuntime | null = null;
const demoConfig = createDemo(createDemoOptions(readEntry));
const demo: GameViewDemoConfig = {
  create(host) {
    demoMenu = demoConfig.create(host);
    return demoMenu;
  },
};
let saveMenuRuntime: GameViewDemoRuntime | null = null;
const saveMenuConfig = createSaveMenu({ suspended: () => demoMenu?.isOpen() ?? false });
const baseSaveMenu: GameViewOverlayConfig = {
  create(host) {
    saveMenuRuntime = saveMenuConfig.create(host);
    return saveMenuRuntime;
  },
};
const saveMenu = worldDiagnostics
  ? withWorldDiagnostics(baseSaveMenu, worldDiagnostics)
  : baseSaveMenu;

mount(() => (
  <>
    <GameView
      immutableState
      project={project}
      maps={repository}
      extensions={extensions}
      battle={rules}
      battleScene={TuxemonBattleScene}
      scenes={scenes}
      sceneViews={{
        [NAME_INPUT_SCENE_ID]: NameInputScene,
        [TUXEMON_JOURNAL_SCENE_ID]: createTuxemonJournalScene(catalog),
        [TUXEMON_MONSTER_PICKER_SCENE_ID]: TuxemonMonsterPickerScene,
        [TUXEMON_PC_SCENE_ID]: TuxemonPcScene,
        [TUXEMON_TRADE_SCENE_ID]: createTuxemonTradeScene(catalog),
        [TUXEMON_MONSTER_SHOP_SCENE_ID]: createTuxemonMonsterShopScene(catalog),
        [TUXEMON_DAYCARE_SCENE_ID]: TuxemonDaycareScene,
      }}
      assets={assets}
      world={createGameWorldRenderer()}
      createWorldCacheDriver={(session, layout) => createWorldCacheDriver(session, layout, {
        onStats: worldAssetCache.onWorldCacheStats,
      })}
      onMapChange={worldAssetCache.onMapChange}
      onStreamStats={(_layer, stats) => {
        const worldStats = stats as WorldStreamedTerrainStats;
        if (worldDiagnostics) {
          const byLayer = worldDiagnostics.stream ?? (worldDiagnostics.stream = {});
          byLayer[_layer] = worldStats;
        }
        if (worldStats.visibleMaps) worldAssetCache.onVisibleMaps(worldStats.visibleMaps);
      }}
      onAnimatedStats={(layer, stats) => {
        if (!worldDiagnostics) return;
        const byLayer = worldDiagnostics.animated ?? (worldDiagnostics.animated = {});
        byLayer[layer] = stats;
      }}
      choiceIcons={ChoiceIconBox}
      demo={demo}
      overlay={saveMenu}
      effects={Effects}
      theme={TUXEMON_UI_THEME}
    />
    {weatherOverlayEnabled && (
      <WeatherOverlay
        bridge={weatherBridge}
        suspended={() => weatherOverlaySuspended(demoMenu, saveMenuRuntime)}
      />
    )}
  </>
));
gp1Mark("mount");
