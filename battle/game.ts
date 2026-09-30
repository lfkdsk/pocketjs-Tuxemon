import battleDbJson from "../data/battle-db.json";
import variableEnumsJson from "../dist/variable-enums.json";

import { validateBattleDb } from "../importer/battle-schema.ts";
import { createTuxemonExtensions } from "./extension.ts";
import { createTuxemonBattleRules, type VariableEnums } from "./runtime.ts";

/** Shared production registration used by GameView and headless journeys. */
export const TUXEMON_BATTLE_DB = validateBattleDb(battleDbJson);
export const TUXEMON_VARIABLE_ENUMS = variableEnumsJson as VariableEnums;
export const TUXEMON_EXTENSIONS = createTuxemonExtensions(TUXEMON_BATTLE_DB);
export const TUXEMON_BATTLE_RULES = createTuxemonBattleRules(
  TUXEMON_BATTLE_DB,
  TUXEMON_VARIABLE_ENUMS,
);
