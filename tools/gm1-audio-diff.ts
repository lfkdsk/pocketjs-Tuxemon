// GM1 one-off: prove a terminal-state hash change between two builds is
// audio-only. Replays the frozen GB6 journey tape against the production
// reducer (or loads a dumped state), normalizes both states, and diffs them.
//
// Normalization drops the sparse interpreter audio fields and canonicalizes
// the e###_ char-id prefixes (a single event insertion shifts every later
// prefix). If the normalized states are equal, the only deltas were the
// BGM intent the importer emits; any other difference is reported and the
// tool exits non-zero.
//
// Usage:
//   bun tools/gm1-audio-diff.ts --baseline <state.json> [--current <state.json>]
//
// --baseline is required (the pre-change terminal state, canonical JSON).
// --current defaults to replaying data/gb6-mainline-journey.json.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { TUXEMON_BATTLE_RULES, TUXEMON_EXTENSIONS } from "../battle/game.ts";
import {
  createSession,
  startSession,
  stepSession,
  type SessionInput,
  type SessionState,
} from "../vendor/pocket-rpgkit/src/engine/session.ts";
import { canonicalJson } from "../vendor/pocket-rpgkit/src/engine/save.ts";
import type { Gb6JourneyResult } from "./gb6-journey.ts";
import { readInlineProject } from "./generated-project.ts";

const ROOT = resolve(import.meta.dir, "..");
const JOURNEY_PATH = process.env.GB6_JOURNEY ?? join(ROOT, "data/gb6-mainline-journey.json");
const GAME_OPTIONS = { extensions: TUXEMON_EXTENSIONS, battle: TUXEMON_BATTLE_RULES } as const;

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function input(mask: number, previous: number): SessionInput {
  const pressed = mask & ~previous;
  return {
    buttons: mask,
    confirmEdge: Boolean(pressed & 0x2000),
    cancelEdge: Boolean(pressed & 0x4000),
    upEdge: Boolean(pressed & 0x0010),
    downEdge: Boolean(pressed & 0x0040),
  };
}

/**
 * Normalize a terminal state for an audio-only diff: drop the sparse
 * interpreter audio fields and canonicalize the e###_ char-id prefixes (a
 * single event insertion shifts every later prefix by one). Char ids appear
 * only as `chars.chars` keys in these states, so a global replacement on the
 * canonical form is complete.
 */
export function normalizeForAudioDiff(state: SessionState): SessionState {
  const clone = structuredClone(state) as SessionState & {
    interp: { audio?: unknown };
  };
  delete clone.interp.audio;
  return JSON.parse(canonicalJson(clone).replace(/e\d{3}_/g, "e_")) as SessionState;
}

/** Top-level paths whose values differ after normalization. */
export function diffTopLevel(current: unknown, baseline: unknown): string[] {
  const diffs: string[] = [];
  const a = current as Record<string, unknown>;
  const b = baseline as Record<string, unknown>;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (canonicalJson(a[key]) !== canonicalJson(b[key])) diffs.push(key);
  }
  return diffs;
}

/** True when the only deltas between the two states are the audio fields. */
export function audioOnlyDiff(current: SessionState, baseline: SessionState): {
  audioOnly: boolean;
  diffs: string[];
} {
  const nCurrent = normalizeForAudioDiff(current);
  const nBaseline = normalizeForAudioDiff(baseline);
  if (canonicalJson(nCurrent) === canonicalJson(nBaseline)) {
    return { audioOnly: true, diffs: [] };
  }
  return { audioOnly: false, diffs: diffTopLevel(nCurrent, nBaseline) };
}

function replayJourney(): SessionState {
  const journey = JSON.parse(readFileSync(JOURNEY_PATH, "utf8")) as Gb6JourneyResult;
  const project = readInlineProject(ROOT);
  const session = createSession(project, 60, GAME_OPTIONS);
  let state = startSession(project, session);
  let previous = 0;
  for (let frame = 0; frame < journey.masks.length; frame++) {
    const mask = journey.masks[frame]!;
    state = stepSession(session, state, input(mask, previous));
    previous = mask;
  }
  return state;
}

// --- CLI -------------------------------------------------------------------

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const baselinePath = argValue("--baseline");
  if (!baselinePath) {
    console.error("usage: bun tools/gm1-audio-diff.ts --baseline <state.json> [--current <state.json>]");
    process.exit(2);
  }

  const currentPath = argValue("--current");
  const current = currentPath
    ? (JSON.parse(readFileSync(currentPath, "utf8")) as SessionState)
    : replayJourney();
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as SessionState;

  const fullHash = digest(current);
  const strippedHash = digest(normalizeForAudioDiff(current));
  const baselineStrippedHash = digest(normalizeForAudioDiff(baseline));
  const audio = (current.interp as { audio?: unknown }).audio;
  console.log(`terminal map: ${current.mapId}@${current.move.tx},${current.move.ty}`);
  console.log(`terminal audio: ${JSON.stringify(audio)}`);
  console.log(`full hash:      ${fullHash}`);
  console.log(`stripped hash:  ${strippedHash}`);
  console.log(`baseline stripped hash: ${baselineStrippedHash}`);

  const { audioOnly, diffs } = audioOnlyDiff(current, baseline);
  if (audioOnly) {
    console.log("verdict: audio-only — normalized states are identical");
  } else {
    console.error(`verdict: extra diffs beyond audio at: ${diffs.join(", ")}`);
    process.exit(1);
  }
}

if (import.meta.main) main();
