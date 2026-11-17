import { describe, expect, it } from "vitest";
import { SLEEP_CHOICES, formatCountdown, sleepChoiceLabel, sleepEndsAt, sleepLeft } from "../apps/web/src/lib/reader-sleep";

describe("reader sleep timer", () => {
  it("treats 0 and junk as off", () => {
    expect(sleepEndsAt(0)).toBe(0);
    expect(sleepEndsAt(-15)).toBe(0);
    expect(sleepEndsAt(Number.NaN)).toBe(0);
    expect(sleepLeft(0)).toBe(0);
    expect(sleepLeft(Number.NaN)).toBe(0);
  });

  it("counts down from a wall-clock deadline", () => {
    const ends = sleepEndsAt(30, 1_000);
    expect(ends).toBe(1_000 + 30 * 60_000);
    expect(sleepLeft(ends, 1_000)).toBe(30 * 60_000);
    expect(sleepLeft(ends, ends + 5_000)).toBe(0);
  });

  it("formats mm:ss and stays quiet when off", () => {
    expect(formatCountdown(0)).toBe("");
    expect(formatCountdown(-1)).toBe("");
    expect(formatCountdown(59_999)).toBe("01:00");
    expect(formatCountdown(60_000)).toBe("01:00");
    expect(formatCountdown(125_000)).toBe("02:05");
    expect(formatCountdown(9_000)).toBe("00:09");
  });

  it("keeps the first choice as the off switch", () => {
    expect(SLEEP_CHOICES[0].minutes).toBe(0);
    expect(sleepChoiceLabel(0)).toBe("关闭");
    expect(sleepChoiceLabel(60)).toBe("1 小时");
    expect(sleepChoiceLabel(7)).toBe("7 分钟");
  });
});
