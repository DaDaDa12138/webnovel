import { describe, expect, it } from "vitest";
import { buildStarts } from "../apps/web/src/lib/reader-progress";
import {
  blockIndexAt,
  blockIndexForPara,
  buildDisplayBlocks,
  DEFAULT_PARAGRAPH_OPTIONS,
  normalizeParagraphOptions,
  partsForRange,
} from "../apps/web/src/lib/reader-blocks";

function make(paragraphs: string[], title = "") {
  const starts = buildStarts(paragraphs);
  return { paragraphs, starts, title };
}

describe("reader display blocks", () => {
  it("keeps one block per paragraph when smart mode is off", () => {
    const { paragraphs, starts } = make(["第一段", "第二段文字"]);
    const blocks = buildDisplayBlocks(paragraphs, starts, "", { ...DEFAULT_PARAGRAPH_OPTIONS, mode: "off" });
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ start: 0, end: 3, text: "第一段", cont: false });
    expect(blocks[1]).toMatchObject({ start: 4, end: 9, text: "第二段文字", cont: false });
    expect(blocks[0].parts[0]).toMatchObject({ para: 0, start: 0, end: 3 });
  });

  it("merges a hard-wrapped sentence without inserting a space", () => {
    const a = "他抬起头看向远处那片被雨水打湿的街道尽头";
    const b = "和街道尽头摇晃的灯火。";
    const { paragraphs, starts } = make([a, b]);
    const blocks = buildDisplayBlocks(paragraphs, starts);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe(a + b);
    expect(blocks[0].parts).toHaveLength(2);
    expect(blocks[0].start).toBe(0);
    expect(blocks[0].end).toBe(starts[1] + b.length);
  });

  it("does not merge a line that starts a new dialogue", () => {
    const a = "他抬起头看向远处那片被雨水打湿的街道尽头";
    const b = "“你来了。”";
    const { paragraphs, starts } = make([a, b]);
    const blocks = buildDisplayBlocks(paragraphs, starts);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks[0].text).toBe(a);
  });

  it("splits long paragraphs into readable blocks while keeping absolute offsets", () => {
    const sentence = "他沿着长街慢慢往前走，雨水从屋檐落下来，打湿了鞋面和裤脚。";
    const text = sentence.repeat(8);
    const { paragraphs, starts } = make([text]);
    const blocks = buildDisplayBlocks(paragraphs, starts);
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) {
      expect(block.text.length).toBeLessThanOrEqual(275);
      expect(text.slice(block.start, block.end)).toBe(block.text);
      for (const part of block.parts) {
        expect(text.slice(part.start, part.end)).toBe(part.text);
      }
    }
  });

  it("keeps dialogue and narration in separate blocks", () => {
    const { paragraphs, starts } = make(["“你来了。”他说。", "她点点头。"]);
    const blocks = buildDisplayBlocks(paragraphs, starts);
    expect(blocks.map((b) => b.text)).toEqual(["“你来了。”", "他说。", "她点点头。"]);
    expect(blocks[0].kind).toBe("dialog");
    expect(blocks[1].kind).toBe("text");
  });

  it("hides a duplicated chapter title without dropping its offset", () => {
    const { paragraphs, starts } = make(["第一章 风起", "风从山口吹来。"], "第一章 风起");
    const blocks = buildDisplayBlocks(paragraphs, starts, "第一章 风起");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("风从山口吹来。");
    expect(blocks[0].start).toBe(starts[1]);
  });

  it("maps offsets and paragraphs to blocks", () => {
    const { paragraphs, starts } = make(["第一段", "第二段文字", "第三段"]);
    const blocks = buildDisplayBlocks(paragraphs, starts, "", { ...DEFAULT_PARAGRAPH_OPTIONS, mode: "off" });
    expect(blockIndexAt(blocks, 0)).toBe(0);
    expect(blockIndexAt(blocks, 3)).toBe(0);
    expect(blockIndexAt(blocks, 4)).toBe(1);
    expect(blockIndexAt(blocks, 8)).toBe(1);
    expect(blockIndexAt(blocks, 10)).toBe(2);
    expect(blockIndexForPara(blocks, 1, starts)).toBe(1);
  });

  it("returns parts intersecting a range", () => {
    const a = "他抬起头看向远处那片被雨水打湿的街道尽头";
    const b = "和街道尽头摇晃的灯火。";
    const { paragraphs, starts } = make([a, b]);
    const blocks = buildDisplayBlocks(paragraphs, starts);
    const parts = partsForRange(blocks, 2, starts[1] + 4);
    expect(parts[0].start).toBe(2);
    expect(parts[parts.length - 1].end).toBe(starts[1] + 4);
  });

  it("normalizes paragraph options", () => {
    expect(normalizeParagraphOptions({ mode: "off", splitLength: 9999, mergeWrapped: false })).toMatchObject({
      mode: "off",
      splitLength: 400,
      mergeWrapped: false,
      splitLong: true,
      special: true,
    });
    expect(normalizeParagraphOptions({ special: false }).special).toBe(false);
    expect(normalizeParagraphOptions(null)).toEqual(DEFAULT_PARAGRAPH_OPTIONS);
  });

  it("recognizes dividers, system messages, SMS and letters without changing offsets", () => {
    const paragraphs = [
      "前文到此为止。",
      "***",
      "【系统提示】好感度 +1",
      "短信：今晚八点老地方见",
      "[张三] 到楼下了",
      "亲爱的阿明：",
      "见字如面。",
      "此致",
      "敬礼",
      "后记。",
    ];
    const { starts } = make(paragraphs);
    const blocks = buildDisplayBlocks(paragraphs, starts);
    const kinds = blocks.map((block) => block.kind);
    expect(kinds).toContain("divider");
    expect(kinds).toContain("system");
    expect(kinds.filter((kind) => kind === "sms")).toHaveLength(2);
    expect(kinds.filter((kind) => kind === "letter").length).toBeGreaterThanOrEqual(4);
    for (const block of blocks) {
      expect(paragraphs.join("\n").slice(block.start, block.end)).toBe(block.text);
    }
  });

  it("keeps consecutive poem lines as poem blocks and disables special detection when asked", () => {
    const paragraphs = ["两个黄鹂鸣翠柳", "一行白鹭上青天", "窗含西岭千秋雪", "门泊东吴万里船"];
    const { starts } = make(paragraphs);
    const blocks = buildDisplayBlocks(paragraphs, starts);
    expect(blocks.every((block) => block.kind === "poem")).toBe(true);
    const plain = buildDisplayBlocks(paragraphs, starts, "", { ...DEFAULT_PARAGRAPH_OPTIONS, special: false });
    expect(plain.every((block) => block.kind === "text")).toBe(true);
  });

  it("does not mistake short prose lines for a poem", () => {
    const paragraphs = ["不是哥们，你在说什么", "你打扫排练室干嘛", "这不是保洁干的事情吗", "你时间不值钱吗"];
    const { starts } = make(paragraphs);
    const blocks = buildDisplayBlocks(paragraphs, starts);
    expect(blocks.every((block) => block.kind !== "poem")).toBe(true);
  });

  it("does not treat author tags in square brackets as SMS", () => {
    const paragraphs = ["[bl同人] 《（诡秘之主同人）收藏家》作者：瑟清洛春君【完结】", "正文开始。"];
    const { starts } = make(paragraphs);
    const blocks = buildDisplayBlocks(paragraphs, starts);
    expect(blocks.every((block) => block.kind !== "sms")).toBe(true);
  });

  it("recognizes decorative dividers such as ￥￥￥", () => {
    const paragraphs = ["前文。", "￥￥￥￥", "后文。"];
    const { starts } = make(paragraphs);
    const blocks = buildDisplayBlocks(paragraphs, starts);
    expect(blocks[1].kind).toBe("divider");
  });

  it("does not merge a special block into surrounding prose", () => {
    const paragraphs = ["他抬起头看向远处那片被雨水打湿的街道尽头", "***", "和街道尽头摇晃的灯火。"];
    const { starts } = make(paragraphs);
    const blocks = buildDisplayBlocks(paragraphs, starts);
    expect(blocks.map((block) => block.kind)).toEqual(["text", "divider", "text"]);
    expect(blocks[0].text).toBe(paragraphs[0]);
  });

  it("marks author notes at the head and tail but not in the middle", () => {
    const long = "他沿着长街慢慢往前走，雨水从屋檐落下来，打湿了鞋面和裤脚。";
    const head = ["作者的话：今天两更，求月票。", long];
    const headBlocks = buildDisplayBlocks(head, buildStarts(head));
    expect(headBlocks[0].kind).toBe("note");

    const tail = [long, long, "PS：明天请假一天。"];
    const tailBlocks = buildDisplayBlocks(tail, buildStarts(tail));
    expect(tailBlocks[tailBlocks.length - 1].kind).toBe("note");

    const middle = [long, long, "作者的话：今天两更。", long, long, long, "结尾。"];
    const middleBlocks = buildDisplayBlocks(middle, buildStarts(middle));
    expect(middleBlocks.every((block) => block.kind !== "note")).toBe(true);

    const off = buildDisplayBlocks(head, buildStarts(head), "", { ...DEFAULT_PARAGRAPH_OPTIONS, authorNote: false });
    expect(off.every((block) => block.kind !== "note")).toBe(true);

    // 关掉诗歌/书信等特殊样式，不该连带把作者话也关掉。
    const noSpecial = buildDisplayBlocks(head, buildStarts(head), "", { ...DEFAULT_PARAGRAPH_OPTIONS, special: false });
    expect(noSpecial[0].kind).toBe("note");
  });

  it("recognizes a short subhead between long paragraphs", () => {
    const long = "他推开院门，看见院子里那棵老槐树还在，树下落了一层薄薄的雪，脚印一直延伸到廊下。";
    const paragraphs = [long, "三个月后", long];
    const blocks = buildDisplayBlocks(paragraphs, buildStarts(paragraphs));
    expect(blocks[1].kind).toBe("subhead");

    const off = buildDisplayBlocks(paragraphs, buildStarts(paragraphs), "", { ...DEFAULT_PARAGRAPH_OPTIONS, subhead: false });
    expect(off.every((block) => block.kind !== "subhead")).toBe(true);

    const narrative = [long, "他来了", long];
    const narrativeBlocks = buildDisplayBlocks(narrative, buildStarts(narrative));
    expect(narrativeBlocks.every((block) => block.kind !== "subhead")).toBe(true);
  });

  it("lets a manual fix win over automatic classification", () => {
    const long = "他推开院门，看见院子里那棵老槐树还在，树下落了一层薄薄的雪，脚印一直延伸到廊下。";
    const paragraphs = ["作者的话：今天两更，求月票。", long, "三个月后", long];
    const starts = buildStarts(paragraphs);
    const auto = buildDisplayBlocks(paragraphs, starts);
    expect(auto[0].kind).toBe("note");
    expect(auto[2].kind).toBe("subhead");

    const fixed = buildDisplayBlocks(paragraphs, starts, "", DEFAULT_PARAGRAPH_OPTIONS, undefined, {
      0: "text",
      2: "note",
    });
    expect(fixed[0].kind).toBe("text");
    expect(fixed[2].kind).toBe("note");
    // 覆盖只改类型，不改原文和坐标。
    expect(fixed[0].start).toBe(0);
    expect(fixed[2].text).toBe("三个月后");
  });
});
