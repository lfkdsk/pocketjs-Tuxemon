// @title Pocket Tuxemon — the imported Tuxemon world on Pocket RPG Kit
import { mount, pakGet } from "@pocketjs/framework";
import { fsHost, readFileSync } from "@pocketjs/framework/fs";
import rawProject from "./dist/project-shell.json";
import { createJsonMapRepository } from "./vendor/pocket-rpgkit/src/engine/map-repository.ts";
import type { ProjectShell } from "./vendor/pocket-rpgkit/src/engine/types.ts";
import { GameView } from "./vendor/pocket-rpgkit/src/ui/GameView.tsx";
import { GAME_ASSETS } from "./ui/game-assets.ts";
import { BATTLE_ASSET_PATHS } from "./ui/battle-assets.ts";

const project = rawProject as unknown as ProjectShell;
const repository = createJsonMapRepository(project.mapIndex, {
  // splitProjectMaps emits ASCII bytes. Supplying bytes, rather than a
  // decoded string, selects the repository's bounded QuickJS fast path. The
  // desktop launcher stages entries in data.fs; web and consoles use the pak
  // that their host installs before evaluating this bundle.
  read: (entry) => fsHost() ? readFileSync(entry) : pakGet(entry),
});
// The generated literal list is the build-time asset root. Battle UI resolves
// these paths dynamically from battle-db at runtime.
void BATTLE_ASSET_PATHS;

mount(() => (
  <GameView
    project={project}
    maps={repository}
    assets={GAME_ASSETS}
    theme={{
      border: "#224f68",
      rim: "#65d5c3",
      paper: "#102b3a",
      ink: "#f5f1d7",
      dim: "#9cc8c1",
      accent: "#ffd15c",
      backdrop: "#06141d",
    }}
  />
));
