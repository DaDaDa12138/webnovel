import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readEpub, resolvePath } from "../apps/server/src/services/books/epub";

function makeZip(files: Array<{ name: string; data: string | Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, "utf8");
    const body = deflateRawSync(raw);
    const name = Buffer.from(file.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, eocd]);
}

const container = `<?xml version="1.0"?>
<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

const opf = `<?xml version="1.0" encoding="utf-8"?>
<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>测试电子书</dc:title><dc:creator>某作者</dc:creator>
<dc:description>&lt;p&gt;一句话简介。&lt;/p&gt;&lt;p&gt;第二句。&lt;/p&gt;</dc:description></metadata>
<manifest>
<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="sub/ch2.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`;

const ch1 = `<html><head><title>测试电子书</title></head><body><h1>第一章 起点</h1><p>他推开窗。</p></body></html>`;
const ch2 = `<html><head><title>第二章 终点</title></head><body><p>故事结束。</p></body></html>`;

describe("readEpub", () => {
  const book = readEpub(
    makeZip([
      { name: "mimetype", data: "application/epub+zip" },
      { name: "META-INF/container.xml", data: container },
      { name: "OEBPS/content.opf", data: opf },
      { name: "OEBPS/ch1.xhtml", data: ch1 },
      { name: "OEBPS/sub/ch2.xhtml", data: ch2 },
    ]),
  );

  it("读出书名、作者与简介", () => {
    expect(book.title).toBe("测试电子书");
    expect(book.author).toBe("某作者");
    expect(book.intro).toBe("一句话简介。 第二句。");
  });

  it("按 spine 顺序出章，标题优先取 h1/h2，其次文档 title", () => {
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["第一章 起点", "第二章 终点"]);
    expect(book.chapters[0].text).toContain("他推开窗。");
    expect(book.chapters[1].text).toContain("故事结束。");
  });

  it("缺少 container.xml 时报错", () => {
    expect(() => readEpub(makeZip([{ name: "mimetype", data: "x" }]))).toThrow(/container.xml/);
  });
});

describe("resolvePath", () => {
  it("处理相对路径与 ../", () => {
    expect(resolvePath("OEBPS/", "ch1.xhtml")).toBe("OEBPS/ch1.xhtml");
    expect(resolvePath("OEBPS/", "../images/a.png")).toBe("images/a.png");
    expect(resolvePath("", "a/b.xhtml")).toBe("a/b.xhtml");
    expect(resolvePath("OEBPS/", "ch1.xhtml#top")).toBe("OEBPS/ch1.xhtml");
  });
});

describe("readEpub images", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const opfWithImages = `<?xml version="1.0" encoding="utf-8"?>
<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>有图的书</dc:title><dc:creator>画师</dc:creator></metadata>
<manifest>
<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
<item id="pic" href="images/pic.png" media-type="image/png"/>
<item id="cover" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
</manifest>
<spine><itemref idref="c1"/></spine></package>`;
  const chapter = `<html><head><title>插图章</title></head><body>
<p>他推开窗。</p><img src="images/pic.png" alt="窗外"/><p>后来。</p></body></html>`;
  const book = readEpub(
    makeZip([
      { name: "mimetype", data: "application/epub+zip" },
      { name: "META-INF/container.xml", data: container },
      { name: "OEBPS/content.opf", data: opfWithImages },
      { name: "OEBPS/ch1.xhtml", data: chapter },
      { name: "OEBPS/images/pic.png", data: png },
      { name: "OEBPS/images/cover.jpg", data: jpg },
    ]),
  );

  it("抽出插图字节并按内容哈希命名", () => {
    expect(book.assets.size).toBe(2);
    expect([...book.assets.values()]).toContainEqual(png);
    expect(book.chapters[0].images).toHaveLength(1);
    expect(book.chapters[0].images[0].src).toMatch(/^[0-9a-f]{16}\.png$/);
  });

  it("图片位置按第几段之后记录", () => {
    expect(book.chapters[0].text).toBe("他推开窗。\n后来。");
    expect(book.chapters[0].images[0].after).toBe(1);
  });

  it("读取 EPUB3 封面并写进 assets", () => {
    expect(book.cover).toMatch(/^[0-9a-f]{16}\.jpg$/);
    expect(book.assets.get(book.cover)).toEqual(jpg);
  });
});

describe("readEpub cover fallbacks", () => {
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const opfGuide = `<?xml version="1.0" encoding="utf-8"?>
<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>封面兜底</dc:title></metadata>
<manifest>
<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
<item id="coverpage" href="cover.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="c1"/></spine>
<guide><reference type="cover" href="cover.xhtml"/></guide></package>`;
  const coverPage = `<html><body><img src="images/cover.jpg" alt="封面"/></body></html>`;

  it("从 guide 指向的 cover.xhtml 里取第一张图", () => {
    const book = readEpub(
      makeZip([
        { name: "mimetype", data: "application/epub+zip" },
        { name: "META-INF/container.xml", data: container },
        { name: "OEBPS/content.opf", data: opfGuide },
        { name: "OEBPS/ch1.xhtml", data: ch1 },
        { name: "OEBPS/cover.xhtml", data: coverPage },
        { name: "OEBPS/images/cover.jpg", data: jpg },
      ]),
    );
    expect(book.cover).toMatch(/^[0-9a-f]{16}\.jpg$/);
    expect(book.assets.get(book.cover)).toEqual(jpg);
  });
});
