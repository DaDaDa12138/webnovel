/**
 * 插图查看器的几何：只做纯计算，DOM 与指针事件留在组件里。
 *
 * 约定：1× 表示「图片按容器等比装下」（CSS max-width/max-height 负责），
 * 缩放只在这个基准上做乘法，所以同一张 600px 图和 4000px 图的手感一致。
 */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
export const DOUBLE_TAP_ZOOM = 2.5;

export interface ZoomSize {
  width: number;
  height: number;
}

export interface ZoomOffset {
  x: number;
  y: number;
}

/** 夹到 [1, 5]；NaN / 负数 / 0 一律回到 1（手势算错时不能让图消失）。 */
export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/** 双击缩放：已经放大了就还原，否则放大到 2.5×。 */
export function toggleZoom(current: number): number {
  return clampZoom(current) > 1.01 ? MIN_ZOOM : DOUBLE_TAP_ZOOM;
}

/**
 * 平移上限：图片放大后超出容器的部分一半，就是能拖动的最大距离。
 * 没超出时返回 0 —— 小图不该被拖离中心。
 */
export function panLimit(content: number, viewport: number, zoom: number): number {
  if (!Number.isFinite(content) || !Number.isFinite(viewport) || !Number.isFinite(zoom)) return 0;
  return Math.max(0, (content * clampZoom(zoom) - viewport) / 2);
}

export function clampPan(value: number, limit: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(limit) || limit <= 0) return 0;
  return Math.min(limit, Math.max(-limit, value));
}

/**
 * 以某个焦点缩放（滚轮 / 双指）：焦点下的像素保持不动。
 * focal 是相对容器中心的坐标，ratio 是「新缩放 / 旧缩放」。
 */
export function zoomAround(offset: number, focal: number, ratio: number): number {
  if (!Number.isFinite(offset) || !Number.isFinite(focal) || !Number.isFinite(ratio)) return 0;
  return focal + (offset - focal) * ratio;
}

/** 双指捏合时的新缩放：起点缩放 × 当前两指距离 / 起点距离。 */
export function pinchZoom(startZoom: number, startDistance: number, distance: number): number {
  if (!Number.isFinite(startDistance) || startDistance <= 0) return clampZoom(startZoom);
  return clampZoom(startZoom * (distance / startDistance));
}

/** 两指中点（相对容器中心），用来在捏合的同时跟手平移。 */
export function pinchCenter(a: { x: number; y: number }, b: { x: number; y: number }, frame: ZoomSize): ZoomOffset {
  return { x: (a.x + b.x) / 2 - frame.width / 2, y: (a.y + b.y) / 2 - frame.height / 2 };
}
