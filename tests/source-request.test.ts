import { describe, expect, it } from "vitest";
import { probeSourceAccess, readSourceRequestSettings, validateSourceHeader } from "../apps/server/src/services/source-request.js";

describe("source request settings", () => {
  it("accepts Key: Value headers", () => {
    expect(validateSourceHeader("Cookie: uid=1; token=abc\nReferer: https://example.com/")).toBeNull();
  });

  it("accepts JSON headers", () => {
    expect(validateSourceHeader('{"Cookie":"uid=1"}')).toBeNull();
  });

  it("rejects a header line without a colon", () => {
    expect(validateSourceHeader("Cookie abc")).toContain("Key: Value");
  });

  it("rejects an empty JSON object", () => {
    expect(validateSourceHeader("{}")).toContain("空对象");
  });

  it("rejects invalid JSON", () => {
    expect(validateSourceHeader("{bad}")).toContain("合法 JSON");
  });

  it("reads defaults when the source has no request settings", () => {
    expect(readSourceRequestSettings({})).toEqual({ header: "", loginUrl: "", enabledCookieJar: true });
  });

  it("reports a missing URL instead of throwing", async () => {
    const result = await probeSourceAccess({});
    expect(result.ok).toBe(false);
    expect(result.error).toBe("missing_url");
  });
});
