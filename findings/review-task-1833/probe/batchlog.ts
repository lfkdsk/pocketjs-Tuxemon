const ROOT = "/home/tangollvm/.fleet/worktrees/task-1833";
const { bootWorld } = await import(`${ROOT}/vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts`);
const log: string[] = [];
let batches = 0;
const world = await bootWorld("/var/tmp/fleet/1838/rdist/review-main", 60, { __reviewStart: { map: "spyder_downstairs", x: 5, y: 4, dir: "down" } }, (ops: any) => {
  const origBatch = ops.setPropBatch, origSet = ops.setProp;
  ops.setPropBatch = (records: ArrayBuffer) => {
    batches++;
    const v = new Float64Array(records);
    const ids = new Set<number>();
    for (let i = 0; i + 2 < v.length; i += 3) { ids.add(v[i]!); if (v[i] === 1854 || v[i] === 2054) log.push(`batch#${batches} node ${v[i]} prop ${v[i + 1]} = ${v[i + 2]}`); }
    log.push(`batch#${batches}: ${v.length / 3} records, distinct nodes ${ids.size}, min ${Math.min(...ids)}, max ${Math.max(...ids)}`);
    return origBatch(records);
  };
  ops.setProp = (id: number, prop: number, value: number) => { if (id === 1854) log.push(`setProp node 1854 prop ${prop} = ${value}`); return origSet(id, prop, value); };
}, { width: 480, height: 272 });
for (let f = 0; f < 30; f++) { world.frame(0); world.tick(); }
console.log(log.slice(0, 40).join("\n"));
console.log("mom state:", JSON.stringify((globalThis as any).__rpgSessionState.chars.chars["npc_spyder_papertown_mom"]));
