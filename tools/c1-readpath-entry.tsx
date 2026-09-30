// QuickJS-only benchmark entry: decomposes the map first-visit read path
// into host file read, host fs handler, JS-observed chunk transfer,
// envelope parse, base64 decode, concat, ASCII decode, JSON.parse,
// validate/derive, plus the production staged pipeline, commit and the
// first frames. Built into a scratch directory by bench-c1-readpath.sh
// and never part of the shipped game bundle.

import { mount } from "@pocketjs/framework";
import { View } from "@pocketjs/framework/components";
import { readFileSync } from "@pocketjs/framework/fs";
import { base64ToBytes } from "../vendor/pocket-rpgkit/vendor/pocketjs/framework/src/bytes.ts";
import {
  createJsonMapRepository,
  decodeMapEntryBytes,
  validateMapDefStructure,
} from "../vendor/pocket-rpgkit/src/engine/map-repository.ts";
import { createWorld } from "../vendor/pocket-rpgkit/src/engine/interpreter.ts";
import { buildPassage } from "../vendor/pocket-rpgkit/src/engine/passability.ts";
import { MOTION_HZ } from "../vendor/pocket-rpgkit/src/engine/motion-clock.ts";
import {
  acquireSessionMap,
  createSession,
  prepareSessionMapStep,
  releaseSessionMapsExcept,
  type Session,
} from "../vendor/pocket-rpgkit/src/engine/session.ts";
import rawProject from "../dist/project-shell.json";
import type { BattleRules } from "../vendor/pocket-rpgkit/src/engine/battle.ts";
import type { MapDef, ProjectShell } from "../vendor/pocket-rpgkit/src/engine/types.ts";

const FS_MAX_IO_BYTES = 65536;
const BLOB_KEY = "$b";

const project = rawProject as unknown as ProjectShell;

let session: Session | undefined;
function benchmarkSession(): Session {
  if (session) return session;
  const repository = createJsonMapRepository(project.mapIndex, {
    read: (entry) => readFileSync(entry),
  });
  // This probe measures only the read path. Accept game-owned calls and
  // complete Battle Processing immediately so every shard can be loaded
  // without pulling the production battle database into the scratch bundle.
  const battle: BattleRules = {
    start: () => null,
    step: (state) => state,
    done: () => null,
  };
  session = createSession(project, 60, {
    maps: repository,
    extensions: { allowUnknown: true },
    battle,
  });
  releaseSessionMapsExcept(session, []);
  return session;
}

interface C1MapMeta {
  id: string;
  entry: string;
  width: number;
  height: number;
}

interface C1Envelope {
  data: Record<string, string>;
  size: number;
  eof: boolean;
}

interface C1Scratch {
  envelope: string;
  parsed: C1Envelope | null;
  bytes: Uint8Array | null;
  chunks: Uint8Array[];
  allBytes: Uint8Array | null;
  text: string;
  map: unknown;
}

const scratch: C1Scratch = {
  envelope: "",
  parsed: null,
  bytes: null,
  chunks: [],
  allBytes: null,
  text: "",
  map: null,
};

function fsRead(path: string, offset: number, maxBytes: number): string {
  const ns = (globalThis as { fs?: unknown }).fs;
  if (!ns || typeof ns !== "object") {
    throw new Error("c1 bench: globalThis.fs is not mounted");
  }
  const read = (ns as { read?: unknown }).read;
  if (typeof read !== "function") throw new Error("c1 bench: fs.read is not a function");
  return (read as (p: string, o: number, m: number) => string)(path, offset, maxBytes);
}

interface C1ReadBenchApi {
  maps: C1MapMeta[];
  warmup(): void;
  readChunk(entry: string, offset: number): number;
  parseEnvelope(): number;
  decodeChunk(): number;
  pushChunk(): void;
  concatChunks(): number;
  decodeText(): number;
  parseJson(): string;
  lightValidate(): void;
  buildWorld(): number;
  buildPassageTable(): number;
  productionRead(entry: string): number;
  resetScratch(): void;
  begin(id: string): void;
  step(id: string): boolean;
  commit(id: string): void;
}

declare global {
  // eslint-disable-next-line no-var
  var __c1ReadBench: C1ReadBenchApi;
}

globalThis.__c1ReadBench = {
  maps: project.mapIndex.map(({ id, entry, width, height }) => ({ id, entry, width, height })),
  warmup() {
    benchmarkSession();
  },
  readChunk(entry, offset) {
    scratch.envelope = fsRead(entry, offset, FS_MAX_IO_BYTES);
    return scratch.envelope.length;
  },
  parseEnvelope() {
    scratch.parsed = JSON.parse(scratch.envelope) as C1Envelope;
    return scratch.parsed.data[BLOB_KEY].length;
  },
  decodeChunk() {
    scratch.bytes = base64ToBytes(scratch.parsed!.data[BLOB_KEY]);
    return scratch.bytes.length;
  },
  pushChunk() {
    scratch.chunks.push(scratch.bytes!);
  },
  concatChunks() {
    if (scratch.chunks.length === 1) {
      scratch.allBytes = scratch.chunks[0]!;
    } else {
      const total = scratch.chunks.reduce((n, c) => n + c.length, 0);
      const out = new Uint8Array(total);
      let o = 0;
      for (const c of scratch.chunks) {
        out.set(c, o);
        o += c.length;
      }
      scratch.allBytes = out;
    }
    return scratch.allBytes.length;
  },
  decodeText() {
    scratch.text = decodeMapEntryBytes(scratch.allBytes!);
    return scratch.text.length;
  },
  parseJson() {
    scratch.map = JSON.parse(scratch.text);
    return (scratch.map as { id: string }).id;
  },
  lightValidate() {
    validateMapDefStructure(scratch.map);
  },
  buildWorld() {
    const sess = benchmarkSession();
    const world = createWorld(scratch.map as MapDef, sess.commonEvents, MOTION_HZ, sess.worldOptions);
    return world.pagePrograms.size;
  },
  buildPassageTable() {
    const table = buildPassage(scratch.map as MapDef, benchmarkSession().sheets);
    return table.solid.length;
  },
  productionRead(entry) {
    return readFileSync(entry).length;
  },
  resetScratch() {
    scratch.envelope = "";
    scratch.parsed = null;
    scratch.bytes = null;
    scratch.chunks = [];
    scratch.allBytes = null;
    scratch.text = "";
    scratch.map = null;
  },
  begin(id) {
    const current = benchmarkSession();
    if (!current.mapIndex?.has(id)) throw new Error(`c1 bench: unknown map ${id}`);
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
