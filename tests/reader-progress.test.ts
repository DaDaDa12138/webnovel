import { describe, expect, it } from "vitest";
import { bookPercent, buildStarts, chapterLength, clamp01, paragraphAt, readingMinutes, remainingChars } from "../apps/web/src/lib/reader-progress";
import { firstVisibleOffsetFromRects } from "../apps/web/src/lib/reader-dom";

describe("reader progress", () => {
  const paragraphs = ["第一段", "第二段文字", "第三段"];
  const starts = buildStarts(paragraphs);

  it("builds character starts with a separator per paragraph", () => {
    expect(starts).toEqual([0, 4, 10]);
    expect(chapterLength(paragraphs, starts)).toBe(13);
  });

  it("maps a char offset to the containing paragraph", () => {
    expect(paragraphAt(starts, 0)).toBe(0);
    expect(paragraphAt(starts, 3)).toBe(0);
    expect(paragraphAt(starts, 4)).toBe(1);
    expect(paragraphAt(starts, 9)).toBe(1);
    expect(paragraphAt(starts, 10)).toBe(2);
    expect(paragraphAt(starts, 999)).toBe(2);
  });

  it("handles empty chapters", () => {
    expect(buildStarts([])).toEqual([]);
    expect(chapterLength([], [])).toBe(0);
    expect(paragraphAt([], 5)).toBe(0);
  });

  it("clamps chapter percent into 0..1", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(9)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });

  it("computes the whole-book percent from chapter index and chapter percent", () => {
    expect(bookPercent(0, 0, 100)).toBe(0);
    expect(bookPercent(0, 0.5, 100)).toBe(0.5);
    expect(bookPercent(99, 1, 100)).toBe(100);
    expect(bookPercent(3, 0.25, 0)).toBe(0);
  });

  it("estimates reading minutes with a 400 chars/minute baseline", () => {
    expect(readingMinutes(0)).toBe(1);
    expect(readingMinutes(400)).toBe(1);
    expect(readingMinutes(401)).toBe(2);
    expect(readingMinutes(2000)).toBe(5);
  });

  it("counts the remaining characters of a chapter", () => {
    expect(remainingChars(paragraphs, starts, 0)).toBe(13);
    expect(remainingChars(paragraphs, starts, 4)).toBe(9);
    expect(remainingChars(paragraphs, starts, 99)).toBe(0);
  });

  it("keeps positions stable when font size changes (offset-based, not pixel-based)", () => {
    const offset = starts[1] + 2;
    expect(paragraphAt(starts, offset)).toBe(1);
    expect(remainingChars(paragraphs, starts, offset)).toBe(7);
  });

  it("falls back to the next visible paragraph when the caret probe misses", () => {
    const rects = [
      { start: 0, bottom: 100 },
      { start: 40, bottom: 260 },
      { start: 90, bottom: 420 },
    ];
    expect(firstVisibleOffsetFromRects(rects, 120, [])).toBe(40);
  });

  it("does not reset progress to the chapter start at the chapter-end card", () => {
    const blocks = [
      { start: 0, end: 10 },
      { start: 10, end: 30 },
    ];
    const rects = [
      { start: 0, bottom: 100 },
      { start: 10, bottom: 240 },
    ];
    // 章末卡片没有 data-start，所有正文段都已滚到视口上方。
    expect(firstVisibleOffsetFromRects(rects, 500, blocks)).toBe(30);
  });
});
