import { describe, expect, it } from "vitest";
import {
  DAHUILANG_URL,
  DahuilangLoginError,
  DahuilangVipError,
  DEFAULT_DAHUILANG_SERVER,
  decodeDahuilangBookUrl,
  decodeDahuilangChapterUrl,
  decodeDahuilangPayload,
  encodeDahuilangBookUrl,
  encodeDahuilangChapterUrl,
  isDahuilangLoginError,
  isDahuilangSource,
  isDahuilangVipError,
  cleanExploreTitle,
  normalizeDahuilangServer,
  parseDahuilangContent,
  withFanqieFilters,
} from "../apps/server/src/services/dahuilang";

describe("大灰狼聚合线路", () => {
  it("defaults empty or invalid servers to v5", () => {
    expect(normalizeDahuilangServer("")).toBe(DEFAULT_DAHUILANG_SERVER);
    expect(normalizeDahuilangServer("   ")).toBe(DEFAULT_DAHUILANG_SERVER);
    expect(normalizeDahuilangServer("ftp://example.com")).toBe(DEFAULT_DAHUILANG_SERVER);
    expect(normalizeDahuilangServer("not a url")).toBe(DEFAULT_DAHUILANG_SERVER);
  });

  it("adds https to bare hosts and keeps an explicit http port", () => {
    expect(normalizeDahuilangServer("v4.langge.uk/")).toBe("https://v4.langge.uk");
    expect(normalizeDahuilangServer("http://219.154.201.122:5006/")).toBe("http://219.154.201.122:5006");
    expect(normalizeDahuilangServer("https://v5.langge.uk/api/")).toBe("https://v5.langge.uk/api");
  });
});

describe("大灰狼聚合地址编码", () => {
  it("round-trips a book payload without url-unsafe characters", () => {
    const payload = {
      b: "NzQ3NTY3MDA2MjMxNDAzMjE1Mg",
      s: "番茄",
      t: "小说",
      n: "三体",
      a: "刘慈欣",
      c: "https://img.example/1.jpg",
      d: "简介",
      w: "19.14 万字",
      l: "第 36 章",
      k: "科幻 · 连载",
    };
    const encoded = encodeDahuilangBookUrl(payload);
    expect(encoded.startsWith("dhl:")).toBe(true);
    expect(encoded.slice(4)).not.toMatch(/[+/=]/);
    expect(decodeDahuilangBookUrl(encoded)).toEqual(payload);
  });

  it("rejects foreign or incomplete book urls", () => {
    expect(decodeDahuilangBookUrl("https://example.com/book")).toBeNull();
    expect(decodeDahuilangBookUrl("dhl:not-base64-json")).toBeNull();
    expect(decodeDahuilangBookUrl("dhl:" + Buffer.from(JSON.stringify({ s: "番茄" })).toString("base64url"))).toBeNull();
  });

  it("round-trips a chapter payload and defaults tab to 小说", () => {
    const encoded = encodeDahuilangChapterUrl({ b: "book", i: "item", s: "番茄", t: "", n: "第1章" });
    expect(encoded.startsWith("dhlc:")).toBe(true);
    expect(decodeDahuilangChapterUrl(encoded)).toEqual({ b: "book", i: "item", s: "番茄", t: "小说", n: "第1章" });
    expect(decodeDahuilangChapterUrl("dhlc:{}")).toBeNull();
  });
});

describe("大灰狼聚合响应解码", () => {
  it("keeps plain JSON and decodes a hex-encoded JSON body", () => {
    const json = JSON.stringify({ code: 0, content: "正文" });
    expect(decodeDahuilangPayload(json)).toBe(json);
    const hex = Buffer.from(json, "utf8").toString("hex");
    expect(decodeDahuilangPayload(hex)).toBe(json);
  });

  it("does not damage a plain string that merely looks like hex", () => {
    expect(decodeDahuilangPayload("abcdef")).toBe("abcdef");
    expect(decodeDahuilangPayload("")).toBe("");
  });
});

describe("大灰狼聚合正文解析", () => {
  it("treats code -1 with a content hint as a login error, not as prose", () => {
    const payload = {
      code: -1,
      msg: "您今日免登录访问次数已达上限(3次)！继续阅读请登录后刷新页面。",
      content: "您今日免登录访问次数已达上限(3次)！继续阅读请登录后刷新页面。",
    };
    expect(() => parseDahuilangContent(payload)).toThrow(DahuilangLoginError);
    try {
      parseDahuilangContent(payload);
    } catch (err) {
      expect(isDahuilangLoginError(err)).toBe(true);
      expect((err as Error).message).toContain("免登录");
    }
  });

  it("returns plain text and converts an HTML body to paragraphs", () => {
    expect(parseDahuilangContent({ code: 0, content: "第一段\n第二段" })).toBe("第一段\n第二段");
    const html = parseDahuilangContent({ code: 0, content: "<p>第一段</p><p>第二段</p>" });
    expect(html).toContain("第一段");
    expect(html).toContain("第二段");
    expect(html).not.toContain("<p>");
  });

  it("surfaces a VIP message and rejects an empty body", () => {
    expect(() => parseDahuilangContent({ code: 0, msg: "本章需要 VIP 会员" })).toThrow(DahuilangVipError);
    expect(() => parseDahuilangContent({ code: 0, content: "" })).toThrow("没有返回正文");
  });
});

describe("大灰狼聚合发现页", () => {
  const filteredState = {
    mode: "小说",
    source: "番茄",
    filters: { word: "30万字以上", status: "完结", sort: "热门" },
  } as unknown as Parameters<typeof withFanqieFilters>[1];

  it("cleans decorative and emoji section titles", () => {
    expect(cleanExploreTitle("📌热门标签📌")).toBe("热门标签");
    expect(cleanExploreTitle("☆ 排行榜 ☆")).toBe("排行榜");
    expect(cleanExploreTitle("°・* 分类 *・°")).toBe("分类");
  });

  it("adds selected_items to a Fanqie novel category", () => {
    const target =
      "https://v5.langge.uk/get_discover?source=%E7%95%AA%E8%8C%84&tab=%E5%B0%8F%E8%AF%B4&type=7&gender=1&page={{page}}";
    const out = withFanqieFilters(target, filteredState);
    expect(out).toContain("selected_items=word_num_gte30,creation_status_end,sort_hot");
    expect(withFanqieFilters(out, filteredState)).toBe(out);
  });

  it("leaves rankings, other platforms and the unlimited filter untouched", () => {
    const ranking =
      "https://v5.langge.uk/get_discover?source=%E7%95%AA%E8%8C%84&type=7&is_ranking=1&page=1";
    expect(withFanqieFilters(ranking, filteredState)).toBe(ranking);
    const other = { ...filteredState, source: "七猫" } as typeof filteredState;
    expect(withFanqieFilters(ranking.replace("is_ranking=1", "bdtype=1"), other)).toBe(
      ranking.replace("is_ranking=1", "bdtype=1"),
    );
    const unlimited = {
      ...filteredState,
      filters: { word: "不限", status: "不限", sort: "不限" },
    } as typeof filteredState;
    expect(withFanqieFilters(ranking.replace("&is_ranking=1", ""), unlimited)).toBe(
      ranking.replace("&is_ranking=1", ""),
    );
  });
});

describe("大灰狼聚合源识别", () => {
  it("recognises only dhl builtin urls", () => {
    expect(DAHUILANG_URL).toBe("dhl://builtin");
    expect(isDahuilangSource({ bookSourceUrl: "dhl://builtin" })).toBe(true);
    expect(isDahuilangSource({ bookSourceUrl: "dhl://anything" })).toBe(true);
    expect(isDahuilangSource({ bookSourceUrl: "shushan://builtin" })).toBe(false);
    expect(isDahuilangSource(null)).toBe(false);
  });

  it("distinguishes login and vip errors", () => {
    const login = new DahuilangLoginError("请登录");
    const vip = new DahuilangVipError("需要会员");
    expect(isDahuilangLoginError(login)).toBe(true);
    expect(isDahuilangLoginError(vip)).toBe(false);
    expect(isDahuilangVipError(vip)).toBe(true);
    expect(isDahuilangVipError(login)).toBe(false);
    expect(isDahuilangLoginError(new Error("请登录"))).toBe(false);
  });
});
