import { describe, expect, it } from "vitest";
import { decodeEntitiesDeep, extractInlineImages, htmlToTextWithImages, splitInlineImages } from "@legado/engine";

function parse(html: string, baseUrl = "https://book.example.com/read/9.html") {
  const parsed = htmlToTextWithImages(html, baseUrl);
  return splitInlineImages(parsed.text, parsed.images);
}

describe("htmlToTextWithImages", () => {
  it("resolves relative image urls and keeps paragraph order", () => {
    const split = parse("<p>第一段</p><p>第二段</p><img src=\"/pic/1.jpg\"><p>第三段</p>");
    expect(split.text).toBe("第一段\n第二段\n第三段");
    expect(split.images).toEqual([{ src: "https://book.example.com/pic/1.jpg", after: 2 }]);
  });

  it("prefers lazy-load attributes over placeholder src", () => {
    const split = parse('<img src="/static/loading.gif" data-src="/real/2.png">');
    expect(split.images).toEqual([{ src: "https://book.example.com/real/2.png", after: 0 }]);
  });

  it("drops tracking pixels, spacer gifs and data urls", () => {
    const split = parse(
      [
        '<img src="https://cdn.example.com/1x1.gif" width="1" height="1">',
        '<img src="/img/spacer.png">',
        '<img src="data:image/gif;base64,R0lGOD">',
        '<img src="/img/real.webp">',
      ].join(""),
    );
    expect(split.images).toEqual([{ src: "https://book.example.com/img/real.webp", after: 0 }]);
  });

  it("keeps inline images inside a paragraph without splitting the text", () => {
    const split = parse('<p>前半<img src="/m/1.jpg">后半</p><p>下一段</p>');
    expect(split.text).toBe("前半后半\n下一段");
    expect(split.images).toEqual([{ src: "https://book.example.com/m/1.jpg", after: 1 }]);
  });

  it("places a chapter-opening image before any paragraph", () => {
    const split = parse('<img src="/m/cover.jpg"><p>正文</p>');
    expect(split.text).toBe("正文");
    expect(split.images).toEqual([{ src: "https://book.example.com/m/cover.jpg", after: 0 }]);
  });

  it("keeps several images in reading order", () => {
    const split = parse('<p>甲</p><img src="/m/a.jpg"><p>乙</p><img src="/m/b.jpg"><p>丙</p>');
    expect(split.text).toBe("甲\n乙\n丙");
    expect(split.images.map((image) => image.after)).toEqual([1, 2]);
  });
});

describe("extractInlineImages", () => {
  it("finds images after entity decoding, as the server does for old caches", () => {
    const decoded = decodeEntitiesDeep('&lt;img src=&quot;https://cdn.example.com/m/1.jpg&quot;&gt;&lt;/img&gt;\n正文');
    const split = extractInlineImages(decoded);
    expect(split.text).toBe("正文");
    expect(split.images).toEqual([{ src: "https://cdn.example.com/m/1.jpg", after: 0 }]);
  });
});

describe("splitInlineImages", () => {
  it("counts paragraphs, not characters, and drops the markers", () => {
    const split = splitInlineImages("甲\n\n乙\n\u0001IMG0\u0001\n丙\u0001IMG1\u0001", ["u0", "u1"]);
    expect(split.text).toBe("甲\n乙\n丙");
    expect(split.images).toEqual([
      { src: "u0", after: 2 },
      { src: "u1", after: 3 },
    ]);
  });

  it("ignores markers whose image was filtered out", () => {
    const split = splitInlineImages("甲\u0001IMG7\u0001", ["only"]);
    expect(split.text).toBe("甲");
    expect(split.images).toEqual([]);
  });

  it("keeps plain text untouched when there are no markers", () => {
    const split = splitInlineImages("甲\n乙", []);
    expect(split.text).toBe("甲\n乙");
    expect(split.images).toEqual([]);
  });
});

describe("extractInlineImages", () => {
  it("turns a literal img tag into a chapter-opening image", () => {
    const split = extractInlineImages('<img src="https://cdn.example.com/cover.jpg"></img>\n第一段\n第二段');
    expect(split.text).toBe("第一段\n第二段");
    expect(split.images).toEqual([{ src: "https://cdn.example.com/cover.jpg", after: 0 }]);
  });

  it("removes an inline img tag without splitting its paragraph", () => {
    const split = extractInlineImages('前半<img src="/m/1.jpg">后半\n下一段', "https://book.example.com/read/1.html");
    expect(split.text).toBe("前半后半\n下一段");
    expect(split.images).toEqual([{ src: "https://book.example.com/m/1.jpg", after: 1 }]);
  });

  it("supports lazy-load attributes and drops placeholders", () => {
    const split = extractInlineImages(
      '<img src="/static/loading.gif" data-src="/real/2.png"><img src="/img/spacer.png">正文',
      "https://book.example.com/read/1.html",
    );
    expect(split.text).toBe("正文");
    expect(split.images).toEqual([{ src: "https://book.example.com/real/2.png", after: 0 }]);
  });

  it("keeps several literal images in reading order", () => {
    const split = extractInlineImages('甲\n<img src="/m/a.jpg">\n乙\n<img src="/m/b.jpg">\n丙', "https://book.example.com/read/1.html");
    expect(split.text).toBe("甲\n乙\n丙");
    expect(split.images.map((image) => image.after)).toEqual([1, 2]);
  });

  it("removes a stray closing tag and leaves text untouched when no image survives", () => {
    const split = extractInlineImages('甲</img>\n乙');
    expect(split.text).toBe("甲\n乙");
    expect(split.images).toEqual([]);
  });
});
