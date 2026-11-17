import { describe, expect, it } from "vitest";
import { buildStarts } from "../apps/web/src/lib/reader-progress";
import {
  excerptAround,
  findMatches,
  hitRanges,
  normalizeQuery,
  singleRange,
  titleMatched,
} from "../apps/web/src/lib/reader-search";

const paras = ["第一段提到了灵气复苏。", "第二段没有关键词。", "第三段又说到灵气复苏，而且灵气复苏很重要。"];
const starts = buildStarts(paras);
const text = paras.join("\n");

describe("reader search", () => {
  it("normalizes whitespace in the query", () => {
    expect(normalizeQuery("  灵气\n 复苏 ")).toBe("灵气 复苏");
    expect(normalizeQuery("   ")).toBe("");
  });

  it("finds every occurrence with paragraph numbers", () => {
    const hits = findMatches(text, starts, "灵气复苏");
    expect(hits).toHaveLength(3);
    expect(hits[0].start).toBe(text.indexOf("灵气复苏"));
    expect(hits.map((h) => h.para)).toEqual([0, 2, 2]);
    expect(text.slice(hits[2].start, hits[2].end)).toBe("灵气复苏");
  });

  it("is case insensitive for latin text and ignores regex characters", () => {
    const latin = "Alpha beta ALPHA (alpha)";
    const hit = findMatches(latin, [0], "alpha");
    expect(hit).toHaveLength(3);
    expect(findMatches("a.b*c", [0], "b*")).toHaveLength(1);
  });

  it("stops at the limit", () => {
    expect(findMatches(text, starts, "灵气复苏", 2)).toHaveLength(2);
  });

  it("builds excerpts with ellipsis on the truncated side", () => {
    const long = "前面还有很长一段铺垫".repeat(5) + "目标词" + "后面也还有很长一段".repeat(5);
    const excerpt = excerptAround(long, long.indexOf("目标词"), long.indexOf("目标词") + 3, 6);
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt).toContain("目标词");
    expect(excerptAround("目标词", 0, 3)).toBe("目标词");
  });

  it("marks the active hit with a different color", () => {
    const hits = findMatches(text, starts, "灵气复苏");
    const ranges = hitRanges(hits, 1);
    expect(ranges.map((r) => r.color)).toEqual(["hit", "hit-on", "hit"]);
    expect(ranges[1].start).toBe(hits[1].start);
  });

  it("returns a single range for a book hit and rejects bad input", () => {
    expect(singleRange(10, 4)).toEqual([{ id: "hit-on", start: 10, end: 14, color: "hit-on" }]);
    expect(singleRange(-1, 4)).toEqual([]);
    expect(singleRange(0, 0)).toEqual([]);
  });

  it("detects a title match", () => {
    expect(titleMatched("第 3 章 灵气复苏", "灵气")).toBe(true);
    expect(titleMatched("第 3 章 灵气复苏", "复苏术")).toBe(false);
    expect(titleMatched("第 3 章", "")).toBe(false);
  });
});
