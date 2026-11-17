import { describe, expect, it } from "vitest";
import { auditSource } from "../apps/server/src/services/source-audit.js";

function source(overrides: Record<string, unknown> = {}) {
  return {
    bookSourceName: "测试源",
    bookSourceUrl: "https://example.com",
    searchUrl: "https://example.com/search?q={{key}}",
    ruleSearch: { bookList: ".list@li", name: "a@text", author: ".author@text", bookUrl: "a@href" },
    ruleToc: { chapterList: ".chapters@a", chapterName: "text", chapterUrl: "href" },
    ruleContent: { content: "#content@html" },
    ...overrides,
  } as never;
}

describe("source static audit", () => {
  it("passes a complete source", () => {
    const report = auditSource(source());
    expect(report.ok).toBe(true);
    expect(report.errors).toBe(0);
  });

  it("flags an empty content rule", () => {
    const report = auditSource(source({ ruleContent: { content: "" } }));
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.code === "empty_rule" && issue.field === "ruleContent.content")).toBe(true);
  });

  it("flags missing search fields", () => {
    const report = auditSource(source({ ruleSearch: { bookList: ".list@li" } }));
    expect(report.issues.some((issue) => issue.field === "ruleSearch.name")).toBe(true);
    expect(report.issues.some((issue) => issue.field === "ruleSearch.bookUrl")).toBe(true);
  });

  it("flags a source with neither search nor explore", () => {
    const report = auditSource(source({ searchUrl: "", exploreUrl: "" }));
    expect(report.issues.some((issue) => issue.code === "missing_search_and_explore")).toBe(true);
  });

  it("catches an invalid @regex selector", () => {
    const report = auditSource(source({ ruleSearch: { bookList: ".list@li", name: "a@text@regex:[", bookUrl: "a@href" } }));
    expect(report.errors).toBeGreaterThan(0);
    expect(report.issues.some((issue) => issue.code === "regex_syntax")).toBe(true);
  });

  it("accepts a valid @regex selector", () => {
    const report = auditSource(source({ ruleSearch: { bookList: ".list@li", name: "a@text@regex:第(\\d+)章", bookUrl: "a@href" } }));
    expect(report.ok).toBe(true);
  });

  it("catches JS syntax errors", () => {
    const report = auditSource(source({ ruleToc: { chapterList: ".chapters@a", chapterName: "<js>if (</js>", chapterUrl: "href" } }));
    expect(report.errors).toBeGreaterThan(0);
    expect(report.issues.some((issue) => issue.code === "js_syntax")).toBe(true);
  });

  it("accepts valid JS snippets", () => {
    const report = auditSource(source({ ruleToc: { chapterList: ".chapters@a", chapterName: "<js>result.text()</js>", chapterUrl: "href" } }));
    expect(report.ok).toBe(true);
  });

  it("warns about a suspicious nextContentUrl self reference", () => {
    const report = auditSource(source({ ruleContent: { content: "#content@html", nextContentUrl: "{{baseUrl}}/chapter?book={{chapterUrl}}" } }));
    expect(report.warnings).toBeGreaterThan(0);
    expect(report.issues.some((issue) => issue.code === "next_content_loop_risk")).toBe(true);
  });

  it("accepts nextContentUrl with a page counter", () => {
    const report = auditSource(source({ ruleContent: { content: "#content@html", nextContentUrl: "{{baseUrl}}/chapter?page={{page}}" } }));
    expect(report.issues.some((issue) => issue.code === "next_content_loop_risk")).toBe(false);
  });

  it("flags an invalid bookUrlPattern", () => {
    const report = auditSource(source({ bookUrlPattern: "[", searchUrl: "https://example.com/search?q={{key}}" }));
    expect(report.issues.some((issue) => issue.code === "book_url_pattern")).toBe(true);
  });

  it("accepts explore pages that fall back to ruleSearch", () => {
    const report = auditSource(source({ exploreUrl: "https://example.com/category?page={{page}}" }));
    expect(report.issues.some((issue) => issue.stage === "explore")).toBe(false);
  });

  it("uses non-empty ruleExplore fields to override search fallback", () => {
    const report = auditSource(
      source({
        exploreUrl: "https://example.com/category?page={{page}}",
        ruleExplore: { name: ".category-name@text" },
      }),
    );
    expect(report.issues.some((issue) => issue.field === "ruleExplore.name")).toBe(false);
  });

  it("still flags explore pages with no usable list rule", () => {
    const report = auditSource(
      source({
        searchUrl: "",
        ruleSearch: {},
        exploreUrl: "https://example.com/category?page={{page}}",
      }),
    );
    expect(report.issues.some((issue) => issue.code === "empty_rule" && issue.field === "ruleExplore.bookList")).toBe(true);
  });

  it("skips built-in aggregate sources", () => {
    const report = auditSource(
      source({
        bookSourceUrl: "shushan://aggregate",
        searchUrl: "",
        exploreUrl: "",
        ruleSearch: {},
        ruleToc: {},
        ruleContent: {},
      }),
    );
    expect(report.ok).toBe(true);
    expect(report.issues.some((issue) => issue.code === "builtin_source" && issue.severity === "info")).toBe(true);
  });

  it("treats missing toc chapterName/chapterUrl as warnings", () => {
    const report = auditSource(
      source({
        ruleToc: { chapterList: ".chapters@a", chapterName: "", chapterUrl: "" },
      }),
    );
    expect(report.errors).toBe(0);
    expect(report.warnings).toBeGreaterThan(0);
    expect(report.issues.some((issue) => issue.code === "empty_rule" && issue.field === "ruleToc.chapterUrl" && issue.severity === "warning")).toBe(true);
  });

  it("checks multi-line @js without truncating it", () => {
    const report = auditSource(
      source({
        ruleToc: {
          chapterList: ".chapters@a",
          chapterName: "text",
          chapterUrl: "@js:\nif (true) {\n  const x = await Promise.resolve(1);\n  return String(x);\n}",
        },
      }),
    );
    expect(report.issues.some((issue) => issue.code === "js_syntax")).toBe(false);
  });

  it("accepts Legado templates inside @js", () => {
    const report = auditSource(
      source({
        ruleToc: {
          chapterList: ".chapters@a",
          chapterName: "text",
          chapterUrl: "@js:const id = {{$.id}}; return String(id);",
        },
      }),
    );
    expect(report.issues.some((issue) => issue.code === "js_syntax")).toBe(false);
  });

  it("stops @js at a trailing Legado ## replacement rule", () => {
    const report = auditSource(
      source({
        ruleToc: {
          chapterList: ".chapters@a",
          chapterName: "text",
          chapterUrl: "@js:result.replace(/x/g, 'y')\n##(章)([^\\s]+)##$1 $2",
        },
      }),
    );
    expect(report.issues.some((issue) => issue.code === "js_syntax")).toBe(false);
  });

  it("does not confuse a ## inside JS regex with a replacement rule", () => {
    const report = auditSource(
      source({
        ruleToc: {
          chapterList: ".chapters@a",
          chapterName: "text",
          chapterUrl: "@js:if (baseUrl.match(/##/)) { result = 'x'; }",
        },
      }),
    );
    expect(report.issues.some((issue) => issue.code === "js_syntax")).toBe(false);
  });

  it("ignores replacement-only <js> blocks", () => {
    const report = auditSource(
      source({
        ruleToc: {
          chapterList: ".chapters@a",
          chapterName: "text",
          chapterUrl: "href\n<js>##第.*章##$1</js>",
        },
      }),
    );
    expect(report.issues.some((issue) => issue.code === "js_syntax")).toBe(false);
  });

  it("does not require a text content rule for audio sources", () => {
    const report = auditSource(
      source({
        bookSourceType: 1,
        ruleContent: { content: "" },
      }),
    );
    expect(report.ok).toBe(true);
    expect(report.issues.some((issue) => issue.code === "non_text_source" && issue.severity === "info")).toBe(true);
  });
});
