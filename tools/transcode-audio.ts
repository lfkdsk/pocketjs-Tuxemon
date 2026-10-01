#!/usr/bin/env bun
// tools/transcode-audio.ts — transcode the mainline music and the used SFX
// from the Tuxemon source into the committed audio assets.
//
// Music: ffmpeg decodes ogg/mp3 to s16le mono 22.05 kHz PCM, then the QOA
// encoder (tools/qoa.ts) produces .qoa files. SFX: the same decode, written
// as uncompressed s16 mono 22.05 kHz WAV. Outputs land in assets/audio/ and
// are committed: ffmpeg output is not bit-exact across versions, so the
// importer reads the committed files, never the source tree. A manifest
// records the ffmpeg version and a per-file SHA-256; `bun run verify:audio`
// both re-transcodes into a temp dir (pipeline reproducibility) and reads
// each committed blob back, comparing its byte count and SHA-256 against
// the manifest (blob integrity).
//
// The slug list is the eight mainline tracks (GM0 §1.1) plus the three SFX
// slugs actually played by map events (GM0 §1.2). Keep it in sync with
// tools/fetch-tuxemon.sh, which sparse-checks out the same music files.
//
// Usage:
//   bun tools/transcode-audio.ts
//   bun run verify:audio
//
// TUXEMON_SRC defaults to the repo-local checkout created by
// tools/fetch-tuxemon.sh.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { verifyCommittedBlobs, type Manifest, type ManifestFile } from "./audio-manifest.ts";
import { encodeQoa } from "./qoa.ts";

const ROOT = resolve(import.meta.dir, "..");
const SRC = process.env.TUXEMON_SRC ?? resolve(ROOT, ".tuxemon-src");
const OUT = join(ROOT, "assets", "audio");
const RATE = 22050;

// GM0 §1.1: the eight tracks the GB6 + J1 mainline journeys play, in
// first-appearance order.
const MUSIC_SLUGS = [
  "music_home",
  "music_cathedral_theme",
  "music_town_theme",
  "music_the_wild_places",
  "music_city_park",
  "music_10_empire",
  "music_07_town",
  "music_jester_theme",
];

// GM0 §1.2: the only three SFX slugs any map event plays.
const SFX_SLUGS = [
  "japanese_temple_bell_small",
  "sound_confirm",
  "coinecho",
];

/** Parse every `- file: … / slug: …` pair in a DB directory's yamls. */
function loadSlugIndex(dbDir: string): Map<string, string> {
  const index = new Map<string, string>();
  for (const name of readdirSync(dbDir).sort()) {
    if (!name.endsWith(".yaml")) continue;
    const text = readFileSync(join(dbDir, name), "utf8");
    for (const m of text.matchAll(/^- file: (.+)\n  slug: (\S+)/gm)) {
      const file = m[1]!.trim();
      const slug = m[2]!.trim();
      if (!index.has(slug)) index.set(slug, file);
    }
  }
  return index;
}

function ffmpegVersion(): string {
  return execFileSync("ffmpeg", ["-version"], { encoding: "utf8" })
    .split("\n")[0]!.trim();
}

/** Decode any source ffmpeg understands to mono s16 PCM at RATE. */
function decodeToMonoPcm(file: string): Int16Array {
  const raw = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", file, "-ac", "1", "-ar", String(RATE), "-f", "s16le", "-"],
    { maxBuffer: 1 << 28 },
  );
  return new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));
}

/** Minimal s16 PCM WAV writer (44-byte header + data). */
function writeWav(path: string, samples: Int16Array, rate: number): void {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  Buffer.from(samples.buffer, samples.byteOffset, dataBytes).copy(buf, 44);
  writeFileSync(path, buf);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function transcode(outDir: string): Manifest {
  const musicDb = loadSlugIndex(join(SRC, "mods", "tuxemon", "db", "music"));
  const soundsDb = loadSlugIndex(join(SRC, "mods", "tuxemon", "db", "sounds"));
  mkdirSync(join(outDir, "music"), { recursive: true });
  mkdirSync(join(outDir, "sounds"), { recursive: true });

  const files: Record<string, ManifestFile> = {};
  const transcodeOne = (slug: string, kind: "music" | "sfx"): void => {
    const db = kind === "music" ? musicDb : soundsDb;
    const source = db.get(slug);
    if (!source) throw new Error(`${kind} slug not in DB: ${slug}`);
    const srcPath = join(SRC, "mods", "tuxemon", kind === "music" ? "music" : "sounds", source);
    const pcm = decodeToMonoPcm(srcPath);
    const rel = kind === "music" ? `music/${slug}.qoa` : `sounds/${slug}.wav`;
    const outPath = join(outDir, rel);
    if (kind === "music") {
      writeFileSync(outPath, encodeQoa(pcm, 1, RATE));
    } else {
      writeWav(outPath, pcm, RATE);
    }
    const bytes = readFileSync(outPath);
    files[rel] = {
      slug,
      kind,
      source,
      pakKey: kind === "music" ? `audio:qoa.${rel}` : `audio:wav.${rel}`,
      bytes: bytes.length,
      sha256: sha256(bytes),
    };
    console.log(`${rel}: ${(bytes.length / 1024).toFixed(0)} KB (${(pcm.length / RATE).toFixed(1)} s)`);
  };

  for (const slug of MUSIC_SLUGS) transcodeOne(slug, "music");
  for (const slug of SFX_SLUGS) transcodeOne(slug, "sfx");

  return {
    format: "pocket-tuxemon/audio-manifest/v1",
    ffmpeg: ffmpegVersion(),
    rate: RATE,
    channels: 1,
    files,
  };
}

const verify = process.argv.includes("--verify");
const outDir = verify ? join(ROOT, "assets", "audio-verify-tmp") : OUT;
if (verify) rmSync(outDir, { recursive: true, force: true });

const manifest = transcode(outDir);
const manifestPath = join(outDir, "manifest.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

if (verify) {
  const committedPath = join(OUT, "manifest.json");
  const committed = JSON.parse(readFileSync(committedPath, "utf8")) as Manifest;
  let failures = 0;
  for (const [rel, entry] of Object.entries(manifest.files)) {
    const want = committed.files[rel];
    if (!want) {
      console.error(`missing in committed manifest: ${rel}`);
      failures++;
    } else if (want.sha256 !== entry.sha256) {
      console.error(`hash mismatch: ${rel}\n  committed ${want.sha256}\n  reencoded ${entry.sha256}`);
      failures++;
    }
  }
  for (const rel of Object.keys(committed.files)) {
    if (!manifest.files[rel]) {
      console.error(`extra in committed manifest: ${rel}`);
      failures++;
    }
  }
  // Independently read the blobs that actually ship and compare their byte
  // counts and SHA-256 against the committed manifest. The re-encode check
  // above cannot notice a corrupted or swapped committed blob; this one can.
  for (const err of verifyCommittedBlobs(OUT, committed)) {
    console.error(err);
    failures++;
  }
  rmSync(outDir, { recursive: true, force: true });
  if (failures > 0) {
    console.error(`verify:audio: ${failures} mismatch(es) — ffmpeg version drift? re-run transcode-audio.ts and commit`);
    process.exit(1);
  }
  console.log("verify:audio: all hashes match");
} else {
  const total = Object.values(manifest.files).reduce((n, f) => n + f.bytes, 0);
  console.log(`wrote ${Object.keys(manifest.files).length} files, ${(total / 1024 / 1024).toFixed(2)} MB to ${OUT}`);
}
