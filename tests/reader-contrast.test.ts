import { describe, expect, it } from "vitest";
import {
  READABLE_INK,
  contrastRatio,
  ensureContrast,
  isLowContrast,
  mixHex,
  parseHex,
  pickReadableInk,
  relativeLuminance,
  rgbaFromHex,
} from "../apps/web/src/lib/reader-contrast";

describe("reader contrast", () => {
  it("parses six- and three-digit hex", () => {
    expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex("102030")).toEqual({ r: 16, g: 32, b: 48 });
    expect(parseHex("#12345")).toBeNull();
    expect(parseHex("nope")).toBeNull();
  });

  it("computes WCAG luminance and contrast", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(contrastRatio("zzz", "#fff")).toBe(1);
    expect(contrastRatio("#fff", "#12345")).toBe(1);
  });

  it("picks readable ink for light and dark paper", () => {
    expect(pickReadableInk("#faf8f3")).toBe(READABLE_INK.light);
    expect(pickReadableInk("#101010")).toBe(READABLE_INK.dark);
  });

  it("flags pairs below the AA threshold", () => {
    expect(isLowContrast("#999999", "#faf8f3")).toBe(true);
    expect(isLowContrast("#23241f", "#faf8f3")).toBe(false);
    expect(isLowContrast("#999999", "#faf8f3", 2)).toBe(false);
  });

  it("auto-corrects ink on a mid-grey background", () => {
    const bg = "#777777";
    expect(contrastRatio(pickReadableInk(bg), bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ensureContrast("#999999", bg), bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ensureContrast("#faf8f3", "#ffffff"), "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("mixes colors and emits rgba borders deterministically", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#123456", "#abcdef", 0)).toBe("#123456");
    expect(mixHex("#123456", "#abcdef", 1)).toBe("#abcdef");
    expect(rgbaFromHex("#123456", 0.16)).toBe("rgba(18, 52, 86, 0.16)");
    expect(rgbaFromHex("zzz", 2)).toBe("rgba(0, 0, 0, 1)");
  });
});
