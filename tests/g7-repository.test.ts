import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createJsonMapRepository,
  mapManifestHash,
} from "../vendor/pocket-rpgkit/src/engine/map-repository.ts";
import {
  createSession,
  startSession,
  stepSession,
  type SessionInput,
  type SessionState,
} from "../vendor/pocket-rpgkit/src/engine/session.ts";
import {
  canonicalJson,
  createSessionSnapshot,
  decodeEnvelopeText,
  encodeEnvelope,
} from "../vendor/pocket-rpgkit/src/engine/save.ts";
import {
  restoreSessionEnvelope,
  restoreSessionSnapshot,
} from "../vendor/pocket-rpgkit/src/engine/save-restore.ts";
import { AttractController } from "../vendor/pocket-rpgkit/src/engine/attract.ts";
import type { ProjectShell } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import { readInlineProject, readShardedProject } from "../tools/generated-project.ts";
import { TUXEMON_BATTLE_RULES, TUXEMON_EXTENSIONS } from "../battle/game.ts";

const ROOT = resolve(import.meta.dir, "..");
const journey = JSON.parse(readFileSync(join(ROOT, "data/g6-journey.json"), "utf8")) as {
  masks: number[];
};
const GAME_OPTIONS = { extensions: TUXEMON_EXTENSIONS, battle: TUXEMON_BATTLE_RULES } as const;
// Pin the complete post-Billie state, including the spawned Nut, battle
// history, shared-session rewards, extension RNG cursor, shop stock, and
// scene/queue slots. The shared-economy migration removes ext.inventory and
// ext.money; the first-battle reward now lives in SessionState.gold.
const EXPECTED_TERMINAL_STATE_SHA256 = "5653f0110656dd4e0a930ff1908c833c9f9fc221c9cfd3a90d22b138ef8d4827";

function input(mask: number, previous: number): SessionInput {
  const pressed = mask & ~previous;
  return {
    buttons: mask,
    confirmEdge: !!(pressed & 0x2000),
    cancelEdge: !!(pressed & 0x4000),
    upEdge: !!(pressed & 0x0010),
    downEdge: !!(pressed & 0x0040),
  };
}

describe("G6 production map repository", () => {
  test("the maintained journey is byte-identical to inline on every frame", () => {
    const inlineProject = readInlineProject(ROOT);
    const sharded = readShardedProject(ROOT);
    const inlineSession = createSession(inlineProject, 60, GAME_OPTIONS);
    const shardedSession = createSession(sharded.project, 60, { maps: sharded.repository, ...GAME_OPTIONS });
    let inlineState = startSession(inlineProject, inlineSession);
    let shardedState = startSession(sharded.project, shardedSession);
    let previous = 0;

    expect(canonicalJson(shardedState)).toBe(canonicalJson(inlineState));
    for (let frame = 0; frame < journey.masks.length; frame++) {
      const mask = journey.masks[frame]!;
      const frameInput = input(mask, previous);
      inlineState = stepSession(inlineSession, inlineState, frameInput);
      shardedState = stepSession(shardedSession, shardedState, frameInput);
      expect(canonicalJson(shardedState), `frame ${frame}`).toBe(canonicalJson(inlineState));
      expect([...shardedSession.maps.keys()], `resident maps at frame ${frame}`)
        .toEqual([shardedState.mapId]);
      previous = mask;
    }

    expect([shardedState.mapId, shardedState.move.tx, shardedState.move.ty])
      .toEqual(["spyder_route1", 14, 19]);
    expect(createHash("sha256").update(canonicalJson(shardedState)).digest("hex"))
      .toBe(EXPECTED_TERMINAL_STATE_SHA256);
  }, 60_000);

  test("attract replay stays byte-identical at 60, 30, 20, and 4 Hz", () => {
    const inlineProject = readInlineProject(ROOT);
    const terminalHashes: string[] = [];
    for (const hz of [60, 30, 20, 4]) {
      const sharded = readShardedProject(ROOT);
      const inline = new AttractController(inlineProject, journey.masks, { hz, ...GAME_OPTIONS });
      const lazy = new AttractController(sharded.project, journey.masks, {
        hz,
        maps: sharded.repository,
        ...GAME_OPTIONS,
      });
      inline.startAttract();
      lazy.startAttract();
      let hostFrame = 0;
      for (; hostFrame < 20_000; hostFrame++) {
        const expected = inline.step(0);
        const actual = lazy.step(0);
        if (canonicalJson(actual.state) !== canonicalJson(expected.state)) {
          throw new Error(`attract SessionState mismatch at ${hz} Hz host frame ${hostFrame}`);
        }
        if (actual.status.demoFrame === journey.masks.length) break;
      }
      expect(lazy.status().demoFrame, `${hz} Hz tape completion`).toBe(journey.masks.length);
      expect([lazy.state.mapId, lazy.state.move.tx, lazy.state.move.ty])
        .toEqual(["spyder_route1", 14, 19]);
      terminalHashes.push(
        createHash("sha256").update(canonicalJson(lazy.state)).digest("hex"),
      );
    }
    expect(new Set(terminalHashes)).toEqual(new Set([EXPECTED_TERMINAL_STATE_SHA256]));
  }, 60_000);

  test("a cross-map save restores an evicted map and rejects another content build", () => {
    const inlineProject = readInlineProject(ROOT);
    const sharded = readShardedProject(ROOT);
    const inlineSession = createSession(inlineProject, 60, GAME_OPTIONS);
    const shardedSession = createSession(sharded.project, 60, { maps: sharded.repository, ...GAME_OPTIONS });
    let inlineState: SessionState = startSession(inlineProject, inlineSession);
    let shardedState: SessionState = startSession(sharded.project, shardedSession);
    let previous = 0;
    let inlineEnvelope = "";
    let shardedEnvelope = "";
    let savedMap = "";

    for (let frame = 0; frame <= 1367; frame++) {
      const mask = journey.masks[frame]!;
      const frameInput = input(mask, previous);
      inlineState = stepSession(inlineSession, inlineState, frameInput);
      shardedState = stepSession(shardedSession, shardedState, frameInput);
      previous = mask;
      if (frame === 1292) {
        savedMap = shardedState.mapId;
        const inlineSnapshot = createSessionSnapshot(inlineSession, inlineState, mask);
        const shardedSnapshot = createSessionSnapshot(shardedSession, shardedState, mask);
        inlineEnvelope = encodeEnvelope(inlineSnapshot);
        shardedEnvelope = encodeEnvelope(shardedSnapshot, shardedSession.content);
        expect(canonicalJson(shardedSnapshot)).toBe(canonicalJson(inlineSnapshot));
        expect(JSON.parse(shardedEnvelope).checksum).toBe(JSON.parse(inlineEnvelope).checksum);
      }
    }

    expect(savedMap).toBe("spyder_downstairs");
    expect(shardedState.mapId).toBe("spyder_paper_town");
    expect(shardedSession.maps.has(savedMap)).toBeFalse();
    const restoredInline = restoreSessionSnapshot(
      inlineSession,
      decodeEnvelopeText(inlineEnvelope),
    );
    const restoredSharded = restoreSessionEnvelope(shardedSession, shardedEnvelope);
    expect(canonicalJson(restoredSharded)).toBe(canonicalJson(restoredInline));
    expect([...shardedSession.maps.keys()]).toEqual([savedMap]);

    let reads = 0;
    const changedIndex = sharded.project.mapIndex.map((entry) => entry.id === savedMap
      ? { ...entry, sha256: "0".repeat(64) }
      : entry);
    const unhashed: ProjectShell = {
      ...sharded.project,
      mapIndex: changedIndex,
      mapManifestHash: undefined,
    };
    const mismatched: ProjectShell = { ...unhashed, mapManifestHash: mapManifestHash(unhashed) };
    const repository = createJsonMapRepository(mismatched.mapIndex, {
      read(entry) {
        reads++;
        return new Uint8Array(readFileSync(join(ROOT, "dist", entry)));
      },
    });
    const mismatchedSession = createSession(mismatched, 60, { maps: repository, ...GAME_OPTIONS });
    expect(reads).toBe(1);
    expect(() => restoreSessionEnvelope(mismatchedSession, shardedEnvelope)).toThrow(/manifest hash/);
    expect(reads).toBe(1);
  });
});
