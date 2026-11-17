import { describe, expect, it } from "vitest";
import { countContentChars, locateChapterIndex, matchChapter, titleSimilarity } from "@legado/engine";

describe("countContentChars", () => {
  it("counts characters without whitespace", () => {
    expect(countContentChars("一二三 四五六\n\t七八九")).toBe(9);
    expect(countContentChars("")).toBe(0);
    expect(countContentChars(null as unknown as string)).toBe(0);
  });

  it("counts by code point so rare glyphs and emoji count once", () => {
    // 「𠮷」是 U+20BB7，String.length 会算 2；emoji 同理。
    expect(countContentChars("𠮷")).toBe(1);
    expect(countContentChars("😀😀")).toBe(2);
  });
});

describe("locateChapterIndex", () => {
  const list = [
    { title: "第1章 起点" },
    { title: "第2章 风起（求收藏）" },
    { title: "第3章 云涌" },
  ];

  it("prefers an exact title match", () => {
    expect(locateChapterIndex(list, "第3章 云涌", 0)).toBe(2);
  });

  it("falls back to the chapter ordinal when the title gained site noise", () => {
    expect(locateChapterIndex(list, "第2章 风起", 0)).toBe(1);
  });

  it("matches after cleaning when the ordinal is missing", () => {
    const toc = [{ title: "序章" }, { title: "正文 第一章 归途" }];
    expect(locateChapterIndex(toc, "第一章 归途", 0)).toBe(1);
  });

  it("clamps the fallback into range when nothing matches", () => {
    expect(matchChapter(list, "番外 后记", 1).reason).toBe("index");
    expect(locateChapterIndex(list, "番外 后记", 99)).toBe(2);
    expect(locateChapterIndex(list, "番外 后记", -3)).toBe(0);
    expect(locateChapterIndex([], "第1章", 5)).toBe(0);
  });
});

describe("matchChapter", () => {
  it("follows the chapter name when the target toc numbering is shifted", () => {
    // 盗版站少了两章：同一章在下标 1，但章号写成了「第4章」。
    const toc = [{ title: "第1章 起点" }, { title: "第4章 云涌" }, { title: "第5章 风起（求收藏）" }];
    const hit = matchChapter(toc, "第3章 云涌", 2);
    expect(hit).toMatchObject({ index: 1, reason: "core" });
    expect(hit.score).toBeGreaterThan(0.9);
  });

  it("prefers the name over an ordinal that points at a different row", () => {
    const toc = [{ title: "第9章 风起" }, { title: "第3章 别的故事" }];
    expect(matchChapter(toc, "第3章 风起", 1).index).toBe(0);
  });

  it("falls back to the ordinal only when no name is close", () => {
    const toc = [{ title: "第1章 起点" }, { title: "第2章 完全不同" }];
    const hit = matchChapter(toc, "第2章 风起云涌", 0);
    expect(hit).toMatchObject({ index: 1, reason: "ordinal" });
    expect(hit.score).toBeLessThan(0.5);
  });

  it("ignores a trailing site note when comparing names", () => {
    // 「求月票」这类噪音 cleanChapterTitle 已经会清掉（走 exact），「加更」不会，靠剥结尾括注。
    const toc = [{ title: "第1章 起点" }, { title: "第2章 风起（加更）" }];
    expect(matchChapter(toc, "第2章 风起", 0)).toMatchObject({ index: 1, reason: "cleaned" });
  });

  it("matches a name that lost its ordinal prefix", () => {
    const toc = [{ title: "第1章 起点" }, { title: "风起云涌" }];
    expect(matchChapter(toc, "第2章 风起云涌", 0).index).toBe(1);
  });

  it("keeps duplicate names near the expected position", () => {
    const toc = [{ title: "第1章 序" }, { title: "番外 后记" }, { title: "第9章 序" }, { title: "番外 后记" }];
    expect(matchChapter(toc, "番外 后记", 3).index).toBe(3);
    expect(matchChapter(toc, "番外 后记", 1).index).toBe(1);
  });

  it("scores title similarity without the chapter number", () => {
    expect(titleSimilarity("第2章 木叶宏伟新政", "第7章 木叶宏伟新政（求月票）")).toBe(1);
    expect(titleSimilarity("第2章 木叶宏伟新政", "第2章 完全无关的标题")).toBeLessThan(0.4);
  });
});
