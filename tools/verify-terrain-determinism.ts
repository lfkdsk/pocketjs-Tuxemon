// Generate the complete terrain corpus twice into isolated scratch trees and
// compare every materialised byte. The scratch trees are removed on success.

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { writeTerrain } from "../importer/terrain.ts";

const ROOT = resolve(import.meta.dir, "..");
const SCRATCH = join(tmpdir(), "tuxemon-terrain-determinism");
const FIRST = join(SCRATCH, "first");
const SECOND = join(SCRATCH, "second");

function filesBelow(root: string, at = root): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    const path = join(at, entry.name);
    if (entry.isDirectory()) out.push(...filesBelow(root, path));
    else if (entry.isFile()) out.push(relative(root, path));
  }
  return out.sort();
}

function digestTree(root: string): { files: string[]; bytes: number; sha256: string } {
  const files = filesBelow(root);
  const hash = createHash("sha256");
  let bytes = 0;
  for (const file of files) {
    const body = readFileSync(join(root, file));
    const name = Buffer.from(file);
    hash.update(new Uint8Array([name.length >>> 24, name.length >>> 16, name.length >>> 8, name.length]));
    hash.update(name);
    hash.update(body);
    bytes += body.length;
  }
  return { files, bytes, sha256: hash.digest("hex") };
}

rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(FIRST, { recursive: true });
mkdirSync(SECOND, { recursive: true });
writeTerrain({ outputRoot: FIRST });
writeTerrain({ outputRoot: SECOND });
const first = digestTree(FIRST);
const second = digestTree(SECOND);
const sameFiles = first.files.length === second.files.length && first.files.every((file, index) => file === second.files[index]);
if (!sameFiles || first.sha256 !== second.sha256 || first.bytes !== second.bytes) {
  throw new Error(`terrain generation differs: ${JSON.stringify({ first, second, sameFiles })}`);
}
const report = {
  format: "g5-terrain-determinism/v1",
  runs: 2,
  filesPerRun: first.files.length,
  bytesPerRun: first.bytes,
  aggregateSha256: first.sha256,
  identical: true,
};
writeFileSync(join(ROOT, "reports/G5-determinism-report.json"), JSON.stringify(report, null, 2) + "\n");
rmSync(SCRATCH, { recursive: true, force: true });
console.log(JSON.stringify(report));
