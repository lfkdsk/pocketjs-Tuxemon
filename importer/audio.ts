// importer/audio.ts — audio asset resolution for the importer.
//
// The transcode pipeline (tools/transcode-audio.ts) commits the eight
// mainline music tracks (QOA) and the three used SFX (s16 WAV) to
// assets/audio/, with a manifest recording each file's slug, pak key and
// SHA-256. The importer reads that manifest to build the Project.audio
// table: a logical audio id -> pak key map. Slugs without a committed asset
// (the non-mainline tracks Tuxemon events still reference) get no entry, so
// playBgm/playSe commands for them stay silent while the reducer state
// machine still tracks them.

import { readFileSync } from "node:fs";

export interface AudioManifestFile {
  slug: string;
  kind: "music" | "sfx";
  source: string;
  pakKey: string;
  bytes: number;
  sha256: string;
}

interface AudioManifest {
  format: "pocket-tuxemon/audio-manifest/v1";
  ffmpeg: string;
  rate: number;
  channels: 1;
  files: Record<string, AudioManifestFile>;
}

let cached: AudioManifest | undefined;

/** The committed audio manifest (assets/audio/manifest.json). */
export function audioManifest(): AudioManifest {
  if (cached) return cached;
  cached = JSON.parse(
    readFileSync(new URL("../assets/audio/manifest.json", import.meta.url), "utf8"),
  ) as AudioManifest;
  return cached;
}

/** Sanitize a Tuxemon audio slug into a logical audio id. Mirrors the
 *  play_sound sanitization the importer already used. */
export function audioId(slug: string): string {
  return slug.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

/** Project.audio table: logical id -> pak key, for every committed asset. */
export function audioTable(): Record<string, string> {
  const table: Record<string, string> = {};
  for (const file of Object.values(audioManifest().files)) {
    table[audioId(file.slug)] = file.pakKey;
  }
  return table;
}

/** Logical ids with a committed asset, for coverage accounting. */
export function audioAssetIds(): Set<string> {
  return new Set(Object.values(audioManifest().files).map((f) => audioId(f.slug)));
}
