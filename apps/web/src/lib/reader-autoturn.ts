/**
 * 分页模式的自动翻页：每页停留多久由屏高与滚动速度换算，
 * 这样滚动模式的 40 px/s 与分页模式的「一屏 / 40px 秒」是同一种手感，
 * 读者换模式时不用重新找速度。
 */

/** 再快也至少给一秒半，否则读者还没看完就翻走了。 */
export const MIN_DWELL_MS = 1500;
/** 再慢也别超过两分钟，否则看起来像卡住了。 */
export const MAX_DWELL_MS = 120_000;
const FALLBACK_DWELL_MS = 8000;

export function clampDwell(ms: number): number {
  if (!Number.isFinite(ms)) return FALLBACK_DWELL_MS;
  return Math.round(Math.min(MAX_DWELL_MS, Math.max(MIN_DWELL_MS, ms)));
}

/** 屏高（px）÷ 速度（px/s）= 一屏读多久。参数不可用时给一个温和的默认值。 */
export function pageDwellMs(pageHeight: number, speed: number): number {
  const height = Number.isFinite(pageHeight) ? pageHeight : 0;
  const rate = Number.isFinite(speed) ? speed : 0;
  if (height <= 0 || rate <= 0) return FALLBACK_DWELL_MS;
  return clampDwell((height / rate) * 1000);
}

export function formatDwell(ms: number): string {
  const seconds = Math.max(1, Math.round(clampDwell(ms) / 1000));
  if (seconds < 60) return seconds + " 秒/页";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? minutes + " 分 " + rest + " 秒/页" : minutes + " 分/页";
}
