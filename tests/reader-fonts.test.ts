import { describe, expect, it } from "vitest";
import {
  FONT_FAMILY_PREFIX,
  MAX_FONT_BYTES,
  checkFontFile,
  fontFamilyFor,
  fontFormat,
  formatBytes,
} from "../apps/web/src/lib/reader-fonts";

describe("fontFormat", () => {
  it("maps the four web font extensions", () => {
    expect(fontFormat("a.ttf")).toBe("truetype");
    expect(fontFormat("a.OTF")).toBe("opentype");
    expect(fontFormat("a.woff")).toBe("woff");
    expect(fontFormat("a.woff2")).toBe("woff2");
    expect(fontFormat("a.ttc")).toBe("");
    expect(fontFormat("noext")).toBe("");
  });
});

describe("checkFontFile", () => {
  it("rejects unknown extensions, empty files and oversized files", () => {
    expect(checkFontFile({ name: "a.ttc", size: 100 }).ok).toBe(false);
    expect(checkFontFile({ name: "a.ttf", size: 0 }).ok).toBe(false);
    expect(checkFontFile({ name: "a.ttf", size: MAX_FONT_BYTES + 1 }).message).toContain("太大");
    expect(checkFontFile({ name: "a.ttf", size: 1024 })).toEqual({ ok: true, format: "truetype", message: "" });
  });
});

describe("fontFamilyFor", () => {
  it("is stable, prefixed and CSS-safe", () => {
    const family = fontFamilyFor("霞鹜文楷.ttf", 12345);
    expect(family).toBe(fontFamilyFor("霞鹜文楷.ttf", 12345));
    expect(family.startsWith(FONT_FAMILY_PREFIX)).toBe(true);
    expect(family).toMatch(/^LegadoFont-[0-9a-f]{8}$/);
    expect(fontFamilyFor("霞鹜文楷.ttf", 12346)).not.toBe(family);
    expect(fontFamilyFor("另一款.ttf", 12345)).not.toBe(family);
  });
});

describe("formatBytes", () => {
  it("shows bytes, KB and MB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
});
