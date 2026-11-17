import { describe, expect, it } from "vitest";
import {
  buildOpdsRoot,
  buildOpdsSearchDescription,
  buildOpdsShelf,
  coverHref,
  escapeXml,
  filterOpdsBooks,
  imageMime,
  isoDate,
  normalizeOpdsSearch,
  type OpdsBook,
} from "../apps/server/src/services/opds";

const now = new Date("2026-11-03T03:00:00Z");

function book(overrides: Partial<OpdsBook> = {}): OpdsBook {
  return {
    id: 7,
    name: "书 & <测试>",
    author: "作者",
    intro: "简介",
    coverUrl: "https://img.example.com/cover.png?x=1&y=2",
    sourceId: 3,
    updatedAt: "2026-11-02 10:20:30",
    chapterCount: 10,
    cachedChapters: 4,
    ...overrides,
  };
}

describe("opds feed", () => {
  it("escapes XML text and strips control characters", () => {
    expect(escapeXml('a & <b> "c" \'d\'')).toBe("a &amp; &lt;b&gt; &quot;c&quot; &apos;d&apos;");
    expect(escapeXml("bad\u0001char")).toBe("badchar");
  });

  it("builds a navigation root with a shelf subsection", () => {
    const xml = buildOpdsRoot("http://127.0.0.1:18080/", 12, now);
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom"');
    expect(xml).toContain("<title>legado-web</title>");
    expect(xml).toContain('<link rel="self" href="http://127.0.0.1:18080/opds"');
    expect(xml).toContain('<link rel="subsection" href="http://127.0.0.1:18080/opds/shelf"');
    expect(xml).toContain('<link rel="search" href="http://127.0.0.1:18080/opds/search.xml"');
    expect(xml).toContain("共 12 本书");
    expect(xml).toContain('kind=navigation"');
  });

  it("builds an acquisition feed with paging, cover proxy and download link", () => {
    const xml = buildOpdsShelf(
      { books: [book()], total: 3, page: 1, size: 2 },
      "http://127.0.0.1:18080",
      now,
    );
    expect(xml).toContain("<title>书 &amp; &lt;测试&gt;</title>");
    expect(xml).toContain("<author><name>作者</name></author>");
    expect(xml).toContain("http://127.0.0.1:18080/api/img?u=https%3A%2F%2Fimg.example.com%2Fcover.png%3Fx%3D1%26y%3D2&amp;s=3");
    expect(xml).toContain('rel="http://opds-spec.org/acquisition/open-access"');
    expect(xml).toContain("http://127.0.0.1:18080/opds/books/7/epub");
    expect(xml).toContain('<link rel="next" href="http://127.0.0.1:18080/opds/shelf?page=2&amp;size=2"');
    expect(xml).not.toContain('rel="previous"');
    expect(xml).toContain("<opensearch:totalResults>3</opensearch:totalResults>");
  });

  it("adds a previous link and omits acquisition for uncached books", () => {
    const xml = buildOpdsShelf(
      { books: [book({ cachedChapters: 0 })], total: 3, page: 2, size: 2 },
      "http://127.0.0.1:18080",
      now,
    );
    expect(xml).toContain('rel="previous" href="http://127.0.0.1:18080/opds/shelf?page=1&amp;size=2"');
    expect(xml).not.toContain('rel="next"');
    expect(xml).not.toContain("acquisition/open-access");
    expect(xml).toContain("尚未缓存正文");
  });

  it("wraps remote covers and leaves local covers alone", () => {
    expect(coverHref({ coverUrl: "/api/local-images/abc/1.png", sourceId: 0 }, "http://x")).toBe(
      "http://x/api/local-images/abc/1.png",
    );
    expect(coverHref({ coverUrl: "", sourceId: 0 }, "http://x")).toBe("");
    expect(imageMime("https://a/b.webp")).toBe("image/webp");
    expect(imageMime("/api/img?u=https%3A%2F%2Fa%2Fb.png")).toBe("image/png");
    expect(imageMime("https://a/b")).toBe("image/jpeg");
  });

  it("normalizes sqlite timestamps and invalid dates", () => {
    expect(isoDate("2026-11-02 10:20:30", now)).toBe("2026-11-02T10:20:30.000Z");
    expect(isoDate("2026-11-02T10:20:30Z", now)).toBe("2026-11-02T10:20:30.000Z");
    expect(isoDate("", now)).toBe(now.toISOString());
    expect(isoDate("not-a-date", now)).toBe(now.toISOString());
  });

  it("normalizes search terms and matches title or author", () => {
    expect(normalizeOpdsSearch("  诡秘   之主 ")).toBe("诡秘 之主");
    expect(normalizeOpdsSearch("x".repeat(80))).toHaveLength(60);
    const books = [
      book({ id: 1, name: "Alpha", author: "Ann" }),
      book({ id: 2, name: "Beta", author: "Bob" }),
    ];
    expect(filterOpdsBooks(books, "ALP").map((item) => item.id)).toEqual([1]);
    expect(filterOpdsBooks(books, "bob").map((item) => item.id)).toEqual([2]);
    expect(filterOpdsBooks(books, "  ")).toHaveLength(2);
  });

  it("keeps the search term in the feed and paging links", () => {
    const xml = buildOpdsShelf(
      { books: [book({ name: "Alpha" })], total: 3, page: 1, size: 2, search: "Alpha & Co" },
      "http://127.0.0.1:18080",
      now,
    );
    expect(xml).toContain("<title>搜索：Alpha &amp; Co</title>");
    expect(xml).toContain('<opensearch:Query role="request" searchTerms="Alpha &amp; Co" startPage="1"/>');
    expect(xml).toContain("page=2&amp;size=2&amp;search=Alpha%20%26%20Co");
    expect(xml).not.toContain("<title>legado-web 书架</title>");
  });

  it("describes the OpenSearch endpoint", () => {
    const xml = buildOpdsSearchDescription("http://127.0.0.1:18080/");
    expect(xml).toContain("<OpenSearchDescription");
    expect(xml).toContain("<ShortName>legado-web</ShortName>");
    expect(xml).toContain("search={searchTerms}");
    expect(xml).toContain("&amp;page={startPage?}&amp;size={count?}");
    expect(xml).toContain('type="application/atom+xml;profile=opds-catalog;kind=acquisition"');
  });
});
