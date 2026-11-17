import { describe, expect, it } from "vitest";
import { makeSwitchAnchor, resolveSwitchAnchor } from "../apps/web/src/lib/switch-anchor";

const TEXT = "第一段写了一些铺垫，主角从城门走进来，雨还没停。\n\n第二段他抬头看见灯，心里忽然安静下来。\n\n第三段是结尾。";

describe("switch anchor", () => {
  it("stores the point with enough context to find it again", () => {
    const anchor = makeSwitchAnchor({
      bookId: "book-1",
      chapterIndex: 3,
      chapterTitle: "第三章",
      text: TEXT,
      charOffset: 20,
      chapterPercent: 0.2,
    });
    expect(anchor).not.toBeNull();
    expect(anchor!.quote.length).toBeGreaterThan(20);
    expect(anchor!.quote).toContain("主角从城门");
    expect(anchor!.quoteStart).toBe(0);
    expect(anchor!.charOffset).toBe(20);
  });

  it("re-locates the same quote after the new source adds a prefix", () => {
    const anchor = makeSwitchAnchor({
      bookId: "book-1",
      chapterIndex: 0,
      text: TEXT,
      charOffset: 20,
      chapterPercent: 0.2,
    })!;
    const shifted = "新源加了一句开场白。\n\n" + TEXT;
    const hit = resolveSwitchAnchor(shifted, anchor);
    expect(hit.matched).toBe(true);
    expect(hit.offset).toBe(20 + "新源加了一句开场白。\n\n".length);
  });

  it("falls back to the chapter percentage when the quote is gone", () => {
    const anchor = makeSwitchAnchor({
      bookId: "book-1",
      chapterIndex: 0,
      text: TEXT,
      charOffset: 40,
      chapterPercent: 0.5,
    })!;
    const hit = resolveSwitchAnchor("完全不同的正文，只有一半长度。", anchor);
    expect(hit.matched).toBe(false);
    expect(hit.offset).toBe(Math.round(0.5 * "完全不同的正文，只有一半长度。".length));
  });

  it("clamps an anchor at the very end of the chapter", () => {
    const anchor = makeSwitchAnchor({
      bookId: "book-1",
      chapterIndex: 0,
      text: TEXT,
      charOffset: 9999,
      chapterPercent: 1,
    })!;
    expect(anchor.charOffset).toBe(TEXT.length);
    const hit = resolveSwitchAnchor(TEXT, anchor);
    expect(hit.matched).toBe(true);
    expect(hit.offset).toBe(TEXT.length);
  });

  it("returns null for an empty chapter", () => {
    expect(makeSwitchAnchor({ bookId: "book-1", chapterIndex: 0, text: "", charOffset: 0, chapterPercent: 0 })).toBeNull();
  });
});
