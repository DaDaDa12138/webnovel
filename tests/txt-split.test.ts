import { describe, expect, it } from "vitest";
import { isHeading, splitTxtChapters } from "../apps/server/src/services/books/txt-split";

describe("isHeading", () => {
  it("认得常见的章节标题", () => {
    expect(isHeading("第一章 初见")).toBe(true);
    expect(isHeading("第12章 原来是你")).toBe(true);
    expect(isHeading("  第一百零八回 大结局  ")).toBe(true);
    expect(isHeading("第三卷")).toBe(true);
    expect(isHeading("楔子")).toBe(true);
    expect(isHeading("番外 后来的事")).toBe(true);
  });

  it("不把正文里的句子当标题", () => {
    expect(isHeading("第三回合结束后，他走了。")).toBe(false);
    expect(isHeading("他说：第一章节的重点在这里，你要记住。")).toBe(false);
    expect(isHeading("第一章节的内容很长" + "，".repeat(40))).toBe(false);
    expect(isHeading("")).toBe(false);
  });

  it("没有分隔符时只接受很短的标题", () => {
    expect(isHeading("第3章初见")).toBe(true);
    expect(isHeading("第3章初见的时候，天还没亮，街上的灯都灭着")).toBe(false);
  });
});

describe("splitTxtChapters", () => {
  it("按标题切章，标题行不进正文", () => {
    const raw = [
      "第一章 初见",
      "第一段正文。",
      "第二段正文。",
      "",
      "第二章 再见",
      "又一段。",
    ].join("\n");
    const sections = splitTxtChapters(raw);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ title: "第一章 初见" });
    expect(sections[0].text).toBe("第一段正文。\n第二段正文。");
    expect(sections[1].title).toBe("第二章 再见");
  });

  it("标题前的文字单独成章", () => {
    const sections = splitTxtChapters("这是简介。\n\n第一章 开始\n正文。");
    expect(sections.map((item) => item.title)).toEqual(["开始", "第一章 开始"]);
  });

  it("CRLF 与 BOM 都能处理", () => {
    const sections = splitTxtChapters("\uFEFF第一章 甲\r\n甲正文。\r\n第二章 乙\r\n乙正文。");
    expect(sections.map((item) => item.title)).toEqual(["第一章 甲", "第二章 乙"]);
  });

  it("没有章节标题时按长度切块", () => {
    const paragraph = "这是一个很长的段落。".repeat(30);
    const sections = splitTxtChapters(Array.from({ length: 12 }, () => paragraph).join("\n"), 1000);
    expect(sections.length).toBeGreaterThan(1);
    expect(sections[0].title).toBe("第 1 节");
    expect(sections.every((item) => item.text.length > 0)).toBe(true);
  });

  it("空文本返回空数组", () => {
    expect(splitTxtChapters("   \n\n  ")).toEqual([]);
  });
});
