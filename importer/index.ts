import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { availableMapIds, buildProject, DEFAULT_MAPS } from "./project.ts";

export interface ImportPaths {
  project: string;
  variables: string;
  report: string;
}

export function jsonBytes(value: unknown): string {
  return JSON.stringify(value, null, 1) + "\n";
}

export function writeImport(
  mapIds: readonly string[],
  outDir = resolve(import.meta.dir, "../dist"),
): ImportPaths {
  const result = buildProject(mapIds);
  if (result.report.schemaErrors.length) {
    const detail = result.report.schemaErrors
      .slice(0, 20)
      .map((error) => `${error.path}: ${error.msg}`)
      .join("\n");
    throw new Error(`${result.report.schemaErrors.length} schema error(s)\n${detail}`);
  }
  if (result.report.transferErrors.length) {
    const detail = result.report.transferErrors
      .slice(0, 20)
      .map((error) =>
        `${error.sourceMap}/${error.event}: ${error.targetMap}@${error.x},${error.y} (${error.reason})`
      )
      .join("\n");
    throw new Error(`${result.report.transferErrors.length} invalid transfer(s)\n${detail}`);
  }
  mkdirSync(outDir, { recursive: true });
  const paths: ImportPaths = {
    project: resolve(outDir, "project.json"),
    variables: resolve(outDir, "variable-enums.json"),
    report: resolve(outDir, "import-report.json"),
  };
  writeFileSync(paths.project, jsonBytes(result.project));
  writeFileSync(paths.variables, jsonBytes(result.variables));
  writeFileSync(paths.report, jsonBytes(result.report));
  return paths;
}

function main(): void {
  const args = process.argv.slice(2);
  const named = args.filter((arg) => !arg.startsWith("--"));
  const selected = args.includes("--sample")
    ? DEFAULT_MAPS
    : named.length ? named : availableMapIds();
  const paths = writeImport(selected);
  console.log(`Imported ${selected.length} map(s); schema errors: 0`);
  console.log(`Project: ${paths.project}`);
  console.log(`Variables: ${paths.variables}`);
  console.log(`Report: ${paths.report}`);
}

if (import.meta.main) main();
