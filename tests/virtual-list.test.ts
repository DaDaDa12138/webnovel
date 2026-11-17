import { describe, expect, it } from "vitest";
import { scrollTopForIndex, visibleRange } from "../apps/web/src/lib/virtual-list";

describe("virtual list", () => {
  it("renders only the visible window plus overscan", () => {
    const range = visibleRange({ scrollTop: 0, viewport: 480, rowHeight: 48, count: 1000 });
    expect(range.start).toBe(0);
    expect(range.end).toBe(19);
    expect(range.offsetY).toBe(0);
    expect(range.totalHeight).toBe(48000);
  });

  it("follows the scroll position and clamps the tail", () => {
    const mid = visibleRange({ scrollTop: 4800, viewport: 480, rowHeight: 48, count: 1000 });
    expect(mid.start).toBe(96);
    expect(mid.offsetY).toBe(96 * 48);
    const end = visibleRange({ scrollTop: 999999, viewport: 480, rowHeight: 48, count: 1000 });
    expect(end.end).toBe(1000);
  });

  it("handles an empty list and a missing row height", () => {
    expect(visibleRange({ scrollTop: 0, viewport: 480, rowHeight: 48, count: 0 })).toEqual({
      start: 0,
      end: 0,
      offsetY: 0,
      totalHeight: 0,
    });
    const range = visibleRange({ scrollTop: 0, viewport: 480, rowHeight: 0, count: 10 });
    expect(range.totalHeight).toBe(480);
  });

  it("centres the current row and never scrolls past the end", () => {
    expect(scrollTopForIndex(10, 48, 480, 1000)).toBe(264);
    expect(scrollTopForIndex(999, 48, 480, 1000)).toBe(47520);
    expect(scrollTopForIndex(-5, 48, 480, 1000)).toBe(0);
  });
});
