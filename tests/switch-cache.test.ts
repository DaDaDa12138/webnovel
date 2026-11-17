import { describe, expect, it } from "vitest";
import { chapterKey } from "../apps/server/src/services/switch-cache";

/** 缓存键带版本前缀：引擎修了取正文的 bug 之后，旧缓存里的失败不能继续冒充 30 分钟。 */
const V = "v2:";

describe("switch chapter key", () => {
  it("normalizes whitespace so the same chapter hits the same cache row", () => {
    expect(chapterKey(3, "第 3 章 风起")).toBe(V + "t:第3章风起");
    expect(chapterKey(3, " 第3章 风起 ")).toBe(V + "t:第3章风起");
    // 章号不同、章名相同：目录错乱的站会把同一章编成不同号，仍算同一章。
    expect(chapterKey(4, "第 3 章 风起")).toBe(V + "t:第3章风起");
  });

  it("falls back to the index when the title is missing", () => {
    expect(chapterKey(7, "")).toBe(V + "i:7");
    expect(chapterKey(7, "   ")).toBe(V + "i:7");
    expect(chapterKey(7)).toBe(V + "i:7");
  });

  it("clamps a broken index instead of producing a negative key", () => {
    expect(chapterKey(-4, "")).toBe(V + "i:0");
    expect(chapterKey(Number.NaN, "")).toBe(V + "i:0");
  });

  it("keeps a version prefix so an engine fix can invalidate old rows", () => {
    expect(chapterKey(1, "第1章 起")).toMatch(/^v\d+:/);
    expect(chapterKey(1, "第1章 起").endsWith(":t:第1章起")).toBe(true);
  });
});
