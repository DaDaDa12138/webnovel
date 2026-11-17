import { describe, expect, it, vi } from "vitest";
import { BookSourceEngine, collectItems, evalField, evalRule, renderTemplate, runJsSync } from "@legado/engine";

const html = `<html><body>
<a href="/nav">导航</a>
<div class="list">
  <div class="item" onclick="open('42', '', '')" data-rid="77">
    <a href="/chapter/1.html">第一章 起点</a>
  </div>
  <div class="item" onclick="open('43', '', '')" data-rid="78">
    <a href="/chapter/2.html">第二章 远行</a>
  </div>
</div>
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

describe("rule comments", () => {
  it("strips a Chinese // comment before the real rule", async () => {
    const result = await evalRule("//删掉这行字，vip章节会显示🔓\n$.name", ctx({ kind: "json", json: { name: "诡秘之主" }, html: '{"name":"诡秘之主"}' }));
    expect(result).toEqual(["诡秘之主"]);
  });

  it("keeps real XPath rules that start with //", async () => {
    const result = await evalRule("//div[@class='item']//a/@href", ctx());
    expect(result).toEqual(["/chapter/1.html", "/chapter/2.html"]);
  });
});

describe("multi-line js rules", () => {
  // 书源把目录规则写成「选择器 + 多行 <js>」（335 穿越小说 / 339 笔趣阁）。
  // 按行切开会把 JS 当成 CSS 选择器，整站目录直接空掉。
  it("keeps a <js> block on its own line and feeds it the element list", async () => {
    const rule = [
      ".item",
      "<js>",
      "var out = [];",
      "for (var i = 0; i < result.length; i++) {",
      "  out.push(result[i]);",
      "}",
      "result = out;",
      "result",
      "</js>",
    ].join("\n");
    const items = await collectItems(rule, ctx());
    expect(items.length).toBe(2);
    expect(items[0].html).toContain("/chapter/1.html");
  });

  it("turns a JS JSON chapter list into json items for $.field rules", async () => {
    const rule = [
      ".item",
      "<js>",
      "JSON.stringify(result.select('a').toArray().map(function (a) { return { title: a.text(), url: a.attr('href') }; }))",
      "</js>",
      "$[*]",
    ].join("\n");
    const items = await collectItems(rule, ctx());
    expect(items.length).toBe(2);
    expect(items[0].kind).toBe("json");
    expect(items[0].json).toMatchObject({ title: "第一章 起点", url: "/chapter/1.html" });
  });

  it("scopes result.select to the selected items and exposes jsoup helpers", async () => {
    const rule = [
      ".item",
      "<js>",
      "var links = result.select('a');",
      "links.size() + '|' + links.first().text()",
      "</js>",
    ].join("\n");
    const values = await evalRule(rule, ctx());
    expect(values).toEqual(["2|第一章 起点"]);
  });

  const itemHtml = `<div class="item" onclick="open('42', '', '')" data-rid="77">
    <a href="/chapter/1.html">第一章 起点</a>
  </div>`;

  it("runs a bare @js rule against the current element", async () => {
    const values = await evalRule("@js:result.attr('data-rid')", ctx({ html: itemHtml, docHtml: html }));
    expect(values).toEqual(["77"]);
  });

  it("evaluates accessor-only rules before the js segment", async () => {
    const values = await evalRule("@onclick@js:result.match(/'(\\d+)'/)[1]", ctx({ html: itemHtml, docHtml: html }));
    expect(values).toEqual(["42"]);
  });

  it("finds the current element in the full document for sibling lookups", async () => {
    const first = `<div class="item" onclick="open('42', '', '')" data-rid="77">
    <a href="/chapter/1.html">第一章 起点</a>
  </div>`;
    const values = await evalRule("@js:result.nextElementSibling().attr('data-rid')", ctx({ html: first, docHtml: html }));
    expect(values).toEqual(["78"]);
  });

  it("supports hasClass on selected elements", async () => {
    const rule = [".item", "<js>", "result.hasClass('item') ? 'yes' : 'no'", "</js>"].join("\n");
    await expect(evalRule(rule, ctx())).resolves.toEqual(["yes"]);
  });

  it("exposes attributes() on selected elements", async () => {
    const rule = [
      ".item",
      "<js>",
      "var a = result.toArray()[0];",
      "a.attributes().map(function (item) { return item.name + '=' + item.value; }).join('|');",
      "</js>",
    ].join("\n");
    const values = await evalRule(rule, ctx());
    expect(values[0]).toContain("data-rid=77");
    expect(values[0]).toContain("onclick=open('42', '', '')");
  });

  it("exposes jsoup toArray and outerHtml on elements", async () => {
    const rule = [
      ".item",
      "<js>",
      "var links = result.select('a').toArray();",
      "links.map(function (a) { return a.outerHtml(); }).join('|');",
      "</js>",
    ].join("\n");
    const values = await evalRule(rule, ctx());
    expect(values[0]).toContain('href="/chapter/1.html"');
    expect(values[0]).toContain('href="/chapter/2.html"');
  });
});

describe("Legado JS bridge helpers", () => {
  it("reads and writes source variables", async () => {
    const rendered = await renderTemplate(
      "{{source.putVariable('device', 'abc')}}{{source.getVariable('device')}}|{{source.getVariable()}}",
      { html: "", text: "", json: null, vars: {}, baseUrl: "https://example.com", source: { bookSourceUrl: "https://example.com" } } as never,
    );
    expect(rendered).toBe('abc|{"device":"abc"}');
  });

  it("loads jsLib globals before a JS rule", async () => {
    const values = await evalRule("@js:APP_NAME + '|' + nativeSign('AB')", ctx({
      source: {
        bookSourceName: "test",
        bookSourceUrl: "https://example.com",
        jsLib: "var APP_NAME = 'com.example'; function nativeSign(s) { return s.split('').reverse().join(''); }",
      },
    }));
    expect(values).toEqual(["com.example|BA"]);
  });

  it("accepts source.setVariable with a JSON payload", async () => {
    const rendered = await renderTemplate(
      "{{source.setVariable('\\u007b\"device\":\"abc\",\"count\":2\\u007d')}}{{source.getVariable('device')}}|{{source.getVariable('count')}}",
      { html: "", text: "", json: null, vars: {}, baseUrl: "https://example.com", source: { bookSourceUrl: "https://example.com" } } as never,
    );
    expect(rendered).toBe("abc|2");
  });

  it("supports cache.getFile and cache.putFile with null misses", async () => {
    const rendered = await renderTemplate(
      "{{String(cache.getFile('novels'))}}|{{cache.putFile('novels', 'v')}}{{cache.getFile('novels')}}",
      { html: "", text: "", json: null, vars: {}, baseUrl: "https://example.com" } as never,
    );
    expect(rendered).toBe("null|v");
  });


  it("round-trips AES/CBC through java.createSymmetricCrypto", () => {
    const out = runJsSync(`
      const fullKey = "0123456789abcdef0123456789abcdef";
      const iv = java.strToBytes(fullKey.substring(0, 16));
      const key = java.strToBytes(fullKey.substring(16));
      const cipher = java.createSymmetricCrypto("AES/CBC/Pkcs7Padding", key, iv);
      const encrypted = cipher.encryptStr("hello 正文");
      cipher.decryptStr(java.base64DecodeToByteArray(encrypted));
    `);
    expect(out).toBe("hello 正文");
  });

  it("decrypts AES/CBC directly through java.aesBase64DecodeToString", () => {
    const out = runJsSync(`
      const fullKey = "0123456789abcdef0123456789abcdef";
      const iv = fullKey.substring(0, 16);
      const key = fullKey.substring(16);
      const cipher = java.createSymmetricCrypto("AES/CBC/Pkcs7Padding", java.strToBytes(key), java.strToBytes(iv));
      const encrypted = cipher.encryptStr("hello 正文");
      java.aesBase64DecodeToString(encrypted, key, "AES/CBC/PKCS5Padding", iv);
    `);
    expect(out).toBe("hello 正文");
  });

  it("provides getCover and a minimal org.jsoup parser", async () => {
    const rendered = await renderTemplate(
      "{{getCover('/cover.jpg')}}|{{org.jsoup.Jsoup.parse('<div class=\"tag\">奇幻</div>').select('.tag').text()}}",
      { html: "", text: "", json: null, vars: {}, baseUrl: "https://example.com" } as never,
    );
    expect(rendered).toBe("/cover.jpg|奇幻");
  });
});

describe("connect().raw().request().url()", () => {
  // 书源用 `{{java.connect(source.getKey()).raw().request().url()}}modules/...` 拼搜索地址。
  // OkHttp 的 HttpUrl 字符串形式带结尾斜杠，缺了会拼出 https://m.bqg9.xyzmodules/...
  it("returns the source url with a trailing slash", async () => {
    const rendered = await renderTemplate(
      "{{java.connect(source.getKey()).raw().request().url()}}modules/article/search.php?keyword={{key}}",
      { html: "", text: "", json: null, vars: { key: "x" }, baseUrl: "https://example.com", source: { bookSourceUrl: "https://m.bqg9.xyz" } } as never,
    );
    expect(rendered).toBe("https://m.bqg9.xyz/modules/article/search.php?keyword=x");
  });
});

describe("Legado java helpers", () => {
  // 41 VIP中文 的 init 把简介正则写在 java.getString 里：`...@content##简介[：:]`。
  // 以前整串交给 CSS，抛 "Expected name, found ##简介[：:]"。
  it("applies ##regex##replacement inside java.getString", async () => {
    const rendered = await renderTemplate("{{java.getString('.item@data-rid##^7##X')}}", ctx());
    expect(rendered).toBe("X7\nX8");
  });

  // 409 言情小说吧 的 coverUrl 调 getStringList 的 size()/get(0)。
  it("returns a Java-like list from java.getStringList", async () => {
    const rendered = await renderTemplate(
      "{{java.getStringList('.item a@href').size()}}|{{java.getStringList('.item a@href').get(1)}}|{{java.getStringList('.none@href').isEmpty()}}",
      ctx(),
    );
    expect(rendered).toBe("2|/chapter/2.html|true");
  });

  // Legado 的 || 是备选规则，不是 CSS 列组合器；409 的 coverUrl 全靠它。
  it("falls back across || selector alternatives", async () => {
    const rendered = await renderTemplate(
      "{{java.getStringList('img@src||.item a@href').get(0)}}|{{java.getStringList('meta@content||.item a@text').get(0)}}",
      ctx(),
    );
    expect(rendered).toBe("/chapter/1.html|第一章 起点");
  });

  // 207 少年小说网 从 <style> 里读隐藏章节选择器，jsoup 的 data() 对 style 返回 CSS 文本。
  it("returns style text from data() on a style element", () => {
    const out = runJsSync(
      "org.jsoup.Jsoup.parse('<style>.x{display:none}</style>').select('style').first().data()",
      { html: "", text: "", json: null, vars: {}, baseUrl: "https://example.com" } as never,
    );
    expect(out).toBe(".x{display:none}");
  });
});

describe("js operators", () => {
  // JS 字符串里的 || 不能被当成选择器备选，否则代码从中间断开。
  it("keeps || inside an inline JS rule", async () => {
    await expect(evalRule(".item a@js:'a||b'", ctx())).resolves.toEqual(["a||b"]);
  });
});

describe("inline js without closing tag", () => {
  // splitLines 把 selector@js:code 转成 selector<js>code，没有 </js>。
  it("strips the <js> prefix before evaluating", async () => {
    await expect(evalRule(".item a@js:result.length", ctx())).resolves.toEqual(["2"]);
  });

  // 170/171 多看阅读：chapterUrl = "$.seq_id@js:" + 下一行拼接 URL。
  // 以前 splitLines 只在 <js> 处进入 JS 模式，多行 @js 被拆成两条规则，章节地址全空。
  it("keeps multi-line selector@js code in one rule", async () => {
    await expect(
      evalRule('$.seq_id@js:\n"id-" + result', ctx({ kind: "json", json: { seq_id: 7 }, html: "" })),
    ).resolves.toEqual(["id-7"]);
  });
});

describe("book info url rules", () => {
  // 195 宜搜 / 243 新浪 / 561、619 17K 的 tocUrl 是纯 URL + @get。
  // 以前只有 {{...}} 会走模板渲染，URL 里的 @get 被当 XPath 解析。
  it("renders @get variables in a literal URL", async () => {
    const url = await evalRule(
      "https://api.example.com/toc?gid=@get:{gid}&nid=@get:{nid}",
      ctx({ html: "", kind: "json", json: {}, vars: { gid: "42", nid: "7" } }),
    );
    expect(url).toEqual(["https://api.example.com/toc?gid=42&nid=7"]);
  });

  it("returns no URL when an @get variable is missing", async () => {
    await expect(
      evalRule("https://api.example.com/toc?gid=@get:{gid}", ctx({ html: "", kind: "json", json: {}, vars: {} })),
    ).resolves.toEqual([]);
  });
});

describe("accessor-only inline js", () => {
  // 589/712 若初文学：html@js:result.match(...)。html 是取值访问器，
  // 不是 CSS 选择器；以前 result 是 <html> 元素，调用 match 直接报错。
  it("passes the page text to inline JS after html", async () => {
    await expect(evalRule("html@js:result.match(/<a/) ? 'yes' : 'no'", ctx())).resolves.toEqual(["yes"]);
  });
});

describe("multi-line nextContentUrl", () => {
  // 252/253/805/806 的 nextContentUrl 是「选择器 + 下一行 @js:」。
  // splitLines 会把它规范成没有闭合 </js> 的 <js> 块；以前 stripJsWrapper
  // 原样返回，JS 解析器报 Unexpected token '<'，整章正文被判失败。
  it("strips an unclosed <js> wrapper from a multi-line @js rule", async () => {
    const rule = ["text.下一@href", "@js:", "var next=/_\\d+\\.html/.test(result) ? result : '';", "next;"].join("\n");
    await expect(evalRule(rule, ctx({ html: '<div><a href="/chapter/1_2.html">下一</a></div>' }))).resolves.toEqual(["/chapter/1_2.html"]);
  });
});

describe("js regex replacement suffix", () => {
  // 41 VIP中文的 chapterName 末尾是 ##(章)...##$1 $2$3；这是 Legado 的
  // 结果后处理，不是 JS 代码，不能交给 new Function。
  it("applies ##pattern##replacement to JS results", async () => {
    const rule = ["text", "@js:result + '·'", "##·##!"].join("\n");
    await expect(evalRule(rule, ctx({ html: "<div>第一章 起点</div>" }))).resolves.toEqual(["第一章 起点!"]);
  });
});

describe("js completion", () => {
  // 409 言情小说吧的目录 JS 中途给 result 赋过探测值，最后一行才是真正的返回值。
  it("returns the last expression even when result was assigned earlier", () => {
    expect(runJsSync("result='探测'; '<div>章节</div>'", { html: "", text: "", json: null, vars: {}, baseUrl: "https://example.com" } as never)).toBe("<div>章节</div>");
    expect(runJsSync("result='探测'; if(false){result='x'}", { html: "", text: "", json: null, vars: {}, baseUrl: "https://example.com" } as never)).toBe("探测");
  });
});

describe("unsupported browser APIs", () => {
  it("raises a clear error for java.webView / java.startBrowser", () => {
    const base = ctx();
    expect(() => runJsSync("java.webView('https://example.com')", base as never)).toThrow(/java\.webView.*浏览器内核/);
    expect(() => runJsSync("java.startBrowser('https://example.com')", base as never)).toThrow(/java\.startBrowser.*浏览器/);
  });
});

describe("search variables", () => {
  // 195 宜搜的 name/author 规则分别 @put 不同的 gid/nid；搜索列表共用一个 vars
  // 时最后一条会覆盖前一条，bookUrl 全部指向最后一本书。
  it("isolates @put variables per search result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      '<div class="item"><a href="/1">甲</a></div><div class="item"><a href="/2">乙</a></div>',
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    )));
    try {
      const engine = new BookSourceEngine({ timeoutMs: 5000 });
      const source = {
        bookSourceName: "t",
        bookSourceUrl: "https://e.com",
        searchUrl: "https://e.com/s?q={{key}}",
        ruleSearch: { bookList: ".item", name: "a@text", bookUrl: "https://e.com/book?gid=@get:{gid}" },
      } as never;
      // 用 author 规则把 href 存进 gid，模拟源站按条目写变量。
      (source as { ruleSearch: Record<string, string> }).ruleSearch.author = "a@text@put:{gid:a@href}";
      const books = await engine.search(source, "x", 1);
      expect(books.map((b) => b.bookUrl)).toEqual(["https://e.com/book?gid=/1", "https://e.com/book?gid=/2"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fills @get variables from the book URL query", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html><head><title>书</title></head><body></body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    })));
    try {
      const engine = new BookSourceEngine({ timeoutMs: 5000 });
      const source = {
        bookSourceName: "t",
        bookSourceUrl: "https://e.com",
        ruleBookInfo: { tocUrl: "https://e.com/toc?gid=@get:{gid}&nid=@get:{nid}" },
      } as never;
      const info = await engine.bookInfo(source, "https://e.com/book?gid=42&nid=7");
      expect(info.tocUrl).toBe("https://e.com/toc?gid=42&nid=7");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("list rules", () => {
  it("supports a bare XPath chapter list", async () => {
    const items = await collectItems('//div[@class="item"]', ctx());
    expect(items).toHaveLength(2);
    expect(await evalRule("a@href", items[0])).toEqual(["/chapter/1.html"]);
  });

  it("turns a JS array of objects into json items", async () => {
    const items = await collectItems("<js>[{name:'第1章',url:'/1'},{name:'第2章',url:'/2'}]</js>", ctx());
    expect(items).toHaveLength(2);
    expect(await evalRule("name", items[0])).toEqual(["第1章"]);
    expect(await evalRule("url", items[1])).toEqual(["/2"]);
  });

  it("returns an empty list instead of treating a JS rule as CSS", async () => {
    await expect(collectItems("<js>[]</js>", ctx())).resolves.toEqual([]);
  });

  // JS 的 || 是逻辑或，不是选择器备选；409 的目录规则满屏 ||，拆开就语法错误。
  it("does not split || inside a JS list rule", async () => {
    const items = await collectItems("@js:'<div class=\"item\"><a href=\"/1\">A</a></div>'||''", ctx());
    expect(items).toHaveLength(1);
  });
});

describe("content rules", () => {
  // contentWithImages 以前没有把 jsEvaluator 传给 evalFieldList，@js 正文规则里
  // 的 src 是空串；192 完本小说的 `src.match(/d\\("([^\\)]+)/)[1]` 因此读 null 的 [1]。
  it("exposes the fetched page as src inside a content @js rule", async () => {
    const page = '<html><body><div id="content"><p>你好</p></div><script>var data = d("cipher,key");</script></body></html>';
    vi.stubGlobal("fetch", vi.fn(async () => new Response(page, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    })));
    try {
      const engine = new BookSourceEngine({ timeoutMs: 5000, maxContentPages: 1 });
      const source = {
        bookSourceName: "test",
        bookSourceUrl: "https://example.com",
        ruleContent: { content: '@js:src.match(/d\\("([^\\)]+)/)[1].replace(/"/g, "")' },
      } as never;
      const chapter = { title: "第一章", url: "https://example.com/1.html" } as never;
      const out = await engine.contentWithImages(source, chapter);
      expect(out.text).toBe("cipher,key");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("jsLib", () => {
  it("ignores external-script URL maps instead of concatenating JSON as code", () => {
    const source = { bookSourceName: "test", bookSourceUrl: "https://example.com", jsLib: '{"crypto":"https://cdn.example.com/crypto.js"}' };
    expect(runJsSync("1 + 1", { source } as never)).toBe(2);
  });
});

describe("P2.1 source compatibility", () => {
  // 80 福书：目录是 <option value="/BLtongren/41125_0.html">，旧引擎没有 value 访问器。
  it("reads option value accessors", async () => {
    const values = await evalRule(
      "option@value",
      ctx({ html: '<select><option value="/a">A</option><option value="/b">B</option></select>' }),
    );
    expect(values).toEqual(["/a", "/b"]);
  });

  // 290 爱下：@get 变量和 {{$.field}} 混在同一条 URL 里，不能把整串当变量名。
  it("renders @get inside a mixed URL template", async () => {
    const url = await evalRule(
      "https://ixdzs.tw/novel/@get:{url}p{{$.ordernum}}.html",
      ctx({ kind: "json", json: { ordernum: 1 }, html: "", vars: { url: "clist/" } }),
    );
    expect(url).toEqual(["https://ixdzs.tw/novel/clist/p1.html"]);
  });

  // 602 QQ阅读：chapterUrl 的 JS 字符串里写 &cid={{$.seq}}，JS 代码本身要先渲染模板。
  it("renders JSONPath templates inside JS rules", async () => {
    const url = await evalRule(
      '<js>"https://api.example.com/chapter?cid=" + {{$.seq}}</js>',
      ctx({ kind: "json", json: { seq: 7 }, html: "" }),
    );
    expect(url).toEqual(["https://api.example.com/chapter?cid=7"]);
  });

  // 367/368 米读：URL 用单花括号 {$.bookId}，Legado 也接受这种写法。
  it("normalizes single-brace JSONPath URL templates", async () => {
    const url = await evalRule(
      "https://cdn.example.com/{$.bookId}_{$.chapterId}.txt?md5={$.md5}",
      ctx({ kind: "json", json: { bookId: 9, chapterId: 3, md5: "abc" }, html: "" }),
    );
    expect(url).toEqual(["https://cdn.example.com/9_3.txt?md5=abc"]);
  });

  // 602 的 chapterName 是裸键 title；它和 HTML 的 title 属性同名，必须优先按 JSON 取。
  it("reads a bare JSON key before HTML accessors", async () => {
    const name = await evalField(
      "title",
      ctx({ kind: "json", json: { title: "第1章 绯红" }, html: "<html><head><title>页面标题</title></head></html>" }),
    );
    expect(name).toBe("第1章 绯红");
  });

  // 373 紫云宫：解密脚本对非全局正则调用 replaceAll，V8 默认会抛错。
  it("allows replaceAll with a non-global regex", () => {
    expect(runJsSync('"a1b2".replaceAll(/(\\d)/, "[$1]")', { html: "", text: "", json: null, vars: {}, baseUrl: "https://example.com" } as never)).toBe("a[1]b[2]");
  });

  // 412 话本小说：chapterUrl 用 chapter.putVariable 存下一页地址。
  it("exposes chapter.putVariable to JS rules", () => {
    const out = runJsSync('chapter.putVariable("next", "/chapter/2"); result = chapter.getVariable("next");', {
      chapter: {},
      vars: {},
    });
    expect(out).toBe("/chapter/2");
  });
});
