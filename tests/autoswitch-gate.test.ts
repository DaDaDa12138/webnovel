import { describe, expect, it } from "vitest";
import {
  AUTO_SWITCH_COOLDOWN_MS,
  AUTO_SWITCH_MAX_ATTEMPTS,
  autoSwitchGate,
} from "../apps/server/src/services/autoswitch";

function book(patch: Partial<Parameters<typeof autoSwitchGate>[0]> = {}) {
  return {
    auto_switched: 0,
    auto_switch_attempts: 0,
    auto_switch_last_at: null,
    ...patch,
  };
}

describe("auto switch gate", () => {
  it("allows a fresh book", () => {
    expect(autoSwitchGate(book())).toBe("ok");
  });

  it("does not retry after a successful switch", () => {
    expect(autoSwitchGate(book({ auto_switched: 1, auto_switch_attempts: 1 }))).toBe("already_switched");
  });

  it("stops after three failed attempts", () => {
    expect(AUTO_SWITCH_MAX_ATTEMPTS).toBe(3);
    expect(autoSwitchGate(book({ auto_switch_attempts: 3 }))).toBe("attempt_limit");
  });

  it("cools down for six hours after a failure", () => {
    const now = Date.parse("2026-01-01T12:00:00Z");
    const recent = new Date(now - 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
    expect(autoSwitchGate(book({ auto_switch_attempts: 1, auto_switch_last_at: recent }), now)).toBe("cooldown");
  });

  it("allows another try once the cooldown has passed", () => {
    const now = Date.parse("2026-01-01T12:00:00Z");
    const old = new Date(now - AUTO_SWITCH_COOLDOWN_MS - 1000).toISOString().slice(0, 19).replace("T", " ");
    expect(autoSwitchGate(book({ auto_switch_attempts: 2, auto_switch_last_at: old }), now)).toBe("ok");
  });

  it("treats malformed or missing timestamps as no previous attempt", () => {
    expect(autoSwitchGate(book({ auto_switch_last_at: "not-a-date" }))).toBe("ok");
  });
});
