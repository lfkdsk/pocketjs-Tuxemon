// findings/scout-S1/vars.ts — Tuxemon game-variable census (Scout S1; not
// product code). Tuxemon keeps player.game_variables as a string->value
// map; this lists every variable, the values written/tested, and who writes
// it, to size the enum encoding onto rpgkit numeric variables.
//
//   bun findings/scout-S1/vars.ts > findings/scout-S1/vars.json

import { loadAllFileEvents } from "./tuxsrc.ts";

interface VarInfo {
  written: Set<string>; // literal values written by set_variable
  tested: Set<string>; // literal values compared by variable_set name:value
  testedBare: number; // `variable_set name` (existence only)
  cleared: number; // clear_variable
  writers: Set<string>; // action types that write it
  readers: Set<string>; // condition/action types that read it
  maps: Set<string>;
}

const vars = new Map<string, VarInfo>();
const v = (name: string): VarInfo => {
  let x = vars.get(name);
  if (!x) vars.set(name, (x = { written: new Set(), tested: new Set(), testedBare: 0, cleared: 0, writers: new Set(), readers: new Set(), maps: new Set() }));
  return x;
};

// action -> index of the argument naming the variable it WRITES (dynamic value)
const DYNAMIC_WRITERS: Record<string, number> = {
  translated_dialog_choice: 1,
  choice_monster: 1,
  choice_npc: 1,
  random_integer: 0,
  set_random_variable: 0,
  copy_variable: 0,
  format_variable: 0,
  get_player_monster: 0,
  get_pending_moves: 0,
};

for (const ev of loadAllFileEvents()) {
  const map = ev.source.replace(/\.(tmx|yaml)$/, "");
  for (const a of ev.acts) {
    if (a.type === "set_variable") {
      for (const p of a.args) {
        const i = p.indexOf(":");
        const name = i < 0 ? p : p.slice(0, i);
        const val = i < 0 ? "" : p.slice(i + 1);
        const x = v(name);
        x.written.add(val);
        x.writers.add("set_variable");
        x.maps.add(map);
      }
    } else if (a.type === "clear_variable") {
      for (const p of a.args) {
        const x = v(p);
        x.cleared++;
        x.writers.add("clear_variable");
        x.maps.add(map);
      }
    } else if (a.type === "variable_math") {
      const x = v(a.args[3] ?? a.args[0]!);
      x.writers.add("variable_math");
      x.maps.add(map);
    } else if (a.type in DYNAMIC_WRITERS) {
      const idx = DYNAMIC_WRITERS[a.type]!;
      const name = a.type === "get_player_monster" ? a.args[0]! : a.args[idx]!;
      if (!name) continue;
      const x = v(name);
      x.writers.add(a.type);
      x.maps.add(map);
      if (a.type === "translated_dialog_choice" || a.type === "choice_monster" || a.type === "choice_npc") {
        for (const opt of a.args[0]!.split(":")) x.written.add(opt);
      }
    }
  }
  for (const c of ev.conds) {
    if (c.type === "variable_set") {
      for (const p of c.args) {
        const i = p.indexOf(":");
        const name = i < 0 ? p : p.slice(0, i);
        const x = v(name);
        if (i < 0 || p.slice(i + 1) === "") x.testedBare++;
        else x.tested.add(p.slice(i + 1));
        x.readers.add(`${c.op} variable_set`);
        x.maps.add(map);
      }
    } else if (c.type === "variable_is") {
      for (const p of [c.args[0]!, c.args[2]!]) {
        if (p && !/^-?\d+(\.\d+)?$/.test(p)) {
          const x = v(p);
          x.readers.add("variable_is");
          x.maps.add(map);
        }
      }
    }
  }
}

const rows = [...vars.entries()]
  .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  .map(([name, x]) => {
    const values = [...new Set([...x.written, ...x.tested])].sort();
    return {
      name,
      values,
      written: [...x.written].sort(),
      tested: [...x.tested].sort(),
      testedBare: x.testedBare,
      cleared: x.cleared,
      writers: [...x.writers].sort(),
      readers: [...x.readers].sort(),
      maps: x.maps.size,
    };
  });
const numericish = rows.filter((r) => r.writers.some((w) => ["variable_math", "random_integer", "format_variable", "copy_variable"].includes(w)) || r.readers.includes("variable_is"));
const dynamic = rows.filter((r) => r.writers.some((w) => ["get_player_monster", "get_pending_moves", "set_random_variable"].includes(w)));
const valueCounts = rows.map((r) => r.values.length);
console.log(
  JSON.stringify(
    {
      variables: rows.length,
      maxValuesPerVariable: Math.max(...valueCounts),
      histogramValuesPerVariable: Object.fromEntries(
        [...new Set(valueCounts)].sort((a, b) => a - b).map((k) => [k, valueCounts.filter((c) => c === k).length]),
      ),
      testedButNeverWritten: rows.filter((r) => r.writers.length === 0).map((r) => r.name),
      writtenButNeverTested: rows.filter((r) => r.readers.length === 0).map((r) => r.name).length,
      numericish: numericish.map((r) => r.name),
      dynamic: dynamic.map((r) => r.name),
      rows,
    },
    null,
    1,
  ),
);
