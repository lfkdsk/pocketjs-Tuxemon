// Shared Proxy-backed lazy table: resolves and
// caches exactly the keys read through it from a pak/data.fs entry, at zero
// parse cost for `has`/`in` and `Reflect.ownKeys`. Used by
// ui/animated-repository.ts and ui/npc-src-repository.ts, which both split a
// GameAssets table that a game session only ever reads by a single current
// key (the loaded map id, or an NPC's art id) rather than enumerating.
// battle/battle-repository.ts predates this and keeps its own copy
// (lazyShardTable) tied to BattleDb's shell shape.
//
// releaseLazyEntries evicts cached entries outside a keep-set, so a long
// session that visits many maps does not grow these tables without bound.
// The controls hang off a WeakMap keyed by the proxy, so the table's
// Record shape is unchanged for every reader.
import { decodeMapEntryBytes } from "../vendor/pocket-rpgkit/src/engine/map-repository.ts";

export interface LazyEntrySource {
  read(entry: string): string | Uint8Array | undefined;
}

export interface LazyEntryIndexEntry {
  id: string;
  entry: string;
}

export interface LazyEntryStats {
  /** Cached entries currently resident. */
  resident: number;
  /** Entries loaded since the table was created. */
  loads: number;
  /** Entries evicted by releaseLazyEntries. */
  evictions: number;
  /** Reads for ids absent from the index. */
  missing: number;
}

interface LazyEntryControls {
  cache: Map<string, unknown>;
  loads: number;
  evictions: number;
  missing: number;
}

const controls = new WeakMap<object, LazyEntryControls>();

function decodeEntry(input: string | Uint8Array): string {
  return typeof input === "string" ? input : decodeMapEntryBytes(input);
}

export function lazyEntryTable<T>(
  index: readonly LazyEntryIndexEntry[],
  source: LazyEntrySource,
  label: string,
): Readonly<Record<string, T>> {
  const byId = new Map(index.map((meta) => [meta.id, meta.entry]));
  const cache = new Map<string, T>();
  const state: LazyEntryControls = { cache, loads: 0, evictions: 0, missing: 0 };
  const resolveCached = (id: string): T | undefined => {
    if (cache.has(id)) return cache.get(id);
    const entry = byId.get(id);
    if (entry === undefined) {
      state.missing++;
      return undefined;
    }
    const input = source.read(entry);
    if (input === undefined) {
      throw new Error(`${label} repository: missing entry for '${id}' (${entry})`);
    }
    let value: T;
    try {
      value = JSON.parse(decodeEntry(input));
    } catch {
      throw new Error(`${label} repository: entry for '${id}' (${entry}) is not JSON`);
    }
    cache.set(id, value);
    state.loads++;
    return value;
  };
  const proxy = new Proxy({} as Record<string, T>, {
    get(_target, prop) {
      return typeof prop === "string" ? resolveCached(prop) : undefined;
    },
    has(_target, prop) {
      return typeof prop === "string" && byId.has(prop);
    },
    ownKeys() {
      return [...byId.keys()];
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop !== "string" || !byId.has(prop)) return undefined;
      return { value: resolveCached(prop), enumerable: true, configurable: true, writable: false };
    },
  });
  controls.set(proxy, state);
  return proxy;
}

/** Evict every cached entry whose id is not in `keep`. Returns the number
 *  of entries released. Entries still referenced by a mounted node stay
 *  alive through that reference; only the table's cache is dropped. */
export function releaseLazyEntries(table: object, keep: readonly string[]): number {
  const state = controls.get(table);
  if (!state) throw new Error("releaseLazyEntries: not a lazy entry table");
  const keepSet = new Set(keep);
  let released = 0;
  for (const id of [...state.cache.keys()]) {
    if (!keepSet.has(id)) {
      state.cache.delete(id);
      released++;
    }
  }
  state.evictions += released;
  return released;
}

/** Residency and traffic counters for a lazy entry table. */
export function lazyEntryStats(table: object): LazyEntryStats {
  const state = controls.get(table);
  if (!state) throw new Error("lazyEntryStats: not a lazy entry table");
  return {
    resident: state.cache.size,
    loads: state.loads,
    evictions: state.evictions,
    missing: state.missing,
  };
}
