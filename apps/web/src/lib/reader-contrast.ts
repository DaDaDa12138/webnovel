/** WCAG contrast helpers: the settings sheet warns when a custom background would make the
 * text unreadable, instead of silently producing grey-on-grey pages. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(hex: string): Rgb | null {
  const value = String(hex ?? "").trim().replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** Contrast ratio between two colours, 1..21. Returns 1 for unparseable input. */
export function contrastRatio(a: string, b: string): number {
  if (!parseHex(a) || !parseHex(b)) return 1;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

export const READABLE_INK = { light: "#26251f", dark: "#e8e6e1" };

function toHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

/** Linear RGB mix; amount 0 returns `a`, 1 returns `b`. */
export function mixHex(a: string, b: string, amount: number): string {
  const from = parseHex(a);
  const to = parseHex(b);
  if (!from || !to) return a;
  const t = Math.max(0, Math.min(1, amount));
  return "#" + toHex(from.r + (to.r - from.r) * t) + toHex(from.g + (to.g - from.g) * t) + toHex(from.b + (to.b - from.b) * t);
}

/** `#rrggbb` + alpha → CSS rgba(), for borders that should follow the ink. */
export function rgbaFromHex(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return `rgba(0, 0, 0, ${Math.max(0, Math.min(1, alpha))})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.max(0, Math.min(1, alpha))})`;
}

/**
 * Nudge `fg` toward black or white until it reaches `minimum` against `bg`.
 * A custom background in the middle of the luminance range is the case this exists for:
 * picking only between two fixed inks is not enough to guarantee AA there.
 */
export function ensureContrast(fg: string, bg: string, minimum = 4.5): string {
  if (!parseHex(fg) || !parseHex(bg)) return fg;
  if (contrastRatio(fg, bg) >= minimum) return fg;
  const target = contrastRatio("#000000", bg) >= contrastRatio("#ffffff", bg) ? "#000000" : "#ffffff";
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mixHex(fg, target, step / 20);
    if (contrastRatio(candidate, bg) >= minimum) return candidate;
  }
  return target;
}

/** Ink colour that maximises contrast against `bg`, then guarantees AA for body text. */
export function pickReadableInk(bg: string): string {
  const base = contrastRatio(bg, READABLE_INK.light) >= contrastRatio(bg, READABLE_INK.dark)
    ? READABLE_INK.light
    : READABLE_INK.dark;
  return ensureContrast(base, bg);
}

/** True when the pair is below the WCAG AA threshold for body text. */
export function isLowContrast(fg: string, bg: string, minimum = 4.5): boolean {
  return contrastRatio(fg, bg) < minimum;
}
