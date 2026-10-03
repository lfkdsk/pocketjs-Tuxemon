// Cross-language saves (B2): a save written in the other language build is
// refused with a clear LANGUAGE MISMATCH prompt, not an "another build"
// error. Both load paths (slot and save code) peek at the save's language
// from its encoded envelope before the content-manifest check, because the
// en_US and zh_CN builds have different map manifests. These tests use the
// real production shells and codecs: real en/zh project manifests, real
// encode/decode through ui/save-game.ts, and the menu runtime's actual
// judgment order (button dispatch for slots, the OSK commit hook for codes).

import { afterEach, describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";

import { TUXEMON_BATTLE_DB, TUXEMON_BATTLE_RULES, TUXEMON_SCENES } from "../battle/game.ts";
import { createTuxemonExtensions } from "../battle/extension.ts";
import { FIXED_INITIAL_CIVIL_TIME, timeWeatherAt } from "../battle/time-weather.ts";
import { createSessionSnapshot, encodeSaveCode, type SaveSnapshot } from "../vendor/pocket-rpgkit/src/engine/save.ts";
import {
  createSession,
  startSession,
  type Session,
  type SessionState,
} from "../vendor/pocket-rpgkit/src/engine/session.ts";
import { createOsk } from "../vendor/pocket-rpgkit/vendor/pocketjs/framework/src/osk-controller.ts";
import { readShardedProject } from "../tools/generated-project.ts";
import { ROOT } from "../tools/save-resume.ts";
import {
  browserSaveStore,
  exportSaveCode,
  saveSlot,
  type SlotStore,
  type StorageLike,
} from "../ui/save-game.ts";
import { createSaveMenuRuntime, type SaveMenuRuntime } from "../ui/save-menu-runtime.ts";
import type { Lang } from "../ui/language.ts";

const BTN_START = 0x0008;
const BTN_UP = 0x0010;
const BTN_DOWN = 0x0040;
const BTN_CIRCLE = 0x2000;

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

interface GameSession {
  project: ReturnType<typeof readShardedProject>["project"];
  session: Session;
  state: SessionState;
}

/** A production session for the given language: real sharded shell (real
 *  map manifest) and extensions that tag saves with the language. */
function gameSession(lang: Lang): GameSession {
  const { project, repository } = readShardedProject(ROOT, lang);
  const extensions = createTuxemonExtensions(TUXEMON_BATTLE_DB, {
    initialTimeWeather: timeWeatherAt(FIXED_INITIAL_CIVIL_TIME),
    lang,
  });
  const session = createSession(project, 60, {
    maps: repository,
    extensions,
    battle: TUXEMON_BATTLE_RULES,
    scenes: TUXEMON_SCENES,
  });
  return { project, session, state: startSession(project, session) };
}

function takeSnapshot(game: GameSession): SaveSnapshot {
  // createSessionSnapshot is the exact function takeSaveSnapshot calls;
  // the save-point gate is irrelevant to a load test.
  return createSessionSnapshot(game.session, game.state, 0);
}

interface MountedMenu {
  menu: SaveMenuRuntime;
  dispose: () => void;
  replaced: () => number;
}

/** A save menu runtime bound to `game`'s session, with `lang` as the active
 *  content language and an in-memory slot store shared via `storage`. */
function mountMenu(game: GameSession, lang: Lang, storage: StorageLike): MountedMenu {
  const slots: SlotStore = { channel: "browser", store: browserSaveStore(storage) };
  let replaced = 0;
  let dispose = () => {};
  const menu = createRoot((d) => {
    dispose = d;
    return createSaveMenuRuntime(
      { slots, lang },
      {
        project: game.project,
        session: game.session,
        getState: () => game.state,
        heldButtons: () => 0,
        replaceState() {
          replaced++;
        },
      },
      createOsk,
    );
  });
  return { menu, dispose, replaced: () => replaced };
}

let lastButtons = 0;
function press(menu: SaveMenuRuntime, buttons: number): void {
  const pressed = buttons & ~lastButtons;
  lastButtons = buttons;
  menu.step(buttons, pressed);
  menu.step(0, 0);
  lastButtons = 0;
}

afterEach(() => {
  // Each mounted menu publishes itself here; drop the last one's hook.
  delete (globalThis as Record<string, unknown>).__pocketTuxemonSave;
});

describe("cross-language save code", () => {
  test("an English save code in the Chinese build shows the mismatch prompt", () => {
    const en = gameSession("en_US");
    const zh = gameSession("zh_CN");
    const code = exportSaveCode(en.session, takeSnapshot(en));

    const mounted = mountMenu(zh, "zh_CN", memoryStorage());
    mounted.menu.step(BTN_START, BTN_START);
    mounted.menu.step(0, 0);
    // The production OSK commit path, exactly as the keyboard calls it.
    (globalThis as { __pocketTuxemonSave?: { importCode(c: string): void } })
      .__pocketTuxemonSave!.importCode(code);

    const state = mounted.menu.menu();
    expect(state.kind).toBe("message");
    if (state.kind !== "message") throw new Error("expected message");
    expect(state.title).toBe("LANGUAGE MISMATCH / 语言不匹配");
    expect(state.body).toContain("English");
    expect(state.body).toContain("该存档来自英文版");
    expect(mounted.replaced()).toBe(0);
    mounted.dispose();
  });

  test("a Chinese save code in the English build shows the mismatch prompt", () => {
    const en = gameSession("en_US");
    const zh = gameSession("zh_CN");
    const code = exportSaveCode(zh.session, takeSnapshot(zh));

    const mounted = mountMenu(en, "en_US", memoryStorage());
    mounted.menu.step(BTN_START, BTN_START);
    mounted.menu.step(0, 0);
    (globalThis as { __pocketTuxemonSave?: { importCode(c: string): void } })
      .__pocketTuxemonSave!.importCode(code);

    const state = mounted.menu.menu();
    expect(state.kind).toBe("message");
    if (state.kind !== "message") throw new Error("expected message");
    expect(state.title).toBe("LANGUAGE MISMATCH / 语言不匹配");
    expect(state.body).toContain("Chinese (中文)");
    expect(state.body).toContain("该存档来自中文版");
    expect(mounted.replaced()).toBe(0);
    mounted.dispose();
  });

  test("a same-language save code from another build still says 'another build'", () => {
    const en = gameSession("en_US");
    const snapshot = takeSnapshot(en);
    // Encode with a bogus content identity: same language, foreign build.
    const foreign = {
      manifest: "0".repeat(64),
      schema: en.session.content!.schema,
    };
    const code = encodeSaveCode(snapshot, foreign);

    const mounted = mountMenu(en, "en_US", memoryStorage());
    mounted.menu.step(BTN_START, BTN_START);
    mounted.menu.step(0, 0);
    (globalThis as { __pocketTuxemonSave?: { importCode(c: string): void } })
      .__pocketTuxemonSave!.importCode(code);

    const state = mounted.menu.menu();
    expect(state.kind).toBe("message");
    if (state.kind !== "message") throw new Error("expected message");
    expect(state.title).toBe("CAN'T LOAD THAT CODE");
    expect(state.body).toBe("That save is from another build of the game.");
    mounted.dispose();
  });

  test("a same-language valid save code loads", () => {
    const en = gameSession("en_US");
    const code = exportSaveCode(en.session, takeSnapshot(en));

    const mounted = mountMenu(en, "en_US", memoryStorage());
    mounted.menu.step(BTN_START, BTN_START);
    mounted.menu.step(0, 0);
    (globalThis as { __pocketTuxemonSave?: { importCode(c: string): void } })
      .__pocketTuxemonSave!.importCode(code);

    expect(mounted.menu.menu().kind).toBe("closed");
    expect(mounted.replaced()).toBe(1);
    mounted.dispose();
  });
});

describe("cross-language slot save", () => {
  test("an English slot save in the Chinese build shows the mismatch prompt", () => {
    const en = gameSession("en_US");
    const zh = gameSession("zh_CN");
    const storage = memoryStorage();
    const enSlots: SlotStore = { channel: "browser", store: browserSaveStore(storage) };
    saveSlot(enSlots, 1, takeSnapshot(en), en.session.content);

    const mounted = mountMenu(zh, "zh_CN", storage);
    // START (open) -> DOWN (Load) -> CIRCLE (slots) -> CIRCLE (slot 1)
    press(mounted.menu, BTN_START);
    press(mounted.menu, BTN_DOWN);
    press(mounted.menu, BTN_CIRCLE);
    press(mounted.menu, BTN_CIRCLE);

    const state = mounted.menu.menu();
    expect(state.kind).toBe("message");
    if (state.kind !== "message") throw new Error("expected message");
    expect(state.title).toBe("LANGUAGE MISMATCH / 语言不匹配");
    expect(state.body).toContain("English");
    expect(mounted.replaced()).toBe(0);
    mounted.dispose();
  });

  test("the foreign save lists as a selectable slot, not an error", () => {
    const en = gameSession("en_US");
    const zh = gameSession("zh_CN");
    const storage = memoryStorage();
    const enSlots: SlotStore = { channel: "browser", store: browserSaveStore(storage) };
    saveSlot(enSlots, 1, takeSnapshot(en), en.session.content);

    const mounted = mountMenu(zh, "zh_CN", storage);
    press(mounted.menu, BTN_START);
    const listing = mounted.menu.slots();
    expect(listing[0]).not.toBeNull();
    expect(listing[0]).not.toHaveProperty("error");
    mounted.dispose();
  });
});
