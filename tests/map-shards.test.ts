import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { splitProjectMaps } from "../vendor/pocket-rpgkit/tools/lib/map-project.ts";
import { createJsonMapRepository } from "../vendor/pocket-rpgkit/src/engine/map-repository.ts";
import type { Project, ProjectShell } from "../vendor/pocket-rpgkit/src/engine/types.ts";

const ROOT = resolve(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const inline = JSON.parse(readFileSync(join(DIST, "project.json"), "utf8")) as Project;
const shellBytes = readFileSync(join(DIST, "project-shell.json"));
const shell = JSON.parse(shellBytes.toString("utf8")) as ProjectShell;
const pak = JSON.parse(readFileSync(join(ROOT, "pak.json"), "utf8")) as Array<{
  key: string;
  file: string;
}>;

describe("generated per-map repository", () => {
  test("the compact shell and all canonical map entries match splitProjectMaps", () => {
    const expected = splitProjectMaps(inline, { shellEntry: "project-shell.json" });
    expect(shell.mapIndex).toHaveLength(263);
    expect("maps" in shell).toBeFalse();
    expect(shellBytes).toEqual(Buffer.from(expected.shellText));

    const mapRows = pak.filter((entry) => entry.key.startsWith("maps/") && entry.key.endsWith(".json"));
    expect(mapRows).toHaveLength(263);
    expect(mapRows).toEqual(expected.entries.map((entry) => ({
      key: entry.path,
      file: `dist/${entry.path}`,
    })));

    for (const entry of expected.entries) {
      const actual = readFileSync(join(DIST, entry.path));
      expect(actual, entry.meta.id).toEqual(Buffer.from(entry.bytes));
      expect(actual.some((byte) => byte > 0x7f), entry.meta.id).toBeFalse();
      expect(createHash("sha256").update(actual).digest("hex"), entry.meta.id).toBe(entry.meta.sha256);
    }
  });

  test("the standard byte repository can acquire every generated map", () => {
    const reads: string[] = [];
    const repository = createJsonMapRepository(shell.mapIndex, {
      read(entry) {
        reads.push(entry);
        return new Uint8Array(readFileSync(join(DIST, entry)));
      },
    });
    for (const meta of shell.mapIndex) {
      expect(repository.acquire(meta.id)).toMatchObject({
        id: meta.id,
        width: meta.width,
        height: meta.height,
      });
      repository.releaseExcept([]);
    }
    expect(reads).toEqual(shell.mapIndex.map((entry) => entry.entry));
  });
});
