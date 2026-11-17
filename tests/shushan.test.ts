import { describe, expect, it } from "vitest";
import {
  cleanSectionTitle,
  cleanTags,
  decodeBookUrl,
  decodeChapterUrl,
  encodeBookUrl,
  encodeChapterUrl,
  extractCategories,
  extractNovelToken,
  formatWords,
  isShushanSource,
  isShushanVipError,
  parseShushanApiGroup,
  queryValue,
  shushanApiGroup,
  ShushanVipError,
} from "../apps/server/src/services/shushan";

describe("书山聚合地址编码", () => {
  it("round-trips a book payload including chinese and base64 book_url", () => {
    const payload = {
      s: "番茄小说",
      u: "aHR0cHM6Ly9mYW5xaWUuZXhhbXBsZS9kZXRhaWw/Ym9va19pZD0xMjM=",
      n: "十日终焉",
      a: "杀虫队队员",
      c: "https://img.example/1.jpg",
      d: "简介",
      t: "novel",
    };
    const encoded = encodeBookUrl(payload);
    expect(encoded.startsWith("ss:")).toBe(true);
    // base64url：URL 里不能出现 + / =，否则会被当成路径分隔符
    expect(encoded.slice(3)).not.toMatch(/[+/=]/);
    expect(decodeBookUrl(encoded)).toEqual(payload);
  });

  it("returns null for foreign or broken book urls", () => {
    expect(decodeBookUrl("https://example.com/book")).toBeNull();
    expect(decodeBookUrl("ss:not-base64-json")).toBeNull();
  });

  it("round-trips a chapter payload and keeps cid as a number", () => {
    const encoded = encodeChapterUrl({ u: "book_id=123&item_id=456", cid: 456, t: "第1章 开端" });
    expect(encoded.startsWith("ssc:")).toBe(true);
    expect(decodeChapterUrl(encoded)).toEqual({ u: "book_id=123&item_id=456", cid: 456, t: "第1章 开端" });
    expect(decodeChapterUrl("ssc:{}")).toBeNull();
  });
});

describe("书山聚合小工具", () => {
  it("reads a query value out of a bare query string or a full url", () => {
    expect(queryValue("book_id=123&item_id=456", "item_id")).toBe("456");
    expect(queryValue("?book_id=123&item_id=456", "book_id")).toBe("123");
    expect(queryValue("book_id=123", "item_id")).toBe("");
  });

  it("formats word counts the way the shelf shows them", () => {
    expect(formatWords(828846)).toBe("82.9 万字");
    expect(formatWords("12000")).toBe("1.2 万字");
    expect(formatWords(980)).toBe("980 字");
    expect(formatWords(0)).toBe("");
    expect(formatWords("nope")).toBe("");
  });

  it("pulls the category table out of the upstream explore script", () => {
    const script = [
      "let isMale = genderCode == 1;",
      "let categories = isMale ? [",
      '  {id: 1141, name: "西方奇幻"},',
      '  {id: 8, name: "科幻末世"}',
      "] : [",
      '  {id: 1139, name: "古风世情"}',
      "];",
    ].join("\n");
    const list = extractCategories(script);
    expect(list).toEqual([
      { id: 1141, name: "西方奇幻", gender: 1 },
      { id: 8, name: "科幻末世", gender: 1 },
      { id: 1139, name: "古风世情", gender: 2 },
    ]);
    // 书源改了写法也不能把发现页弄空：解析不到就返回空数组，调用方保留旧分类表。
    expect(extractCategories("no categories here")).toEqual([]);
  });

  it("reads the upstream token out of the source header", () => {
    const header = '@js:\nJSON.stringify({\n\t"X-Api-Key": getSecretKey(),\n\t"X-Novel-Token": "abcd1234efgh5678"\n})';
    const token = extractNovelToken(header);
    expect(token).toHaveLength(16);
    expect(token).not.toContain("{{");
    expect(extractNovelToken('@js:JSON.stringify({"User-Agent": "x"})')).toBe("");
  });

  it("cleans the upstream tag soup down to three labels", () => {
    expect(cleanTags("连载,付费,都市,2026-11-01,836,现代都市")).toBe("连载 · 付费 · 都市");
    expect(cleanTags("玄幻, 穿越 ,恋爱")).toBe("玄幻 · 穿越 · 恋爱");
    expect(cleanTags("")).toBe("");
    expect(cleanTags(undefined)).toBe("");
  });

  it("strips the decoration from upstream section headers", () => {
    expect(cleanSectionTitle("ʚ排行榜ɞ")).toBe("排行榜");
    expect(cleanSectionTitle("❤️热门标签❤️")).toBe("热门标签");
    expect(cleanSectionTitle(" 行文流派 ")).toBe("行文流派");
  });

  it("round-trips a type_api group url", () => {
    const group = {
      mode: "audio" as const,
      site: "番茄听书",
      gender: "boy" as const,
      tag: "",
      target: "{{getApi()}}/so/qimao/category.php?rank_type=rec_list&category_id=0&gender=1",
    };
    const url = shushanApiGroup(group);
    expect(url.startsWith("ssx:api:audio:")).toBe(true);
    expect(url).not.toMatch(/[+/=]/);
    expect(parseShushanApiGroup(url)).toEqual(group);
    // 晋江的标签频道也要能带上
    const tagged = { ...group, site: "晋江", tag: "纯爱", target: "https://example.com/list?page=1" };
    expect(parseShushanApiGroup(shushanApiGroup(tagged))).toEqual(tagged);
    expect(parseShushanApiGroup("ssx:top:1:1141")).toBeNull();
    expect(parseShushanApiGroup("ssx:api:novel:broken")).toBeNull();
  });

  it("recognises the builtin source and the vip error", () => {
    expect(isShushanSource({ bookSourceUrl: "shushan://builtin" })).toBe(true);
    expect(isShushanSource({ bookSourceUrl: "https://example.com" })).toBe(false);
    expect(isShushanSource(null)).toBe(false);
    const err = new ShushanVipError("需要会员");
    expect(isShushanVipError(err)).toBe(true);
    expect(isShushanVipError(new Error("需要会员"))).toBe(false);
  });
});
