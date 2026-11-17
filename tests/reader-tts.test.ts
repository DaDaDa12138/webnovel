import { describe, expect, it } from "vitest";
import { clampTtsRate, resolveTtsEngine, splitSentences, splitSpeechChunks } from "../apps/web/src/lib/reader-tts";

describe("splitSentences", () => {
  it("按中文句末标点断句，并记录段内起点", () => {
    const chunks = splitSentences("第一句话。第二句话！");
    expect(chunks.map((chunk) => chunk.text)).toEqual(["第一句话。", "第二句话！"]);
    expect(chunks[1].start).toBe(5);
  });

  it("句末标点后面的引号归上一句", () => {
    const chunks = splitSentences("他说：“走吧。”然后离开。");
    expect(chunks.map((chunk) => chunk.text)).toEqual(["他说：“走吧。”", "然后离开。"]);
  });

  it("英文句点不断句：缩写和小数点会误伤", () => {
    const chunks = splitSentences("Mr. Smith paid 3.14 dollars.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe("Mr. Smith paid 3.14 dollars.");
  });

  it("超长句优先退到最近的逗号，而不是硬切", () => {
    const text = "甲".repeat(70) + "，" + "乙".repeat(40);
    const chunks = splitSentences(text, 80);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text.endsWith("，")).toBe(true);
    expect(chunks[0].text.length).toBe(71);
    expect(chunks[1].text).toBe("乙".repeat(40));
  });

  it("没有软断点时才硬切", () => {
    const chunks = splitSentences("字".repeat(300), 120);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.text.length <= 120)).toBe(true);
  });

  it("空白不产生片段", () => {
    expect(splitSentences("   ")).toEqual([]);
  });
});

describe("splitSpeechChunks", () => {
  it("把段落序号和章号带上，供高亮定位", () => {
    const chunks = splitSpeechChunks(7, ["开头。", "结尾！"]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ chapterIndex: 7, paraIndex: 0, start: 0 });
    expect(chunks[1]).toMatchObject({ chapterIndex: 7, paraIndex: 1, start: 0 });
  });
});

describe("resolveTtsEngine", () => {
  it("自动模式优先服务端，音色跨设备一致", () => {
    expect(resolveTtsEngine("auto", { system: true, http: true })).toBe("http");
  });

  it("服务端没配时退回浏览器语音", () => {
    expect(resolveTtsEngine("auto", { system: true, http: false })).toBe("system");
  });

  it("指定了不可用的引擎时返回 null，由调用方提示", () => {
    expect(resolveTtsEngine("http", { system: true, http: false })).toBeNull();
    expect(resolveTtsEngine("system", { system: false, http: true })).toBeNull();
  });

  it("两个都不可用返回 null", () => {
    expect(resolveTtsEngine("auto", { system: false, http: false })).toBeNull();
  });
});

describe("clampTtsRate", () => {
  it("夹到 0.5-2 并保留一位小数", () => {
    expect(clampTtsRate(0.1)).toBe(0.5);
    expect(clampTtsRate(5)).toBe(2);
    expect(clampTtsRate(1.24)).toBe(1.2);
  });

  it("非数字回落到 1", () => {
    expect(clampTtsRate(Number.NaN)).toBe(1);
  });
});
