import { describe, expect, it } from "vitest";
import { splitSpeechChunks } from "../apps/web/src/lib/reader-tts";

describe("splitSpeechChunks", () => {
  it("按句末标点断句并记录段落与起始位置", () => {
    const paragraphs = ["第一句话。第二句话！", "第三段没有标点"];
    const chunks = splitSpeechChunks(3, paragraphs);
    expect(chunks.map((chunk) => chunk.text)).toEqual(["第一句话。", "第二句话！", "第三段没有标点"]);
    expect(chunks[0]).toMatchObject({ chapterIndex: 3, paraIndex: 0, start: 0 });
    expect(chunks[1].start).toBe(5);
    expect(chunks[2].paraIndex).toBe(1);
  });

  it("超长段落按 120 字切开", () => {
    const long = "字".repeat(300);
    const chunks = splitSpeechChunks(0, [long]);
    expect(chunks.length).toBe(3);
    expect(chunks.every((chunk) => chunk.text.length <= 120)).toBe(true);
  });

  it("空段落不产生朗读片段", () => {
    expect(splitSpeechChunks(0, ["", "   "])).toEqual([]);
  });
});
