// D1/GI-1a coverage fixtures: time_is/update_time retain their tux.* ext
// shapes while set_layer now uses the kit's native screen-layer command.
//
// S5 §5.1 census: time_is 128 source uses, update_time 3, set_layer 79.

import { describe, expect, test } from "bun:test";
import {
  availableMapIds,
  buildProject,
  G6_IMPORT_OPTIONS,
} from "../importer/project.ts";
import { createTuxemonExtensions } from "../battle/extension.ts";
import type {
  Command,
  Condition,
  PageCondition,
  Project,
} from "../vendor/pocket-rpgkit/src/engine/types.ts";

type ExtCommand = Extract<Command, { op: "ext" }>;
type ExtCondition = Extract<Condition, { kind: "ext" }>;
type LayerCommand = Extract<Command, { op: "layer" }>;

/** Every ext command in a page's command tree (if/choices/battle nested). */
function collectExtCommands(commands: readonly Command[], out: ExtCommand[]): void {
  for (const command of commands) {
    if (command.op === "ext") out.push(command);
    else if (command.op === "if") {
      collectExtCommands(command.then, out);
      collectExtCommands(command.else ?? [], out);
    } else if (command.op === "choices") {
      for (const option of command.options) collectExtCommands(option.commands, out);
      collectExtCommands(command.cancel?.commands ?? [], out);
    } else if (command.op === "battle") {
      collectExtCommands(command.onWin ?? [], out);
      collectExtCommands(command.onLose ?? [], out);
      collectExtCommands(command.onEscape ?? [], out);
    }
  }
}

function collectLayerCommands(commands: readonly Command[], out: LayerCommand[]): void {
  for (const command of commands) {
    if (command.op === "layer") out.push(command);
    else if (command.op === "if") {
      collectLayerCommands(command.then, out);
      collectLayerCommands(command.else ?? [], out);
    } else if (command.op === "choices") {
      for (const option of command.options) collectLayerCommands(option.commands, out);
      collectLayerCommands(command.cancel?.commands ?? [], out);
    } else if (command.op === "battle") {
      collectLayerCommands(command.onWin ?? [], out);
      collectLayerCommands(command.onLose ?? [], out);
      collectLayerCommands(command.onEscape ?? [], out);
    }
  }
}

function collectExtConditions(condition: PageCondition | undefined, out: ExtCondition[]): void {
  if (!condition?.all) return;
  for (const child of condition.all) {
    if (child.kind === "ext") out.push(child);
  }
}

function projectExtCommands(project: Project, call: string): ExtCommand[] {
  const out: ExtCommand[] = [];
  for (const map of project.maps) {
    for (const event of map.events ?? []) {
      for (const page of event.pages) collectExtCommands(page.commands, out);
    }
  }
  return out.filter((command) => command.call === call);
}

function projectExtConditions(project: Project, call: string): ExtCondition[] {
  const out: ExtCondition[] = [];
  for (const map of project.maps) {
    for (const event of map.events ?? []) {
      for (const page of event.pages) collectExtConditions(page.condition, out);
    }
  }
  return out.filter((condition) => condition.call === call);
}

function projectLayerCommands(project: Project): LayerCommand[] {
  const out: LayerCommand[] = [];
  for (const map of project.maps) {
    for (const event of map.events ?? []) {
      for (const page of event.pages) collectLayerCommands(page.commands, out);
    }
  }
  return out.filter((command) => command.layer === "tux_overlay");
}

describe("D1 time and GI-1a set_layer imported shapes (G6)", () => {
  test("time_is stage_of_day becomes a tux.time_is ext condition", () => {
    const { project } = buildProject(["spyder_paper_town"], G6_IMPORT_OPTIONS);
    const night = projectExtConditions(project, "tux.time_is")
      .filter((c) => (c.args as Record<string, unknown>).value === "night");
    // The Day Cycle pair carries both `is ... night` (Night Day Cycle Outside)
    // and `not ... night` (Day Cycle Outside) on this map.
    const isNight = night.find((c) => (c.args as Record<string, unknown>).negate === false);
    const notNight = night.find((c) => (c.args as Record<string, unknown>).negate === true);
    expect(isNight).toBeDefined();
    expect(notNight).toBeDefined();
    expect(isNight!.args).toMatchObject({
      property: "stage_of_day",
      operation: "equals",
      value: "night",
      negate: false,
    });
  });

  test("time_is date easter egg becomes a tux.time_is ext condition", () => {
    const { project } = buildProject(["maple_bedroom"], G6_IMPORT_OPTIONS);
    const date = projectExtConditions(project, "tux.time_is")
      .find((c) => (c.args as Record<string, unknown>).property === "date");
    expect(date).toBeDefined();
    expect(date!.args).toMatchObject({
      property: "date",
      operation: "equals",
      value: "4-27",
    });
  });

  test("set_layer RGBA colour selects a native screen-layer variant", () => {
    const { project } = buildProject(["spyder_paper_town"], G6_IMPORT_OPTIONS);
    expect(projectLayerCommands(project)).toContainEqual({
      op: "layer",
      layer: "tux_overlay",
      variant: "color_0_0_128_128",
      visible: true,
    });
  });

  test("set_layer with no argument clears the native screen layer", () => {
    const { project } = buildProject(["eclipse_crystal_center"], G6_IMPORT_OPTIONS);
    const layers = projectLayerCommands(project);
    expect(layers).toContainEqual({
      op: "layer",
      layer: "tux_overlay",
      visible: null,
      variant: null,
    });
    // The same cutscene also darkens with an opaque black overlay.
    expect(layers).toContainEqual({
      op: "layer",
      layer: "tux_overlay",
      variant: "color_0_0_0_255",
      visible: true,
    });
  });

  test("set_layer PNG selects the prepackaged native image variant", () => {
    const { project } = buildProject(["spyder_candy_hospital1"], G6_IMPORT_OPTIONS);
    expect(projectLayerCommands(project)).toContainEqual({
      op: "layer",
      layer: "tux_overlay",
      variant: "image_gfx_ui_overlay_torchlight_png",
      visible: true,
    });
  });
});

describe("D1 coverage dispositions (all maps, G6)", () => {
  const { report } = buildProject(availableMapIds(), G6_IMPORT_OPTIONS);
  const rows = [
    ...report.coverage.actions.rows,
    ...report.coverage.conditions.rows,
  ];
  const row = (type: string) => rows.find((candidate) => candidate.type === type);

  test("time_is (128 source uses) is Placeholder with the D2 note", () => {
    // S5 §5.1: 128 source uses = 67 `is` + 61 `not`.
    const isTime = row("is time_is")!;
    const notTime = row("not time_is")!;
    expect(isTime.total + notTime.total).toBe(128);
    expect(isTime.placeholder + notTime.placeholder).toBe(126);
    expect(isTime.dropped + notTime.dropped).toBe(2);
    for (const candidate of [isTime, notTime]) {
      expect(candidate.reasons.placeholder?.[0]).toContain("D2");
      expect(candidate.reasons.placeholder?.[0]).toContain("tux.time_is");
    }
  });

  test("set_layer (79 source uses) is native when its source asset is available", () => {
    const setLayer = row("set_layer")!;
    expect(setLayer.total).toBe(79);
    expect(setLayer.native).toBe(77);
    expect(setLayer.placeholder).toBe(0);
    expect(setLayer.dropped).toBe(2);
    expect(setLayer.reasons.native?.[0]).toContain("KV1");
  });

  test("update_time (3 source uses) is Dropped: every source event fails to materialize", () => {
    // All three `update_time player` events live behind a folded
    // `current_state TeleporterState` guard (spyder, xero) or in battle_menu,
    // which has no .tmx and so is never a map. The converter still maps
    // update_time to a tux.update_time ext command (see the schema test), but
    // no source event reaches it, so coverage records Dropped, not Placeholder.
    const updateTime = row("update_time")!;
    expect(updateTime.total).toBe(3);
    expect(updateTime.placeholder).toBe(0);
    expect(updateTime.dropped).toBe(3);
    const reasons = updateTime.reasons.dropped ?? [];
    expect(reasons).toContain("fixed-false guard prevents the source event from starting");
    expect(reasons).toContain("source event is not materialized by any map");
  });

  test("the weather table is exported with 10 entries", () => {
    expect(report.weather.entries).toHaveLength(10);
    expect(report.weather.source).toBe("mods/tuxemon/db/weather/weathers.yaml");
    expect(report.weather.entries.map((entry) => entry.slug)).toEqual([
      "cloudy", "foggy", "freezing", "hot", "misty",
      "rain", "snow", "sunny", "thunderstorm", "windy",
    ]);
  });
});

describe("D1 time placeholder runtime handlers", () => {
  // The handlers are registered on the production extension set. They must
  // replicate the importer's historical fold so imported events keep their
  // behavior until D2 lands the virtual clock.
  const extensions = createTuxemonExtensions({} as never);
  const timeIs = extensions.conditions!["tux.time_is"]!;
  const updateTime = extensions.commands!["tux.update_time"]!;
  const ctx = {} as never;

  test("tux.time_is folds stage_of_day to the fixed morning", () => {
    // Matches the importer's pre-D1 fold: stage_of_day "morning".
    expect(timeIs(ctx, { property: "stage_of_day", operation: "equals", value: "morning", negate: false })).toBe(true);
    expect(timeIs(ctx, { property: "stage_of_day", operation: "equals", value: "night", negate: false })).toBe(false);
    expect(timeIs(ctx, { property: "stage_of_day", operation: "equals", value: "night", negate: true })).toBe(true);
    expect(timeIs(ctx, { property: "stage_of_day", operation: "not_equals", value: "morning", negate: false })).toBe(false);
  });

  test("tux.time_is folds daytime to the fixed true", () => {
    expect(timeIs(ctx, { property: "daytime", operation: "equals", value: "true", negate: false })).toBe(true);
    expect(timeIs(ctx, { property: "daytime", operation: "equals", value: "false", negate: false })).toBe(false);
  });

  test("tux.time_is is false for date/hour/season (no clock in P1)", () => {
    for (const property of ["date", "hour", "day_of_year", "year", "month", "day", "weekday", "leap_year", "season"]) {
      expect(timeIs(ctx, { property, operation: "equals", value: "anything", negate: false })).toBe(false);
    }
  });

  test("tux.update_time is a no-op", () => {
    expect(updateTime(ctx, { character: "player" })).toBeUndefined();
  });
});
