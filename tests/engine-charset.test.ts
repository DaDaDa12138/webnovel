import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { decodeResponse, normalizeCharset, sniffMetaCharset } from "../packages/engine/src/http";

const gbk = (text: string) => iconv.encode(text, "gb18030");
const utf8 = (text: string) => Buffer.from(text, "utf8");

describe("decodeResponse", () => {
  it("prefers <meta charset> over a lying content-type header", () => {
    // IIS 会无条件发 charset=UTF-8，正文其实是 GBK —— 只看响应头就会把整页解成乱码。
    const html = `<html><head><meta charset="gbk"><title>夜无疆最新章节列表</title></head><body>辰东</body></html>`;
    const decoded = decodeResponse(gbk(html), { headerCharset: "utf-8" });
    expect(decoded.charset).toBe("gb18030");
    expect(decoded.text).toContain("夜无疆最新章节列表");
  });

  it("falls back to gb18030 when a utf-8 declaration is not valid utf-8", () => {
    const html = `<html><body><h1>夜的命名术</h1></body></html>`;
    const decoded = decodeResponse(gbk(html), { headerCharset: "utf-8" });
    expect(decoded.text).toContain("夜的命名术");
  });

  it("keeps utf-8 bytes even when the header claims gbk", () => {
    const html = `<html><body><h1>夜的命名术</h1></body></html>`;
    const decoded = decodeResponse(utf8(html), { headerCharset: "gbk" });
    expect(decoded.charset).toBe("utf8");
    expect(decoded.text).toContain("夜的命名术");
  });

  it("honours an explicit rule charset", () => {
    const html = `<html><body><h1>夜的命名术</h1></body></html>`;
    const decoded = decodeResponse(gbk(html), { ruleCharset: "gbk", headerCharset: "utf-8" });
    expect(decoded.charset).toBe("gb18030");
    expect(decoded.text).toContain("夜的命名术");
  });

  it("strips a utf-8 BOM", () => {
    const decoded = decodeResponse(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8("夜无疆")]));
    expect(decoded.charset).toBe("utf8");
    expect(decoded.text).toBe("夜无疆");
  });

  it("leaves pure ascii alone", () => {
    const decoded = decodeResponse(Buffer.from('{"ok":true}'), { headerCharset: "gbk" });
    expect(decoded.text).toBe('{"ok":true}');
  });

  it("sniffs both meta forms", () => {
    expect(sniffMetaCharset(Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=gb2312">'))).toBe("gb2312");
    expect(sniffMetaCharset(Buffer.from("<meta charset='Big5'>"))).toBe("Big5");
    expect(sniffMetaCharset(Buffer.from("<html><body>no meta</body></html>"))).toBe(null);
  });

  it("normalises charset names and rejects unknown ones", () => {
    expect(normalizeCharset("GBK")).toBe("gb18030");
    expect(normalizeCharset('"utf-8"')).toBe("utf8");
    expect(normalizeCharset("not-a-charset")).toBe(null);
    expect(normalizeCharset("")).toBe(null);
  });
});
