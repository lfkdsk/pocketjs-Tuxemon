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

function benchmarkSession(): Session {
  if (session) return session;
  const repository = createJsonMapRepository(project.mapIndex, {
    read: (entry) => readFileSync(entry),
  });
  session = createSession(project, 60, repository);
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
