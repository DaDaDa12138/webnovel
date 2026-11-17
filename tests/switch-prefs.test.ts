import { describe, expect, it } from "vitest";
import {
  applySwitchPrefs,
  normalizeSwitchPrefs,
  toggleBlockedSource,
  togglePinnedSource,
} from "../apps/web/src/lib/switch-prefs";
import type { SwitchCandidate } from "@legado/shared";

function make(id: number): SwitchCandidate {
  return {
    sourceId: id,
    sourceName: "源" + id,
    sourceStatus: "ok",
    name: "书",
    author: "作者",
    bookUrl: "https://example.com/" + id,
    coverUrl: "",
    kind: "",
    lastChapter: "",
    wordCount: "",
    duplicates: 1,
    status: "ok",
    chapters: 100,
    ms: 10,
    titleOk: true,
    authorOk: true,
    reason: "",
    error: "",
  };
}

describe("switch preferences", () => {
  it("normalizes bad storage values", () => {
    expect(normalizeSwitchPrefs(null)).toEqual({ pinned: [], blocked: [] });
    expect(normalizeSwitchPrefs({ pinned: [1, "2", 2, -1, 0, 3.5], blocked: ["x", 4] })).toEqual({
      pinned: [1, 2],
      blocked: [4],
    });
  });

  it("keeps pinned and blocked mutually exclusive", () => {
    let prefs = { pinned: [], blocked: [3] };
    prefs = togglePinnedSource(prefs, 3);
    expect(prefs).toEqual({ pinned: [3], blocked: [] });
    prefs = toggleBlockedSource(prefs, 3);
    expect(prefs).toEqual({ pinned: [], blocked: [3] });
  });

  it("filters blocked sources and lifts pinned ones while keeping order", () => {
    const list = [make(1), make(2), make(3), make(4)];
    const result = applySwitchPrefs(list, { pinned: [3], blocked: [2] });
    expect(result.map((item) => item.sourceId)).toEqual([3, 1, 4]);
  });
});
