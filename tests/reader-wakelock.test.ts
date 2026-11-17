import { describe, expect, it } from "vitest";
import { wakelockWanted } from "../apps/web/src/lib/reader-wakelock";

const base = { keepAwake: false, autoPlaying: false, speaking: false, visible: true };

describe("wakelockWanted", () => {
  it("holds the lock when the reader asked for it", () => {
    expect(wakelockWanted({ ...base, keepAwake: true })).toBe(true);
  });

  it("holds the lock while auto page turn or speech is running", () => {
    expect(wakelockWanted({ ...base, autoPlaying: true })).toBe(true);
    expect(wakelockWanted({ ...base, speaking: true })).toBe(true);
  });

  it("drops the lock when nothing is running and the setting is off", () => {
    expect(wakelockWanted(base)).toBe(false);
  });

  it("never holds the lock in a hidden tab", () => {
    expect(wakelockWanted({ ...base, keepAwake: true, visible: false })).toBe(false);
    expect(wakelockWanted({ ...base, autoPlaying: true, speaking: true, visible: false })).toBe(false);
  });
});
