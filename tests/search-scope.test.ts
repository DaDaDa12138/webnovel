import { describe, expect, it } from "vitest";
import { normalizeSearchHealthScope, searchHealthWhere } from "../apps/server/src/services/search-scope";

describe("search health scope", () => {
  it("defaults unknown values to usable", () => {
    expect(normalizeSearchHealthScope(undefined)).toBe("usable");
    expect(normalizeSearchHealthScope("")).toBe("usable");
    expect(normalizeSearchHealthScope("nope")).toBe("usable");
  });

  it("accepts healthy and all case-insensitively", () => {
    expect(normalizeSearchHealthScope(" HEALTHY ")).toBe("healthy");
    expect(normalizeSearchHealthScope("all")).toBe("all");
  });

  it("builds the expected SQL fragments", () => {
    expect(searchHealthWhere("usable")).toContain("NOT IN ('blocked', 'broken')");
    expect(searchHealthWhere("healthy")).toBe(" AND health_state = 'healthy'");
    expect(searchHealthWhere("all")).toBe("");
  });
});
