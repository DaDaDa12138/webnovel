export interface PopoverRect {
  left: number;
  top: number;
  bottom: number;
  width: number;
}

export interface PopoverSize {
  width: number;
  height: number;
}

export interface PopoverViewport {
  width: number;
  height: number;
}

export interface PopoverPlacement {
  left: number;
  top: number;
  side: "above" | "below";
}

const MARGIN = 12;
const GAP = 10;

/**
 * Place a small popover next to a text range without covering it.
 *
 * The rect comes from the tapped highlight fragment, so a mark that wraps across lines anchors
 * to the fragment the reader actually touched. Horizontal position is centred on that fragment
 * and clamped to the viewport; vertical prefers above, flips below when the mark sits near the
 * top, and pins to the bottom edge when neither side fits (long comments on small screens).
 */
export function popoverPlacement(
  rect: PopoverRect,
  size: PopoverSize,
  viewport: PopoverViewport,
  gap = GAP,
): PopoverPlacement {
  const width = Math.min(size.width, Math.max(0, viewport.width - MARGIN * 2));
  const center = rect.left + rect.width / 2;
  const left = Math.min(Math.max(MARGIN, center - width / 2), Math.max(MARGIN, viewport.width - width - MARGIN));
  const above = rect.top - gap - size.height;
  if (above >= MARGIN) return { left, top: above, side: "above" };
  const below = rect.bottom + gap;
  if (below + size.height <= viewport.height - MARGIN) return { left, top: below, side: "below" };
  return { left, top: Math.max(MARGIN, viewport.height - size.height - MARGIN), side: "below" };
}
