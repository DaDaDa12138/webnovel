import { describe, expect, it } from "vitest";
import type { SearchBook } from "@legado/shared";
import {
  EXPLORE_BURST_PAGES,
  bookKey,
  isRankGroup,
  mergeBooks,
  parseRankOverrides,
  splitRankGroups,
} from "../apps/web/src/lib/explore-rank";

function book(name: string, url: string, author = "作者"): SearchBook {
  return {
    name,
    author,
    bookUrl: url,
    coverUrl: "",
    intro: "",
    kind: "",
    lastChapter: "",
    wordCount: "",
    origin: "",
    originName: "",
    sourceId: 1,
  };
}

describe("explore rank split", () => {
  it("recognizes ranking entries by title keywords", () => {
    expect(isRankGroup({ title: "热销榜", url: "/sort/1" })).toBe(true);
    expect(isRankGroup({ title: "新书推荐", url: "/new" })).toBe(true);
    expect(isRankGroup({ title: "月票排行", url: "/x" })).toBe(true);
  });

  it("ignores url hints, because categories often live on a rank api", () => {
    // QQ 阅读 350 个分类全是 /rank/list?groupid=1505；书山聚合是自造的 ssx:top:1:1141。
    expect(isRankGroup({ title: "都市", url: "https://bookshelf.html5.qq.com/qbread/api/rank/list?groupid=1505" })).toBe(false);
    expect(isRankGroup({ title: "男频 · 西方奇幻", url: "ssx:top:1:1141" })).toBe(false);
    // 反过来：标题写着榜单就是榜单，地址长什么样都不影响。
    expect(isRankGroup({ title: "畅销榜", url: "/sort/1" })).toBe(true);
    const { ranks, others } = splitRankGroups([
      { title: "男频 · 西方奇幻", url: "ssx:top:1:1141" },
      { title: "男频 · 东方仙侠", url: "ssx:top:1:1142" },
    ]);
    expect(ranks).toHaveLength(0);
    expect(others).toHaveLength(2);
  });

  it("splits groups while preserving order", () => {
    const groups = [{ title: "玄幻", url: "/a" }, { title: "畅销榜", url: "/b" }, { title: "都市", url: "/c" }];
    const { ranks, others } = splitRankGroups(groups);
    expect(others.map((g) => g.title)).toEqual(["玄幻", "都市"]);
    expect(ranks.map((g) => g.title)).toEqual(["畅销榜"]);
  });

  it("treats an empty group list as no rankings", () => {
    expect(splitRankGroups([]).ranks).toEqual([]);
  });
});

describe("explore book merge", () => {
  it("dedupes by detail url and keeps first occurrence order", () => {
    const merged = mergeBooks([book("A", "/a"), book("B", "/b")], [book("A2", "/a"), book("C", "/c")]);
    expect(merged.map((item) => item.name)).toEqual(["A", "B", "C"]);
  });

  it("falls back to name and author when url is missing", () => {
    const merged = mergeBooks([book("同名", "", "甲")], [book("同名", "", "甲"), book("同名", "", "乙")]);
    expect(merged).toHaveLength(2);
    expect(bookKey(book("同名", "", "甲"))).toBe("同名|甲");
  });

  it("drops books that have neither url nor name", () => {
    expect(mergeBooks([], [book("", "", "")])).toEqual([]);
  });

  it("loads three pages for the first screen", () => {
    expect(EXPLORE_BURST_PAGES).toBe(3);
  });
});

describe("manual rank overrides", () => {
  it("keeps per-source url lists", () => {
    const parsed = parseRankOverrides(JSON.stringify({ 119: ["/b", "/c"], 33: ["/x"] }));
    expect(parsed).toEqual({ 119: ["/b", "/c"], 33: ["/x"] });
  });

  it("drops empty or non-string entries", () => {
    expect(parseRankOverrides(JSON.stringify({ 1: ["/a", "", 3, null], 2: "nope", 3: [] }))).toEqual({ 1: ["/a"] });
  });

  it("falls back to auto detection on broken settings", () => {
    expect(parseRankOverrides("not json")).toEqual({});
    expect(parseRankOverrides("[]")).toEqual({});
    expect(parseRankOverrides("")).toEqual({});
    expect(parseRankOverrides(undefined)).toEqual({});
  });
});
