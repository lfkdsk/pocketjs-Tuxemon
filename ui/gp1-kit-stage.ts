// Stage-boundary wrapper for the QuickJS startup bench: re-exports the PocketJS framework entry points and the RPG
// Kit UI pieces main.tsx needs, then marks "engine" as its own trailing
// top-level statement. Because this wrapper's imports are its only
// dependencies, that mark fires exactly when the framework + kit UI
// bundle (the "bundle eval" stage) has finished evaluating and before any
// of Pocket Tuxemon's own JSON literals/module init (ui/gp1-data-stage.ts)
// starts.
import { mount, pakGet } from "@pocketjs/framework";
import { fsHost, readFileSync } from "@pocketjs/framework/fs";
import { createJsonMapRepository } from "../vendor/pocket-rpgkit/src/engine/map-repository.ts";
import { GameView } from "../vendor/pocket-rpgkit/src/ui/GameView.tsx";
import { gp1Mark } from "./gp1-marks.ts";

export { mount, pakGet, fsHost, readFileSync, createJsonMapRepository, GameView };

gp1Mark("engine");
