import { describe, expect, it } from "vitest";
import { matchChapter } from "@legado/engine";

/** 837 章的目标目录：标题都是「第 N 章 标题N」，名字和章号一一对应。 */
const toc = Array.from({ length: 837 }, (_, i) => ({ title: `第${i + 1}章 标题${i + 1}` }));

describe("matchChapter 换源对齐", () => {
  it("matches by exact title regardless of the old total", () => {
    const match = matchChapter(toc, "第100章 标题100", 100, 884);
    expect(match.reason).toBe("exact");
    expect(match.index).toBe(99);
  });

  it("scales the fallback position when the old total is known", () => {
    // 旧目录 884 章读到第 700 章，新目录 837 章：700 * 837 / 884 ≈ 663，而不是硬取 700。
    const match = matchChapter(toc, "尾声 归来", 700, 884);
    expect(match.reason).toBe("index");
    expect(match.index).toBe(663);
  });

  it("keeps the plain index when the old total is unknown or unchanged", () => {
    expect(matchChapter(toc, "尾声 归来", 700).index).toBe(700);
    expect(matchChapter(toc, "尾声 归来", 700, 0).index).toBe(700);
    expect(matchChapter(toc, "尾声 归来", 700, 837).index).toBe(700);
  });

  it("clamps the scaled position into the new table of contents", () => {
    const short = toc.slice(0, 10);
    const match = matchChapter(short, "尾声 归来", 800, 884);
    expect(match.index).toBe(9);
  });

  it("prefers a chapter number hit over the scaled position", () => {
    // 章号完全一致比「按比例猜」更可信：镜像站少几十章时，比例会把人送偏。
    const match = matchChapter(toc, "第500章 改过的名字", 500, 884);
    expect(match.reason).toBe("ordinal");
    expect(match.index).toBe(499);
  });

  it("breaks ties near the scaled anchor, not the raw index", () => {
    const list = [
      { title: "第一章 起" },
      { title: "同名" },
      { title: "同名" },
      { title: "同名" },
      { title: "同名" },
    ];
    // 旧 10 章的第 4 章 → 新 5 章的第 2 章；三个同名条目里取离 2 最近的那个。
    const match = matchChapter(list, "同名", 4, 10);
    expect(match.index).toBe(2);
  });
});
