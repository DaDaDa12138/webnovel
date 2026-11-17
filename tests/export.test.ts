import { describe, expect, it } from "vitest";
import {
  buildEpub,
  buildTxt,
  escapeXml,
  exportFilename,
  type ExportChapter,
} from "../apps/server/src/services/books/export";
import { readZipEntries, readZipText } from "../apps/server/src/services/books/zip";
import { readEpub } from "../apps/server/src/services/books/epub";

const book = { id: 7, name: "测试 书/名", author: "某作者", intro: "一句话简介。" };
const chapters: ExportChapter[] = [
  { idx: 0, title: "第1章 起点", content: "第一段。\n\n第二段 & <危险>。" },
  { idx: 3, title: "", content: "没有标题的一章。" },
];

describe("buildTxt", () => {
  it("writes a header, every chapter and a gap note", () => {
    const text = buildTxt(book, chapters, 10);
    expect(text.startsWith("《测试 书/名》\n作者：某作者\n\n")).toBe(true);
    expect(text).toContain("（全书 10 章，已导出 2 章；未缓存的章节已跳过）");
    expect(text).toContain("第1章 起点\n\n第一段。\n第二段 & <危险>。");
    expect(text).toContain("第 4 章\n\n没有标题的一章。");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("omits the gap note when every chapter is cached", () => {
    const text = buildTxt(book, chapters, 2);
    expect(text).not.toContain("未缓存");
  });
});

describe("exportFilename", () => {
  it("strips path characters and falls back to the book id", () => {
    expect(exportFilename("测试 书/名", "txt", 7)).toBe("测试 书 名.txt");
    expect(exportFilename("  ", "epub", 7)).toBe("book-7.epub");
    expect(exportFilename('a:b*c?d"e<f>g|h', "txt", 1)).toBe("a b c d e f g h.txt");
  });
});

describe("escapeXml", () => {
  it("escapes the five XML entities", () => {
    expect(escapeXml('&<>"\'')).toBe("&amp;&lt;&gt;&quot;&apos;");
  });
});

describe("buildEpub", () => {
  const epub = buildEpub(book, chapters, 10, new Date("2026-01-02T03:04:05Z"));
  const entries = readZipEntries(epub);

  it("puts a stored mimetype first", () => {
    expect(entries[0].name).toBe("mimetype");
    expect(entries[0].method).toBe(0);
    expect(readZipText(epub, entries[0])).toBe("application/epub+zip");
  });

  it("contains the container, package, nav and one file per chapter", () => {
    const names = entries.map((entry) => entry.name);
    expect(names).toContain("META-INF/container.xml");
    expect(names).toContain("OEBPS/content.opf");
    expect(names).toContain("OEBPS/nav.xhtml");
    expect(names).toContain("OEBPS/chapter-0.xhtml");
    expect(names).toContain("OEBPS/chapter-3.xhtml");
  });

  it("can be read back by the EPUB importer", () => {
    const parsed = readEpub(epub);
    expect(parsed.title).toBe("测试 书/名");
    expect(parsed.author).toBe("某作者");
    expect(parsed.intro).toBe("一句话简介。");
    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.chapters[0].title).toBe("第1章 起点");
    expect(parsed.chapters[0].text).toContain("第二段 & <危险>。");
  });

  it("writes metadata, spine and escaped chapter text", () => {
    const opf = readZipText(epub, entries.find((entry) => entry.name === "OEBPS/content.opf")!);
    expect(opf).toContain("<dc:title>测试 书/名</dc:title>");
    expect(opf).toContain("<dc:description>一句话简介。</dc:description>");
    expect(opf).toContain('<meta property="dcterms:modified">2026-01-02T03:04:05Z</meta>');
    expect(opf.match(/<itemref /g)).toHaveLength(2);
    const nav = readZipText(epub, entries.find((entry) => entry.name === "OEBPS/nav.xhtml")!);
    expect(nav).toContain('<a href="chapter-0.xhtml">第1章 起点</a>');
    const chapter = readZipText(epub, entries.find((entry) => entry.name === "OEBPS/chapter-0.xhtml")!);
    expect(chapter).toContain("<p>第二段 &amp; &lt;危险&gt;。</p>");
    expect(chapter).toContain("<h1>第1章 起点</h1>");
  });
});

describe("buildEpub with images", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const hash = "a".repeat(32);
  const file = "b".repeat(16) + ".png";
  const src = "/api/local-images/" + hash + "/" + file;
  const coverSrc = "/api/local-images/" + hash + "/" + "c".repeat(16) + ".jpg";
  const withImages: ExportChapter[] = [
    { idx: 0, title: "第1章 有图", content: "第一段。\n第二段。", images: [{ src, after: 1 }] },
  ];
  const epub = buildEpub(
    { id: 9, name: "插图书", author: "作者", cover: coverSrc },
    withImages,
    1,
    new Date("2026-02-03T04:05:06Z"),
    { assets: [{ src, name: file, data: png }], cover: { name: "cover-c.jpg", data: jpg } },
  );
  const entries = readZipEntries(epub);

  it("writes image and cover entries", () => {
    const names = entries.map((entry) => entry.name);
    expect(names).toContain("OEBPS/images/" + file);
    expect(names).toContain("OEBPS/cover-c.jpg");
  });

  it("declares the cover and image in the manifest", () => {
    const opf = readZipText(epub, entries.find((entry) => entry.name === "OEBPS/content.opf")!);
    expect(opf).toContain('<item id="cover-image" href="cover-c.jpg" media-type="image/jpeg" properties="cover-image" />');
    expect(opf).toContain('<meta name="cover" content="cover-image" />');
    expect(opf).toContain('href="images/' + file + '" media-type="image/png"');
  });

  it("puts the figure after the paragraph it belongs to", () => {
    const chapter = readZipText(epub, entries.find((entry) => entry.name === "OEBPS/chapter-0.xhtml")!);
    const first = chapter.indexOf("<p>第一段。</p>");
    const figure = chapter.indexOf('<figure><img src="images/' + file + '"');
    const second = chapter.indexOf("<p>第二段。</p>");
    expect(first).toBeGreaterThan(-1);
    expect(figure).toBeGreaterThan(first);
    expect(second).toBeGreaterThan(figure);
  });

  it("round-trips through the importer", () => {
    const parsed = readEpub(epub);
    expect(parsed.chapters[0].images).toHaveLength(1);
    expect(parsed.chapters[0].images[0].after).toBe(1);
    expect(parsed.chapters[0].text).toBe("第一段。\n第二段。");
    expect(parsed.cover).toMatch(/^[0-9a-f]{16}\.jpg$/);
    expect(parsed.assets.get(parsed.cover)).toEqual(jpg);
  });
});

