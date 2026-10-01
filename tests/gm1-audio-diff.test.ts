// GM1 fix 1 (B3): the audio-diff tool must read a real baseline, normalize
// (drop interp.audio, canonicalize e###_ char prefixes), and exit non-zero
// when the states differ beyond audio. The old version compared against the
// journey's own golden (mislabeled "pre-GM1") and always exited 0.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audioOnlyDiff, diffTopLevel, normalizeForAudioDiff } from "../tools/gm1-audio-diff.ts";

type AnyState = Record<string, unknown> & { interp: Record<string, unknown> };

function baseState(): AnyState {
  return {
    mapId: "spyder_route3",
    move: { tx: 4, ty: 6 },
    frame: 100,
    chars: { chars: { e028_talk_wanda_r051: { id: "e028_talk_wanda_r051" } }, rng: 7 },
    sw: { switches: {}, variables: {} },
    interp: { frame: 100, cues: [] },
  };
}

describe("audioOnlyDiff (B3)", () => {
  test("audio-only delta passes", () => {
    const baseline = baseState();
    const current = baseState();
    (current.interp as { audio?: unknown }).audio = { bgm: { id: "music_x", volume: 100 } };
    expect(audioOnlyDiff(current as never, baseline as never)).toEqual({ audioOnly: true, diffs: [] });
  });

  test("char-id prefix shift plus audio still passes", () => {
    // One event insertion shifts every later e###_ prefix by one.
    const baseline = baseState();
    const current = baseState();
    current.chars = { chars: { e029_talk_wanda_r051: { id: "e029_talk_wanda_r051" } }, rng: 7 };
    (current.interp as { audio?: unknown }).audio = { bgm: { id: "music_x", volume: 100 } };
    expect(audioOnlyDiff(current as never, baseline as never)).toEqual({ audioOnly: true, diffs: [] });
  });

  test("extra non-audio delta fails and names the path", () => {
    const baseline = baseState();
    const current = baseState();
    (current.interp as { audio?: unknown }).audio = { bgm: { id: "music_x", volume: 100 } };
    current.frame = 999;
    const result = audioOnlyDiff(current as never, baseline as never);
    expect(result.audioOnly).toBe(false);
    expect(result.diffs).toContain("frame");
  });

  test("normalizeForAudioDiff drops audio and canonicalizes prefixes", () => {
    const s = baseState();
    (s.interp as { audio?: unknown }).audio = { bgm: { id: "x" } };
    const n = normalizeForAudioDiff(s as never) as unknown as AnyState;
    expect(n.interp.audio).toBeUndefined();
    expect(Object.keys((n.chars as { chars: Record<string, unknown> }).chars)[0]).toBe("e_talk_wanda_r051");
  });

  test("diffTopLevel reports every differing top-level key", () => {
    const a = baseState();
    const b = baseState();
    a.frame = 1; b.frame = 2;
    a.sw = { x: 1 };
    expect(diffTopLevel(a, b).sort()).toEqual(["frame", "sw"]);
  });
});

describe("gm1-audio-diff CLI (B3)", () => {
  const dir = mkdtempSync(join(tmpdir(), "gm1-diff-"));
  const baselinePath = join(dir, "baseline.json");
  const currentPath = join(dir, "current.json");

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeStates(current: AnyState, baseline: AnyState): void {
    writeFileSync(baselinePath, JSON.stringify(baseline));
    writeFileSync(currentPath, JSON.stringify(current));
  }

  function run(): { code: number; out: string } {
    try {
      const out = execFileSync(
        "bun",
        ["tools/gm1-audio-diff.ts", "--baseline", baselinePath, "--current", currentPath],
        { cwd: join(import.meta.dir, ".."), encoding: "utf8" },
      );
      return { code: 0, out };
    } catch (e) {
      return { code: (e as { status?: number }).status ?? 1, out: String((e as { stdout?: unknown }).stdout ?? "") + String((e as { stderr?: unknown }).stderr ?? "") };
    }
  }

  test("exits 0 when the only delta is audio", () => {
    const baseline = baseState();
    const current = baseState();
    (current.interp as { audio?: unknown }).audio = { bgm: { id: "music_x" } };
    writeStates(current, baseline);
    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).toContain("audio-only");
  });

  test("exits 1 when there is an extra non-audio delta", () => {
    const baseline = baseState();
    const current = baseState();
    (current.interp as { audio?: unknown }).audio = { bgm: { id: "music_x" } };
    current.frame = 999;
    writeStates(current, baseline);
    const r = run();
    expect(r.code).toBe(1);
    expect(r.out).toContain("frame");
  });

  test("exits 2 without --baseline", () => {
    try {
      execFileSync("bun", ["tools/gm1-audio-diff.ts"], {
        cwd: join(import.meta.dir, ".."),
        encoding: "utf8",
        stdio: "pipe",
      });
      expect.unreachable("should have exited non-zero");
    } catch (e) {
      expect((e as { status?: number }).status).toBe(2);
    }
  });
});
