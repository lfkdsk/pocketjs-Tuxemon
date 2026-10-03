// Type-only module for the zh_CN data bundle, so the PSP stub
// (tools/psp-stubs/zh-data.ts) can type-check standalone without importing
// the real JSON blobs.
import type { ProjectShell } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import type { BattleRuntimeShell } from "../importer/battle-schema.ts";
import type { BattleNames } from "../battle/battle-names.ts";

export interface ZhData {
  project: ProjectShell;
  battleShell: BattleRuntimeShell;
  names: BattleNames;
}
