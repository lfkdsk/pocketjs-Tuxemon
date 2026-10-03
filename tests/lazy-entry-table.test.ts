import { describe, expect, test } from "bun:test";
import {
  lazyEntryStats,
  lazyEntryTable,
  releaseLazyEntries,
  type LazyEntryIndexEntry,
} from "../ui/lazy-entry-table.ts";

const INDEX: readonly LazyEntryIndexEntry[] = [
  { id: "map_a", entry: "shard/map_a.json" },
  { id: "map_b", entry: "shard/map_b.json" },
  { id: "map_c", entry: "shard/map_c.json" },
];

function source() {
  const files = new Map(INDEX.map((meta) => [meta.entry, JSON.stringify({ id: meta.id })]));
  const reads: string[] = [];
  return {
    reads,
    read: (entry: string) => {
      reads.push(entry);
      return files.get(entry);
    },
  };
}

describe("lazyEntryTable eviction and stats", () => {
  test("releaseLazyEntries drops entries outside the keep-set and counts them", () => {
    const src = source();
    const table = lazyEntryTable(INDEX, src, "test");
    table["map_a"];
    table["map_b"];
    table["map_c"];
    expect(lazyEntryStats(table)).toEqual({ resident: 3, loads: 3, evictions: 0, missing: 0 });

    expect(releaseLazyEntries(table, ["map_b"])).toBe(2);
    expect(lazyEntryStats(table)).toEqual({ resident: 1, loads: 3, evictions: 2, missing: 0 });

    table["map_a"];
    expect(src.reads).toHaveLength(4);
    table["map_b"];
    expect(src.reads).toHaveLength(4);
  });

  test("a keep-set of everything releases nothing", () => {
    const table = lazyEntryTable(INDEX, source(), "test");
    table["map_a"];
    table["map_b"];
    expect(releaseLazyEntries(table, ["map_a", "map_b", "map_c"])).toBe(0);
    expect(lazyEntryStats(table).resident).toBe(2);
  });

  test("missing ids are counted but never read", () => {
    const src = source();
    const table = lazyEntryTable(INDEX, src, "test");
    expect(table["no_such_map"]).toBeUndefined();
    expect(src.reads).toEqual([]);
    expect(lazyEntryStats(table).missing).toBe(1);
  });

  test("rejects controls for objects that are not lazy tables", () => {
    expect(() => releaseLazyEntries({}, [])).toThrow(/not a lazy entry table/);
    expect(() => lazyEntryStats({})).toThrow(/not a lazy entry table/);
  });
});
