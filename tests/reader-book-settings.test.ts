import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_READER_SETTINGS, normalizeReaderSettings } from "../apps/web/src/lib/reader-settings";
import {
  BOOK_TYPOGRAPHY_STORAGE_KEY,
  applyBookTypography,
  clearBookTypography,
  isBookTypographyPatch,
  loadBookTypography,
  normalizeBookTypography,
  pickBookTypography,
  saveBookTypography,
} from "../apps/web/src/lib/reader-book-settings";

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

describe("per-book typography", () => {
  it("only picks typography fields out of a mixed patch", () => {
    const picked = pickBookTypography({ fontSize: 24, theme: "night", paragraph: { ...DEFAULT_READER_SETTINGS.paragraph, splitLength: 240 } });
    expect(picked.fontSize).toBe(24);
    expect(picked.paragraph?.splitLength).toBe(240);
    expect("theme" in picked).toBe(false);
    expect(isBookTypographyPatch({ fontSize: 24 })).toBe(true);
    expect(isBookTypographyPatch({ fontSize: 24, theme: "night" })).toBe(false);
    expect(isBookTypographyPatch({})).toBe(false);
  });

  it("stores and loads one override per book", () => {
    saveBookTypography(7, { fontSize: 26, lineHeight: 2.2 });
    saveBookTypography(8, { fontFamily: "kai" });
    expect(loadBookTypography(7)).toEqual({ fontSize: 26, lineHeight: 2.2 });
    expect(loadBookTypography(8)).toEqual({ fontFamily: "kai" });
    expect(loadBookTypography(9)).toEqual({});
    clearBookTypography(7);
    expect(loadBookTypography(7)).toEqual({});
    expect(loadBookTypography(8).fontFamily).toBe("kai");
  });

  it("clamps invalid stored values and drops unknown keys", () => {
    localStorage.setItem(
      BOOK_TYPOGRAPHY_STORAGE_KEY,
      JSON.stringify({ version: 1, books: { 12: { fontSize: 99, theme: "night", pageWidth: 700, nope: true } } }),
    );
    const loaded = loadBookTypography(12);
    expect(loaded.fontSize).toBe(36);
    expect(loaded.pageWidth).toBe(720);
    expect("theme" in loaded).toBe(false);
    expect("nope" in loaded).toBe(false);
  });

  it("merges paragraph options over the global base instead of replacing them", () => {
    const base = normalizeReaderSettings({ fontSize: 18, paragraph: { ...DEFAULT_READER_SETTINGS.paragraph, mergeWrapped: false, splitDialogue: false } });
    const effective = applyBookTypography(base, {
      fontSize: 25,
      paragraph: { ...base.paragraph, splitLength: 260, splitDialogue: true },
    });
    expect(effective.fontSize).toBe(25);
    expect(effective.paragraph.mergeWrapped).toBe(false);
    expect(effective.paragraph.splitDialogue).toBe(true);
    expect(effective.paragraph.splitLength).toBe(260);
    // 全局对象不能被就地改掉。
    expect(base.fontSize).toBe(18);
    expect(base.paragraph.splitDialogue).toBe(false);
  });

  it("ignores malformed JSON and clears an empty override", () => {
    localStorage.setItem(BOOK_TYPOGRAPHY_STORAGE_KEY, "{not json");
    expect(loadBookTypography(3)).toEqual({});
    saveBookTypography(3, { fontSize: 21 });
    saveBookTypography(3, {});
    expect(loadBookTypography(3)).toEqual({});
  });

  it("normalizes a partial override without freezing other fields", () => {
    const clean = normalizeBookTypography({ fontSize: 22, bogus: 1 });
    expect(clean).toEqual({ fontSize: 22 });
  });
});
