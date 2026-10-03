import { describe, expect, test } from "bun:test";
import { placedMapAccessor } from "../ui/world-renderer-state.ts";

describe("game world renderer adapter", () => {
  test("keeps the last placed id while a world subtree switches to the legacy path", () => {
    const placed = new Set(["outdoor-a", "outdoor-b"]);
    let active = "indoor-start";
    const read = placedMapAccessor(() => active, (id) => placed.has(id), "outdoor-a");

    expect(read()).toBe("outdoor-a");
    active = "outdoor-b";
    expect(read()).toBe("outdoor-b");
    active = "indoor-destination";
    expect(read()).toBe("outdoor-b");
  });
});
