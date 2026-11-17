import { describe, expect, it } from "vitest";
import {
  MAX_DWELL_MS,
  MIN_DWELL_MS,
  clampDwell,
  formatDwell,
  pageDwellMs,
} from "../apps/web/src/lib/reader-autoturn";

describe("pageDwellMs", () => {
  it("turns a screen height and a speed into a dwell time", () => {
    expect(pageDwellMs(728, 40)).toBe(18200);
    expect(pageDwellMs(800, 100)).toBe(8000);
  });

  it("keeps the dwell inside the readable range", () => {
    expect(pageDwellMs(728, 1000)).toBe(MIN_DWELL_MS);
    expect(pageDwellMs(6000, 20)).toBe(MAX_DWELL_MS);
    expect(clampDwell(-50)).toBe(MIN_DWELL_MS);
    expect(clampDwell(999_999)).toBe(MAX_DWELL_MS);
  });

  it("falls back to a gentle default when geometry is missing", () => {
    expect(pageDwellMs(0, 40)).toBe(8000);
    expect(pageDwellMs(728, 0)).toBe(8000);
    expect(pageDwellMs(Number.NaN, Number.NaN)).toBe(8000);
  });
});

describe("formatDwell", () => {
  it("reads as seconds per page", () => {
    expect(formatDwell(18200)).toBe("18 秒/页");
    expect(formatDwell(1500)).toBe("2 秒/页");
  });

  it("spells out minutes for slow settings", () => {
    expect(formatDwell(60000)).toBe("1 分/页");
    expect(formatDwell(90000)).toBe("1 分 30 秒/页");
    expect(formatDwell(120000)).toBe("2 分/页");
  });
});
