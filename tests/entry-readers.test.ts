import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createGameEntryReaders, createGameMapRepository } from "../ui/entry-readers.ts";
import type { FsOps } from "@pocketjs/framework/fs";
import type { MapIndexEntry } from "../vendor/pocket-rpgkit/src/engine/types.ts";

const ROOT = resolve(import.meta.dir, "..");
const shell = JSON.parse(readFileSync(resolve(ROOT, "dist/project-shell.json"), "utf8")) as {
  mapIndex: Record<string, MapIndexEntry>;
};
const meta = Object.values(shell.mapIndex).find((m) => m.id === "37707_tower")!;
const mapText = readFileSync(resolve(ROOT, "dist", meta.entry), "utf8");
const mapBytes = new TextEncoder().encode(mapText);

// The framework resolves globalThis.fs live on every read, so mounting a
// host stand-in for the duration of a call is enough.
function withFsHost<T>(host: FsOps, fn: () => T): T {
  const previous = (globalThis as { fs?: unknown }).fs;
  (globalThis as { fs?: unknown }).fs = host;
  try {
    return fn();
  } finally {
    (globalThis as { fs?: unknown }).fs = previous;
  }
}

const CORRUPT = new TextEncoder().encode("CORRUPT");
const envelope = (bytes: Uint8Array, eof: boolean) =>
  JSON.stringify({ data: { $b: Buffer.from(bytes).toString("base64") }, size: bytes.length, eof });

const noopOps = {
  write: () => 0,
  remove: () => 0,
  list: () => "",
  stat: () => "",
  mkdir: () => 0,
  rename: () => 0,
  usage: () => "",
  lastError: () => "",
} satisfies Partial<FsOps>;

// A host whose text op serves the real payload while its byte op serves
// corrupt bytes: a repository that prefers readText loads the map, and one
// that silently falls back to read cannot.
function splitHost() {
  const calls = { textReads: 0, byteReads: 0 };
  const host: FsOps = {
    ...noopOps,
    read: () => {
      calls.byteReads += 1;
      return envelope(CORRUPT, true);
    },
    readText: (path: string) => {
      calls.textReads += 1;
      return path === meta.entry ? mapText : "";
    },
  };
  return { host, calls };
}

// A host without the readText op, serving the real payload in paged chunks.
function pagedHost() {
  const calls = { byteReads: 0 };
  const host: FsOps = {
    ...noopOps,
    read: (_path: string, offset: number, maxBytes: number) => {
      calls.byteReads += 1;
      const chunk = mapBytes.subarray(offset, Math.min(offset + maxBytes, mapBytes.length));
      return envelope(chunk, offset + maxBytes >= mapBytes.length);
    },
  };
  return { host, calls };
}

describe("KP2 entry readers", () => {
  test("the map repository prefers the native readText channel on a filesystem host", () => {
    const { host, calls } = splitHost();
    withFsHost(host, () => {
      const { repository } = createGameMapRepository([meta], host);
      const map = repository.acquire(meta.id);
      expect(map.id).toBe(meta.id);
      expect(calls.textReads).toBe(1);
      expect(calls.byteReads).toBe(0);
    });
  });

  test("readText falls back to paged bytes on hosts without the text op", () => {
    // Older desktop hosts predate the readText op; the framework's text
    // path must keep working through paged base64 reads.
    const { host, calls } = pagedHost();
    withFsHost(host, () => {
      const { repository } = createGameMapRepository([meta], host);
      const map = repository.acquire(meta.id);
      expect(map.id).toBe(meta.id);
      expect(calls.byteReads).toBeGreaterThan(0);
    });
  });

  test("the byte reader serves data.fs entries on desktop hosts", () => {
    const { host } = pagedHost();
    withFsHost(host, () => {
      const readers = createGameEntryReaders(host);
      expect(readers.read(meta.entry)).toEqual(mapBytes);
    });
  });

  test("pak-only hosts (web/consoles) wire no readText channel", () => {
    const readers = createGameEntryReaders(null);
    expect(readers.readText).toBeUndefined();
  });
});
