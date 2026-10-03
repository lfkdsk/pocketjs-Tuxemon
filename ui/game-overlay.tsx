// Composite GameView overlay: the save/load menu (START) and the language
// switcher (R). Only one is open at a time; each runtime owns its open
// button and its frames while open.

import type { JSX } from "solid-js";
import type {
  GameViewDemoRuntime,
  GameViewOverlayConfig,
  GameViewSessionHost,
} from "../vendor/pocket-rpgkit/src/ui/demo-contract.ts";
import type { UiTheme } from "../vendor/pocket-rpgkit/src/ui/theme.ts";

export function createCompositeOverlay(
  saveMenu: GameViewOverlayConfig,
  langMenu: GameViewOverlayConfig,
): GameViewOverlayConfig {
  return {
    create(host: GameViewSessionHost): GameViewDemoRuntime {
      const save = saveMenu.create(host);
      const lang = langMenu.create(host);
      return {
        step(buttons, pressed) {
          if (save.isOpen()) return save.step(buttons, pressed);
          if (lang.isOpen()) return lang.step(buttons, pressed);
          // Both closed: the save menu watches START, the language menu R.
          const saveResult = save.step(buttons, pressed);
          if (save.isOpen() || saveResult.consumed) return saveResult;
          return lang.step(buttons, pressed);
        },
        isOpen: () => save.isOpen() || lang.isOpen(),
        render(theme?: Partial<UiTheme>): JSX.Element {
          return (
            <>
              {save.render(theme)}
              {lang.render(theme)}
            </>
          );
        },
      };
    },
  };
}
