import { describe, expect, it } from "vitest";
import {
  DEFAULT_READOUT,
  clockText,
  formatReadout,
  normalizeReadout,
  type ReadoutContext,
} from "../apps/web/src/lib/reader-readout";

const ctx: ReadoutContext = {
  book: "诡秘之主",
  chapter: "第一章 暴雨之夜",
  percent: 12.345,
  page: 3,
  pages: 9,
  remainingChars: 1200,
  readChars: 3456,
  now: new Date(2024, 4, 6, 7, 5),
};

describe("reader readout", () => {
  it("defaults to chapter, clock and progress", () => {
    expect(DEFAULT_READOUT).toEqual({
      topLeft: "chapter",
      topRight: "time",
      bottomLeft: "none",
      bottomRight: "progress",
    });
  });

  it("rejects unknown slots and fields", () => {
    const readout = normalizeReadout({ topLeft: "book", topRight: "battery", extra: "time" });
    expect(readout.topLeft).toBe("book");
    expect(readout.topRight).toBe("time");
    expect(readout.bottomRight).toBe("progress");
    expect(normalizeReadout(null)).toEqual(DEFAULT_READOUT);
  });

  it("formats every field", () => {
    expect(formatReadout("book", ctx)).toBe("诡秘之主");
    expect(formatReadout("chapter", ctx)).toBe("第一章 暴雨之夜");
    expect(formatReadout("progress", ctx)).toBe("3/9 · 12.3%");
    expect(formatReadout("time", ctx)).toBe("07:05");
    expect(formatReadout("remaining", ctx)).toBe("余 3 分钟");
    expect(formatReadout("read", ctx)).toBe("已读 3,456 字");
    expect(formatReadout("read", { ...ctx, readChars: 0 })).toBe("");
    expect(formatReadout("none", ctx)).toBe("");
  });

  it("clamps progress and page numbers", () => {
    expect(formatReadout("progress", { ...ctx, percent: 140, page: 40, pages: 9 })).toBe("9/9 · 100.0%");
    expect(formatReadout("progress", { ...ctx, percent: -5, page: 0, pages: 0 })).toBe("1/1 · 0.0%");
    expect(formatReadout("remaining", { ...ctx, remainingChars: 0 })).toBe("");
  });

  it("pads the clock", () => {
    expect(clockText(new Date(2024, 0, 1, 0, 0))).toBe("00:00");
    expect(clockText(new Date(2024, 0, 1, 23, 59))).toBe("23:59");
  });
});
