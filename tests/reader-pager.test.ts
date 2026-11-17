import { describe, expect, it } from "vitest";
import {
  chapterSpan,
  columnCount,
  columnStride,
  measureMetrics,
  offsetForPage,
  pageAt,
  pageProgress,
} from "../apps/web/src/lib/reader-pager";

describe("reader pager geometry", () => {
  it("counts columns from the flow width and the page stride", () => {
    expect(columnCount(2160, 720, 0)).toBe(3);
    expect(columnCount(720, 720, 0)).toBe(1);
    expect(columnCount(0, 720, 0)).toBe(1);
    expect(columnCount(2160, 720, 64)).toBe(3);
  });

  it("derives a stride that lands exactly on the last page", () => {
    const metrics = measureMetrics(2160, 720, 0);
    expect(metrics.columns).toBe(3);
    expect(metrics.stride).toBe(720);
    expect(offsetForPage(2, metrics.stride, metrics.columns)).toBe(1440);
    expect(offsetForPage(9, metrics.stride, metrics.columns)).toBe(1440);
  });

  it("rounds stray offsets to the nearest page", () => {
    expect(pageAt(0, 720, 3)).toBe(0);
    expect(pageAt(700, 720, 3)).toBe(1);
    expect(pageAt(5000, 720, 3)).toBe(2);
    expect(pageAt(-40, 720, 3)).toBe(0);
    expect(pageAt(100, 0, 1)).toBe(0);
  });

  it("reports progress inside a chapter", () => {
    expect(pageProgress(0, 4)).toBe(0.25);
    expect(pageProgress(3, 4)).toBe(1);
    expect(pageProgress(0, 0)).toBe(0);
  });

  it("maps a chapter to its first page and page count", () => {
    const metrics = measureMetrics(2880, 720, 0);
    expect(metrics.columns).toBe(4);
    expect(chapterSpan(720, 1440, metrics)).toEqual({ start: 1, pages: 1 });
    expect(chapterSpan(720, 2160, metrics)).toEqual({ start: 1, pages: 2 });
    expect(chapterSpan(2880, 2880, metrics)).toEqual({ start: 3, pages: 1 });
  });

  it("treats two columns as one screen in spread mode", () => {
    // 6 columns of 600px with 64px gaps: scrollWidth = 6*600 + 5*64 = 3920, viewport = 1264.
    const metrics = measureMetrics(3920, 1264, 64, 2);
    expect(metrics.columns).toBe(6);
    expect(metrics.perView).toBe(2);
    expect(metrics.stride).toBe(664);
    expect(offsetForPage(0, metrics.stride, metrics.columns, 2)).toBe(0);
    expect(offsetForPage(1, metrics.stride, metrics.columns, 2)).toBe(1328);
    expect(offsetForPage(2, metrics.stride, metrics.columns, 2)).toBe(2656);
    expect(offsetForPage(9, metrics.stride, metrics.columns, 2)).toBe(2656);
    expect(pageAt(0, metrics.stride, metrics.columns, 2)).toBe(0);
    expect(pageAt(664, metrics.stride, metrics.columns, 2)).toBe(0);
    expect(pageAt(1328, metrics.stride, metrics.columns, 2)).toBe(1);
    expect(pageProgress(2, metrics.columns, 2)).toBe(1);
    expect(pageProgress(0, metrics.columns, 2)).toBeCloseTo(1 / 3, 5);
  });

  it("maps chapters to screens, not columns, in spread mode", () => {
    const metrics = measureMetrics(3920, 1264, 64, 2);
    // Chapter starting on column 2 starts on screen 1.
    expect(chapterSpan(1328, 1992, metrics)).toEqual({ start: 1, pages: 1 });
    // A chapter spanning columns 1..3 covers screens 0..1.
    expect(chapterSpan(664, 2656, metrics)).toEqual({ start: 0, pages: 2 });
    // Last chapter ending at the flow edge still claims the final screen.
    expect(chapterSpan(3328, 3920, metrics)).toEqual({ start: 2, pages: 1 });
  });

  it("survives a single-page flow", () => {
    const metrics = measureMetrics(700, 720, 64);
    expect(metrics.columns).toBe(1);
    expect(metrics.stride).toBe(0);
    expect(chapterSpan(0, 700, metrics)).toEqual({ start: 0, pages: 1 });
  });
});
