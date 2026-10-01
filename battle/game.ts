import battleDbJson from "../data/battle-db.json";
import variableEnumsJson from "../dist/variable-enums.json";

import { validateBattleDb } from "../importer/battle-schema.ts";
import { createTuxemonExtensions } from "./extension.ts";
import { createTuxemonBattleRules, type VariableEnums } from "./runtime.ts";
import { createTuxemonScenes } from "./scenes.ts";

/** Shared production registration used by GameView and headless journeys. */
export const TUXEMON_BATTLE_DB = validateBattleDb(battleDbJson);
export const TUXEMON_VARIABLE_ENUMS = variableEnumsJson as VariableEnums;
export const TUXEMON_EXTENSIONS = createTuxemonExtensions(TUXEMON_BATTLE_DB);
export const TUXEMON_BATTLE_RULES = createTuxemonBattleRules(
  TUXEMON_BATTLE_DB,
  TUXEMON_VARIABLE_ENUMS,
);
const TUXEMON_SCENE_BUNDLE = createTuxemonScenes(TUXEMON_BATTLE_DB);
export const TUXEMON_SCENES = TUXEMON_SCENE_BUNDLE.rules;
export const TUXEMON_SCENE_CATALOG = TUXEMON_SCENE_BUNDLE.catalog;
export const TUXEMON_SESSION_OPTIONS = Object.freeze({
  extensions: TUXEMON_EXTENSIONS,
  battle: TUXEMON_BATTLE_RULES,
  scenes: TUXEMON_SCENES,
});
