import shellJson from "../dist/battle-runtime-shell.json";
import variableEnumsJson from "../dist/variable-enums.json";

import type { BattleRuntimeShell } from "../importer/battle-schema.ts";
import { createTuxemonBattleDbProvider, type BattleEntrySource } from "./battle-repository.ts";
import {
  createTuxemonExtensions,
  type TuxemonExtensionRuntimeOptions,
} from "./extension.ts";
import { createTuxemonBattleRules, type VariableEnums } from "./runtime.ts";
import { createTuxemonScenes, runtimeJournalIndex } from "./scenes.ts";

// GP1: the importer splits the runtime projection into this compact shell
// (bundled, like project-shell.json) plus one pak/data.fs entry per
// monster/technique/item/status. Building the provider here — instead of
// importing the full 801 KB battle-runtime-db.json as an object literal —
// keeps species/technique data out of the bundle and off the startup path;
// each battle then parses only the slugs it actually touches.
const RUNTIME_SHELL = shellJson as unknown as BattleRuntimeShell;

export function createProductionTuxemonBattle(
  source: BattleEntrySource,
  extensionOptions: Readonly<TuxemonExtensionRuntimeOptions> = {},
): {
  extensions: ReturnType<typeof createTuxemonExtensions>;
  rules: ReturnType<typeof createTuxemonBattleRules>;
  scenes: ReturnType<typeof createTuxemonScenes>["rules"];
  catalog: ReturnType<typeof createTuxemonScenes>["catalog"];
} {
  const provider = createTuxemonBattleDbProvider(RUNTIME_SHELL, source);
  const sceneBundle = createTuxemonScenes(provider, runtimeJournalIndex(RUNTIME_SHELL));
  return {
    extensions: createTuxemonExtensions(provider, extensionOptions),
    rules: createTuxemonBattleRules(provider, variableEnumsJson as VariableEnums),
    scenes: sceneBundle.rules,
    catalog: sceneBundle.catalog,
  };
}
