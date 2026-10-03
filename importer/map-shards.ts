import { splitProjectMaps, type SplitProjectMaps } from "../vendor/pocket-rpgkit/tools/lib/map-project.ts";
import {
  assertShellManifestFresh,
  mapManifestHash,
} from "../vendor/pocket-rpgkit/src/engine/map-repository.ts";
import { canonicalJson, utf8Encode } from "../vendor/pocket-rpgkit/src/engine/save.ts";
import type { Project, ProjectShell } from "../vendor/pocket-rpgkit/src/engine/types.ts";

/**
 * Compact-map decoding is linear in the encoded object tree. On QuickJS the
 * very largest event-heavy shards can make one indivisible repository stage
 * exceed the frame budget even though canonical JSON is only modestly larger.
 * Keep compact transport for normal maps and trade bytes for bounded decode
 * latency once an encoded entry crosses 128 KiB.
 */
export const MAX_COMPACT_MAP_ENTRY_BYTES = 128 * 1024;

export function splitGameProjectMaps(
  project: Project,
  maxCompactBytes = MAX_COMPACT_MAP_ENTRY_BYTES,
): SplitProjectMaps {
  if (!Number.isSafeInteger(maxCompactBytes) || maxCompactBytes < 0) {
    throw new Error("map shards: maxCompactBytes must be a non-negative safe integer");
  }
  const auto = splitProjectMaps(project, {
    shellEntry: "project-shell.json",
    entryEncoding: "auto",
    mapEntry: (id) => `maps/${id}.rkm`,
  });
  const canonical = splitProjectMaps(project, {
    shellEntry: "project-shell.json",
    entryEncoding: "json",
    mapEntry: (id) => `maps/${id}.json`,
  });
  const canonicalById = new Map(canonical.entries.map((entry) => [entry.meta.id, entry]));
  const entries = auto.entries.map((entry) =>
    entry.encoding === "json" || entry.bytes.byteLength > maxCompactBytes
      ? canonicalById.get(entry.meta.id)!
      : entry
  );
  const { mapManifestHash: _manifest, mapIndex: _index, ...globals } = auto.shell;
  const unhashed: ProjectShell = {
    ...globals,
    mapIndex: entries.map((entry) => entry.meta),
  };
  const shell: ProjectShell = {
    ...unhashed,
    mapManifestHash: mapManifestHash(unhashed),
  };
  assertShellManifestFresh(shell);
  const shellText = canonicalJson(shell);
  return {
    shell,
    shellText,
    entries,
    files: [
      { path: "project-shell.json", bytes: utf8Encode(shellText) },
      ...entries.map((entry) => ({ path: entry.path, bytes: entry.bytes })),
    ],
  };
}
