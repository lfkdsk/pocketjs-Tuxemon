// tools/audio-manifest.ts — manifest types + committed-blob verification.
//
// `bun run verify:audio` must prove the blobs that actually ship in
// assets/audio/{music,sounds} are the ones the manifest describes. Re-
// transcoding to a temp dir and comparing those hashes only proves the
// pipeline is reproducible; it does not notice a corrupted or swapped
// committed blob. This module reads each committed file directly and
// compares its byte count and SHA-256 against the manifest.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface ManifestFile {
  slug: string;
  kind: "music" | "sfx";
  source: string;
  pakKey: string;
  bytes: number;
  sha256: string;
}

export interface Manifest {
  format: "pocket-tuxemon/audio-manifest/v1";
  ffmpeg: string;
  rate: number;
  channels: 1;
  files: Record<string, ManifestFile>;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Read every committed blob the manifest names and compare its byte count
 * and SHA-256. Also reports files present under music/ or sounds/ that the
 * manifest does not name. Returns a list of human-readable errors (empty
 * when everything matches).
 */
export function verifyCommittedBlobs(audioDir: string, manifest: Manifest): string[] {
  const errors: string[] = [];
  for (const [rel, entry] of Object.entries(manifest.files)) {
    const path = join(audioDir, rel);
    if (!existsSync(path)) {
      errors.push(`missing committed blob: ${rel}`);
      continue;
    }
    const bytes = readFileSync(path);
    if (bytes.length !== entry.bytes) {
      errors.push(`byte count mismatch: ${rel} (manifest ${entry.bytes}, on disk ${bytes.length})`);
    }
    const hash = sha256(bytes);
    if (hash !== entry.sha256) {
      errors.push(`sha256 mismatch: ${rel}\n  manifest ${entry.sha256}\n  on disk  ${hash}`);
    }
  }

  const named = new Set(Object.keys(manifest.files));
  for (const sub of ["music", "sounds"]) {
    const dir = join(audioDir, sub);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      const rel = `${sub}/${name}`;
      if (!named.has(rel)) errors.push(`extra committed blob not in manifest: ${rel}`);
    }
  }
  return errors;
}

/** All committed blob paths relative to the audio dir, sorted. */
export function committedBlobPaths(audioDir: string): string[] {
  const out: string[] = [];
  for (const sub of ["music", "sounds"]) {
    const dir = join(audioDir, sub);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      out.push(relative(audioDir, join(dir, name)).split(sep).join("/"));
    }
  }
  return out;
}
