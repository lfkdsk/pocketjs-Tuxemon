// @title Pocket Tuxemon — the imported Tuxemon world on Pocket RPG Kit
import { mount } from "@pocketjs/framework";
import rawProject from "./dist/project.json";
import type { Project } from "./vendor/pocket-rpgkit/src/engine/types.ts";
import { GameView } from "./vendor/pocket-rpgkit/src/ui/GameView.tsx";
import { GAME_ASSETS } from "./ui/game-assets.ts";

const project = rawProject as unknown as Project;

mount(() => (
  <GameView
    project={project}
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
