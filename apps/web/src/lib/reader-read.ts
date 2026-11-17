/** 目录里的已读摘要：只做展示用的纯函数。 */

export function readCount(read: Iterable<number>, total: number): number {
  const safeTotal = Math.max(0, Math.floor(total));
  let count = 0;
  for (const index of read) {
    if (Number.isInteger(index) && index >= 0 && index < safeTotal) count += 1;
  }
  return count;
}

export function readPercent(read: Iterable<number>, total: number): number {
  const safeTotal = Math.max(0, Math.floor(total));
  if (!safeTotal) return 0;
  return Math.min(100, Math.round((readCount(read, safeTotal) / safeTotal) * 100));
}

export function readLabel(read: Iterable<number>, total: number): string {
  const safeTotal = Math.max(0, Math.floor(total));
  if (!safeTotal) return "0 章";
  const count = readCount(read, safeTotal);
  // 一本没读过的书显示「1081 章」就够了，「已读 0 / 1081」只会让目录显得吵。
  if (!count) return safeTotal + " 章";
  return "已读 " + count + " / " + safeTotal + " 章";
}
