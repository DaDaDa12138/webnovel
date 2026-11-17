import { describe, expect, it } from "vitest";
import { popoverPlacement } from "../apps/web/src/lib/reader-popover";

const viewport = { width: 390, height: 844 };
const size = { width: 300, height: 160 };

describe("popoverPlacement", () => {
  it("sits above a mark with room to spare", () => {
    const spot = popoverPlacement({ left: 140, top: 500, bottom: 520, width: 110 }, size, viewport);
    expect(spot.side).toBe("above");
    expect(spot.top).toBe(330);
    expect(spot.left).toBe(45);
  });

  it("flips below when the mark is near the top", () => {
    const spot = popoverPlacement({ left: 40, top: 80, bottom: 100, width: 120 }, size, viewport);
    expect(spot.side).toBe("below");
    expect(spot.top).toBe(110);
  });

  it("clamps the bubble inside the viewport on both edges", () => {
    const left = popoverPlacement({ left: 0, top: 500, bottom: 520, width: 40 }, size, viewport);
    expect(left.left).toBe(12);
    const right = popoverPlacement({ left: 370, top: 500, bottom: 520, width: 20 }, size, viewport);
    expect(right.left).toBe(78);
  });

  it("pins to the bottom when neither side fits", () => {
    const tall = { width: 300, height: 800 };
    const spot = popoverPlacement({ left: 100, top: 400, bottom: 420, width: 100 }, tall, viewport);
    expect(spot.side).toBe("below");
    expect(spot.top).toBe(32);
  });
});
