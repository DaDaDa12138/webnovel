import { describe, expect, it, vi } from "vitest";
import type { BookSourceEngine, BookSource } from "@legado/engine";
import { runSourceProbe } from "../apps/server/src/services/source-probe-core";

function engineWith(overrides: Partial<Record<"search" | "bookInfo" | "toc" | "contentWithImages", unknown>> = {}) {
  const engine = {
    search: vi.fn(async () => [{ name: "测试书", author: "作者", bookUrl: "/book/1", coverUrl: "", intro: "", kind: "", lastChapter: "", wordCount: "", origin: "", originName: "" }]),
    bookInfo: vi.fn(async () => ({ name: "测试书", author: "作者", bookUrl: "/book/1", coverUrl: "", intro: "", kind: "", lastChapter: "", wordCount: "", origin: "", originName: "", tocUrl: "/toc" })),
    toc: vi.fn(async () => [{ title: "第1章", url: "/chapter/1", isVip: false, isVolume: false }]),
    contentWithImages: vi.fn(async () => ({ text: "正文".repeat(100), images: [] })),
    ...overrides,
  };
  return engine as unknown as BookSourceEngine & typeof engine;
}

const source = { bookSourceUrl: "https://example.com", bookSourceName: "测试源" } as BookSource;
const at = () => "2026-01-01T00:00:00.000Z";

describe("runSourceProbe", () => {
  it("runs all four stages and records samples", async () => {
    const engine = engineWith();
    const result = await runSourceProbe(engine, source, { key: "测试", now: at });
    expect(result.stages.search?.status).toBe("ok");
    expect(result.stages.detail?.status).toBe("ok");
    expect(result.stages.toc?.status).toBe("ok");
    expect(result.stages.toc?.count).toBe(1);
    expect(result.stages.content?.status).toBe("ok");
    expect(result.stages.content?.chars).toBeGreaterThanOrEqual(120);
    expect(result.samples).toEqual({ bookUrl: "/book/1", tocUrl: "/toc", chapterUrl: "/chapter/1" });
  });

  it("marks an empty search and skips the rest", async () => {
    const engine = engineWith({ search: vi.fn(async () => []) });
    const result = await runSourceProbe(engine, source, { now: at });
    expect(result.stages.search).toMatchObject({ status: "empty", code: "no_results" });
    expect(result.stages.detail?.status).toBe("skip");
    expect(result.stages.toc?.status).toBe("skip");
    expect(result.stages.content?.status).toBe("skip");
    expect(engine.bookInfo).not.toHaveBeenCalled();
  });

  it("keeps the failure code when detail fails", async () => {
    const engine = engineWith({
      bookInfo: vi.fn(async () => {
        throw Object.assign(new Error("403 Forbidden"), { code: "http_403" });
      }),
    });
    const result = await runSourceProbe(engine, source, { now: at });
    expect(result.stages.detail).toMatchObject({ status: "fail", code: "http_403", message: "403 Forbidden" });
    expect(result.stages.toc?.status).toBe("skip");
    expect(result.stages.content?.status).toBe("skip");
  });

  it("treats a volume-only toc as empty and skips content", async () => {
    const engine = engineWith({ toc: vi.fn(async () => [{ title: "第一卷", url: "", isVip: false, isVolume: true }]) });
    const result = await runSourceProbe(engine, source, { now: at });
    expect(result.stages.toc).toMatchObject({ status: "empty", count: 0, code: "empty_toc" });
    expect(result.stages.content?.status).toBe("skip");
    expect(engine.contentWithImages).not.toHaveBeenCalled();
  });

  it("marks a short chapter as empty content", async () => {
    const engine = engineWith({ contentWithImages: vi.fn(async () => ({ text: "太短了", images: [] })) });
    const result = await runSourceProbe(engine, source, { now: at });
    expect(result.stages.content).toMatchObject({ status: "empty", code: "content_too_short" });
    expect(result.stages.content?.chars).toBeLessThan(120);
  });

  it("retries the next search result when the first toc is empty", async () => {
    const search = vi.fn(async () => [
      { name: "作者页", author: "", bookUrl: "/author/1", coverUrl: "", intro: "", kind: "", lastChapter: "", wordCount: "", origin: "", originName: "" },
      { name: "测试书", author: "作者", bookUrl: "/book/2", coverUrl: "", intro: "", kind: "", lastChapter: "", wordCount: "", origin: "", originName: "" },
    ]);
    const bookInfo = vi.fn(async (_source: BookSource, url: string) => ({
      name: "测试书", author: "作者", bookUrl: url, coverUrl: "", intro: "", kind: "", lastChapter: "", wordCount: "", origin: "", originName: "", tocUrl: url === "/author/1" ? "/author/toc" : "/book/2/toc",
    }));
    const toc = vi.fn(async (_source: BookSource, info: { tocUrl: string }) =>
      info.tocUrl === "/author/toc" ? [] : [{ title: "第1章", url: "/chapter/2", isVip: false, isVolume: false }],
    );
    const engine = engineWith({ search, bookInfo, toc });
    const result = await runSourceProbe(engine, source, { key: "测试", now: at });
    expect(search).toHaveBeenCalledWith(source, "测试", 1);
    expect(engine.bookInfo).toHaveBeenCalledTimes(2);
    expect(result.samples.bookUrl).toBe("/book/2");
    expect(result.stages.detail?.status).toBe("ok");
    expect(result.stages.toc).toMatchObject({ status: "ok", count: 1 });
    expect(result.stages.content?.status).toBe("ok");
  });

  it("tries up to three search results by default", async () => {
    const book = (url: string) => ({ name: url, author: "", bookUrl: url, coverUrl: "", intro: "", kind: "", lastChapter: "", wordCount: "", origin: "", originName: "" });
    const search = vi.fn(async () => ["/a/1", "/a/2", "/book/3"].map(book));
    const bookInfo = vi.fn(async (_source: BookSource, url: string) => ({
      name: "测试书", author: "作者", bookUrl: url, coverUrl: "", intro: "", kind: "", lastChapter: "", wordCount: "", origin: "", originName: "", tocUrl: `${url}/toc`,
    }));
    const toc = vi.fn(async (_source: BookSource, info: { tocUrl: string }) =>
      info.tocUrl === "/book/3/toc" ? [{ title: "第1章", url: "/chapter/3", isVip: false, isVolume: false }] : [],
    );
    const engine = engineWith({ search, bookInfo, toc });
    const result = await runSourceProbe(engine, source, { key: "测试", now: at });
    expect(engine.bookInfo).toHaveBeenCalledTimes(3);
    expect(result.samples.bookUrl).toBe("/book/3");
    expect(result.stages.toc).toMatchObject({ status: "ok", count: 1 });
  });

  it("retries the next search result when the first detail fails", async () => {
    const search = vi.fn(async () => [
      { name: "坏页", author: "", bookUrl: "/bad/1", coverUrl: "", intro: "", kind: "", lastChapter: "", wordCount: "", origin: "", originName: "" },
      { name: "测试书", author: "作者", bookUrl: "/book/2", coverUrl: "", intro: "", kind: "", lastChapter: "", wordCount: "", origin: "", originName: "" },
    ]);
    const bookInfo = vi.fn(async (_source: BookSource, url: string) => {
      if (url === "/bad/1") throw new Error("403 Forbidden");
      return { name: "测试书", author: "作者", bookUrl: url, coverUrl: "", intro: "", kind: "", lastChapter: "", wordCount: "", origin: "", originName: "", tocUrl: "/book/2/toc" };
    });
    const engine = engineWith({ search, bookInfo });
    const result = await runSourceProbe(engine, source, { key: "测试", now: at });
    expect(engine.bookInfo).toHaveBeenCalledTimes(2);
    expect(result.samples.bookUrl).toBe("/book/2");
    expect(result.stages.detail?.status).toBe("ok");
    expect(result.stages.toc?.status).toBe("ok");
  });

  it("starts from a known book without searching", async () => {
    const engine = engineWith();
    const result = await runSourceProbe(engine, source, { bookUrl: "/book/9", now: at });
    expect(engine.search).not.toHaveBeenCalled();
    expect(engine.bookInfo).toHaveBeenCalledWith(source, "/book/9");
    expect(result.stages.search).toBeUndefined();
    expect(result.stages.detail?.status).toBe("ok");
  });

  it("probes only the requested stage", async () => {
    const engine = engineWith();
    const result = await runSourceProbe(engine, source, { stages: ["search"], now: at });
    expect(Object.keys(result.stages)).toEqual(["search"]);
    expect(engine.bookInfo).not.toHaveBeenCalled();
  });

  it("uses an explicit chapter url for the content stage", async () => {
    const engine = engineWith();
    const result = await runSourceProbe(engine, source, { stages: ["content"], chapterUrl: "/chapter/9", now: at });
    expect(result.stages.content?.status).toBe("ok");
    expect(result.samples.chapterUrl).toBe("/chapter/9");
    expect(engine.contentWithImages).toHaveBeenCalledWith(source, expect.objectContaining({ url: "/chapter/9" }));
  });
});
