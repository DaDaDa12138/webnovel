import { describe, expect, it } from "vitest";
import { readCount, readLabel, readPercent } from "../apps/web/src/lib/reader-read";

describe("readCount", () => {
  it("counts only valid chapter indices", () => {
    expect(readCount([0, 1, 2], 3)).toBe(3);
    expect(readCount([0, 9, -1, 1.5, 2], 3)).toBe(2);
    expect(readCount([], 0)).toBe(0);
  });
});

describe("readPercent", () => {
  it("rounds and clamps", () => {
    expect(readPercent([0], 3)).toBe(33);
    expect(readPercent([0, 1, 2], 3)).toBe(100);
    expect(readPercent([5], 0)).toBe(0);
  });
});

describe("readLabel", () => {
  it("labels the catalog header", () => {
    expect(readLabel([0, 1], 10)).toBe("已读 2 / 10 章");
    expect(readLabel([], 10)).toBe("10 章");
    expect(readLabel([], 0)).toBe("0 章");
  });
});
