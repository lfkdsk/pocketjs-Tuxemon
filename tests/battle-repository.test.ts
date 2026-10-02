import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { createTuxemonExtensions } from "../battle/extension.ts";
import { battleDbToTuxemonBattleDb } from "../battle/from-battle-db.ts";
import { createTuxemonBattleRules } from "../battle/runtime.ts";
import { TUXEMON_SCENES, TUXEMON_VARIABLE_ENUMS } from "../battle/game.ts";
import { canonicalJson } from "../vendor/pocket-rpgkit/src/engine/save.ts";
import {
  createSession,
  startSession,
  stepSession,
  type SessionInput,
} from "../vendor/pocket-rpgkit/src/engine/session.ts";
import { readInlineProject } from "../tools/generated-project.ts";
import { readInlineBattleDb, readShardedBattleDb } from "../tools/generated-battle.ts";

const ROOT = resolve(import.meta.dir, "..");
const journey = JSON.parse(readFileSync(join(ROOT, "data/g6-journey.json"), "utf8")) as {
  masks: number[];
};
// Same pinned terminal state the G7 map repository test and the QuickJS
// bench check; GP1 changes only how the battle database is loaded.
const EXPECTED_TERMINAL_STATE_SHA256 = "4bc48ecf71ac6b2a162b0e515923531e7d331f6fb474228ecfffd16b8551275a";

function input(mask: number, previous: number): SessionInput {
  const pressed = mask & ~previous;
  return {
    buttons: mask,
    confirmEdge: !!(pressed & 0x2000),
    cancelEdge: !!(pressed & 0x4000),
    upEdge: !!(pressed & 0x0010),
    downEdge: !!(pressed & 0x0040),
    leftEdge: !!(pressed & 0x0080),
    rightEdge: !!(pressed & 0x0020),
  };
}

describe("GP1 lazy battle-runtime repository", () => {
  test("the sharded provider rebuilds the complete inline battle database", () => {
    // Full top-level parity. The comparable field set is not hand-written —
    // the inline library defines it, and the rebuilt provider must expose
    // exactly that set with canonically equal values. canonicalJson walks
    // every key, which forces the four lazy shard tables
    // (monsters/techniques/items/statuses) to resolve in full, so a field
    // dropped from the shell or a shard that no longer round-trips turns
    // this red instead of silently shipping.
    const inlineDb = readInlineBattleDb(ROOT) as Record<string, unknown>;
    const rebuilt = readShardedBattleDb(ROOT).load() as unknown as Record<string, unknown>;
    expect(Object.keys(rebuilt).sort()).toEqual(Object.keys(inlineDb).sort());
    expect(canonicalJson(rebuilt)).toBe(canonicalJson(inlineDb));
  });

  test("the sharded rulesDb equals the inline rulesDb for every slug", () => {
    const inlineDb = readInlineBattleDb(ROOT);
    const shardedProvider = readShardedBattleDb(ROOT);
    const inlineRules = battleDbToTuxemonBattleDb(inlineDb as never);
    const shardedRules = battleDbToTuxemonBattleDb(shardedProvider.load());
    expect(canonicalJson(shardedRules)).toBe(canonicalJson(inlineRules));
  });

  test("the maintained journey is byte-identical to the inline battle database on every frame", () => {
    const project = readInlineProject(ROOT);
    const inlineDb = readInlineBattleDb(ROOT);
    const shardedProvider = readShardedBattleDb(ROOT);
    const inlineOptions = {
      extensions: createTuxemonExtensions(inlineDb as never),
      battle: createTuxemonBattleRules(inlineDb as never, TUXEMON_VARIABLE_ENUMS),
      scenes: TUXEMON_SCENES,
    } as const;
    const shardedOptions = {
      extensions: createTuxemonExtensions(shardedProvider),
      battle: createTuxemonBattleRules(shardedProvider, TUXEMON_VARIABLE_ENUMS),
      scenes: TUXEMON_SCENES,
    } as const;
    const inlineSession = createSession(project, 60, inlineOptions);
    const shardedSession = createSession(project, 60, shardedOptions);
    let inlineState = startSession(project, inlineSession);
    let shardedState = startSession(project, shardedSession);
    let previous = 0;

    expect(canonicalJson(shardedState)).toBe(canonicalJson(inlineState));
    for (let frame = 0; frame < journey.masks.length; frame++) {
      const mask = journey.masks[frame]!;
      const frameInput = input(mask, previous);
      inlineState = stepSession(inlineSession, inlineState, frameInput);
      shardedState = stepSession(shardedSession, shardedState, frameInput);
      expect(canonicalJson(shardedState), `frame ${frame}`).toBe(canonicalJson(inlineState));
      previous = mask;
    }

    expect([shardedState.mapId, shardedState.move.tx, shardedState.move.ty])
      .toEqual(["spyder_route1", 14, 19]);
    expect(createHash("sha256").update(canonicalJson(shardedState)).digest("hex"))
      .toBe(EXPECTED_TERMINAL_STATE_SHA256);
  }, 60_000);
});
