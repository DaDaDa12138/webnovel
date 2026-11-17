import { describe, expect, it } from "vitest";
import {
  annotationsMarkdown,
  charOffsetOf,
  locateOffset,
  matchAnnotation,
  normalizeRanges,
  paragraphSegments,
  quoteAround,
} from "../apps/web/src/lib/annotations";

describe("paragraphSegments", () => {
  it("slices a paragraph without losing a single character", () => {
    const text = "abcdefghij";
    const segments = paragraphSegments(text, 100, [{ id: "a", start: 102, end: 105, color: "yellow" }]);
    expect(segments.map((s) => s.text).join("")).toBe(text);
    expect(segments).toEqual([
      { text: "ab", mark: null },
      { text: "cde", mark: { id: "a", color: "yellow" } },
      { text: "fghij", mark: null },
    ]);
  });

  it("lets the earlier range win when two ranges overlap", () => {
    const text = "0123456789";
    const segments = paragraphSegments(text, 0, [
      { id: "a", start: 0, end: 4, color: "yellow" },
      { id: "b", start: 2, end: 6, color: "blue" },
    ]);
    expect(segments.map((s) => s.text).join("")).toBe(text);
    expect(segments.map((s) => s.mark?.id ?? null)).toEqual(["a", "b", null]);
    expect(segments[1].text).toBe("45");
  });

  it("ignores ranges that fall outside the paragraph and empty ranges", () => {
    const text = "hello";
    expect(paragraphSegments(text, 10, [{ id: "x", start: 0, end: 5, color: "yellow" }])).toEqual([
      { text, mark: null },
    ]);
    expect(paragraphSegments(text, 10, [{ id: "x", start: 12, end: 12, color: "yellow" }])).toEqual([
      { text, mark: null },
    ]);
    expect(normalizeRanges([{ id: "b", start: 5, end: 9, color: "pink" }, { id: "a", start: 1, end: 3, color: "pink" }])).toEqual([
      { id: "a", start: 1, end: 3, color: "pink" },
      { id: "b", start: 5, end: 9, color: "pink" },
    ]);
  });
});

describe("char offsets", () => {
  const starts = [0, 6, 12];

  it("maps a paragraph offset to a chapter offset and back", () => {
    expect(charOffsetOf(starts, 1, 3)).toBe(9);
    expect(locateOffset(starts, 9)).toEqual({ para: 1, offset: 3 });
    expect(locateOffset(starts, 0)).toEqual({ para: 0, offset: 0 });
    expect(locateOffset(starts, 999)).toEqual({ para: 2, offset: 987 });
    expect(locateOffset([], 12)).toEqual({ para: 0, offset: 0 });
  });
});

describe("matchAnnotation", () => {
  const text = "第一段内容。第二段内容。";

  it("trusts the offsets when the quote still matches", () => {
    const anchor = { start: 6, end: 10, quote: "第二段内" };
    expect(matchAnnotation(text, anchor)).toEqual({ start: 6, end: 10 });
  });

  it("falls back to prefix + quote + suffix after the text shifted", () => {
    const anchor = quoteAround(text, 6, 10);
    const shifted = "新增的序言。" + text;
    expect(matchAnnotation(shifted, anchor)).toEqual({ start: 12, end: 16 });
  });

  it("refuses to guess when the quote appears twice", () => {
    const doubled = "内容。内容。";
    expect(matchAnnotation(doubled, { start: 99, end: 101, quote: "内容", prefix: "", suffix: "" })).toBeNull();
  });

  it("keeps a unique quote even without context", () => {
    expect(matchAnnotation("abc目标def", { start: 99, end: 101, quote: "目标" })).toEqual({ start: 3, end: 5 });
  });
});

describe("annotationsMarkdown", () => {
  it("groups quotes by chapter and keeps comments under them", () => {
    const md = annotationsMarkdown("测试书", [
      { chapterIndex: 1, chapterTitle: "第二章 开始", quote: "他走了。", comment: "转折", type: "note" },
      { chapterIndex: 0, chapterTitle: "第一章 初见", quote: "风起了。", comment: "", type: "highlight" },
    ]);
    expect(md.startsWith("# 《测试书》划线笔记")).toBe(true);
    expect(md).toContain("## 第一章 初见");
    expect(md).toContain("> 风起了。");
    expect(md).toContain("## 第二章 开始");
    expect(md).toContain("转折");
    expect(md.indexOf("第一章")).toBeLessThan(md.indexOf("第二章"));
  });

  it("says so when there is nothing to export", () => {
    expect(annotationsMarkdown("空书", [])).toContain("还没有划线与笔记");
  });
});
