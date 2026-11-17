import { describe, expect, it } from "vitest";
import { cardDate, cardFileName, wrapText } from "../apps/web/src/lib/quote-card";

/** 假尺子：每个字符 10px。 */
const measure = (text: string) => text.length * 10;

describe("wrapText", () => {
  it("wraps Chinese by character", () => {
    const lines = wrapText("一二三四五六七八九十", { maxWidth: 30, measure, maxLines: 4 });
    expect(lines).toEqual(["一二三", "四五六", "七八九", "十"]);
  });

  it("wraps Latin by word and never splits a word", () => {
    const lines = wrapText("hello world foo", { maxWidth: 60, measure, maxLines: 4 });
    expect(lines).toEqual(["hello", "world", "foo"]);
  });

  it("keeps punctuation off the start of a line", () => {
    const lines = wrapText("一二三，四五六", { maxWidth: 30, measure, maxLines: 4 });
    expect(lines).toEqual(["一二三，", "四五六"]);
  });

  it("pushes an opening quote to the next line", () => {
    const lines = wrapText("一二三《四五六》", { maxWidth: 30, measure, maxLines: 4 });
    expect(lines[0]).toBe("一二三");
    expect(lines[1].startsWith("《")).toBe(true);
  });

  it("truncates with an ellipsis after maxLines", () => {
    const lines = wrapText("一二三四五六七八九十一二三四五六七八九十", { maxWidth: 30, measure, maxLines: 2 });
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    expect(measure(lines[1])).toBeLessThanOrEqual(30);
  });

  it("returns nothing for blank input", () => {
    expect(wrapText("   \n ", { maxWidth: 30, measure, maxLines: 3 })).toEqual([]);
  });
});

describe("cardFileName", () => {
  it("joins book and chapter and strips illegal characters", () => {
    expect(cardFileName("这个明星正得发邪", "第8章 你管这叫新人？")).toBe("这个明星正得发邪-第8章 你管这叫新人？-书摘.png");
    expect(cardFileName("a/b:c", 'd"e')).toBe("a b c-d e-书摘.png");
  });

  it("falls back when everything is empty", () => {
    expect(cardFileName("", "")).toBe("书摘.png");
  });
});

describe("cardDate", () => {
  it("formats a local date", () => {
    expect(cardDate(new Date(2026, 10, 3))).toBe("2026 年 11 月 3 日");
  });
});
