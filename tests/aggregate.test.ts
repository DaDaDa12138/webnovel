import { describe, expect, it } from "vitest";
import type { SearchBook } from "../apps/web/src/api";
import { aggregateBooks, sourcePreferenceScore } from "../apps/web/src/lib/aggregate";

function book(patch: Partial<SearchBook> & { sourceId: number }): SearchBook {
  return {
    name: "三体",
    author: "刘慈欣",
    bookUrl: "book-" + patch.sourceId,
    coverUrl: "",
    intro: "",
    kind: "科幻",
    lastChapter: "",
    wordCount: "",
    origin: "https://example.com",
    originName: "源" + patch.sourceId,
    ...patch,
  };
}

describe("sourcePreferenceScore", () => {
  it("可用源即使没有封面，也排在封面齐全的失效源前面", () => {
    const broken = book({ sourceId: 1, healthState: "broken", healthScore: 0, coverUrl: "https://img/cover.jpg", intro: "简介".repeat(20) });
    const healthy = book({ sourceId: 2, healthState: "healthy", healthScore: 92 });
    expect(sourcePreferenceScore(healthy)).toBeGreaterThan(sourcePreferenceScore(broken));
    expect(aggregateBooks([broken, healthy])[0].best.sourceId).toBe(2);
  });

  it("健康源优先于待补测，健康分只在同状态内微调", () => {
    const partial = book({ sourceId: 1, healthState: "partial", healthScore: 100, coverUrl: "https://img/cover.jpg" });
    const healthy = book({ sourceId: 2, healthState: "healthy", healthScore: 60 });
    expect(aggregateBooks([partial, healthy])[0].best.sourceId).toBe(2);
    const healthyLow = book({ sourceId: 3, healthState: "healthy", healthScore: 55 });
    expect(sourcePreferenceScore(healthy)).toBeGreaterThan(sourcePreferenceScore(healthyLow));
  });

  it("全部不可用时仍按封面、简介、最新章节选，不把组丢掉", () => {
    const plain = book({ sourceId: 1, healthState: "broken" });
    const rich = book({ sourceId: 2, healthState: "blocked", coverUrl: "https://img/cover.jpg", lastChapter: "第 10 章" });
    const group = aggregateBooks([plain, rich])[0];
    expect(group.best.sourceId).toBe(2);
  });

  it("来源列表按可用性排序，健康源排在前面", () => {
    const broken = book({ sourceId: 1, healthState: "broken", coverUrl: "https://img/cover.jpg" });
    const healthy = book({ sourceId: 2, healthState: "healthy" });
    const group = aggregateBooks([broken, healthy])[0];
    expect(group.versions.map((item) => item.sourceId)).toEqual([2, 1]);
  });
});
