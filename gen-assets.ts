// One-command deterministic Tuxemon terrain cook.
// Usage: TUXEMON_SRC=/path/to/Tuxemon bun gen-assets.ts

import { writeTerrain } from "./importer/terrain.ts";

const build = writeTerrain({ outputRoot: import.meta.dir });
const report = build.report;
console.log(
  `terrain: ${report.maps} maps, ${report.cells} cells, ${report.entries} TILESET entries, ` +
  `${report.pakBytes} pak bytes (${report.gzipBytes} gzip), ${report.quantizedChunks} quantized chunks`,
);
