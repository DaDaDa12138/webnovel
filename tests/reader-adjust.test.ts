import { describe, expect, it } from "vitest";
import {
  ADJUST_TRAVEL_RATIO,
  adjustDelta,
  adjustLabel,
  adjustPercent,
  adjustText,
  adjustZoneAt,
  applyAdjust,
} from "../apps/web/src/lib/reader-adjust";

describe("edge adjust", () => {
  it("splits the screen into brightness / nothing / font", () => {
    expect(adjustZoneAt(0, 390)).toBe("brightness");
    expect(adjustZoneAt(90, 390)).toBe("brightness");
    expect(adjustZoneAt(120, 390)).toBe(null);
    expect(adjustZoneAt(195, 390)).toBe(null);
    expect(adjustZoneAt(300, 390)).toBe("font");
    expect(adjustZoneAt(390, 390)).toBe("font");
    expect(adjustZoneAt(10, 0)).toBe(null);
    expect(adjustZoneAt(Number.NaN, 390)).toBe(null);
  });

  it("maps a drag to the whole range over 60% of the viewport", () => {
    expect(ADJUST_TRAVEL_RATIO).toBe(0.6);
    // 800 高的屏，滑 480px 正好走完 100 的区间；上滑为正。
    expect(adjustDelta(-480, 800, 100)).toBe(100);
    expect(adjustDelta(480, 800, 100)).toBe(-100);
    expect(adjustDelta(-240, 800, 100)).toBe(50);
    expect(adjustDelta(0, 800, 100)).toBe(0);
    expect(adjustDelta(-100, 0, 100)).toBe(0);
    expect(adjustDelta(Number.NaN, 800, 100)).toBe(0);
  });

  it("clamps to the allowed range", () => {
    expect(applyAdjust(90, -480, 800, 100, 0, 100)).toBe(100);
    expect(applyAdjust(10, 480, 800, 100, 0, 100)).toBe(0);
    expect(applyAdjust(19, -120, 800, 24, 12, 36)).toBe(25);
    expect(applyAdjust(19, -480, 800, 24, 12, 36)).toBe(36);
    expect(applyAdjust(Number.NaN, 0, 800, 24, 12, 36)).toBe(12);
  });

  it("describes the value for the hint bar", () => {
    expect(adjustPercent(50, 0, 100)).toBe(50);
    expect(adjustPercent(-10, 0, 100)).toBe(0);
    expect(adjustPercent(120, 0, 100)).toBe(100);
    expect(adjustPercent(5, 10, 10)).toBe(0);
    expect(adjustLabel("brightness")).toBe("亮度");
    expect(adjustLabel("font")).toBe("字号");
    expect(adjustText("brightness", 42.4)).toBe("亮度 42");
    expect(adjustText("font", 19.6)).toBe("字号 20");
  });
});
