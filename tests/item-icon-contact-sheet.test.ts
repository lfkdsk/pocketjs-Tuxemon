import { expect, test } from "bun:test";
import { resolveCell } from "../tools/item-icon-contact-sheet.ts";

// Minimal stand-ins for dist/import-report.json and dist/project.json.
const report = {
  itemIcons: {
    sheet: { cols: 16, rows: 9 },
    cells: [
      { cell: 0, file: "gfx/items/apple.png" },
      { cell: 19, file: "gfx/items/box.png" },
      { cell: 100, file: "gfx/items/tm_earth.png" },
    ],
    placeholderCell: 143,
  },
};

const project = {
  items: [
    { id: "repellent", sprite: "items.19" },
    { id: "apple", sprite: "items.0" },
    { id: "tm_earth", sprite: "items.100" },
    { id: "elianeoutput", sprite: "items.143" },
  ],
};

test("resolveCell: project item slug", () => {
  expect(resolveCell("repellent", report, project)).toEqual({ cell: 19, label: "box.png" });
});

test("resolveCell: numeric cell", () => {
  expect(resolveCell("19", report, project)).toEqual({ cell: 19, label: "box.png" });
});

test("resolveCell: placeholder cell by number", () => {
  expect(resolveCell("143", report, project)).toEqual({ cell: 143, label: "placeholder" });
});

test("resolveCell: placeholder cell via item slug", () => {
  expect(resolveCell("elianeoutput", report, project)).toEqual({ cell: 143, label: "placeholder" });
});

test("resolveCell: upstream file basename with and without extension", () => {
  expect(resolveCell("box.png", report, project)).toEqual({ cell: 19, label: "box.png" });
  expect(resolveCell("box", report, project)).toEqual({ cell: 19, label: "box.png" });
});

test("resolveCell: unknown selectors throw", () => {
  expect(() => resolveCell("nonexistent", report, project)).toThrow("no cell for nonexistent");
  expect(() => resolveCell("999", report, project)).toThrow("no cell for 999");
});
