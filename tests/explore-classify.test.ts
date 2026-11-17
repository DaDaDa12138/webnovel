import { describe, expect, it } from "vitest";
import { classifyExploreGroup, isRankingGroup } from "../apps/server/src/services/explore-classify";

describe("explore group classifier", () => {
  it("recognises explicit ranking titles", () => {
    for (const title of ["排行榜", "月票榜", "飙升榜", "完本榜", "TOP100"]) {
      expect(classifyExploreGroup(title).kind, title).toBe("ranking");
    }
  });

  it("treats popularity lists as rankings but not plain categories", () => {
    expect(isRankingGroup("热门推荐")).toBe(true);
    expect(isRankingGroup("玄幻魔法")).toBe(false);
    expect(classifyExploreGroup("玄幻魔法").kind).toBe("category");
    expect(classifyExploreGroup("全部小说").kind).toBe("category");
  });

  it("uses the url as a weak signal", () => {
    expect(classifyExploreGroup("书库", "https://example.com/rank/all").kind).toBe("ranking");
  });

  it("falls back to other for neutral titles", () => {
    expect(classifyExploreGroup("书库").kind).toBe("other");
  });
});
