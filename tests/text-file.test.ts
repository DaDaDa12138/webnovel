import { describe, expect, it } from "vitest";
import { decodeTextFile, txtNameOf } from "../apps/web/src/lib/text-file";

const encoder = new TextEncoder();

describe("decodeTextFile", () => {
  it("UTF-8 原样解出", () => {
    expect(decodeTextFile(encoder.encode("第一章 初见"))).toBe("第一章 初见");
  });

  it("去掉 UTF-8 BOM", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode("正文")]);
    expect(decodeTextFile(bytes)).toBe("正文");
  });

  it("GBK 文件按 GBK 解出", () => {
    // 「中文」的 GBK 编码：D6 D0 CE C4
    const bytes = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);
    expect(decodeTextFile(bytes)).toBe("中文");
  });
});

describe("txtNameOf", () => {
  it("去掉扩展名并裁剪", () => {
    expect(txtNameOf("斗破苍穹.txt")).toBe("斗破苍穹");
    expect(txtNameOf(" 无扩展名 ")).toBe("无扩展名");
  });
});
