// Bake chapter snapshots and thumbnails for the web demo menu.
//
// One reducer replay of the combined GB6+J1+J2 mainline tape picks named
// checkpoints at safe points (canSave, no input lock, no fade). Each
// checkpoint becomes a kit save envelope (validated through the same
// decode/restore gate the game uses) plus the frame where its tape suffix
// starts. A second replay through the built game bundle renders one
// 480x272 thumbnail per chapter.
//
//   bun tools/bake-chapters.ts          # rewrite data/chapters.json + docs/screenshots/chapters
//   bun tools/verify-chapters.ts        # re-bake in memory and byte-diff both,
//                                       # then suffix-replay every chapter
//
// The demo menu concatenates data/gb6-mainline-journey.json,
// data/j1-captainreturns-journey.json and data/j2-hospitalcure-journey.json
// masks and slices at `frame`: restore the envelope, set the global reducer
// frame to `timelineFrame` (the envelope carries only the per-map
// interpreter clock, not the global frame), then replay the suffix.
// verifyChapterSuffixes() proves every committed chapter reaches the same
// terminal state as one full replay of the combined tape.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { tuxemonExtensionState } from "../battle/extension.ts";
import {
  TUXEMON_BATTLE_DB,
  TUXEMON_BATTLE_RULES,
  TUXEMON_EXTENSIONS,
  TUXEMON_SCENES,
} from "../battle/game.ts";
// Thumbnails boot the built game at the same fixed 09:00 as the reducer
// replay; without it the daylight tint follows the machine's wall clock.
import { FIXED_TIME_HOST_GLOBALS } from "../battle/time-weather.ts";
import { bootWorld } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";
import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import {
  canSave,
  canonicalJson,
  createSessionSnapshot,
  decodeEnvelopeText,
  encodeEnvelope,
} from "../vendor/pocket-rpgkit/src/engine/save.ts";
import { restoreSessionSnapshot } from "../vendor/pocket-rpgkit/src/engine/save-restore.ts";
import {
  createSession,
  startSession,
  stepSession,
  type Session,
  type SessionInput,
  type SessionState,
} from "../vendor/pocket-rpgkit/src/engine/session.ts";
import type { Gb6JourneyResult } from "./gb6-journey.ts";
import type { J1JourneyResult } from "./j1-journey.ts";
import type { J2JourneyResult } from "./j2-journey.ts";
import { readInlineProject } from "./generated-project.ts";

export const ROOT = resolve(import.meta.dir, "..");
const BUNDLE = join(ROOT, "dist/main");
const GB6_PATH = join(ROOT, "data/gb6-mainline-journey.json");
const J1_PATH = join(ROOT, "data/j1-captainreturns-journey.json");
const J2_PATH = join(ROOT, "data/j2-hospitalcure-journey.json");
export const CHAPTERS_PATH = join(ROOT, "data/chapters.json");
export const THUMB_DIR = join(ROOT, "docs/screenshots/chapters");
export const THUMB_REL = "docs/screenshots/chapters";
export const THUMB_W = 480;
export const THUMB_H = 272;

const GAME_OPTIONS = {
  extensions: TUXEMON_EXTENSIONS,
  battle: TUXEMON_BATTLE_RULES,
  scenes: TUXEMON_SCENES,
} as const;
const DEBUG = process.env.CHAPTERS_DEBUG === "1";

export interface ChapterRecord {
  id: string;
  title: string;
  map: string;
  position: [number, number];
  /** First mask of the tape suffix: the offset into the concatenated
   *  GB6+J1 mask array the demo menu replays after restoring. */
  frame: number;
  /** Global reducer frame at the checkpoint. The envelope carries only
   *  the per-map interpreter clock (interp.frame), so the chapter resume
   *  contract is: restore the snapshot, then set state.frame =
   *  timelineFrame before replaying the suffix. verifyChapterSuffixes()
   *  proves this reaches the full-replay terminal state. */
  timelineFrame: number;
  /** BTN mask held on the checkpoint frame (the envelope carries it too). */
  held: number;
  suffixFrames: number;
  /** rpgkit-save/v1 envelope string, validated through decode + restore. */
  snapshot: string;
  thumbnail: string;
  thumbnailSha256: string;
}

export interface ChaptersFile {
  format: "pocket-tuxemon/chapters/v1";
  hz: 60;
  tape: {
    gb6: { file: string; frames: number; tapeSha256: string };
    j1: { file: string; frames: number; tapeSha256: string };
    j2: { file: string; frames: number; tapeSha256: string };
    frames: number;
    sha256: string;
  };
  chapters: ChapterRecord[];
}

interface Capture {
  id: string;
  title: string;
  frame: number;
  thumbnailIdle: number;
  state: SessionState;
}

interface Checkpoint {
  id: string;
  title: string;
  /** "first" = first frame where select() holds; "last" = last frame before
   *  `deadline` where it holds; "exact" = frame `at` if it holds there. */
  mode: "first" | "last" | "exact";
  at?: number;
  deadline?: number;
  /** Idle frames driven before the thumbnail is captured. The sim host's
   *  surface is blank before its first frame step, so a frame-0 chapter
   *  (the only safe point in the new-game bedroom) lets the intro text
   *  type out for its preview. The snapshot still belongs to frame 0. */
  thumbnailIdle?: number;
  select: (frame: number, state: SessionState) => boolean;
}

function expect(label: string, condition: boolean): asserts condition {
  if (!condition) throw new Error(`bake-chapters: ${label}`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function input(mask: number, previous: number): SessionInput {
  const pressed = mask & ~previous;
  return {
    buttons: mask,
    confirmEdge: Boolean(pressed & 0x2000),
    cancelEdge: Boolean(pressed & 0x4000),
    upEdge: Boolean(pressed & 0x0010),
    downEdge: Boolean(pressed & 0x0040),
    leftEdge: Boolean(pressed & 0x0080),
    rightEdge: Boolean(pressed & 0x0020),
  };
}

/** A chapter may only start at a safe point: the engine's save predicate,
 *  plus no held input lock and no transfer fade (the spec bars checkpoints
 *  mid-dialogue/battle/lock; the fade keeps the thumbnail readable). */
function safe(state: SessionState): boolean {
  return canSave(state.move, state.interp, state.scene)
    && !state.interp.inputLocked
    && !state.fade;
}

function partySize(state: SessionState): number {
  return tuxemonExtensionState(state.ext, TUXEMON_BATTLE_DB).party.length;
}

function loadTape(): { gb6: Gb6JourneyResult; j1: J1JourneyResult; j2: J2JourneyResult; combined: number[] } {
  const gb6 = JSON.parse(readFileSync(GB6_PATH, "utf8")) as Gb6JourneyResult;
  const j1 = JSON.parse(readFileSync(J1_PATH, "utf8")) as J1JourneyResult;
  const j2 = JSON.parse(readFileSync(J2_PATH, "utf8")) as J2JourneyResult;
  expect("wrong GB6 format", gb6.format === "pocket-tuxemon/gb6-mainline/v1");
  expect("GB6 is not 60 Hz", gb6.hz === 60);
  expect("GB6 frame count differs from masks", gb6.frames === gb6.masks.length);
  expect("GB6 tape hash changed", sha256(JSON.stringify(gb6.masks)) === gb6.tapeSha256);
  expect("wrong J1 format", j1.format === "pocket-tuxemon/j1-captainreturns/v1");
  expect("J1 is not 60 Hz", j1.hz === 60);
  expect("J1 frame count differs from masks", j1.frames === j1.masks.length);
  expect("J1 tape hash changed", sha256(JSON.stringify(j1.masks)) === j1.tapeSha256);
  expect("J1 base does not end where GB6 ends", j1.base.frames === gb6.frames);
  expect("wrong J2 format", j2.format === "pocket-tuxemon/j2-hospitalcure/v1");
  expect("J2 is not 60 Hz", j2.hz === 60);
  expect("J2 frame count differs from masks", j2.frames === j2.masks.length);
  expect("J2 tape hash changed", sha256(JSON.stringify(j2.masks)) === j2.tapeSha256);
  expect("J2 base does not continue the J1 combined tape",
    j2.base.frames === j1.combinedFrames && j2.base.tapeSha256 === j1.combinedTapeSha256);
  const combined = [...gb6.masks, ...j1.masks, ...j2.masks];
  expect("J1 combined frame count changed", j1.combinedFrames === gb6.frames + j1.frames);
  expect("J1 combined tape hash changed", sha256(JSON.stringify([...gb6.masks, ...j1.masks])) === j1.combinedTapeSha256);
  expect("J2 combined frame count changed", j2.combinedFrames === combined.length);
  expect("J2 combined tape hash changed", sha256(JSON.stringify(combined)) === j2.combinedTapeSha256);
  return { gb6, j1, j2, combined };
}

function defineCheckpoints(gb6: Gb6JourneyResult): Checkpoint[] {
  const firstBillie = gb6.battles.find((battle) => battle.opponent === "spyder_billie");
  expect("missing the first Billie battle", firstBillie !== undefined);
  const starterWindowEnd = firstBillie!.endFrame + 600;
  return [
    {
      id: "bedroom",
      title: "Bedroom (new game)",
      mode: "first",
      thumbnailIdle: 60,
      select: (frame, state) => frame === 0 && state.mapId === "spyder_bedroom" && safe(state),
    },
    {
      id: "paper-town",
      title: "Paper Town",
      mode: "first",
      select: (_frame, state) => state.mapId === "spyder_paper_town" && safe(state),
    },
    {
      id: "before-billie",
      title: "Before the first Billie battle",
      mode: "last",
      deadline: firstBillie!.startFrame,
      select: (frame, state) => frame < firstBillie!.startFrame && safe(state),
    },
    {
      // The bin choice leads straight into the rival battle, so the first
      // safe point with a starter is just after that battle ends.
      id: "starter",
      title: "Starter chosen",
      mode: "first",
      select: (frame, state) =>
        frame >= firstBillie!.endFrame && frame <= starterWindowEnd
        && partySize(state) >= 1 && safe(state),
    },
    {
      id: "route-1",
      title: "Route 1",
      mode: "first",
      select: (_frame, state) => state.mapId === "spyder_route1" && safe(state),
    },
    {
      id: "cotton-town",
      title: "Cotton Town",
      mode: "first",
      select: (_frame, state) => state.mapId === "spyder_cotton_town" && safe(state),
    },
    {
      id: "city-park",
      title: "City Park",
      mode: "first",
      select: (_frame, state) => state.mapId === "spyder_citypark" && safe(state),
    },
    {
      id: "route-3-north",
      title: "Route 3 north end",
      mode: "exact",
      at: gb6.frames,
      select: (frame, state) => frame === gb6.frames && state.mapId === "spyder_route3" && safe(state),
    },
    {
      id: "flower-city",
      title: "Flower City",
      mode: "first",
      select: (_frame, state) => state.mapId === "spyder_flower_city" && safe(state),
    },
    {
      id: "captain-returns",
      title: "Captain's return",
      mode: "exact",
      at: undefined, // set below to the GB6+J1 combined length
      select: () => false,
    },
    // --- J2 continuation: the hospital-cure story arc -----------------
    {
      id: "candy-town",
      title: "Candy Town",
      mode: "first",
      select: (_frame, state) => state.mapId === "spyder_candy_town" && safe(state),
    },
    {
      // Looten's post-battle dialogue grants the story-critical Aardant on
      // this map; the first safe frame afterwards is the checkpoint.
      id: "greenwash-aardant",
      title: "Greenwash (Aardant acquired)",
      mode: "first",
      select: (_frame, state) =>
        state.mapId === "spyder_greenwash" && (state.sw.items.aardant ?? 0) >= 1 && safe(state),
    },
    {
      // The recovered cure is the J2 terminal story flag, set on the
      // quarantined laboratory floor after the scanner shuts down.
      id: "hospital-cure",
      title: "Hospital cure",
      mode: "first",
      select: (_frame, state) =>
        state.mapId === "spyder_candy_hospital3"
        && (state.sw.variables["v.hospitalcure"] ?? 0) !== 0 && safe(state),
    },
  ];
}

function replayReducer(
  session: Session,
  project: ReturnType<typeof readInlineProject>,
  combined: readonly number[],
  checkpoints: Checkpoint[],
): Map<string, Capture> {
  const pending = new Map(checkpoints.map((cp) => [cp.id, cp]));
  const lastCandidates = new Map<string, number>();
  const captures = new Map<string, Capture>();
  let state = startSession(project, session);
  let previous = 0;

  const consider = (frame: number): void => {
    for (const cp of checkpoints) {
      if (captures.has(cp.id)) continue;
      if (cp.mode === "first" && cp.select(frame, state)) {
        captures.set(cp.id, { id: cp.id, title: cp.title, frame, thumbnailIdle: cp.thumbnailIdle ?? 0, state });
        pending.delete(cp.id);
      } else if (cp.mode === "last" && cp.select(frame, state)) {
        lastCandidates.set(cp.id, frame);
      } else if (cp.mode === "exact" && cp.at === frame && cp.select(frame, state)) {
        captures.set(cp.id, { id: cp.id, title: cp.title, frame, thumbnailIdle: cp.thumbnailIdle ?? 0, state });
        pending.delete(cp.id);
      }
      if (DEBUG && frame <= 60) {
        console.log(`f${frame} map=${state.mapId} modal=${state.interp.modal?.kind ?? "-"} `
          + `scene=${state.scene?.kind ?? "-"} lock=${state.interp.inputLocked} fade=${state.fade ? "y" : "n"} `
          + `busy=${state.interp.main !== null}`);
      }
    }
  };

  consider(0);
  for (let frame = 1; frame <= combined.length; frame++) {
    const mask = combined[frame - 1]!;
    state = stepSession(session, state, input(mask, previous));
    previous = mask;
    consider(frame);
    // Finalize "last" checkpoints once their deadline passes.
    for (const [id, cp] of pending) {
      if (cp.mode === "last" && cp.deadline !== undefined && frame >= cp.deadline) {
        const candidate = lastCandidates.get(id);
        expect(`checkpoint ${id}: no safe frame before deadline ${cp.deadline}`, candidate !== undefined);
        captures.set(id, {
          id,
          title: cp.title,
          frame: candidate!,
          thumbnailIdle: cp.thumbnailIdle ?? 0,
          state: captureState(session, project, combined, candidate!),
        });
        pending.delete(id);
      }
    }
  }
  for (const cp of checkpoints) {
    expect(`checkpoint ${cp.title} (${cp.id}) was never reached`, captures.has(cp.id));
  }
  return captures;
}

/** Re-fold the prefix to a specific frame (only used for "last" checkpoints,
 *  whose final frame is known only after the deadline passes). */
function captureState(
  session: Session,
  project: ReturnType<typeof readInlineProject>,
  combined: readonly number[],
  frame: number,
): SessionState {
  let state = startSession(project, session);
  let previous = 0;
  for (let f = 1; f <= frame; f++) {
    const mask = combined[f - 1]!;
    state = stepSession(session, state, input(mask, previous));
    previous = mask;
  }
  return state;
}

function buildChaptersFile(
  project: ReturnType<typeof readInlineProject>,
  gb6: Gb6JourneyResult,
  j1: J1JourneyResult,
  j2: J2JourneyResult,
  combined: readonly number[],
  captures: Map<string, Capture>,
): ChaptersFile {
  const session = createSession(project, 60, GAME_OPTIONS);
  const chapters: ChapterRecord[] = [];
  const ordered = [...captures.values()].sort((a, b) => a.frame - b.frame);
  for (const cap of ordered) {
    const held = cap.frame === 0 ? 0 : combined[cap.frame - 1]!;
    const snapshot = createSessionSnapshot(session, cap.state, held);
    const envelope = encodeEnvelope(snapshot);
    // The snapshot must pass the kit's full save gate: the decoder's
    // structural validation, then the map-aware restore contract. Dynamic
    // characters are not part of a save (the restore rebuilds them from
    // event pages), so equivalence is proven by a save/restore round-trip
    // reproducing the exact saved bytes rather than by a live-state digest.
    const decoded = decodeEnvelopeText(envelope);
    const restored = restoreSessionSnapshot(session, decoded);
    const again = createSessionSnapshot(session, restored, decoded.held);
    expect(`${cap.id}: save/restore round-trip changed the snapshot`,
      canonicalJson(again) === canonicalJson(snapshot));
    chapters.push({
      id: cap.id,
      title: cap.title,
      map: cap.state.mapId,
      position: [cap.state.move.tx, cap.state.move.ty],
      frame: cap.frame,
      timelineFrame: cap.state.frame,
      held: held >>> 0,
      suffixFrames: combined.length - cap.frame,
      snapshot: envelope,
      thumbnail: "",
      thumbnailSha256: "",
    });
  }
  return {
    format: "pocket-tuxemon/chapters/v1",
    hz: 60,
    tape: {
      gb6: { file: "data/gb6-mainline-journey.json", frames: gb6.frames, tapeSha256: gb6.tapeSha256 },
      j1: { file: "data/j1-captainreturns-journey.json", frames: j1.frames, tapeSha256: j1.tapeSha256 },
      j2: { file: "data/j2-hospitalcure-journey.json", frames: j2.frames, tapeSha256: j2.tapeSha256 },
      frames: combined.length,
      sha256: sha256(JSON.stringify(combined)),
    },
    chapters,
  };
}

async function renderThumbnails(combined: readonly number[], captures: Map<string, Capture>): Promise<Map<string, Uint8Array>> {
  if (!existsSync(BUNDLE + ".js") || !existsSync(BUNDLE + ".pak")) {
    throw new Error("bake-chapters: missing dist/main.{js,pak}; run `bun run build && bun run build:wasm`");
  }
  const ordered = [...captures.values()].sort((a, b) => a.frame - b.frame);
  const thumbnails = new Map<string, Uint8Array>();
  const reducerAt = new Map(ordered.map((cap) => [cap.frame, cap]));
  let next = 0;
  const capture = (world: Awaited<ReturnType<typeof bootWorld>>, frame: number): void => {
    const cap = reducerAt.get(frame)!;
    const live = globalThis.__rpgSessionState as SessionState | undefined;
    expect(`thumbnail ${cap.id} f${frame}: missing built-game session state`, live !== undefined);
    expect(`thumbnail ${cap.id} f${frame}: built game is on ${live!.mapId}@${live!.move.tx},${live!.move.ty}, `
      + `reducer on ${cap.state.mapId}@${cap.state.move.tx},${cap.state.move.ty}`,
      live!.mapId === cap.state.mapId && live!.move.tx === cap.state.move.tx && live!.move.ty === cap.state.move.ty);
    const rgba = world.render().slice();
    thumbnails.set(cap.id, encodePNG(rgba, THUMB_W, THUMB_H));
    if (DEBUG) console.log(`thumbnail ${cap.id} f${frame} ${live!.mapId}@${live!.move.tx},${live!.move.ty}`);
    next++;
  };

  // A frame-0 chapter (the new-game bedroom) is the only safe point before
  // the intro modal opens, and the sim surface is blank before its first
  // frame step. Render it from its own boot with idle frames so the map and
  // intro text are visible; the snapshot still belongs to frame 0.
  const first = ordered[0]!;
  if (first.frame === 0) {
    const world = await bootWorld(BUNDLE, 60, FIXED_TIME_HOST_GLOBALS, undefined, { width: THUMB_W, height: THUMB_H });
    for (let i = 0; i < first.thumbnailIdle; i++) {
      world.frame(0);
      world.tick();
    }
    capture(world, 0);
  }

  const world = await bootWorld(BUNDLE, 60, FIXED_TIME_HOST_GLOBALS, undefined, { width: THUMB_W, height: THUMB_H });
  for (let frame = 1; frame <= combined.length && next < ordered.length; frame++) {
    world.frame(combined[frame - 1]!);
    world.tick();
    if (reducerAt.has(frame)) capture(world, frame);
  }
  expect(`rendered ${next}/${ordered.length} thumbnails`, next === ordered.length);
  return thumbnails;
}

export interface BakeResult {
  chapters: ChaptersFile;
  thumbnails: Map<string, Uint8Array>;
}

export async function bakeChapters(root: string = ROOT): Promise<BakeResult> {
  const project = readInlineProject(root);
  const { gb6, j1, j2, combined } = loadTape();
  const checkpoints = defineCheckpoints(gb6);
  // The captain's return is the final frame of the GB6+J1 tape; the J2
  // continuation replays from the restored terminal snapshot.
  const last = checkpoints.find((cp) => cp.id === "captain-returns")!;
  last.at = j1.combinedFrames;
  last.select = (frame, state) => frame === j1.combinedFrames && state.mapId === "spyder_mansion" && safe(state);

  const session = createSession(project, 60, GAME_OPTIONS);
  const captures = replayReducer(session, project, combined, checkpoints);
  const chapters = buildChaptersFile(project, gb6, j1, j2, combined, captures);
  const thumbnails = await renderThumbnails(combined, captures);
  for (const chapter of chapters.chapters) {
    const png = thumbnails.get(chapter.id)!;
    chapter.thumbnail = `${THUMB_REL}/${chapter.id}-${THUMB_W}x${THUMB_H}.png`;
    chapter.thumbnailSha256 = createHash("sha256").update(png).digest("hex");
  }
  return { chapters, thumbnails };
}

export function chaptersJson(chapters: ChaptersFile): string {
  return JSON.stringify(chapters, null, 2) + "\n";
}

export interface ChapterSuffixResult {
  id: string;
  startFrame: number;
  timelineFrame: number;
  suffixFrames: number;
  terminalSha256: string;
  matches: boolean;
}

/** Prove every committed chapter envelope, restored through the public
 *  save contract and resumed at its timeline frame, suffix-replays to the
 *  same terminal state as one full replay of the combined tape.
 *
 *  The envelope carries the per-map interpreter clock (interp.frame) but
 *  not the global reducer frame (SessionState.frame), so restore alone
 *  leaves the timeline at the map-entry clock. The chapter contract
 *  supplies the global frame via `timelineFrame`: restore the snapshot,
 *  set state.frame = timelineFrame, then replay the suffix masks. The
 *  held mask seeds the previous-mask so pressed edges line up.
 *
 *  This is the test the review asked for: the committed data/chapters.json
 *  must be resumable through the documented contract, not just a
 *  save/restore round-trip. */
export function verifyChapterSuffixes(root: string = ROOT): ChapterSuffixResult[] {
  const project = readInlineProject(root);
  const { combined } = loadTape();
  const file = JSON.parse(readFileSync(CHAPTERS_PATH, "utf8")) as ChaptersFile;
  expect("chapters file format changed", file.format === "pocket-tuxemon/chapters/v1");
  const session = createSession(project, 60, GAME_OPTIONS);

  // One full replay: the terminal state every suffix must reach.
  let terminal = startSession(project, session);
  let previous = 0;
  for (let f = 1; f <= combined.length; f++) {
    const mask = combined[f - 1]!;
    terminal = stepSession(session, terminal, input(mask, previous));
    previous = mask;
  }
  const terminalHash = sha256(canonicalJson(terminal));
  const j2 = JSON.parse(readFileSync(J2_PATH, "utf8")) as { terminalStateSha256?: string };
  expect("full-replay terminal hash != the J2 journey pin",
    typeof j2.terminalStateSha256 === "string" && terminalHash === j2.terminalStateSha256);

  const results: ChapterSuffixResult[] = [];
  for (const chapter of file.chapters) {
    const decoded = decodeEnvelopeText(chapter.snapshot);
    let state = restoreSessionSnapshot(session, decoded);
    // Resume the global timeline the envelope does not carry (see the
    // timelineFrame field comment).
    state = { ...state, frame: chapter.timelineFrame };
    let prev = decoded.held >>> 0;
    for (let f = chapter.frame; f < combined.length; f++) {
      const mask = combined[f]!;
      state = stepSession(session, state, input(mask, prev));
      prev = mask;
    }
    const hash = sha256(canonicalJson(state));
    results.push({
      id: chapter.id,
      startFrame: chapter.frame,
      timelineFrame: chapter.timelineFrame,
      suffixFrames: chapter.suffixFrames,
      terminalSha256: hash,
      matches: hash === terminalHash,
    });
  }
  for (const result of results) {
    expect(`chapter ${result.id}: snapshot + suffix did not reach the full-replay terminal state`,
      result.matches);
  }
  return results;
}

if (import.meta.main) {
  const { chapters, thumbnails } = await bakeChapters();
  mkdirSync(THUMB_DIR, { recursive: true });
  for (const [id, png] of thumbnails) {
    writeFileSync(join(THUMB_DIR, `${id}-${THUMB_W}x${THUMB_H}.png`), png);
  }
  writeFileSync(CHAPTERS_PATH, chaptersJson(chapters));
  console.log(`CHAPTERS BAKED ${chapters.chapters.length} chapters, ${thumbnails.size} thumbnails`);
  for (const chapter of chapters.chapters) {
    console.log(`  ${chapter.id} f${chapter.frame} ${chapter.map}@${chapter.position.join(",")} `
      + `suffix=${chapter.suffixFrames} thumb=${chapter.thumbnailSha256.slice(0, 12)}`);
  }
}
