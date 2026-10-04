// Node/Bun-side access to the generated battle-runtime shell + shards. The
// desktop/web byte source is the equivalent read in main.tsx (data.fs on
// desktop, pak elsewhere) — see tools/generated-project.ts for the map
// repository's version of the same split.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createTuxemonBattleDbProvider } from "../battle/battle-repository.ts";
import type { BattleDbProvider } from "../battle/extension.ts";
import type { BattleRuntimeShell } from "../importer/battle-schema.ts";

export function readInlineBattleDb(root: string): unknown {
  return JSON.parse(readFileSync(join(resolve(root), "data/battle-runtime-db.json"), "utf8"));
}

export function readShardedBattleDb(
  root: string,
  onRead: (entry: string) => void = () => {},
): BattleDbProvider {
  const absolute = resolve(root);
  const shell = JSON.parse(
    readFileSync(join(absolute, "dist/battle-runtime-shell.json"), "utf8"),
  ) as BattleRuntimeShell;
  return createTuxemonBattleDbProvider(shell, {
    read: (entry) => {
      onRead(entry);
      return new Uint8Array(readFileSync(join(absolute, "dist", entry)));
    },
  });
}
