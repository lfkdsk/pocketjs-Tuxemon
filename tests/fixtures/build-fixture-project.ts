// Build the fixture project and print { project, coverage } as JSON.
//
// This runs in a subprocess (spawned by time-weather-update-time-fixture.test.ts)
// with TUXEMON_SRC pointed at the isolated fixture source tree, so the parent
// test process's environment is never mutated. Run with TUXEMON_SRC set.

import { buildProject, G6_IMPORT_OPTIONS } from "../../importer/project.ts";

const { project, report } = buildProject(["fixture_clock"], G6_IMPORT_OPTIONS);
console.log(JSON.stringify({ project, coverage: report.coverage }));
