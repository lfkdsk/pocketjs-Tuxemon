// Startup-stage checkpoints for tools/bench-g6-quickjs.sh (findings/GP1.md
// "Fix 1"). Bun bundles main.tsx's static dependency graph so that every
// module a wrapper imports finishes evaluating before that wrapper's own
// trailing statement runs — pushing one mark at the end of a thin,
// game-owned wrapper module (ui/gp1-kit-stage.ts, ui/gp1-data-stage.ts)
// therefore times exactly "everything imported up to here". Always defined:
// every build pays one array init plus a handful of Date.now() pushes
// (single-digit microseconds total), which is negligible next to the
// startup budget it measures and has no effect on session state, replay, or
// determinism (nothing here is read by the reducer or serialized).
export interface Gp1Mark {
  name: string;
  at: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __gp1Marks: Gp1Mark[];
}

if (!globalThis.__gp1Marks) globalThis.__gp1Marks = [];

export function gp1Mark(name: string): void {
  globalThis.__gp1Marks.push({ name, at: Date.now() });
}

gp1Mark("module-start");
