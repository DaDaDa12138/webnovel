import { describe, expect, it } from "vitest";
import {
  DEFAULT_READER_SETTINGS,
  READER_RANGES,
  READER_SECTION_DEFAULTS,
  READER_THEMES,
  READER_TYPOGRAPHY_DEFAULTS,
  sectionDefaults,
  fontStack,
  fromServerSettings,
  normalizeReaderSettings,
  readerPalette,
  themeById,
  toServerSettings,
} from "../apps/web/src/lib/reader-settings";
import { contrastRatio } from "../apps/web/src/lib/reader-contrast";

describe("reader settings", () => {
  it("clamps numeric fields into their supported ranges", () => {
    const s = normalizeReaderSettings({ fontSize: 99, lineHeight: 9, paraSpacing: -2, pageWidth: 700, pageMargin: 100, ttsRate: 3 });
    expect(s.fontSize).toBe(36);
    expect(s.lineHeight).toBe(2.6);
    expect(s.paraSpacing).toBe(0);
    expect(s.pageWidth).toBe(720);
    expect(s.pageMargin).toBe(48);
    expect(s.ttsRate).toBe(1.8);
    // 边距太窄会把中文挤成一列字，下限 8px。
    expect(normalizeReaderSettings({ pageMargin: 2 }).pageMargin).toBe(8);
  });

  it("falls back to defaults for unknown theme or font", () => {
    const s = normalizeReaderSettings({ theme: "neon" as never, fontFamily: "comic" as never });
    expect(s.theme).toBe("paper");
    expect(s.fontFamily).toBe("system");
  });

  it("rounds font size and keeps explicit false switches", () => {
    const s = normalizeReaderSettings({ fontSize: 19.6, indent: false, autoHide: false, mode: "page" });
    expect(s.fontSize).toBe(20);
    expect(s.indent).toBe(false);
    expect(s.autoHide).toBe(false);
    expect(s.mode).toBe("page");
  });

  it("round-trips through the server settings map", () => {
    const custom = normalizeReaderSettings({ theme: "night", fontSize: 22, lineHeight: 2.1, mode: "page", indent: false });
    const restored = normalizeReaderSettings({ ...DEFAULT_READER_SETTINGS, ...fromServerSettings(toServerSettings(custom)) });
    expect(restored).toEqual(custom);
  });

  it("serializes switches as 1/0 strings", () => {
    const map = toServerSettings({ ...DEFAULT_READER_SETTINGS, indent: false, autoHide: true });
    expect(map["reader-indent"]).toBe("0");
    expect(map["reader-auto-hide"]).toBe("1");
    expect(map.fontSize).toBe("19");
  });

  it("resolves themes and font stacks with fallbacks", () => {
    expect(themeById("sepia").label).toBe("米黄");
    expect(themeById("missing").id).toBe(READER_THEMES[0].id);
    expect(fontStack("song")).toContain("Songti");
    expect(fontStack("missing" as never)).toBe(fontStack("system"));
    expect(fontStack("system", "霞鹜文楷")).toContain("霞鹜文楷");
  });

  it("accepts only six-digit custom colors and derives readable text", () => {
    expect(normalizeReaderSettings({ customBg: "#F3E9D2" }).customBg).toBe("#f3e9d2");
    expect(normalizeReaderSettings({ customBg: "red" }).customBg).toBe("");
    expect(normalizeReaderSettings({ customBg: "#fff" }).customBg).toBe("");
    const light = readerPalette(normalizeReaderSettings({ theme: "paper", customBg: "#f3e9d2" }));
    const dark = readerPalette(normalizeReaderSettings({ theme: "paper", customBg: "#101010" }));
    expect(light.bg).toBe("#f3e9d2");
    expect(light.fg).toBe("#26251f");
    expect(dark.fg).toBe("#e8e6e1");
    const midGrey = readerPalette(normalizeReaderSettings({ theme: "paper", customBg: "#777777" }));
    expect(midGrey.fg).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrastRatio(midGrey.fg, midGrey.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(midGrey.muted, midGrey.bg)).toBeGreaterThanOrEqual(3);
  });

  it("normalizes auto scroll speed and round-trips it", () => {
    const s = normalizeReaderSettings({ autoScroll: true, autoSpeed: 999 });
    expect(s.autoScroll).toBe(true);
    expect(s.autoSpeed).toBe(160);
    const map = toServerSettings(s);
    expect(map["reader-auto-scroll"]).toBe("1");
    expect(map["reader-auto-speed"]).toBe("160");
    const back = normalizeReaderSettings({ ...DEFAULT_READER_SETTINGS, ...fromServerSettings(map) });
    expect(back.autoScroll).toBe(true);
    expect(back.autoSpeed).toBe(160);
  });

  it("normalizes the reading-comfort fields added in 0.8", () => {
    const s = normalizeReaderSettings({ fontSize: 9, warmth: 180, dim: -5, pageAnimation: "spin" as never });
    expect(s.fontSize).toBe(12);
    expect(s.warmth).toBe(100);
    expect(s.dim).toBe(0);
    expect(s.pageAnimation).toBe("slide");
    const custom = normalizeReaderSettings({
      warmth: 30,
      dim: 12,
      pageAnimation: "fade",
      swipeTurn: false,
      edgeAdjust: false,
      spread: true,
      pageMargin: 28,
      desktopCatalog: false,
      readoutAlways: false,
      followSystemTheme: true,
      readout: { topLeft: "book", topRight: "none", bottomLeft: "remaining", bottomRight: "progress" },
    });
    const back = normalizeReaderSettings({ ...DEFAULT_READER_SETTINGS, ...fromServerSettings(toServerSettings(custom)) });
    expect(back).toEqual(custom);
  });

  it("keeps edge adjust on by default and only turns it off when told to", () => {
    expect(DEFAULT_READER_SETTINGS.edgeAdjust).toBe(true);
    expect(normalizeReaderSettings({ edgeAdjust: "no" as unknown as boolean }).edgeAdjust).toBe(true);
    const off = normalizeReaderSettings({ ...DEFAULT_READER_SETTINGS, edgeAdjust: false });
    const back = normalizeReaderSettings({ ...DEFAULT_READER_SETTINGS, ...fromServerSettings(toServerSettings(off)) });
    expect(back.edgeAdjust).toBe(false);
  });

  it("defaults the spread layout to off and survives a round trip", () => {
    expect(DEFAULT_READER_SETTINGS.spread).toBe(false);
    const back = normalizeReaderSettings({ ...DEFAULT_READER_SETTINGS, ...fromServerSettings(toServerSettings({ ...DEFAULT_READER_SETTINGS, spread: true })) });
    expect(back.spread).toBe(true);
    // 只有明确 true 才开，字符串或数字都不能意外打开双页。
    expect(normalizeReaderSettings({ spread: "yes" as never }).spread).toBe(false);
  });

  it("keeps the pinned catalog on by default and only closes it when told to", () => {
    expect(DEFAULT_READER_SETTINGS.desktopCatalog).toBe(true);
    const back = normalizeReaderSettings({
      ...DEFAULT_READER_SETTINGS,
      ...fromServerSettings(toServerSettings({ ...DEFAULT_READER_SETTINGS, desktopCatalog: false })),
    });
    expect(back.desktopCatalog).toBe(false);
    // 旧版本存的设置里没有这个键，宽屏用户不该因此丢掉目录。
    expect(normalizeReaderSettings({ theme: "night" }).desktopCatalog).toBe(true);
  });

  it("keeps at least one menu cell in the tap grid", () => {
    const noMenu = normalizeReaderSettings({ tapGrid: Array(9).fill("next-page") });
    expect(noMenu.tapGrid[4]).toBe("toggle-menu");
    const wrongSize = normalizeReaderSettings({ tapGrid: ["next-page"] as never });
    expect(wrongSize.tapGrid).toHaveLength(9);
    expect(wrongSize.tapGrid).toContain("toggle-menu");
  });

  it("normalizes letter spacing and keeps justify off", () => {
    const s = normalizeReaderSettings({ letterSpacing: 0.5, justify: false, customFont: "  霞鹜文楷  " });
    expect(s.letterSpacing).toBe(0.2);
    expect(s.justify).toBe(false);
    expect(s.customFont).toBe("霞鹜文楷");
  });

  it("defaults smart paragraphing on and clamps its split length", () => {
    expect(DEFAULT_READER_SETTINGS.paragraph.mode).toBe("smart");
    const s = normalizeReaderSettings({
      paragraph: { mode: "off", mergeWrapped: false, splitLong: true, splitLength: 9999, splitDialogue: false, dedupeTitle: false },
    });
    expect(s.paragraph.mode).toBe("off");
    expect(s.paragraph.mergeWrapped).toBe(false);
    expect(s.paragraph.splitLength).toBe(400);
    expect(s.paragraph.splitDialogue).toBe(false);
    expect(s.paragraph.dedupeTitle).toBe(false);
    // 旧版本没有 paragraph 字段，升级后应该直接得到智能分段。
    expect(normalizeReaderSettings({ theme: "night" }).paragraph.mode).toBe("smart");
  });

  it("round-trips paragraph options through the server map", () => {
    const custom = normalizeReaderSettings({
      paragraph: { mode: "smart", mergeWrapped: true, splitLong: false, splitLength: 260, splitDialogue: true, dedupeTitle: false },
    });
    const map = toServerSettings(custom);
    expect(typeof map["reader-paragraph"]).toBe("string");
    const back = normalizeReaderSettings({ ...DEFAULT_READER_SETTINGS, ...fromServerSettings(map) });
    expect(back.paragraph).toEqual(custom.paragraph);
  });

  it("round-trips the special paragraph switch", () => {
    const custom = normalizeReaderSettings({
      paragraph: { ...DEFAULT_READER_SETTINGS.paragraph, special: false },
    });
    expect(custom.paragraph.special).toBe(false);
    const back = normalizeReaderSettings({ ...DEFAULT_READER_SETTINGS, ...fromServerSettings(toServerSettings(custom)) });
    expect(back.paragraph.special).toBe(false);
  });

  it("resets typography without touching theme or turning preferences", () => {
    expect(READER_TYPOGRAPHY_DEFAULTS.theme).toBeUndefined();
    expect(READER_TYPOGRAPHY_DEFAULTS.mode).toBeUndefined();
    expect(READER_TYPOGRAPHY_DEFAULTS.paragraph?.mode).toBe("smart");
    const next = normalizeReaderSettings({ ...DEFAULT_READER_SETTINGS, theme: "night", mode: "page", ...READER_TYPOGRAPHY_DEFAULTS });
    expect(next.theme).toBe("night");
    expect(next.mode).toBe("page");
    expect(next.fontSize).toBe(DEFAULT_READER_SETTINGS.fontSize);
  });

  it("normalizes font weight and vertical page padding", () => {
    expect(normalizeReaderSettings({ fontWeight: 600 }).fontWeight).toBe(600);
    expect(normalizeReaderSettings({ fontWeight: 700 as never }).fontWeight).toBe(400);
    expect(normalizeReaderSettings({ fontWeight: "600" as never }).fontWeight).toBe(600);
    expect(normalizeReaderSettings({ pagePaddingY: 99 }).pagePaddingY).toBe(READER_RANGES.pagePaddingY.max);
    expect(normalizeReaderSettings({ pagePaddingY: -5 }).pagePaddingY).toBe(0);
    expect(DEFAULT_READER_SETTINGS.fontWeight).toBe(400);
  });

  it("round-trips the 0.61 typography fields through the server map", () => {
    const custom = normalizeReaderSettings({ fontWeight: 600, pagePaddingY: 24 });
    const map = toServerSettings(custom);
    expect(map["reader-font-weight"]).toBe("600");
    expect(map["reader-page-padding-y"]).toBe("24");
    const back = normalizeReaderSettings({ ...DEFAULT_READER_SETTINGS, ...fromServerSettings(map) });
    expect(back.fontWeight).toBe(600);
    expect(back.pagePaddingY).toBe(24);
  });

  it("resets only the section being viewed", () => {
    const type = sectionDefaults("type");
    expect(type.fontSize).toBe(DEFAULT_READER_SETTINGS.fontSize);
    expect(type.fontWeight).toBe(400);
    expect(type.theme).toBeUndefined();
    expect(type.mode).toBeUndefined();

    const display = sectionDefaults("display");
    expect(display.theme).toBe("paper");
    expect(display.readout).toEqual(DEFAULT_READER_SETTINGS.readout);
    expect(display.fontSize).toBeUndefined();

    // 返回的对象必须是副本，改它不能污染共享默认值。
    const copy = sectionDefaults("type");
    copy.paragraph!.splitLength = 999;
    expect(READER_SECTION_DEFAULTS.type.paragraph!.splitLength).not.toBe(999);
  });
});
