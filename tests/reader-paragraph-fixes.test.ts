import { beforeEach, describe, expect, it } from "vitest";
import {
  clearParagraphFixes,
  countParagraphFixes,
  loadParagraphFixes,
  removeParagraphFix,
  resolveParagraphFixes,
  saveParagraphFix,
} from "../apps/web/src/lib/reader-paragraph-fixes";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;
});

describe("paragraph fixes", () => {
  it("stores one fix per paragraph and overwrites the kind", () => {
    saveParagraphFix(7, { chapterIndex: 2, chapterTitle: "第二章", text: "三个月后", kind: "subhead" });
    saveParagraphFix(7, { chapterIndex: 2, chapterTitle: "第二章", text: "三个月后", kind: "note" });
    const fixes = loadParagraphFixes(7);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].kind).toBe("note");
    expect(loadParagraphFixes(8)).toEqual([]);
  });

  it("removes and clears only the requested book", () => {
    saveParagraphFix(7, { chapterIndex: 2, chapterTitle: "第二章", text: "三个月后", kind: "subhead" });
    saveParagraphFix(7, { chapterIndex: 3, chapterTitle: "第三章", text: "作者的话", kind: "note" });
    saveParagraphFix(8, { chapterIndex: 1, chapterTitle: "第一章", text: "序", kind: "subhead" });
    expect(removeParagraphFix(7, 2, "三个月后")).toHaveLength(1);
    expect(loadParagraphFixes(8)).toHaveLength(1);
    clearParagraphFixes(7);
    expect(loadParagraphFixes(7)).toEqual([]);
    expect(loadParagraphFixes(8)).toHaveLength(1);
  });

  it("resolves by chapter number and falls back to the chapter title after a source switch", () => {
    const fixes = [
      { chapterIndex: 2, chapterTitle: "第二章 风起", text: "三个月后", kind: "subhead" as const },
      { chapterIndex: 2, chapterTitle: "第二章 风起", text: "作者的话：今天两更。", kind: "note" as const },
    ];
    const paragraphs = ["正文一", "三个月后", "正文二", "作者的话：今天两更。"];
    expect(resolveParagraphFixes(fixes, 2, "第二章 风起", paragraphs)).toEqual({ 1: "subhead", 3: "note" });
    // 换源后整体后移三章：章号对不上，但章名还在。
    expect(resolveParagraphFixes(fixes, 5, "第二章 风 起", paragraphs)).toEqual({ 1: "subhead", 3: "note" });
    expect(resolveParagraphFixes(fixes, 9, "第九章", paragraphs)).toEqual({});
  });

  it("uses the paragraph index to tell duplicate short lines apart", () => {
    const fixes = [
      { chapterIndex: 2, chapterTitle: "第二章", text: "三个月后", kind: "subhead" as const, para: 0 },
    ];
    const paragraphs = ["三个月后", "正文", "三个月后"];
    expect(resolveParagraphFixes(fixes, 2, "第二章", paragraphs)).toEqual({ 0: "subhead" });
    // 换源后同一章名、段落下标变了：退回原文匹配，接受重复文本的歧义。
    expect(resolveParagraphFixes(fixes, 5, "第二章", paragraphs)).toEqual({ 0: "subhead", 2: "subhead" });
  });

  it("counts fixes per chapter", () => {
    const fixes = [
      { chapterIndex: 2, chapterTitle: "", text: "a", kind: "subhead" as const },
      { chapterIndex: 2, chapterTitle: "", text: "b", kind: "note" as const },
      { chapterIndex: 3, chapterTitle: "", text: "c", kind: "text" as const },
    ];
    expect(countParagraphFixes(fixes)).toBe(3);
    expect(countParagraphFixes(fixes, 2)).toBe(2);
    expect(countParagraphFixes(fixes, 4)).toBe(0);
  });

  it("ignores empty text and unknown kinds", () => {
    saveParagraphFix(7, { chapterIndex: 0, chapterTitle: "", text: "   ", kind: "note" });
    expect(loadParagraphFixes(7)).toEqual([]);
  });
});
