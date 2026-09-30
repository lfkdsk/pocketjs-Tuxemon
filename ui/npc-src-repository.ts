// GP1 fix 1: lazy, per-NPC sprite-frame table. ui/game-assets.ts carries
// only NPC_SRC_INDEX (NPC art id -> pak/data.fs entry); lazyEntryTable
// resolves and caches each NPC's frame paths on first read. GameView's
// npcFrame only ever reads `npcSrc[name]` for the specific NPC it is
// currently resolving (see vendor/pocket-rpgkit/src/ui/GameView.tsx:127),
// never an enumeration, so a session only ever parses the NPCs it actually
// spawns.
import { lazyEntryTable, type LazyEntrySource } from "./lazy-entry-table.ts";
import type { NpcArt } from "../vendor/pocket-rpgkit/src/ui/game-assets.ts";
import type { NpcSrcIndexEntry } from "../importer/npc-src.ts";

export type { NpcSrcIndexEntry };
export type NpcSrcEntrySource = LazyEntrySource;

export function createNpcSrcProvider(
  index: readonly NpcSrcIndexEntry[],
  source: NpcSrcEntrySource,
): Readonly<Record<string, NpcArt>> {
  return lazyEntryTable<NpcArt>(index, source, "npc-src");
}
