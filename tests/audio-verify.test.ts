// verify:audio must read the committed blobs that actually
// ship and compare their byte counts and SHA-256 against the manifest, so a
// corrupted or swapped file fails the gate. The re-encode check alone cannot
// notice a tampered committed blob.

import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_TUXEMON_SRC } from "../importer/terrain.ts";
import { sha256, verifyCommittedBlobs, type Manifest } from "../tools/audio-manifest.ts";

const TMP = join(import.meta.dir, "..", ".tmp-audio-verify-test");

function manifestFor(files: Record<string, Uint8Array>): Manifest {
  return {
    format: "pocket-tuxemon/audio-manifest/v1",
    ffmpeg: "test",
    rate: 22050,
    channels: 1,
    files: Object.fromEntries(
      Object.entries(files).map(([rel, bytes]) => [
        rel,
        {
          slug: rel.split("/").pop()!.replace(/\.(qoa|wav)$/, ""),
          kind: rel.startsWith("music/") ? "music" : "sfx",
          source: "test",
          pakKey: `audio:test.${rel}`,
          bytes: bytes.length,
          sha256: sha256(bytes),
        },
      ]),
    ),
  };
}

function writeFixture(files: Record<string, Uint8Array>): Manifest {
  rmSync(TMP, { recursive: true, force: true });
  for (const [rel, bytes] of Object.entries(files)) {
    mkdirSync(join(TMP, rel.split("/").slice(0, -1).join("/")), { recursive: true });
    writeFileSync(join(TMP, rel), bytes);
  }
  return manifestFor(files);
}

const A = new Uint8Array([1, 2, 3, 4]);
const B = new Uint8Array([5, 6, 7, 8, 9]);

describe("verifyCommittedBlobs", () => {
  test("passes when every blob matches the manifest", () => {
    const manifest = writeFixture({ "music/a.qoa": A, "sounds/b.wav": B });
    expect(verifyCommittedBlobs(TMP, manifest)).toEqual([]);
  });

  test("fails when a blob is corrupted (same length, different bytes)", () => {
    const manifest = writeFixture({ "music/a.qoa": A, "sounds/b.wav": B });
    writeFileSync(join(TMP, "music/a.qoa"), new Uint8Array([1, 2, 3, 9]));
    const errors = verifyCommittedBlobs(TMP, manifest);
    expect(errors.some((e) => e.includes("sha256 mismatch") && e.includes("music/a.qoa"))).toBe(true);
  });

  test("fails when a blob is replaced by a different-length file", () => {
    const manifest = writeFixture({ "music/a.qoa": A, "sounds/b.wav": B });
    writeFileSync(join(TMP, "sounds/b.wav"), new Uint8Array([5, 6, 7]));
    const errors = verifyCommittedBlobs(TMP, manifest);
    expect(errors.some((e) => e.includes("byte count mismatch") && e.includes("sounds/b.wav"))).toBe(true);
    expect(errors.some((e) => e.includes("sha256 mismatch"))).toBe(true);
  });

  test("fails when a blob is missing", () => {
    const manifest = writeFixture({ "music/a.qoa": A, "sounds/b.wav": B });
    rmSync(join(TMP, "music/a.qoa"));
    const errors = verifyCommittedBlobs(TMP, manifest);
    expect(errors).toContain("missing committed blob: music/a.qoa");
  });

  test("fails when an extra blob is present", () => {
    const manifest = writeFixture({ "music/a.qoa": A });
    mkdirSync(join(TMP, "sounds"), { recursive: true });
    writeFileSync(join(TMP, "sounds/extra.wav"), B);
    const errors = verifyCommittedBlobs(TMP, manifest);
    expect(errors).toContain("extra committed blob not in manifest: sounds/extra.wav");
  });
});

describe("verify:audio integration", () => {
  // Runs the real command against the real committed assets. This is the
  // end-to-end proof that the gate is green on the shipped files (and the
  // unit tests above prove it goes red when they are tampered).
  // verify:audio re-transcodes from the pinned Tuxemon checkout with ffmpeg,
  // so it needs the same source the importer reads (TUXEMON_SRC, else
  // .tuxemon-src) and an ffmpeg on PATH. The committed-blob checks above run
  // everywhere.
  const source = process.env.TUXEMON_SRC ?? DEFAULT_TUXEMON_SRC;
  const runnable = existsSync(source) && Bun.which("ffmpeg") !== null;
  test.skipIf(!runnable)("bun run verify:audio passes on the committed assets", () => {
    const env = { ...process.env, TUXEMON_SRC: source };
    const out = execFileSync("bun", ["run", "verify:audio"], {
      cwd: join(import.meta.dir, ".."),
      env,
      encoding: "utf8",
    });
    expect(out).toContain("verify:audio: all hashes match");
  }, 60_000);
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});
