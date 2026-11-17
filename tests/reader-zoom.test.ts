import { describe, expect, it } from "vitest";
import {
  clampPan,
  clampZoom,
  DOUBLE_TAP_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  panLimit,
  pinchCenter,
  pinchZoom,
  toggleZoom,
  zoomAround,
} from "../apps/web/src/lib/reader-zoom";

describe("clampZoom", () => {
  it("keeps the range and recovers from junk", () => {
    expect(clampZoom(0.4)).toBe(MIN_ZOOM);
    expect(clampZoom(2)).toBe(2);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM);
    expect(clampZoom(-3)).toBe(MIN_ZOOM);
  });
});

describe("toggleZoom", () => {
  it("zooms in from 1 and back out from anything bigger", () => {
    expect(toggleZoom(1)).toBe(DOUBLE_TAP_ZOOM);
    expect(toggleZoom(1.005)).toBe(DOUBLE_TAP_ZOOM);
    expect(toggleZoom(2.5)).toBe(MIN_ZOOM);
    expect(toggleZoom(9)).toBe(MIN_ZOOM);
  });
});

describe("panLimit", () => {
  it("is zero until the image is wider than the frame", () => {
    expect(panLimit(300, 390, 1)).toBe(0);
    expect(panLimit(390, 390, 2)).toBe(195);
    expect(panLimit(600, 300, 1.5)).toBe(300);
    expect(panLimit(Number.NaN, 300, 2)).toBe(0);
  });
});

describe("clampPan", () => {
  it("keeps offsets inside the limit", () => {
    expect(clampPan(120, 195)).toBe(120);
    expect(clampPan(-400, 195)).toBe(-195);
    expect(clampPan(80, 0)).toBe(0);
    expect(clampPan(Number.NaN, 10)).toBe(0);
  });
});

describe("zoomAround", () => {
  it("keeps the focal point pinned while scaling", () => {
    // 焦点在中心右侧 100px：放大 2 倍后偏移按同一比例拉开
    expect(zoomAround(0, 100, 2)).toBe(-100);
    expect(zoomAround(-50, 100, 1.5)).toBe(-125);
    expect(zoomAround(30, 0, 2)).toBe(60);
    expect(zoomAround(Number.NaN, 10, 2)).toBe(0);
  });
});

describe("pinchZoom", () => {
  it("scales by the distance ratio and clamps", () => {
    expect(pinchZoom(1, 200, 400)).toBe(2);
    expect(pinchZoom(2, 100, 50)).toBe(1);
    expect(pinchZoom(1, 0, 300)).toBe(1);
    expect(pinchZoom(1, 100, 100000)).toBe(MAX_ZOOM);
  });
});

describe("pinchCenter", () => {
  it("returns the midpoint relative to the frame centre", () => {
    expect(pinchCenter({ x: 0, y: 0 }, { x: 100, y: 200 }, { width: 100, height: 100 })).toEqual({ x: 0, y: 50 });
  });
});
