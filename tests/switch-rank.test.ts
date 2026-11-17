import { describe, expect, it } from "vitest";
import {
  chapterDelta,
  charRatio,
  charVerdict,
  collapseMirrors,
  excludeSource,
  filterMoreComplete,
  formatAge,
  formatCharCount,
  matchClass,
  matchLabel,
  measureBlocked,
  recommendCandidate,
  sortByChapterChars,
  sortByChapters,
  sortByHealth,
  sortByQuality,
} from "../apps/web/src/lib/switch-rank";
import type { SwitchCandidate } from "@legado/shared";

function make(partial: Partial<SwitchCandidate> & { sourceId: number }): SwitchCandidate {
  return {
    sourceName: "源" + partial.sourceId,
    sourceStatus: "ok",
    name: "书名",
    author: "作者",
    bookUrl: "https://example.com/" + partial.sourceId,
    coverUrl: "",
    kind: "",
    lastChapter: "",
    wordCount: "",
    duplicates: 1,
    status: "ok",
    chapters: 100,
    ms: 100,
    titleOk: true,
    authorOk: true,
    reason: "",
    error: "",
    ...partial,
  };
}

describe("current source exclusion", () => {
  it("removes only the source the book is currently on", () => {
    const list = [make({ sourceId: 7 }), make({ sourceId: 8 }), make({ sourceId: 9 })];
    expect(excludeSource(list, 8).map((item) => item.sourceId)).toEqual([7, 9]);
  });

  it("keeps the list untouched when the current source is unknown", () => {
    const list = [make({ sourceId: 7 })];
    expect(excludeSource(list, undefined)).toBe(list);
    expect(excludeSource(list, 0)).toBe(list);
    expect(excludeSource(list, Number.NaN)).toBe(list);
  });

  it("also drops other source entries pointing at the same table of contents", () => {
    const list = [
      make({ sourceId: 7, tocUrl: "https://m.dxs.org/ajaxService?book=7" }),
      make({ sourceId: 8, tocUrl: "HTTPS://M.DXS.ORG/ajaxService?book=7/" }),
      make({ sourceId: 9, tocUrl: "https://other.example/toc/9" }),
    ];
    expect(excludeSource(list, undefined, "https://m.dxs.org/ajaxService?book=7").map((item) => item.sourceId)).toEqual([9]);
    expect(excludeSource(list, 8, "https://m.dxs.org/ajaxService?book=7").map((item) => item.sourceId)).toEqual([9]);
  });
});

describe("comprehensive recommendation", () => {
  it("recommends only a matched, readable source with enough chars", () => {
    const list = [
      make({ sourceId: 1, chapters: 105, chars: 2600, matched: true }),
      make({ sourceId: 2, chapters: 105, chars: 1200, matched: true }),
      make({ sourceId: 3, chapters: 105, chars: 2600, matched: false, matchReason: "ordinal" }),
      make({ sourceId: 4, chapters: 105, chars: 2700, matched: true, measureError: "正文是空的" }),
      make({ sourceId: 5, chapters: 105, chars: 50000, matched: true }),
    ];
    const hit = recommendCandidate(list, 2400, { pinned: [], blocked: [] }, 105);
    expect(hit?.candidate.sourceId).toBe(1);
    expect(hit?.reason).toContain("本章多");
  });

  it("can recommend a source with more chapters even when this chapter is slightly shorter", () => {
    const list = [make({ sourceId: 1, chapters: 322, chars: 2300, matched: true })];
    const hit = recommendCandidate(list, 2400, { pinned: [], blocked: [] }, 105);
    expect(hit?.candidate.sourceId).toBe(1);
    expect(hit?.reason).toContain("目录多 217 章");
  });

  it("obeys pinned and blocked preferences", () => {
    const list = [
      make({ sourceId: 1, chapters: 105, chars: 2600, matched: true }),
      make({ sourceId: 2, chapters: 105, chars: 2500, matched: true }),
    ];
    expect(recommendCandidate(list, 2400, { pinned: [2], blocked: [] }, 105)?.candidate.sourceId).toBe(2);
    expect(recommendCandidate(list, 2400, { pinned: [], blocked: [1, 2] }, 105)).toBeNull();
  });

  it("rejects unusable health states and bad content quality", () => {
    const list = [
      make({ sourceId: 1, chapters: 105, chars: 2600, matched: true, sourceHealthState: "broken" }),
      make({ sourceId: 2, chapters: 105, chars: 2600, matched: true, sourceHealthState: "blocked" }),
      make({ sourceId: 3, chapters: 105, chars: 2600, matched: true, contentQuality: "bad" }),
      make({ sourceId: 4, chapters: 105, chars: 2500, matched: true, contentQuality: "ok", sourceHealthState: "healthy" }),
    ];
    expect(recommendCandidate(list, 2400, undefined, 105)?.candidate.sourceId).toBe(4);
  });

  it("returns null when every candidate is unmeasured or too short", () => {
    expect(recommendCandidate([make({ sourceId: 1, chapters: 105, matched: true })], 2400, undefined, 105)).toBeNull();
    expect(recommendCandidate([make({ sourceId: 1, chapters: 105, chars: 1000, matched: true })], 2400, undefined, 105)).toBeNull();
  });
});

describe("health and quality sorting", () => {
  it("puts a healthy source first even when this chapter looks worse", () => {
    const list = [
      make({ sourceId: 1, chapters: 200, chars: 1200, contentQuality: "bad", sourceHealthState: "broken" }),
      make({ sourceId: 2, chapters: 90, chars: 2200, contentQuality: "ok", sourceHealthState: "unknown" }),
      make({ sourceId: 3, chapters: 80, chars: 1800, contentQuality: "suspect", sourceHealthState: "healthy", sourceHealthScore: 88 }),
    ];
    expect(sortByHealth(list).map((item) => item.sourceId)).toEqual([3, 2, 1]);
  });

  it("puts readable text before a healthy source that serves placeholders", () => {
    const list = [
      make({ sourceId: 1, chapters: 300, contentQuality: "bad", sourceHealthState: "healthy", sourceHealthScore: 99 }),
      make({ sourceId: 2, chapters: 80, contentQuality: "ok", sourceHealthState: "degraded", sourceHealthScore: 40 }),
    ];
    expect(sortByQuality(list).map((item) => item.sourceId)).toEqual([2, 1]);
    expect(sortByHealth(list).map((item) => item.sourceId)).toEqual([1, 2]);
  });

  it("still sinks a chapter-name mismatch to the bottom", () => {
    const list = [
      make({ sourceId: 1, chapters: 300, sourceHealthState: "healthy", sourceHealthScore: 99, matched: false, matchReason: "ordinal" }),
      make({ sourceId: 2, chapters: 30, sourceHealthState: "broken", sourceHealthScore: 0, matched: true }),
    ];
    expect(sortByHealth(list).map((item) => item.sourceId)).toEqual([2, 1]);
  });
});
