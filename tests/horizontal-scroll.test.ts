import { describe, expect, it } from "vitest";
import { dragScrollLeft, horizontalScrollState } from "../apps/web/src/lib/horizontal-scroll";

describe("horizontal scroll helpers", () => {
  it("detects both directions in the middle", () => {
    expect(horizontalScrollState(300, 600, 1200)).toEqual({
      canLeft: true,
      canRight: true,
      overflowing: true,
    });
  });

  it("disables the direction at each edge", () => {
    expect(horizontalScrollState(0, 600, 1200)).toMatchObject({ canLeft: false, canRight: true });
    expect(horizontalScrollState(600, 600, 1200)).toMatchObject({ canLeft: true, canRight: false });
  });

  it("does not treat sub-pixel overflow as scrollable", () => {
    expect(horizontalScrollState(0, 600, 601)).toEqual({
      canLeft: false,
      canRight: false,
      overflowing: false,
    });
  });

  it("maps drag distance to scrollLeft", () => {
    expect(dragScrollLeft(120, 300, 220)).toBe(200);
    expect(dragScrollLeft(120, 300, 420)).toBe(0);
  });
});
