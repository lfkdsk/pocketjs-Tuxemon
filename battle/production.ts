import runtimeDbJson from "../data/battle-runtime-db.json";
import variableEnumsJson from "../dist/variable-enums.json";

import type { BattleDb } from "../importer/battle-schema.ts";
import { createTuxemonExtensions } from "./extension.ts";
import { createTuxemonBattleRules, type VariableEnums } from "./runtime.ts";

// The importer derives this complete reducer-facing projection from the
// validated canonical database. Keeping it as an object literal avoids a
// runtime JSON parse while omitting metadata no battle path can read.
const RUNTIME_BATTLE_DB = runtimeDbJson as unknown as BattleDb;

export const TUXEMON_EXTENSIONS = createTuxemonExtensions(RUNTIME_BATTLE_DB);
export const TUXEMON_BATTLE_RULES = createTuxemonBattleRules(
  RUNTIME_BATTLE_DB,
  variableEnumsJson as VariableEnums,
);
