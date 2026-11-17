/** Pagination geometry, kept free of DOM access so it can be unit tested.
 *
 * The reader lays text out with CSS multi-column: every column is one page. The columns are
 * exactly `viewport` wide with `gap` between them, so the distance between two page origins is
 * `(scrollWidth - viewport) / (columns - perView)` — solving for the stride instead of using
 * `viewport + gap` avoids the sub-pixel drift that makes the last page short and the page
 * counter lie.
 *
 * `perView` is how many columns a screen shows at once: 1 for phones, 2 for the desktop
 * spread. Everything the reader sees is a "screen"; everything the browser lays out is a
 * "column", and the two are converted at the boundary of this module.
 */

export interface PagerMetrics {
  /** Visible width in CSS pixels (the whole screen, not one column). */
  viewport: number;
  /** Gap between columns, read from the computed style. */
  gap: number;
  /** Total number of columns in the flow. */
  columns: number;
  /** Distance between two column origins. */
  stride: number;
  /** Columns shown side by side (1 = single page, 2 = spread). */
  perView: number;
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function safePerView(perView: number): number {
  const value = Math.round(finite(perView, 1));
  return value >= 2 ? value : 1;
}

/** How many columns a flow of `scrollWidth` produces. */
export function columnCount(scrollWidth: number, viewport: number, gap: number, perView = 1): number {
  const per = safePerView(perView);
  // One column plus one gap, divided by how many of them fit on a screen.
  const unit = (finite(viewport) + finite(gap)) / per;
  const width = finite(scrollWidth);
  if (unit <= 0 || width <= 0) return 1;
  return Math.max(1, Math.round(width / unit));
}

/** Closed-form stride: the exact distance the flow has to move between two columns. */
export function columnStride(scrollWidth: number, viewport: number, columns: number, perView = 1): number {
  const per = safePerView(perView);
  if (columns <= per) return 0;
  const range = Math.max(0, finite(scrollWidth) - finite(viewport));
  return range / (columns - per);
}

/** Screen index for a horizontal offset inside the flow. */
export function pageAt(x: number, stride: number, columns: number, perView = 1): number {
  const per = safePerView(perView);
  if (columns <= 1 || stride <= 0) return 0;
  const column = Math.min(columns - 1, Math.max(0, Math.round(finite(x) / stride)));
  const screens = Math.ceil(columns / per);
  return Math.min(screens - 1, Math.floor(column / per));
}

/** Transform offset for a screen index. */
export function offsetForPage(page: number, stride: number, columns: number, perView = 1): number {
  const per = safePerView(perView);
  const screens = Math.max(1, Math.ceil(Math.max(1, columns) / per));
  const clamped = Math.min(screens - 1, Math.max(0, Math.round(finite(page))));
  return clamped * per * Math.max(0, finite(stride));
}

/** Reading progress inside one chapter, 0..1. */
export function pageProgress(page: number, columns: number, perView = 1): number {
  if (columns <= 0) return 0;
  const per = safePerView(perView);
  const screens = Math.max(1, Math.ceil(Math.max(1, columns) / per));
  const clamped = Math.min(Math.max(0, Math.round(finite(page))), screens - 1);
  return (clamped + 1) / screens;
}

export function measureMetrics(scrollWidth: number, viewport: number, gap: number, perView = 1): PagerMetrics {
  const per = safePerView(perView);
  const safeViewport = Math.max(0, finite(viewport));
  const safeGap = Math.max(0, finite(gap));
  const columns = columnCount(scrollWidth, safeViewport, safeGap, per);
  return {
    viewport: safeViewport,
    gap: safeGap,
    columns,
    stride: columnStride(scrollWidth, safeViewport, columns, per),
    perView: per,
  };
}

/**
 * Screen range covered by one chapter.
 * `startLeft`/`endLeft` are the chapter's left edge and the next chapter's left edge (or the
 * flow's full width for the last chapter) in layout pixels.
 */
export function chapterSpan(startLeft: number, endLeft: number, metrics: PagerMetrics): { start: number; pages: number } {
  const per = safePerView(metrics.perView);
  const last = metrics.columns - 1;
  const columnAt = (x: number): number => {
    if (metrics.columns <= 1 || metrics.stride <= 0) return 0;
    return Math.min(last, Math.max(0, Math.round(finite(x) / metrics.stride)));
  };
  const startColumn = columnAt(startLeft);
  // The last character of the chapter decides the last page, so floor instead of round: a
  // chapter ending one pixel into the next column must not claim that column.
  const raw = metrics.stride > 0 ? Math.floor(Math.max(startLeft, endLeft - 1) / metrics.stride) : startColumn;
  const endColumn = Math.min(last, Math.max(startColumn, raw));
  const start = Math.floor(startColumn / per);
  const end = Math.floor(endColumn / per);
  return { start, pages: Math.max(1, end - start + 1) };
}
