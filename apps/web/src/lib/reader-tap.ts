/** Tap zones and swipe handling, modelled after hectorqin/reader's 3x3 grid.
 *
 * The grid is row-major and must always keep at least one "menu" cell: a reader that can hide
 * the toolbar but never bring it back is a dead end.
 */

export type TapAction = "prev-page" | "next-page" | "toggle-menu" | "prev-chapter" | "next-chapter" | "none";

export type TapGrid = TapAction[];

export interface TapPreset {
  id: TapPresetId;
  label: string;
  grid: TapGrid;
}

export type TapPresetId = "standard" | "simple" | "reversed" | "chapter-edges";

export const TAP_ACTIONS: Array<{ id: TapAction; label: string }> = [
  { id: "prev-page", label: "上一页" },
  { id: "next-page", label: "下一页" },
  { id: "toggle-menu", label: "工具栏" },
  { id: "prev-chapter", label: "上一章" },
  { id: "next-chapter", label: "下一章" },
  { id: "none", label: "无动作" },
];

export const TAP_ACTION_LABELS: Record<TapAction, string> = {
  "prev-page": "上一页",
  "next-page": "下一页",
  "toggle-menu": "工具栏",
  "prev-chapter": "上一章",
  "next-chapter": "下一章",
  none: "无动作",
};

const ACTION_IDS = new Set<string>(TAP_ACTIONS.map((action) => action.id));

export const TAP_PRESETS: TapPreset[] = [
  {
    id: "standard",
    label: "标准（三列）",
    grid: [
      "prev-page", "toggle-menu", "next-page",
      "prev-page", "toggle-menu", "next-page",
      "prev-chapter", "toggle-menu", "next-chapter",
    ],
  },
  {
    id: "simple",
    label: "简洁（仅翻页）",
    grid: [
      "prev-page", "toggle-menu", "next-page",
      "prev-page", "toggle-menu", "next-page",
      "prev-page", "toggle-menu", "next-page",
    ],
  },
  {
    id: "reversed",
    label: "左右互换",
    grid: [
      "next-page", "toggle-menu", "prev-page",
      "next-page", "toggle-menu", "prev-page",
      "next-chapter", "toggle-menu", "prev-chapter",
    ],
  },
  {
    id: "chapter-edges",
    label: "上下翻章",
    grid: [
      "prev-chapter", "toggle-menu", "next-chapter",
      "prev-page", "toggle-menu", "next-page",
      "prev-chapter", "toggle-menu", "next-chapter",
    ],
  },
];

export const DEFAULT_TAP_GRID: TapGrid = [...TAP_PRESETS[0].grid];

function clone(grid: TapGrid): TapGrid {
  return grid.slice(0, 9);
}

function isAction(value: unknown): value is TapAction {
  return typeof value === "string" && ACTION_IDS.has(value);
}

/** Keep the menu reachable: without a menu cell the toolbar can never come back. */
function ensureMenu(grid: TapGrid): TapGrid {
  if (grid.includes("toggle-menu")) return grid;
  const next = clone(grid);
  next[4] = "toggle-menu";
  return next;
}

export function normalizeTapGrid(value: unknown, fallback: TapGrid = DEFAULT_TAP_GRID): TapGrid {
  if (!Array.isArray(value) || value.length !== 9) return ensureMenu(clone(fallback));
  const grid = value.map((cell) => (isAction(cell) ? cell : "none")) as TapGrid;
  return ensureMenu(grid);
}

/** Change one cell; if that removes the last menu cell, the centre goes back to "menu". */
export function withTapCell(grid: TapGrid, index: number, action: TapAction): TapGrid {
  const next = normalizeTapGrid(grid);
  if (index < 0 || index > 8) return next;
  next[index] = action;
  return ensureMenu(next);
}

/** Same grid, described as a preset id when it matches one. */
export function tapPresetOf(grid: TapGrid): TapPresetId | null {
  const match = TAP_PRESETS.find((preset) => preset.grid.every((action, i) => action === grid[i]));
  return match ? match.id : null;
}

/** Which of the nine cells a point falls into; `width`/`height` are layout pixels. */
export function cellOf(x: number, y: number, width: number, height: number): { column: 0 | 1 | 2; row: 0 | 1 | 2 } {
  const third = (size: number, offset: number): 0 | 1 | 2 => {
    if (!Number.isFinite(size) || size <= 0) return 1;
    if (offset < size / 3) return 0;
    if (offset > (size * 2) / 3) return 2;
    return 1;
  };
  return { column: third(width, x), row: third(height, y) };
}

export function tapActionAt(grid: TapGrid, column: 0 | 1 | 2, row: 0 | 1 | 2, rtl = false): TapAction {
  const col = rtl ? ((2 - column) as 0 | 1 | 2) : column;
  return grid[row * 3 + col] ?? "none";
}
