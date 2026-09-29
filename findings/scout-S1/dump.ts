// findings/scout-S1/dump.ts — print a map's events compactly for reading
// (Scout S1; not product code).
//
//   bun findings/scout-S1/dump.ts spyder_paper_scoop [more maps...]
//   SKIP_SCENARIO=1 hides the scenario yaml events merged into every map.

import { loadAllMaps } from "./tuxsrc.ts";

const want = new Set(process.argv.slice(2));
for (const m of loadAllMaps()) {
  if (!want.has(m.slug)) continue;
  console.log(`\n##### ${m.slug} ${m.width}x${m.height} ${JSON.stringify(m.props)}`);
  for (const e of m.events) {
    if (process.env.SKIP_SCENARIO && e.origin === "scenario") continue;
    const box = e.w * e.h > 1 ? `${e.x},${e.y} ${e.w}x${e.h}` : `${e.x},${e.y}`;
    console.log(`-- [${e.origin}/${e.kind}] "${e.name}" @${box}`);
    for (const b of e.behavs) console.log(`   behav ${b.raw}`);
    for (const c of e.conds) console.log(`   ? ${c.raw}`);
    for (const a of e.acts) console.log(`   > ${a.raw}`);
  }
}
