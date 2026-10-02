import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { buildJ3QuickjsTape } from "../tools/j3-quickjs-tape.ts";

describe("J3 QuickJS continuation tape", () => {
  test("starts at the hospital chapter and carries every J3 battle to the broadcast", () => {
    const tape = buildJ3QuickjsTape();
    expect(tape.format).toBe("pocket-tuxemon/j3-quickjs/v1");
    expect(tape.frames).toBe(12_991);
    expect(tape.frames).toBe(tape.masks.length);
    expect(tape.tapeSha256)
      .toBe(createHash("sha256").update(JSON.stringify(tape.masks)).digest("hex"));
    expect(tape.maps[0]).toEqual({ frame: 0, map: "spyder_candy_hospital3" });
    expect(tape.maps.at(-1)).toMatchObject({ map: "spyder_radiotower" });
    expect(tape.battles).toHaveLength(13);
    expect(tape.battles[0]).toMatchObject({ opponent: "spyder_billie", startFrame: 97 });
    expect(tape.battles.at(-1)).toMatchObject({
      opponent: "spyder_omnichannel_beaverbrook",
      outcome: "won",
    });
    expect(tape.terminalStateSha256)
      .toBe("187ac1e3795cf702dd81d6e0ecc7d6c2a1aedb5f2e7893fa4a08daa0ff5e0572");
  });
});
