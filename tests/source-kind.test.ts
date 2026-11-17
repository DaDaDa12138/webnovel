import { describe, expect, it } from "vitest";
import { isMediaSource, looksLikeMediaBook } from "../apps/server/src/services/source-kind";

describe("isMediaSource", () => {
  it("flags sources whose group is 漫画", () => {
    expect(isMediaSource({ name: "包子漫画", group: "漫画", url: "https://cn.bzmanga.com" })).toBe(true);
  });

  it("flags sources by name keyword even without a group", () => {
    expect(isMediaSource({ name: "奇优影院", group: "", url: "https://www.qiyou.tv" })).toBe(true);
  });

  it("flags comic hosts", () => {
    expect(isMediaSource({ name: "某站", group: "", url: "https://comic.example.com" })).toBe(true);
  });

  it("keeps ordinary novel sources", () => {
    expect(isMediaSource({ name: "云起书院", group: "女频", url: "https://yunqi.qq.com" })).toBe(false);
    expect(isMediaSource({ name: "笔趣阁", group: "", url: "https://www.biquluo.la" })).toBe(false);
  });

  it("does not crash on a broken url", () => {
    expect(isMediaSource({ name: "小说站", group: "", url: "not a url" })).toBe(false);
  });
});

describe("looksLikeMediaBook", () => {
  it("flags episode-style updates", () => {
    expect(looksLikeMediaBook({ kind: "", lastChapter: "更新至第13集" })).toBe(true);
    expect(looksLikeMediaBook({ kind: "", lastChapter: "全 24 集" })).toBe(true);
  });

  it("flags media categories", () => {
    expect(looksLikeMediaBook({ kind: "动漫", lastChapter: "" })).toBe(true);
  });

  it("keeps ordinary chapters", () => {
    expect(looksLikeMediaBook({ kind: "玄幻", lastChapter: "第320章 回归" })).toBe(false);
    expect(looksLikeMediaBook({ kind: "", lastChapter: "" })).toBe(false);
  });
});
