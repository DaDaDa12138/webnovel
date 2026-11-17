/** Fixed-height virtual list, enough for a chapter catalogue of a few thousand rows.
 *
 * The catalogue used to render 300 rows and grow by 300 on every "show more" — with 1000+
 * chapters that is thousands of nodes inside a sheet. A fixed row height (48px) makes the
 * window arithmetic trivial and lets the list jump to the current chapter without measuring.
 */

export interface VirtualRangeInput {
  scrollTop: number;
  viewport: number;
  rowHeight: number;
  count: number;
  /** Extra rows rendered above and below the viewport. */
  overscan?: number;
}

export interface VirtualRange {
  start: number;
  end: number;
  offsetY: number;
  totalHeight: number;
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function visibleRange(input: VirtualRangeInput): VirtualRange {
  const rowHeight = positive(input.rowHeight, 48);
  const count = Math.max(0, Math.floor(Number.isFinite(input.count) ? input.count : 0));
  const viewport = Math.max(0, Number.isFinite(input.viewport) ? input.viewport : 0);
  const overscan = Math.max(0, Math.floor(input.overscan ?? 4));
  const totalHeight = count * rowHeight;
  if (!count) return { start: 0, end: 0, offsetY: 0, totalHeight: 0 };

  const scrollTop = Math.min(Math.max(0, Number.isFinite(input.scrollTop) ? input.scrollTop : 0), Math.max(0, totalHeight - viewport));
  const first = Math.floor(scrollTop / rowHeight);
  const visibleRows = Math.ceil(viewport / rowHeight) + 1;
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, start + visibleRows + overscan * 2);
  return { start, end, offsetY: start * rowHeight, totalHeight };
}

/** Scroll offset that centres a row, clamped so the list never scrolls past its own end. */
export function scrollTopForIndex(index: number, rowHeight: number, viewport: number, count: number): number {
  const height = positive(rowHeight, 48);
  const total = Math.max(0, count) * height;
  const max = Math.max(0, total - Math.max(0, viewport));
  const centre = Math.max(0, index) * height - Math.max(0, viewport) / 2 + height / 2;
  return Math.min(max, Math.max(0, centre));
}
