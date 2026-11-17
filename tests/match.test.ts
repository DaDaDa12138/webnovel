import { describe, expect, it } from "vitest";
import { authorsMatch, cleanAuthor, matchesBookQuery, titleKey, titlesMatch } from "../apps/server/src/services/match";

describe("title and author matching", () => {
  it("removes decorations but keeps subtitle words", () => {
    expect(titleKey("[诡秘之主] 收藏家")).toBe("诡秘之主收藏家");
    expect(titleKey("《三体》")).toBe("三体");
    expect(titleKey("凡人修仙传：仙界篇")).toBe("凡人修仙传仙界篇");
  });

  it("matches the same book and prefixes, never unrelated titles that mention it", () => {
    expect(titlesMatch("三体", "三体全集（全三册）")).toBe(true);
    expect(titlesMatch("诡秘之主", "[诡秘之主] 收藏家")).toBe(true);
    expect(titlesMatch("三体", "从三体逃到超神")).toBe(false);
    expect(titlesMatch("", "三体")).toBe(false);
  });

  it("cleans authors from common source decorations", () => {
    expect(cleanAuthor("作者：爱潜水的乌贼")).toBe("爱潜水的乌贼");
    expect(cleanAuthor("阿勒苏霍得之笔 · 其他类型")).toBe("阿勒苏霍得之笔");
    expect(cleanAuthor("刘慈欣 / 某某")).toBe("刘慈欣");
  });

  it("requires an exact or prefix pen name, not a suffix", () => {
    expect(authorsMatch("爱潜水的乌贼", "爱潜水的乌贼著")).toBe(true);
    expect(authorsMatch("刘慈欣", "刘慈欣、王晋康")).toBe(true);
    expect(authorsMatch("乌贼", "爱潜水的乌贼")).toBe(false);
    expect(authorsMatch("", "爱潜水的乌贼")).toBe(false);
  });

  it("rejects a known author mismatch but allows an unknown author", () => {
    expect(matchesBookQuery("诡秘之主", "爱潜水的乌贼", "诡秘之主", "爱潜水的乌贼")).toBe(true);
    expect(matchesBookQuery("诡秘之主", "爱潜水的乌贼", "诡秘之主", "阿拉不离梦")).toBe(false);
    expect(matchesBookQuery("诡秘之主", "", "诡秘之主", "爱潜水的乌贼")).toBe(true);
    expect(matchesBookQuery("诡秘之主", "爱潜水的乌贼", "三体", "爱潜水的乌贼")).toBe(false);
  });
});
