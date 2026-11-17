import { describe, expect, it, vi } from "vitest";
import {
  applyReplaceRegex,
  BookSourceEngine,
  collectItems,
  evalField,
  evalFieldList,
  evalRule,
  fetchText,
  htmlToText,
  parseExploreUrl,
  parseHeader,
  parseJsoupSelector,
  queryHtml,
  renderTemplate,
  splitTop,
  toAbsoluteUrl,
} from "@legado/engine";
import { hostKey, sourceKey } from "../apps/server/src/services/normalize.js";

const html = `<html><body>
<div class="book-list">
  <li><a href="/book/1">第一本</a><span class="author">作者甲</span></li>
  <li><a href="/book/2">第二本</a><span class="author">作者乙</span></li>
</div>
<div id="content">正文<span>内容</span></div>
</body></html>`;

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    html,
    json: null,
    text: "",
    url: "https://example.com/list",
    baseUrl: "https://example.com/list",
    vars: {},
    kind: "html" as const,
    source: { bookSourceName: "test", bookSourceUrl: "https://example.com" },
    ...overrides,
  } as never;
}

describe("split", () => {
  it("splits on top-level separators only", () => {
    expect(splitTop("a&&b", "&&")).toEqual(["a", "b"]);
    expect(splitTop("a||b||c", "||")).toEqual(["a", "b", "c"]);
    expect(splitTop("{{a&&b}}&&c", "&&")).toEqual(["{{a&&b}}", "c"]);
  });
});

describe("jsoup selector", () => {
  it("parses class prefix and accessors", () => {
    const parsed = parseJsoupSelector("class.book-list@li@a@text");
    expect(parsed.selector).toContain(".book-list");
    expect(parsed.accessors.length).toBeGreaterThan(0);
  });

  it("supports index tokens", () => {
    const parsed = parseJsoupSelector("class.book-list@li.1");
    expect(parsed.accessors.join(",")).toContain("1");
  });
});

describe("html query", () => {
  it("extracts text and attributes", async () => {
    expect(await evalField("class.book-list@li@a@text", ctx())).toBe("第一本");
    expect(await evalRule("class.book-list@li@a@href", ctx())).toEqual(["/book/1", "/book/2"]);
    expect(await evalField("id.content@text", ctx())).toBe("正文内容");
  });

  it("collects list items", async () => {
    const items = await collectItems("class.book-list@li", ctx());
    expect(items).toHaveLength(2);
    expect(await evalField("a@text", items[1])).toBe("第二本");
    expect(await evalField("class.author@text", items[0])).toBe("作者甲");
  });

  it("converts html to text", () => {
    expect(htmlToText("<p>a</p><p>b</p>")).toContain("a");
    expect(queryHtml(html, "id.content@text")).toEqual(["正文内容"]);
  });

  it("keeps selector indexes in accessor rules", async () => {
    const row = '<p><span>[<a href="/category/1/">奇幻</a>]</span><span><a href="/book/1/">书名甲</a></span>/<span><a href="/writer/1/">作者甲</a></span></p>';
    expect(await evalRule("span.-2@a@text", ctx({ html: row }))).toEqual(["书名甲"]);
    expect(await evalRule("span.-1@text", ctx({ html: row }))).toEqual(["作者甲"]);
    expect(await evalRule("a.1@href", ctx({ html: row }))).toEqual(["/book/1/"]);
  });
});

describe("chapter body", () => {
  const chapterHtml = `<html><body><div id="nr"><p>第一段</p><p>第二段</p><p>第三段</p></div></body></html>`;

  it("keeps every paragraph instead of only the first match", async () => {
    const values = await evalFieldList("#nr p@html", ctx({ html: chapterHtml }) as never);
    expect(values).toHaveLength(3);
    expect(values.join("")).toContain("第三段");
  });

  it("evalField still returns a single value", async () => {
    const value = await evalField("#nr p@html", ctx({ html: chapterHtml }) as never);
    expect(value).toContain("第一段");
    expect(value).not.toContain("第三段");
  });
});

describe("template", () => {
  it("renders nested braces and js", async () => {
    const js = { eval: async (code: string) => String(eval(code)) };
    expect(await renderTemplate("共{{1+2}}章", {} as never, js as never)).toBe("共3章");
    expect(await renderTemplate("{{'a'+'b'}}", {} as never, js as never)).toBe("ab");
    expect(await renderTemplate("{{$.name}}", { json: { name: "书名" } } as never, js as never)).toBe("书名");
  });

  it("evaluates {{@@rule}} as a rule, not as JS", async () => {
    expect(await renderTemplate("{{@@class.author@text}}", ctx())).toBe("作者甲\n作者乙");
    expect(await renderTemplate("{{@@id.content@text}}", ctx())).toBe("正文内容");
  });

  it("falls back to the synchronous sandbox when no evaluator is passed", async () => {
    // Legado evaluates {{expr}} with Rhino; a bare expression returns its value.
    expect(await renderTemplate("{{1 + 2}}", ctx())).toBe("3");
    expect(
      await renderTemplate("{{String(baseUrl).match(/\\d+(?=\\.html)/)[0]}}", ctx({ baseUrl: "https://m.95dxs.com/info/3/3361.html" })),
    ).toBe("3361");
  });

  it("renders template rule values end-to-end through evalField", async () => {
    expect(await evalField("{{baseUrl}}/x", ctx({ baseUrl: "https://a.com/b" }))).toBe("https://a.com/b/x");
  });
});

describe("regex and urls", () => {
  it("applies replace regex", () => {
    expect(applyReplaceRegex("abc123def", "##\\d+##")).toBe("abcdef");
    expect(applyReplaceRegex("a1b2", "##\\d##_###")).toBe("a_b_");
  });

  it("resolves relative urls", () => {
    expect(toAbsoluteUrl("/book/1", "https://example.com/list")).toBe("https://example.com/book/1");
    expect(toAbsoluteUrl("2.html", "https://example.com/a/1.html")).toBe("https://example.com/a/2.html");
  });
});

describe("rule url options", () => {
  it("keeps ,{...} options out of the path when resolving a chapter url", async () => {
    // 番茄/QQ阅读的接口式正文：`…/ads-read,{"method":"POST","body":"…"}`。
    // 以前直接丢给 new URL()，选项被百分号编码进路径，正文必然取空。
    const { resolveRuleUrl, splitUrlOptions } = await import("@legado/engine");
    const resolved = resolveRuleUrl('be-api/content/ads-read,{"method":"POST","body":"id=1"}', "https://novel.html5.qq.com/");
    expect(resolved.startsWith("https://novel.html5.qq.com/be-api/content/ads-read,{")).toBe(true);
    const parsed = splitUrlOptions(resolved);
    expect(parsed.url).toBe("https://novel.html5.qq.com/be-api/content/ads-read");
    expect(parsed.options.method).toBe("POST");
    expect(parsed.options.body).toBe("id=1");
  });

  it("leaves plain urls alone", async () => {
    const { resolveRuleUrl } = await import("@legado/engine");
    expect(resolveRuleUrl("/book/1", "https://a.com/x/")).toBe("https://a.com/book/1");
  });

  it("decodes percent-encoded request options", async () => {
    // 377 红薯/382 绿柠的 bookUrl 经过 URL 编码后选项变成 ,{%27method%27:%20%27POST%27}。
    const { splitUrlOptions } = await import("@legado/engine");
    const parsed = splitUrlOptions(
      "https://androidv2.hongshu.com/clientGetBookInfo?version=1.5.2,{%27method%27:%20%27POST%27,%27body%27:%20%27bid=113806%27}",
    );
    expect(parsed.url).toBe("https://androidv2.hongshu.com/clientGetBookInfo?version=1.5.2");
    expect(parsed.options.method).toBe("POST");
    expect(parsed.options.body).toBe("bid=113806");
  });

  it("recognizes fully encoded request options", async () => {
    // 382 绿柠的 bookUrl 连逗号后的花括号也被编码成 ,%7B...%7D。
    const { splitUrlOptions } = await import("@legado/engine");
    const parsed = splitUrlOptions(
      "https://android.goreadnovels.com/getBooksList,%7B%20%20%22body%22:%20%22bids=12553%22,%20%20%22method%22:%20%22POST%22%7D",
    );
    expect(parsed.url).toBe("https://android.goreadnovels.com/getBooksList");
    expect(parsed.options.method).toBe("POST");
    expect(parsed.options.body).toBe("bids=12553");
  });
});

describe("regex rules", () => {
  it("applies a ## regex to a content rule instead of parsing it as CSS", async () => {
    // 842 个源里 126 个这么写正文规则（`id.content@html##最新网址：…`）。
    // 以前 evalFieldList 把它当简单选择器丢给 cheerio，抛 "Expected name, found ##…"，
    // 整章正文取不到，换源面板上就显示「测字失败」。
    const doc = '<div id="content">正文<span>内容</span>最新网址：www.uuwx.la</div>';
    const values = await evalFieldList("id.content@html##最新网址：.*", ctx({ html: doc }));
    expect(values).toHaveLength(1);
    expect(values[0]).toContain("正文");
    expect(values[0]).not.toContain("最新网址");
  });

  it("keeps a ## regex working inside a list rule", async () => {
    const doc = '<ul class="list"><li><a href="/1">第一章</a></li><li><a href="/2">第二章</a></li></ul>';
    const items = await collectItems("class.list@li##\\s+", ctx({ html: doc }));
    expect(items).toHaveLength(2);
    expect(await evalField("text", items[1])).toContain("第二章");
  });

  it("does not swallow a broken selector as a hard error", async () => {
    const values = await evalFieldList("id.content[##x", ctx({ html: '<div id="content">正文</div>' }));
    expect(Array.isArray(values)).toBe(true);
  });
});

describe("@regex selector", () => {
  const textCtx = (text: string, extra: Record<string, unknown> = {}) => ctx({ text, ...extra });

  it("extracts a decimal rating from text", async () => {
    expect(await evalRule("@regex:\\d+\\.\\d+", textCtx("评分 9.2 分，共 1024 人"))).toEqual(["9.2"]);
  });

  it("extracts the first capture group", async () => {
    expect(await evalRule("@regex:ISBN:([\\d-]+)", textCtx("ISBN:978-7-121-12345-6"))).toEqual(["978-7-121-12345-6"]);
  });

  it("returns every match with the g: prefix", async () => {
    expect(await evalRule("@regex:g:\\d+", textCtx("第1章 共23章 2026年"))).toEqual(["1", "23", "2026"]);
  });

  it("supports /pattern/flags syntax", async () => {
    expect(await evalRule("@regex:/[a-z]+/gi", textCtx("Abc 12 DEF"))).toEqual(["Abc", "DEF"]);
  });

  it("supports replacement with capture groups", async () => {
    expect(await evalRule("@regex:(\\d{4})-(\\d{2}):replace:$1年$2月", textCtx("2026-11 更新"))).toEqual(["2026年11月 更新"]);
  });

  it("supports global replacement", async () => {
    expect(await evalRule("@regex:g:\\s+:replace:-", textCtx("a   b\n c"))).toEqual(["a-b-c"]);
  });

  it("supports split", async () => {
    expect(await evalRule("@regex:[,，]:split", textCtx("玄幻，都市,科幻"))).toEqual(["玄幻", "都市", "科幻"]);
  });

  it("supports test", async () => {
    expect(await evalRule("@regex:\\d+:test", textCtx("有 12 章"))).toEqual(["true"]);
    expect(await evalRule("@regex:\\d+:test", textCtx("没有数字"))).toEqual(["false"]);
  });

  it("works after a selector", async () => {
    const doc = '<span class="bookname">《书名》作者：张三</span>';
    expect(await evalRule("class.bookname@text@regex:作者[：:](.+)", ctx({ html: doc }))).toEqual(["张三"]);
  });

  it("works after a list selector and keeps every item", async () => {
    const doc = '<ul><li><a>第一章 开端</a></li><li><a>第二章 相遇</a></li></ul>';
    expect(await evalRule("tag.li@tag.a@text@regex:第(.)章", ctx({ html: doc }))).toEqual(["一", "二"]);
  });

  it("collects regex results as text items", async () => {
    const doc = '<ul class="list"><li><a>第一章 开端</a></li><li><a>第二章 相遇</a></li></ul>';
    const items = await collectItems("class.list@li@a@text@regex:第(.)章", ctx({ html: doc }));
    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe("text");
    expect(items[0].text).toBe("一");
    expect(items[1].text).toBe("二");
  });

  it("evalFieldList keeps all global regex matches", async () => {
    const doc = '<div id="content">正文 12 个字，第 3 段</div>';
    expect(await evalFieldList("id.content@text@regex:g:\\d+", ctx({ html: doc }))).toEqual(["12", "3"]);
  });

  it("applies a standalone regex to ctx.text before html", async () => {
    expect(await evalRule("@regex:\\d+", textCtx("42", { html: "<b>99</b>" }))).toEqual(["42"]);
  });

  it("returns no values when nothing matches", async () => {
    expect(await evalRule("@regex:\\d+", textCtx("没有数字"))).toEqual([]);
  });

  it("returns no values for an invalid pattern", async () => {
    expect(await evalRule("@regex:[", textCtx("任意"))).toEqual([]);
  });

  it("supports optional capture groups", async () => {
    expect(await evalRule("@regex:第(\\d+)章(?:[ 　](.+))?", textCtx("第12章 风起"))).toEqual(["12"]);
  });

  it("supports case-insensitive flags", async () => {
    expect(await evalRule("@regex:/error/i", textCtx("ERROR: 404"))).toEqual(["ERROR"]);
  });

  it("does not hang on zero-width global matches", async () => {
    const values = await evalRule("@regex:g:\\b", textCtx("ab cd"));
    expect(values.length).toBeGreaterThan(0);
  });

  it("keeps a literal colon in the pattern", async () => {
    expect(await evalRule("@regex:更新时间[：:]\\s*(.+)", textCtx("更新时间：2026-11-05"))).toEqual(["2026-11-05"]);
  });

  it("falls back to docHtml for a chained selector", async () => {
    const doc = '<div class="page"><span class="name">书名：测试书</span></div>';
    expect(await evalRule("class.name@text@regex:书名[：:](.+)", ctx({ html: "<span></span>", docHtml: doc }))).toEqual(["测试书"]);
  });

  it("supports an escaped slash inside /pattern/", async () => {
    expect(await evalRule("@regex:/\\d+\\/\\d+/", textCtx("评分 9/10"))).toEqual(["9/10"]);
  });

  it("supports unicode property escapes", async () => {
    expect(await evalRule("@regex:g:\\p{Script=Han}+", textCtx("abc 中文 def 阅读"))).toEqual(["中文", "阅读"]);
  });
});

describe("explore url", () => {
  it("parses json and line formats", () => {
    const json = parseExploreUrl('[{"title":"玄幻","url":"https://a.com/x?p={{page}}"}]');
    expect(json[0]).toEqual({ title: "玄幻", url: "https://a.com/x?p={{page}}" });
    const lines = parseExploreUrl("玄幻::https://a.com/1\n都市::https://a.com/2");
    expect(lines.map((g) => g.title)).toEqual(["玄幻", "都市"]);
  });

  it("salvages pairs from a broken json array", () => {
    const broken = parseExploreUrl('[{"title":"月票榜","url":"/rank?x=1"},]');
    expect(broken).toEqual([{ title: "月票榜", url: "/rank?x=1" }]);
    expect(parseExploreUrl("[not json at all")).toEqual([]);
  });
});

describe("normalize", () => {
  it("strips decoration and keeps path", () => {
    expect(hostKey("https://Book.Example.com/path/♤x")).toBe("book.example.com/path");
    expect(hostKey("http://a.com/search?q=1")).toBe("a.com");
  });

  it("keeps pseudo urls distinct", () => {
    expect(sourceKey("bbnnfgh", "源A")).not.toBe(sourceKey("bbnnfgh", "源B"));
  });
});

describe("fetch", () => {
  it("serializes object POST bodies as JSON", async () => {
    const calls: Array<{ body?: unknown; headers?: Record<string, string> }> = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body?: unknown; headers?: Record<string, string> }) => {
      calls.push(init);
      return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
    });
    await fetchText("https://example.com/api", { method: "POST", body: { a: 1 } });
    expect(calls[0].body).toBe('{"a":1}');
    expect(calls[0].headers?.["content-type"]).toBe("application/json");
    vi.unstubAllGlobals();
  });

  it("evaluates a @js source header and merges the resulting object", async () => {
    const calls: Array<{ headers?: Record<string, string> }> = [];
    vi.stubGlobal("fetch", async (_url: string, init: { headers?: Record<string, string> }) => {
      calls.push(init);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    try {
      const engine = new BookSourceEngine({ timeoutMs: 5000 });
      const source = {
        bookSourceName: "header-js",
        bookSourceUrl: "https://example.com",
        header: '@js:\nJSON.stringify({ "X-Source": source.bookSourceUrl, "X-Const": "yes" })',
      } as never;
      await engine.request("https://example.com/api", source, {});
      expect(calls[0].headers?.["X-Source"]).toBe("https://example.com");
      expect(calls[0].headers?.["X-Const"]).toBe("yes");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("times out while reading a slow response body", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: { signal: AbortSignal }) => ({
      url: "https://example.com/slow",
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      arrayBuffer: () =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    }));
    await expect(fetchText("https://example.com/slow", { timeoutMs: 30 })).rejects.toMatchObject({ code: "TIMEOUT" });
    vi.unstubAllGlobals();
  });
});
describe("parseHeader", () => {
  it("percent-encodes non-Latin1 header values", () => {
    const out = parseHeader('{"cookie":"token=中文","X-Ascii":"ok"}');
    expect(out.cookie).toBe("token=%E4%B8%AD%E6%96%87");
    expect(out["X-Ascii"]).toBe("ok");
  });
});
