import { describe, expect, it } from "vitest";
import { cleanChapterTitle, evalRule, normalizeToc, parseJsoupSelector, queryJson, renderTemplate } from "@legado/engine";

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    html: "",
    json: null,
    text: "",
    url: "https://example.com/book/1",
    baseUrl: "https://example.com/book/1",
    vars: {},
    kind: "html" as const,
    source: { bookSourceName: "test", bookSourceUrl: "https://example.com" },
    ...overrides,
  } as never;
}

describe("JSON 书源与 init 语义", () => {
  const body = JSON.stringify({ code: 200, data: { articleid: 1074, articlename: "书" } });

  it("多行 @js: 整条求值，对象结果序列化成 JSON", async () => {
    // 书源 205 的写法：ruleBookInfo.init 返回 data 对象
    const rule = [
      "@js:",
      "(function(result){",
      "  const data = JSON.parse(result).data;",
      "  return data;",
      "})(result);",
    ].join("\n");
    const out = await evalRule(rule, ctx({ html: body, json: JSON.parse(body) }));
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0])).toEqual({ articleid: 1074, articlename: "书" });
  });

  it("<js> 返回对象时转成 JSON，而不是 [object Object]", async () => {
    const out = await evalRule("<js>JSON.parse(result).data</js>", ctx({ html: body, json: JSON.parse(body) }));
    expect(out[0]).toBe('{"articleid":1074,"articlename":"书"}');
  });

  it("renderTemplate 能用上一行的 result 渲染 {{result.xxx}}", async () => {
    const out = await renderTemplate(
      "https://example.com/api/chapter/list/{{result.articleid}}?lang=zh-CN",
      ctx({ text: "" }) as never,
      undefined,
      { articleid: 1074 },
    );
    expect(out).toBe("https://example.com/api/chapter/list/1074?lang=zh-CN");
  });

  it("queryJson 遇到 null 返回空数组而不是抛错", () => {
    expect(queryJson("$..author", null)).toEqual([]);
    expect(queryJson("$.data[*]", undefined)).toEqual([]);
  });
});

describe("目录归一化", () => {
  const descending = [6, 5, 4, 3, 2, 1].map((n) => ({
    title: `第${n}章 标题${n}`,
    url: `https://example.com/read/1/${n}.html`,
  }));

  it("倒序目录会被摆成第 1 章在前", () => {
    const result = normalizeToc(descending as never, "测试书");
    expect(result.chapters.map((chapter) => chapter.title)).toEqual([
      "第1章 标题1",
      "第2章 标题2",
      "第3章 标题3",
      "第4章 标题4",
      "第5章 标题5",
      "第6章 标题6",
    ]);
  });

  it("正序目录保持原样", () => {
    const ascending = descending.slice().reverse();
    const result = normalizeToc(ascending as never, "测试书");
    expect(result.chapters[0].title).toBe("第1章 标题1");
    expect(result.reversed).toBe(false);
  });

  it("清掉标题里的更新时间与 APP 免费", () => {
    expect(cleanChapterTitle("第320章 回归更新时间：2026-10-31 10:01:00APP免费")).toBe("第320章 回归");
  });

  it("目录里混入的书名条目会被剔除", () => {
    const chapters = [...descending.slice(0, 5), { title: "测试书", url: "https://example.com/book/1" }];
    const result = normalizeToc(chapters as never, "测试书");
    expect(result.chapters).toHaveLength(5);
    expect(result.removed).toBe(1);
  });

  it("剔除首页、直达底部和作者公告，避免体检抓到空正文", () => {
    const chapters = [
      { title: "同人小说网", url: "https://example.com/" },
      { title: "↓↓↓ 直达页面底部", url: "https://example.com/all.html#footer" },
      { title: "爆燃新篇T0战锤40K开启！跪求彦祖..", url: "https://example.com/promo.html" },
      { title: "第一章 绯红", url: "https://example.com/1.html" },
    ];
    const result = normalizeToc(chapters as never, "测试书");
    expect(result.chapters.map((chapter) => chapter.title)).toEqual(["第一章 绯红"]);
  });
});


describe("class. 多类选择器", () => {
  it("class.article-content font16 表示同时具备两个 class", () => {
    expect(parseJsoupSelector("class.article-content font16@html").selector).toBe(".article-content.font16");
  });
});
