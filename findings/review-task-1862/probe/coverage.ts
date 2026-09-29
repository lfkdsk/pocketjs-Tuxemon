// Recompute coverage summaries for the default, K1-only and G6 (K1+K2 routes) profiles.
const ROOT = "/home/tangollvm/.fleet/worktrees/task-1833";
const { availableMapIds, buildProject, DEFAULT_IMPORT_OPTIONS, K1_IMPORT_OPTIONS, G6_IMPORT_OPTIONS } = await import(process.env.IMPORTER ?? `${ROOT}/importer/project.ts`);
const ids = availableMapIds();
for (const [name, opts] of [["default", DEFAULT_IMPORT_OPTIONS], ["K1", K1_IMPORT_OPTIONS], ["G6", G6_IMPORT_OPTIONS]] as const) {
  if (!opts) { console.log(name, "n/a"); continue; }
  const r = buildProject(ids, opts);
  const c = r.report.coverage;
  console.log(name, "maps", r.project.maps.length, "schemaErrors", r.report.schemaErrors?.length ?? r.report.schemaErrors);
  console.log("  actions   ", JSON.stringify(c.actions.summary));
  console.log("  conditions", JSON.stringify(c.conditions.summary));
}
