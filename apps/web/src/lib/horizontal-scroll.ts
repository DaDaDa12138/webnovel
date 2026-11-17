export type HorizontalScrollState = {
  canLeft: boolean;
  canRight: boolean;
  overflowing: boolean;
};

/** 横向 chip 轨道的可滚动状态。tolerance 避免 1px 亚像素误差把箭头误判成可点。 */
export function horizontalScrollState(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
  tolerance = 2,
): HorizontalScrollState {
  const max = Math.max(0, scrollWidth - clientWidth);
  return {
    canLeft: scrollLeft > tolerance,
    canRight: scrollLeft < max - tolerance,
    overflowing: max > tolerance,
  };
}

/** 鼠标拖动后的目标 scrollLeft：向左拖内容右移，scrollLeft 变大。 */
export function dragScrollLeft(startLeft: number, startX: number, currentX: number): number {
  return startLeft - (currentX - startX);
}
