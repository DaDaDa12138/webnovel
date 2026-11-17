import { describe, expect, it } from "vitest";
import {
  DEFAULT_TAP_GRID,
  TAP_PRESETS,
  cellOf,
  normalizeTapGrid,
  tapActionAt,
  tapPresetOf,
  withTapCell,
} from "../apps/web/src/lib/reader-tap";

describe("tap zones", () => {
  it("ships four presets that all keep a menu cell", () => {
    expect(TAP_PRESETS).toHaveLength(4);
    for (const preset of TAP_PRESETS) {
      expect(preset.grid).toHaveLength(9);
      expect(preset.grid).toContain("toggle-menu");
    }
    expect(DEFAULT_TAP_GRID).toEqual(TAP_PRESETS[0].grid);
  });

  it("keeps the menu reachable when the editor removes the last menu cell", () => {
    // 标准预设的中列都是工具栏：把三格依次改掉，最后一格被改时中间那格自动回到工具栏。
    let grid = DEFAULT_TAP_GRID.slice();
    grid = withTapCell(grid, 1, "next-page");
    grid = withTapCell(grid, 4, "next-page");
    expect(grid[4]).toBe("next-page");
    grid = withTapCell(grid, 7, "next-page");
    expect(grid[7]).toBe("next-page");
    expect(grid[4]).toBe("toggle-menu");
    // 改别的格子不影响已有的工具栏格。
    expect(withTapCell(DEFAULT_TAP_GRID, 0, "prev-chapter")[0]).toBe("prev-chapter");
    // 越界索引原样返回。
    expect(withTapCell(DEFAULT_TAP_GRID, 12, "none")).toEqual(DEFAULT_TAP_GRID);
  });

  it("forces a menu cell when the stored grid has none", () => {
    const grid = normalizeTapGrid(Array(9).fill("next-page"));
    expect(grid[4]).toBe("toggle-menu");
    expect(grid[0]).toBe("next-page");
  });

  it("falls back on wrong shapes and unknown actions", () => {
    expect(normalizeTapGrid(["next-page"])).toEqual(DEFAULT_TAP_GRID);
    expect(normalizeTapGrid(null)).toEqual(DEFAULT_TAP_GRID);
    const grid = normalizeTapGrid(["bogus", "next-page", "toggle-menu", "next-page", "toggle-menu", "next-page", "next-page", "toggle-menu", "next-page"]);
    expect(grid[0]).toBe("none");
  });

  it("recognises a preset back from its grid", () => {
    expect(tapPresetOf([...TAP_PRESETS[2].grid])).toBe("reversed");
    expect(tapPresetOf(normalizeTapGrid(["none", "none", "none", "none", "toggle-menu", "none", "none", "none", "none"]))).toBeNull();
  });

  it("splits the screen into three columns and rows", () => {
    expect(cellOf(10, 10, 300, 600)).toEqual({ column: 0, row: 0 });
    expect(cellOf(150, 300, 300, 600)).toEqual({ column: 1, row: 1 });
    expect(cellOf(299, 599, 300, 600)).toEqual({ column: 2, row: 2 });
    expect(cellOf(5, 5, 0, 0)).toEqual({ column: 1, row: 1 });
  });

  it("reads the grid row-major and mirrors for rtl", () => {
    const grid = [...DEFAULT_TAP_GRID];
    expect(tapActionAt(grid, 0, 0)).toBe("prev-page");
    expect(tapActionAt(grid, 2, 0)).toBe("next-page");
    expect(tapActionAt(grid, 0, 0, true)).toBe("next-page");
    expect(tapActionAt(grid, 1, 1, true)).toBe("toggle-menu");
  });
});
