import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineError, type BookSource } from "@legado/engine";
import { classifyTraceError, redactHeader, redactUrl, redactUrlsInText, traceRuleKind, traceSource } from "../apps/server/src/services/source-trace";

describe("source trace helpers", () => {
  it("classifies rule kinds", () => {
    expect(traceRuleKind("")).toBe("empty");
    expect(traceRuleKind("@js:result")).toBe("js");
    expect(traceRuleKind("<js>result</js>")).toBe("js");
    expect(traceRuleKind("@regex:https://.*")).toBe("regex");
    expect(traceRuleKind("$..name")).toBe("json");
    expect(traceRuleKind("@css:.book-name")).toBe("selector");
    expect(traceRuleKind("div.book-list > li")).toBe("selector");
    expect(traceRuleKind("class.book-name@text")).toBe("selector");
  });

  it("redacts secret headers and clips normal values", () => {
    expect(redactHeader("Cookie", "uid=1; token=abc")).toBe("••••（已隐藏）");
    expect(redactHeader("Authorization", "Bearer abc")).toBe("••••（已隐藏）");
    expect(redactHeader("X-Api-Key", "secret")).toBe("••••（已隐藏）");
    expect(redactHeader("User-Agent", "TestBrowser/1.0")).toBe("TestBrowser/1.0");
    expect(redactHeader("Referer", "https://a.com/p?token=secret")).toBe("https://a.com/p?token=redacted");
    expect(redactHeader("Referer", "x".repeat(200)).length).toBe(161);
  });

  it("redacts credentials and sensitive query params in trace URLs", () => {
    expect(redactUrl("https://a.com/p?token=abc123&page=2")).toBe("https://a.com/p?token=redacted&page=2");
    expect(redactUrl("https://a.com/p?api_key=secret")).toBe("https://a.com/p?api_key=redacted");
    expect(redactUrl("https://a.com/p?apiKey=secret")).toBe("https://a.com/p?apiKey=redacted");
    expect(redactUrl("https://user:pass@a.com/p")).toBe("https://a.com/p");
    expect(redactUrl("https://a.com/p?page=2")).toBe("https://a.com/p?page=2");
    expect(redactUrlsInText("见 https://a.com/p?token=abc123&page=2 和 https://b.com/x")).toBe(
      "见 https://a.com/p?token=redacted&page=2 和 https://b.com/x",
    );
  });

  it("classifies engine timeout and network errors", () => {
    expect(classifyTraceError("search", new EngineError("TIMEOUT", "request timed out")).kind).toBe("timeout");
    expect(classifyTraceError("search", new EngineError("NET_ERROR", "fetch failed")).kind).toBe("network");
    expect(classifyTraceError("search", new EngineError("TOO_LARGE", "body too large")).kind).toBe("too_large");
    expect(classifyTraceError("search", new EngineError("BAD_URL", "invalid url")).kind).toBe("url");
  });

  it("classifies HTTP, blocked and login pages", () => {
    expect(classifyTraceError("detail", new Error("failed"), { status: 503 }).kind).toBe("http");
    expect(classifyTraceError("search", new Error("ok"), { body: "Cloudflare captcha 验证码" }).kind).toBe("blocked");
    // Cloudflare 的 challenge-platform 脚本会出现在正常 404 页面里，不能据此判成拦截。
    expect(
      classifyTraceError("content", new Error("HTTP 404"), {
        status: 404,
        body: '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>',
      }).kind,
    ).toBe("http");
    expect(classifyTraceError("content", new Error("failed"), { status: 403, body: "Attention Required! | Cloudflare" }).kind).toBe("blocked");
    expect(classifyTraceError("content", new Error("ok"), { body: "请先登录后查看本章" }).kind).toBe("login");
  });

  it("classifies VIP and rule errors", () => {
    expect(classifyTraceError("content", new Error("本章为 VIP 付费章节")).kind).toBe("vip");
    expect(classifyTraceError("toc", new EngineError("RULE_ERROR", "selector invalid")).kind).toBe("rule_error");
    expect(classifyTraceError("content", new EngineError("JS_ERROR", "ReferenceError: result is not defined")).kind).toBe("js_error");
  });

  it("distinguishes empty selector and short content", () => {
    const empty = classifyTraceError("content", new Error("done"), { chars: 0 });
    expect(empty.kind).toBe("selector_empty");
    expect(empty.hint).toContain("选择器");
    const short = classifyTraceError("content", new Error("done"), { chars: 50 });
    expect(short.kind).toBe("empty_content");
    expect(short.hint).toContain("120");
  });

  it("falls back to unknown for unrecognized errors", () => {
    const result = classifyTraceError("search", new Error("something odd"));
    expect(result.kind).toBe("unknown");
    expect(result.message).toBe("something odd");
    expect(result.hint).toBeTruthy();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("redacts URLs in the full trace payload", async () => {
    const html = '<div class="book"><a href="/book/1?token=secret">书名</a><span>作者</span></div>';
    vi.stubGlobal("fetch", vi.fn(async () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })));
    const source: BookSource = {
      bookSourceName: "测试源",
      bookSourceUrl: "https://example.com/?token=secret",
      searchUrl: "https://example.com/search?token=secret&q={{key}}",
      ruleSearch: { bookList: "div.book", name: "a@text", author: "span@text", bookUrl: "a@href" },
    };
    const trace = await traceSource(source, { id: 1, name: "测试源", url: source.bookSourceUrl, group: "", status: "ok" }, { stage: "search", key: "x" });
    const search = trace.stages[0];
    expect(search.request?.url).toBe("https://example.com/search?token=redacted&q=x");
    expect(search.items?.[0]?.url).toBe("https://example.com/book/1?token=redacted");
    expect(trace.source.url).toBe("https://example.com/?token=redacted");
    const urlField = search.fields.find((field) => field.field === "ruleSearch.bookUrl");
    expect(urlField?.values[0]).toBe("/book/1?token=redacted");
    expect(JSON.stringify(trace)).not.toContain("secret");
  });
});
