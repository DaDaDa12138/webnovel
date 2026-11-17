import { DEFAULT_READOUT, normalizeReadout, type ReadoutConfig } from "./reader-readout";
import { ensureContrast, mixHex, pickReadableInk, rgbaFromHex } from "./reader-contrast";
import { DEFAULT_PARAGRAPH_OPTIONS, normalizeParagraphOptions, type ParagraphOptions } from "./reader-blocks";
import type { TtsEngine } from "./reader-tts";
import { DEFAULT_TAP_GRID, normalizeTapGrid, type TapGrid } from "./reader-tap";

export type ReaderThemeId = "paper" | "sepia" | "eye" | "gray" | "night" | "black" | "pink";
export type ReaderFontId = "system" | "song" | "kai";
export type ReaderMode = "scroll" | "page";
/** Page-turn transition; "none" is also what reduced-motion users get. */
export type PageAnimation = "none" | "slide" | "fade";
/** 正文字重：只开放三档，避免书源自带 font-weight 把正文压成细体或糊成黑块。 */
export type ReaderFontWeight = 400 | 500 | 600;

export interface ReaderTheme {
  id: ReaderThemeId;
  label: string;
  bg: string;
  fg: string;
  muted: string;
  panel: string;
  border: string;
  accent: string;
}

export interface ReaderSettings {
  theme: ReaderThemeId;
  fontFamily: ReaderFontId;
  /** Optional CSS font-family name installed on the device, e.g. "霞鹜文楷". */
  customFont: string;
  fontSize: number;
  /** 正文字重；标题和 UI 不跟着变。 */
  fontWeight: ReaderFontWeight;
  lineHeight: number;
  paraSpacing: number;
  letterSpacing: number;
  pageWidth: number;
  /** Horizontal breathing room in px (8-48). */
  pageMargin: number;
  /** 正文上下额外留白（0-48px）；默认 0，保留原来的 20px 顶距。 */
  pagePaddingY: number;
  indent: boolean;
  justify: boolean;
  /** Custom page background; empty means "use the theme colour". */
  customBg: string;
  mode: ReaderMode;
  autoHide: boolean;
  /** Auto-scroll (teleprompter) mode; only meaningful in scroll mode. */
  autoScroll: boolean;
  /** Auto-scroll speed in CSS pixels per second. */
  autoSpeed: number;
  ttsRate: number;
  /** auto = 服务端可用就优先服务端，否则退回浏览器语音。 */
  ttsEngine: TtsEngine;
  /** 音色：system 引擎存 voice.name，http 引擎存服务端音色名；空表示自动。 */
  ttsVoice: string;
  /** Warm tint overlay strength, 0-100. An overlay, never a filter on the content. */
  warmth: number;
  /** Dim overlay strength, 0-100. */
  dim: number;
  pageAnimation: PageAnimation;
  /** Which action each of the nine screen regions performs. */
  tapGrid: TapGrid;
  /** Horizontal swipe turns the page in page mode. */
  swipeTurn: boolean;
  /** Vertical drag along the left/right edge adjusts brightness/font size in page mode. */
  edgeAdjust: boolean;
  /** Ask the screen to stay awake while reading (released when the tab is hidden). */
  keepAwake: boolean;
  /** Show two columns side by side on wide screens (page mode only). */
  spread: boolean;
  /** Keep the chapter list pinned to the left of the page on wide screens. */
  desktopCatalog: boolean;
  /** What each corner of the reading area shows. */
  readout: ReadoutConfig;
  /** Keep the readout visible while the toolbars are hidden. */
  readoutAlways: boolean;
  /** Follow the OS dark-mode preference instead of the stored theme. */
  followSystemTheme: boolean;
  /** 展示层分段（合段/长段细分/对话独立成段/章标题去重），不改原文与进度锚点。 */
  paragraph: ParagraphOptions;
}

export const READER_THEMES: ReaderTheme[] = [
  { id: "paper", label: "纸白", bg: "#faf8f3", fg: "#23241f", muted: "#78766c", panel: "#f2efe7", border: "rgba(0,0,0,0.08)", accent: "#4e6b57" },
  { id: "sepia", label: "米黄", bg: "#f3e7ce", fg: "#4a3a24", muted: "#8a7758", panel: "#ebdcc0", border: "rgba(74,58,36,0.12)", accent: "#8a5a2b" },
  { id: "eye", label: "护眼", bg: "#e3efdc", fg: "#2c3a2a", muted: "#6c7d66", panel: "#d7e6cf", border: "rgba(44,58,42,0.12)", accent: "#3f6b45" },
  { id: "gray", label: "雾灰", bg: "#ecedf0", fg: "#2c2f33", muted: "#6f747c", panel: "#e1e3e8", border: "rgba(44,47,51,0.10)", accent: "#4a5568" },
  { id: "night", label: "夜间", bg: "#16181a", fg: "#b9bcb4", muted: "#7e8279", panel: "#22262a", border: "rgba(255,255,255,0.08)", accent: "#8fb99b" },
  { id: "black", label: "纯黑", bg: "#000000", fg: "#9a9a9a", muted: "#6a6a6a", panel: "#111111", border: "rgba(255,255,255,0.10)", accent: "#7aa889" },
  { id: "pink", label: "淡粉", bg: "#fbe9ec", fg: "#4a2f33", muted: "#8a6a6f", panel: "#f5dde1", border: "rgba(74,47,51,0.10)", accent: "#a4546a" },
];

export const READER_FONTS: Array<{ id: ReaderFontId; label: string; stack: string }> = [
  { id: "system", label: "系统", stack: "var(--font-family)" },
  { id: "song", label: "宋体", stack: "'Songti SC', 'Noto Serif SC', SimSun, serif" },
  { id: "kai", label: "楷体", stack: "'Kaiti SC', 'KaiTi', 'STKaiti', serif" },
];

/** 滑杆/分段控件的唯一范围来源，设置页和阅读设置面板都从这里取。 */
export const READER_RANGES = {
  fontSize: { min: 12, max: 36, step: 1 },
  lineHeight: { min: 1.4, max: 2.6, step: 0.1 },
  paraSpacing: { min: 0, max: 1.6, step: 0.1 },
  letterSpacing: { min: 0, max: 0.2, step: 0.01 },
  pageMargin: { min: 8, max: 48, step: 2 },
  pagePaddingY: { min: 0, max: 48, step: 4 },
  autoSpeed: { min: 20, max: 160, step: 5 },
  ttsRate: { min: 0.6, max: 1.8, step: 0.1 },
} as const;

export const READER_PAGE_WIDTHS = [640, 720, 820, 1000] as const;

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: "paper",
  fontFamily: "system",
  customFont: "",
  fontSize: 19,
  fontWeight: 400,
  lineHeight: 1.9,
  paraSpacing: 0.7,
  letterSpacing: 0,
  pageWidth: 720,
  pageMargin: 16,
  pagePaddingY: 0,
  indent: true,
  justify: true,
  customBg: "",
  mode: "scroll",
  autoHide: true,
  autoScroll: false,
  autoSpeed: 40,
  ttsRate: 1,
  ttsEngine: "auto",
  ttsVoice: "",
  warmth: 0,
  dim: 0,
  pageAnimation: "slide",
  tapGrid: DEFAULT_TAP_GRID,
  swipeTurn: true,
  edgeAdjust: true,
  keepAwake: true,
  spread: false,
  desktopCatalog: true,
  readout: DEFAULT_READOUT,
  readoutAlways: false,
  followSystemTheme: false,
  paragraph: DEFAULT_PARAGRAPH_OPTIONS,
};

/**
 * 「恢复排版」只动字号、行距、字体这些排版项，不碰主题、翻页、朗读和阅读进度。
 * 面板里滑杆多，一下把所有设置清空太容易误伤。
 */
export const READER_TYPOGRAPHY_DEFAULTS: Partial<ReaderSettings> = {
  fontFamily: DEFAULT_READER_SETTINGS.fontFamily,
  customFont: DEFAULT_READER_SETTINGS.customFont,
  fontSize: DEFAULT_READER_SETTINGS.fontSize,
  fontWeight: DEFAULT_READER_SETTINGS.fontWeight,
  lineHeight: DEFAULT_READER_SETTINGS.lineHeight,
  paraSpacing: DEFAULT_READER_SETTINGS.paraSpacing,
  letterSpacing: DEFAULT_READER_SETTINGS.letterSpacing,
  pageWidth: DEFAULT_READER_SETTINGS.pageWidth,
  pageMargin: DEFAULT_READER_SETTINGS.pageMargin,
  pagePaddingY: DEFAULT_READER_SETTINGS.pagePaddingY,
  indent: DEFAULT_READER_SETTINGS.indent,
  justify: DEFAULT_READER_SETTINGS.justify,
  paragraph: { ...DEFAULT_PARAGRAPH_OPTIONS },
};

export type ReaderSettingsSection = "display" | "type" | "turn" | "speech";

/**
 * 设置面板的「恢复」按当前分组重置，而不是一按就把主题、翻页、朗读全清掉。
 * 这些对象里的嵌套值在返回前会深拷贝，避免调用方改到 DEFAULT 本身。
 */
export const READER_SECTION_DEFAULTS: Record<ReaderSettingsSection, Partial<ReaderSettings>> = {
  display: {
    theme: DEFAULT_READER_SETTINGS.theme,
    customBg: DEFAULT_READER_SETTINGS.customBg,
    warmth: DEFAULT_READER_SETTINGS.warmth,
    dim: DEFAULT_READER_SETTINGS.dim,
    followSystemTheme: DEFAULT_READER_SETTINGS.followSystemTheme,
    readout: DEFAULT_READER_SETTINGS.readout,
    readoutAlways: DEFAULT_READER_SETTINGS.readoutAlways,
  },
  type: READER_TYPOGRAPHY_DEFAULTS,
  turn: {
    mode: DEFAULT_READER_SETTINGS.mode,
    autoHide: DEFAULT_READER_SETTINGS.autoHide,
    autoScroll: DEFAULT_READER_SETTINGS.autoScroll,
    autoSpeed: DEFAULT_READER_SETTINGS.autoSpeed,
    pageAnimation: DEFAULT_READER_SETTINGS.pageAnimation,
    tapGrid: DEFAULT_READER_SETTINGS.tapGrid,
    swipeTurn: DEFAULT_READER_SETTINGS.swipeTurn,
    edgeAdjust: DEFAULT_READER_SETTINGS.edgeAdjust,
    keepAwake: DEFAULT_READER_SETTINGS.keepAwake,
    spread: DEFAULT_READER_SETTINGS.spread,
    desktopCatalog: DEFAULT_READER_SETTINGS.desktopCatalog,
  },
  speech: {
    ttsRate: DEFAULT_READER_SETTINGS.ttsRate,
    ttsEngine: DEFAULT_READER_SETTINGS.ttsEngine,
    ttsVoice: DEFAULT_READER_SETTINGS.ttsVoice,
  },
};

export function sectionDefaults(section: ReaderSettingsSection): Partial<ReaderSettings> {
  const source = READER_SECTION_DEFAULTS[section];
  const out: Partial<ReaderSettings> = { ...source };
  if (source.readout) out.readout = { ...source.readout };
  if (source.tapGrid) out.tapGrid = [...source.tapGrid] as ReaderSettings["tapGrid"];
  if (source.paragraph) out.paragraph = { ...source.paragraph };
  return out;
}

const STORAGE_KEY = "legado-reader-settings";

/** 有没有本机偏好。没有时应该让服务端设置生效，而不是用默认值把它盖掉。 */
export function hasStoredReaderSettings(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) != null;
  } catch {
    return false;
  }
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeReaderSettings(input: Partial<ReaderSettings> | null | undefined): ReaderSettings {
  const src = input ?? {};
  const theme = READER_THEMES.some((t) => t.id === src.theme) ? (src.theme as ReaderThemeId) : DEFAULT_READER_SETTINGS.theme;
  const fontFamily = READER_FONTS.some((f) => f.id === src.fontFamily)
    ? (src.fontFamily as ReaderFontId)
    : DEFAULT_READER_SETTINGS.fontFamily;
  const customBg = String(src.customBg ?? "").trim();
  const customFont = String(src.customFont ?? "").trim().slice(0, 40);
  return {
    theme,
    fontFamily,
    customFont,
    fontSize: Math.round(num(src.fontSize, DEFAULT_READER_SETTINGS.fontSize, READER_RANGES.fontSize.min, READER_RANGES.fontSize.max)),
    fontWeight: Number(src.fontWeight) === 500 || Number(src.fontWeight) === 600 ? (Number(src.fontWeight) as ReaderFontWeight) : 400,
    lineHeight: Number(num(src.lineHeight, DEFAULT_READER_SETTINGS.lineHeight, READER_RANGES.lineHeight.min, READER_RANGES.lineHeight.max).toFixed(2)),
    paraSpacing: Number(num(src.paraSpacing, DEFAULT_READER_SETTINGS.paraSpacing, READER_RANGES.paraSpacing.min, READER_RANGES.paraSpacing.max).toFixed(2)),
    letterSpacing: Number(num(src.letterSpacing, 0, READER_RANGES.letterSpacing.min, READER_RANGES.letterSpacing.max).toFixed(3)),
    pageWidth: READER_PAGE_WIDTHS.includes(Number(src.pageWidth) as (typeof READER_PAGE_WIDTHS)[number]) ? Number(src.pageWidth) : DEFAULT_READER_SETTINGS.pageWidth,
    pageMargin: Math.round(num(src.pageMargin, DEFAULT_READER_SETTINGS.pageMargin, READER_RANGES.pageMargin.min, READER_RANGES.pageMargin.max)),
    pagePaddingY: Math.round(num(src.pagePaddingY, DEFAULT_READER_SETTINGS.pagePaddingY, READER_RANGES.pagePaddingY.min, READER_RANGES.pagePaddingY.max)),
    indent: src.indent !== false,
    justify: src.justify !== false,
    customBg: /^#[0-9a-f]{6}$/i.test(customBg) ? customBg.toLowerCase() : "",
    mode: src.mode === "page" ? "page" : "scroll",
    autoHide: src.autoHide !== false,
    autoScroll: src.autoScroll === true,
    autoSpeed: Math.round(num(src.autoSpeed, DEFAULT_READER_SETTINGS.autoSpeed, READER_RANGES.autoSpeed.min, READER_RANGES.autoSpeed.max)),
    ttsRate: Number(num(src.ttsRate, 1, READER_RANGES.ttsRate.min, READER_RANGES.ttsRate.max).toFixed(2)),
    ttsEngine: src.ttsEngine === "system" || src.ttsEngine === "http" ? src.ttsEngine : "auto",
    ttsVoice: String(src.ttsVoice ?? "").trim().slice(0, 120),
    warmth: Math.round(num(src.warmth, 0, 0, 100)),
    dim: Math.round(num(src.dim, 0, 0, 100)),
    pageAnimation: src.pageAnimation === "none" || src.pageAnimation === "fade" ? src.pageAnimation : "slide",
    tapGrid: normalizeTapGrid(src.tapGrid, DEFAULT_TAP_GRID),
    swipeTurn: src.swipeTurn !== false,
    edgeAdjust: src.edgeAdjust !== false,
    keepAwake: src.keepAwake !== false,
    spread: src.spread === true,
    desktopCatalog: src.desktopCatalog !== false,
    readout: normalizeReadout(src.readout),
    readoutAlways: src.readoutAlways === true,
    followSystemTheme: src.followSystemTheme === true,
    paragraph: normalizeParagraphOptions(src.paragraph),
  };
}

export function loadReaderSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeReaderSettings(JSON.parse(raw) as Partial<ReaderSettings>);
  } catch {
    /* ignore malformed settings */
  }
  // Migrate the flat keys written by 0.1.x / SettingsPage.
  const legacy: Partial<ReaderSettings> = {
    theme: (localStorage.getItem("reader-theme") as ReaderThemeId) ?? undefined,
    fontSize: Number(localStorage.getItem("reader-font-size")) || undefined,
    lineHeight: Number(localStorage.getItem("reader-line-height")) || undefined,
    mode: (localStorage.getItem("reader-mode") as ReaderMode) ?? undefined,
  };
  return normalizeReaderSettings(legacy);
}

export function saveReaderSettings(settings: ReaderSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    localStorage.setItem("reader-theme", settings.theme);
    localStorage.setItem("reader-font-size", String(settings.fontSize));
    localStorage.setItem("reader-line-height", String(settings.lineHeight));
    localStorage.setItem("reader-mode", settings.mode);
  } catch {
    /* storage may be unavailable in private mode */
  }
}

export function toServerSettings(settings: ReaderSettings): Record<string, string> {
  return {
    theme: settings.theme,
    fontSize: String(settings.fontSize),
    lineHeight: String(settings.lineHeight),
    "reader-font-weight": String(settings.fontWeight),
    "reader-page-padding-y": String(settings.pagePaddingY),
    readerMode: settings.mode,
    "reader-font-family": settings.fontFamily,
    "reader-custom-font": settings.customFont,
    "reader-para-spacing": String(settings.paraSpacing),
    "reader-letter-spacing": String(settings.letterSpacing),
    "reader-page-width": String(settings.pageWidth),
    "reader-page-margin": String(settings.pageMargin),
    "reader-indent": settings.indent ? "1" : "0",
    "reader-justify": settings.justify ? "1" : "0",
    "reader-custom-bg": settings.customBg,
    "reader-auto-hide": settings.autoHide ? "1" : "0",
    "reader-auto-scroll": settings.autoScroll ? "1" : "0",
    "reader-auto-speed": String(settings.autoSpeed),
    "reader-tts-rate": String(settings.ttsRate),
    "reader-tts-engine": settings.ttsEngine,
    "reader-tts-voice": settings.ttsVoice,
    "reader-warmth": String(settings.warmth),
    "reader-dim": String(settings.dim),
    "reader-page-animation": settings.pageAnimation,
    "reader-tap-grid": JSON.stringify(settings.tapGrid),
    "reader-swipe-turn": settings.swipeTurn ? "1" : "0",
    "reader-edge-adjust": settings.edgeAdjust ? "1" : "0",
    "reader-keep-awake": settings.keepAwake ? "1" : "0",
    "reader-spread": settings.spread ? "1" : "0",
    "reader-desktop-catalog": settings.desktopCatalog ? "1" : "0",
    "reader-readout": JSON.stringify(settings.readout),
    "reader-readout-always": settings.readoutAlways ? "1" : "0",
    "reader-follow-system": settings.followSystemTheme ? "1" : "0",
    "reader-paragraph": JSON.stringify(settings.paragraph),
  };
}

function parseJson(value: string | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function fromServerSettings(all: Record<string, string>): Partial<ReaderSettings> {
  const out: Partial<ReaderSettings> = {};
  if (all.theme) out.theme = all.theme as ReaderThemeId;
  if (all.fontSize) out.fontSize = Number(all.fontSize);
  if (all.lineHeight) out.lineHeight = Number(all.lineHeight);
  if (all["reader-font-weight"]) out.fontWeight = Number(all["reader-font-weight"]) as ReaderSettings["fontWeight"];
  if (all["reader-page-padding-y"]) out.pagePaddingY = Number(all["reader-page-padding-y"]);
  if (all.readerMode) out.mode = all.readerMode === "page" ? "page" : "scroll";
  if (all["reader-font-family"]) out.fontFamily = all["reader-font-family"] as ReaderFontId;
  if (all["reader-custom-font"] !== undefined) out.customFont = all["reader-custom-font"];
  if (all["reader-para-spacing"]) out.paraSpacing = Number(all["reader-para-spacing"]);
  if (all["reader-letter-spacing"]) out.letterSpacing = Number(all["reader-letter-spacing"]);
  if (all["reader-page-width"]) out.pageWidth = Number(all["reader-page-width"]);
  if (all["reader-page-margin"]) out.pageMargin = Number(all["reader-page-margin"]);
  if (all["reader-indent"]) out.indent = all["reader-indent"] !== "0";
  if (all["reader-justify"]) out.justify = all["reader-justify"] !== "0";
  if (all["reader-custom-bg"] !== undefined) out.customBg = all["reader-custom-bg"];
  if (all["reader-auto-hide"]) out.autoHide = all["reader-auto-hide"] !== "0";
  if (all["reader-auto-scroll"]) out.autoScroll = all["reader-auto-scroll"] !== "0";
  if (all["reader-auto-speed"]) out.autoSpeed = Number(all["reader-auto-speed"]);
  if (all["reader-tts-rate"]) out.ttsRate = Number(all["reader-tts-rate"]);
  if (all["reader-tts-engine"] === "system" || all["reader-tts-engine"] === "http" || all["reader-tts-engine"] === "auto") {
    out.ttsEngine = all["reader-tts-engine"];
  }
  if (all["reader-tts-voice"] !== undefined) out.ttsVoice = all["reader-tts-voice"];
  if (all["reader-warmth"]) out.warmth = Number(all["reader-warmth"]);
  if (all["reader-dim"]) out.dim = Number(all["reader-dim"]);
  if (all["reader-page-animation"] === "none" || all["reader-page-animation"] === "slide" || all["reader-page-animation"] === "fade") {
    out.pageAnimation = all["reader-page-animation"];
  }
  const tapGrid = parseJson(all["reader-tap-grid"]);
  if (tapGrid) out.tapGrid = normalizeTapGrid(tapGrid, DEFAULT_TAP_GRID);
  if (all["reader-swipe-turn"]) out.swipeTurn = all["reader-swipe-turn"] !== "0";
  if (all["reader-edge-adjust"]) out.edgeAdjust = all["reader-edge-adjust"] !== "0";
  if (all["reader-keep-awake"]) out.keepAwake = all["reader-keep-awake"] !== "0";
  if (all["reader-spread"]) out.spread = all["reader-spread"] !== "0";
  if (all["reader-desktop-catalog"]) out.desktopCatalog = all["reader-desktop-catalog"] !== "0";
  const readout = parseJson(all["reader-readout"]);
  if (readout) out.readout = normalizeReadout(readout);
  if (all["reader-readout-always"]) out.readoutAlways = all["reader-readout-always"] !== "0";
  if (all["reader-follow-system"]) out.followSystemTheme = all["reader-follow-system"] !== "0";
  const paragraph = parseJson(all["reader-paragraph"]);
  if (paragraph) out.paragraph = normalizeParagraphOptions(paragraph);
  return out;
}

export function themeById(id: string): ReaderTheme {
  return READER_THEMES.find((t) => t.id === id) ?? READER_THEMES[0];
}

/**
 * Derived palette: the chosen theme, with the user's own background and a readable
 * foreground/panel/border computed from its luminance. No colour picker can produce
 * unreadable dark-on-dark text.
 */
/** The theme actually in force: an explicit choice, or the OS preference when following it. */
export function effectiveTheme(settings: ReaderSettings, systemDark = false): ReaderThemeId {
  if (settings.followSystemTheme) return systemDark ? "night" : "paper";
  return settings.theme;
}

export function readerPalette(settings: ReaderSettings, systemDark = false): ReaderTheme {
  const base = themeById(effectiveTheme(settings, systemDark));
  if (!settings.customBg) return base;
  const bg = settings.customBg;
  const fg = pickReadableInk(bg);
  return {
    ...base,
    bg,
    fg,
    muted: ensureContrast(base.muted, bg, 3),
    panel: mixHex(bg, fg, 0.08),
    border: rgbaFromHex(fg, 0.16),
    accent: ensureContrast(base.accent, bg, 3),
  };
}

export function fontStack(id: ReaderFontId, custom = ""): string {
  const base = (READER_FONTS.find((f) => f.id === id) ?? READER_FONTS[0]).stack;
  const customName = custom.trim();
  return customName ? `"${customName}", ${base}` : base;
}
