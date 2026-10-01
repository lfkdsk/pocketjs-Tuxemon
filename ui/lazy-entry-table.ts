// Shared Proxy-backed lazy table: resolves and
// caches exactly the keys read through it from a pak/data.fs entry, at zero
// parse cost for `has`/`in` and `Reflect.ownKeys`. Used by
// ui/animated-repository.ts and ui/npc-src-repository.ts, which both split a
// GameAssets table that a game session only ever reads by a single current
// key (the loaded map id, or an NPC's art id) rather than enumerating.
// battle/battle-repository.ts predates this and keeps its own copy
// (lazyShardTable) tied to BattleDb's shell shape.
import { decodeMapEntryBytes } from "../vendor/pocket-rpgkit/src/engine/map-repository.ts";

export interface LazyEntrySource {
  read(entry: string): string | Uint8Array | undefined;
}

export interface LazyEntryIndexEntry {
  id: string;
  entry: string;
}

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
  const resolveCached = (id: string): T | undefined => {
    if (cache.has(id)) return cache.get(id);
    const entry = byId.get(id);
    if (entry === undefined) return undefined;
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
    return value;
  };
  return new Proxy({} as Record<string, T>, {
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
}
