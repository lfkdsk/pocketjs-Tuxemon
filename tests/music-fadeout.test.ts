// GM1 fix 1 (B2): the 37707_tower parallel page fades the mystic-island
// BGM out. Upstream fadeout_music clears current_song immediately, so
// music_playing is false while the audible fade is still running. The kit
// keeps bgmPlaying true until the fade completes, which used to let the
// page re-trigger fadeoutBgm every frame and pin the fade counter at its
// total -- the music never stopped. The importer now pairs fadeoutBgm with
// a fading flag (sys.music_fading) that music_playing excludes and
// play_music clears. This test drives the real imported page.

import { describe, expect, test } from "bun:test";
import { TUXEMON_BATTLE_RULES, TUXEMON_EXTENSIONS } from "../battle/game.ts";
import { buildProject, G6_IMPORT_OPTIONS } from "../importer/project.ts";
import {
  createSession,
  startSession,
  stepSession,
  type SessionState,
} from "../vendor/pocket-rpgkit/src/engine/session.ts";

const NONE = { buttons: 0, confirmEdge: false, cancelEdge: false, upEdge: false, downEdge: false };
const SONG = "music_mystic_island";
const FADE_FRAMES = 60; // fadeout_music 1000 ms at 60 Hz

const PROJECT = buildProject(["37707_tower"], G6_IMPORT_OPTIONS).project;

interface Bgm {
  id: string;
  fade?: { totalTicks: number; leftTicks: number };
}

function bgmOf(state: SessionState): Bgm | undefined {
  return (state.interp as { audio?: { bgm?: Bgm } }).audio?.bgm;
}

function fadingFlag(state: SessionState): boolean {
  return state.sw.switches["sys.music_fading"] === true;
}

function newSession(): { session: ReturnType<typeof createSession>; state: SessionState } {
  const session = createSession(PROJECT, 60, {
    extensions: TUXEMON_EXTENSIONS,
    battle: TUXEMON_BATTLE_RULES,
  });
  return { session, state: startSession(PROJECT, session) };
}

describe("37707_tower fadeout_music (B2)", () => {
  test("the parallel page stops re-triggering and the BGM disappears after the fade", () => {
    const { session, state: initial } = newSession();
    expect(initial.mapId).toBe("37707_tower");
    let state = initial;
    // The map has no play_music; the BGM arrives from a previous map and
    // persists across the transfer, so inject it directly.
    state.interp.audio = { bgm: { id: SONG, volume: 100, pitch: 100, positionTicks: 0 } };

    // Frame 1: music_playing holds (BGM on, no fading flag) -> the page
    // fires fadeoutBgm and sets the flag.
    state = stepSession(session, state, NONE);
    const first = bgmOf(state);
    expect(first?.id).toBe(SONG);
    expect(first?.fade?.totalTicks).toBe(FADE_FRAMES);
    expect(fadingFlag(state)).toBe(true);

    // The flag now makes music_playing false, so the page must not fire
    // again: leftTicks has to strictly decrease instead of resetting to 60.
    const ticks: number[] = [];
    for (let frame = 0; frame < FADE_FRAMES - 2; frame++) {
      state = stepSession(session, state, NONE);
      const left = bgmOf(state)?.fade?.leftTicks;
      if (left !== undefined) ticks.push(left);
    }
    expect(ticks.length).toBeGreaterThan(0);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]).toBeLessThan(ticks[i - 1]!);
    }

    // A couple frames past the fade duration the BGM is gone entirely.
    for (let frame = 0; frame < 4; frame++) state = stepSession(session, state, NONE);
    expect(bgmOf(state)).toBeUndefined();
  });

  test("a new play_music clears the flag so a later fadeout can fire again", () => {
    const { session, state: initial } = newSession();
    let state = initial;
    state.interp.audio = { bgm: { id: SONG, volume: 100, pitch: 100, positionTicks: 0 } };

    // Run the fade to completion (flag stays set, BGM gone).
    for (let frame = 0; frame < FADE_FRAMES + 4; frame++) state = stepSession(session, state, NONE);
    expect(bgmOf(state)).toBeUndefined();
    expect(fadingFlag(state)).toBe(true);

    // play_music clears the flag (guarded: only writes when it was set) and
    // starts the track. Simulate the imported play_music body.
    state.sw.switches["sys.music_fading"] = false;
    state.interp.audio = { bgm: { id: SONG, volume: 100, pitch: 100, positionTicks: 0 } };
    state = stepSession(session, state, NONE);
    // With the flag clear and the BGM back, the page fires a fresh fade.
    expect(bgmOf(state)?.fade?.totalTicks).toBe(FADE_FRAMES);
    expect(fadingFlag(state)).toBe(true);
  });
});
