// QuickJS-only benchmark entry for measuring every sharded map's cold path.
// It is built into a scratch directory by bench-g6-quickjs.sh and is never
// part of the shipped game bundle.

import { mount } from "@pocketjs/framework";
import { View } from "@pocketjs/framework/components";
import { readFileSync } from "@pocketjs/framework/fs";
import rawProject from "../dist/project-shell.json";
import {
  acquireSessionMap,
  createSession,
  prepareSessionMapStep,
  releaseSessionMapsExcept,
  type Session,
} from "../vendor/pocket-rpgkit/src/engine/session.ts";
import { createJsonMapRepository } from "../vendor/pocket-rpgkit/src/engine/map-repository.ts";
import type { BattleRules } from "../vendor/pocket-rpgkit/src/engine/battle.ts";
import type { SceneRules } from "../vendor/pocket-rpgkit/src/engine/scene.ts";
import type { ProjectShell } from "../vendor/pocket-rpgkit/src/engine/types.ts";

interface MapBenchmarkEntry {
  id: string;
  entry: string;
  width: number;
  height: number;
}

interface MapBenchmarkApi {
  maps: readonly MapBenchmarkEntry[];
  begin(id: string): void;
  step(id: string): boolean;
  commit(id: string): void;
}

declare global {
  // eslint-disable-next-line no-var
  var __rpgMapBenchmark: MapBenchmarkApi;
}

const project = rawProject as unknown as ProjectShell;
let session: Session | undefined;
const BENCH_BATTLE_RULES: BattleRules = {
  start: () => null,
  step: (state) => state,
  done: () => null,
};
const BENCH_SCENE_RULES: SceneRules = {
  start: (ext) => ({ state: null, ext }),
  step: (state) => state,
  done: () => ({ cancelled: true }),
};
const BENCH_SCENES: Record<string, SceneRules> = {
  "rpgkit.nameInput": BENCH_SCENE_RULES,
  "tux.journal": BENCH_SCENE_RULES,
  "tux.monsterPicker": BENCH_SCENE_RULES,
  "tux.pc": BENCH_SCENE_RULES,
  "tux.trade": BENCH_SCENE_RULES,
  "tux.monsterShop": BENCH_SCENE_RULES,
};

function benchmarkSession(): Session {
  if (session) return session;
  const repository = createJsonMapRepository(project.mapIndex, {
    read: (entry) => readFileSync(entry),
    readText: (entry) => readFileSync(entry, "utf8"),
  });
  // This probe measures only map repository stages. Accept game-owned calls
  // and complete Battle Processing immediately so every shard can be loaded
  // without pulling the production battle database into the scratch bundle.
  session = createSession(project, 60, {
    maps: repository,
    extensions: { allowUnknown: true },
    battle: BENCH_BATTLE_RULES,
    // First-visit timings validate and compile authored scene commands but do
    // not execute them. Register inert rules without pulling the production
    // monster database and scene catalog into this map-only probe.
    scenes: BENCH_SCENES,
  });
  releaseSessionMapsExcept(session, []);
  return session;
}

globalThis.__rpgMapBenchmark = {
  maps: project.mapIndex.map(({ id, entry, width, height }) => ({ id, entry, width, height })),
  begin(id) {
    const current = benchmarkSession();
    if (!current.mapIndex?.has(id)) throw new Error(`map benchmark: unknown map ${id}`);
    releaseSessionMapsExcept(current, []);
  },
  step(id) {
    return prepareSessionMapStep(benchmarkSession(), id);
  },
  commit(id) {
    acquireSessionMap(benchmarkSession(), id);
  },
};

mount(() => <View />);
