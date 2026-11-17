/** 左右边缘上下滑：左边调亮度，右边调字号。 */
export type AdjustKind = "brightness" | "font";

/** 每边占屏幕宽度的四分之一；中间留给点击、长按与左右翻页。 */
export const ADJUST_ZONE_RATIO = 0.25;

/** 从按下到拖满整个可调区间需要的行程：屏高的 60%。 */
export const ADJUST_TRAVEL_RATIO = 0.6;

/** 手指落在左/右边缘时返回要调的东西，中间返回 null。 */
export function adjustZoneAt(x: number, width: number): AdjustKind | null {
  if (!(width > 0) || !Number.isFinite(x)) return null;
  const ratio = x / width;
  if (ratio < ADJUST_ZONE_RATIO) return "brightness";
  if (ratio > 1 - ADJUST_ZONE_RATIO) return "font";
  return null;
}

/** 上滑变大、下滑变小；返回值是「相对按下时的增量」。 */
export function adjustDelta(dy: number, viewportHeight: number, span: number): number {
  if (!(viewportHeight > 0) || !(span > 0) || !Number.isFinite(dy) || dy === 0) return 0;
  return (-dy / (viewportHeight * ADJUST_TRAVEL_RATIO)) * span;
}

export function applyAdjust(base: number, dy: number, viewportHeight: number, span: number, min: number, max: number): number {
  const next = base + adjustDelta(dy, viewportHeight, span);
  if (!Number.isFinite(next)) return min;
  return Math.min(max, Math.max(min, next));
}

/** 0–100，给提示条里的进度用。 */
export function adjustPercent(value: number, min: number, max: number): number {
  if (!(max > min)) return 0;
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

export function adjustLabel(kind: AdjustKind): string {
  return kind === "brightness" ? "亮度" : "字号";
}

export function adjustText(kind: AdjustKind, value: number): string {
  return `${adjustLabel(kind)} ${Math.round(value)}`;
}
