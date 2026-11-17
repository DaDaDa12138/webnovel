import { describe, expect, it } from "vitest";
import {
  HEALTH_STATE_ORDER,
  canRefreshFromHealth,
  healthStateLabel,
  healthStateRank,
  isHealthUsable,
} from "../packages/shared/src/health-rank";

describe("health rank", () => {
  it("orders healthy before partial and unknown before degraded", () => {
    expect(HEALTH_STATE_ORDER.healthy).toBeLessThan(HEALTH_STATE_ORDER.partial);
    expect(HEALTH_STATE_ORDER.partial).toBeLessThan(HEALTH_STATE_ORDER.unknown);
    expect(HEALTH_STATE_ORDER.unknown).toBeLessThan(HEALTH_STATE_ORDER.degraded);
    expect(HEALTH_STATE_ORDER.degraded).toBeLessThan(HEALTH_STATE_ORDER.blocked);
    expect(HEALTH_STATE_ORDER.blocked).toBeLessThan(HEALTH_STATE_ORDER.broken);
  });

  it("treats missing or malformed states as unknown", () => {
    expect(healthStateRank()).toBe(HEALTH_STATE_ORDER.unknown);
    expect(healthStateRank(null)).toBe(HEALTH_STATE_ORDER.unknown);
    expect(healthStateRank("weird")).toBe(HEALTH_STATE_ORDER.unknown);
    expect(healthStateRank("healthy")).toBe(0);
  });

  it("only excludes blocked and broken from routine use", () => {
    expect(isHealthUsable("healthy")).toBe(true);
    expect(isHealthUsable("degraded")).toBe(true);
    expect(isHealthUsable("unknown")).toBe(true);
    expect(isHealthUsable("blocked")).toBe(false);
    expect(isHealthUsable("broken")).toBe(false);
  });

  it("gates updater refresh with a score floor for degraded", () => {
    expect(canRefreshFromHealth("healthy", 90, "ok")).toBe(true);
    expect(canRefreshFromHealth("partial", 60, "retest")).toBe(true);
    expect(canRefreshFromHealth("degraded", 45, "retest")).toBe(true);
    expect(canRefreshFromHealth("degraded", 44, "retest")).toBe(false);
    expect(canRefreshFromHealth("blocked", 90, "ok")).toBe(false);
    expect(canRefreshFromHealth("broken", 0, "ok")).toBe(false);
  });

  it("falls back to the legacy status without a health state", () => {
    expect(canRefreshFromHealth(undefined, undefined, "ok")).toBe(true);
    expect(canRefreshFromHealth(null, null, "retest")).toBe(false);
    expect(healthStateLabel("blocked")).toBe("需登录");
    expect(healthStateLabel(undefined)).toBe("未测");
  });
});
