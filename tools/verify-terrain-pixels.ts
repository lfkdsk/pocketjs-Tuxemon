// Run the six-map/two-viewport G5 pixel matrix against references written by
// tools/terrain-reference.py.  Runtime shots stay in /var/tmp; committed
// comparison strips and the machine-readable report go below findings/.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const REFERENCE = process.env.G5_REFERENCE ?? "/var/tmp/fleet/task-1806/g5-reference";
const RUNTIME = process.env.G5_RUNTIME_SHOTS ?? "/var/tmp/fleet/task-1806/runtime-shots";
const COMPARE = join(ROOT, "findings/G5-shots");
const REPORT = join(ROOT, "findings/G5-pixel-report.json");

const cases = [
  { map: "taba_house1", at: [64, 48] },
  { map: "taba_town", at: [496, 128], occluded: true },
  { map: "buddha_mountain", at: [800, 800] },
  { map: "tt_searoute1", at: [320, 320] },
  { map: "spyder_timber_town", at: [320, 320] },
  { map: "route3", at: [320, 320] },
] as const;
const viewports = [[480, 272], [960, 544]] as const;

mkdirSync(RUNTIME, { recursive: true });
mkdirSync(COMPARE, { recursive: true });
const rows: Record<string, unknown>[] = [];
for (const entry of cases) {
  for (const [width, height] of viewports) {
    const stem = `${entry.map}-${width}x${height}`;
    const proc = Bun.spawnSync({
      cmd: [
        process.execPath,
        join(ROOT, "tools/render-terrain.ts"),
        `--map=${entry.map}`,
        `--w=${width}`,
        `--h=${height}`,
        `--at=${entry.at[0]},${entry.at[1]}`,
        `--ref=${join(REFERENCE, `${entry.map}-full.png`)}`,
        `--out=${join(RUNTIME, `${stem}.png`)}`,
        `--compare=${join(COMPARE, `compare-${stem}.png`)}`,
      ],
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) {
      throw new Error(`pixel case ${stem} failed:\n${proc.stderr.toString()}${proc.stdout.toString()}`);
    }
    const result = JSON.parse(proc.stdout.toString().trim()) as Record<string, unknown>;
    if (result.outsideMask !== 0) throw new Error(`${stem}: ${result.outsideMask} pixels differ outside marker`);
    if ("occluded" in entry && entry.occluded && result.markerSame !== 256) {
      throw new Error(`${stem}: upper layer covers ${result.markerSame}/256 marker pixels, expected 256`);
    }
    rows.push(result);
    console.log(`${stem}: outside=${result.outsideMask} markerSame=${result.markerSame}`);
  }
}

const report = {
  format: "g5-pixel-verification/v1",
  reference: "Python ElementTree + Pillow/numpy direct TMX composite; animations at first frame",
  runtime: "PocketJS wasm host + RPG Kit StreamedChunkLayer + loadTileTexture",
  cases: rows,
  totals: {
    comparisons: rows.length,
    comparedPixels: rows.reduce((sum, row) => sum + Number(row.width) * Number(row.height), 0),
    outsideMaskDifferences: rows.reduce((sum, row) => sum + Number(row.outsideMask), 0),
  },
};
writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");
console.log(`wrote ${REPORT}`);
