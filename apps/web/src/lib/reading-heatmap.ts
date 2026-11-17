/**
 * 阅读热力图的纯函数：一年 53 列 × 7 行（周一起始），以及最长连续天数。
 * 放在 lib/ 里，测试不需要 DOM。
 */

export interface HeatDay {
  day: string;
  seconds: number;
}

export interface HeatCell {
  day: string;
  seconds: number;
  /** 0 无记录，1–4 按「相对每日目标」分档。 */
  level: number;
}

export interface HeatColumn {
  /** 周一到周日；未来日期为 null，这样最后一列不会画到明天。 */
  cells: Array<HeatCell | null>;
}

export interface Heatmap {
  columns: HeatColumn[];
  /** 月份标签挂在「这一列的周一」所在月份变化的那一列。 */
  months: Array<{ column: number; label: string }>;
  totalSeconds: number;
  activeDays: number;
}

const DAY_MS = 86_400_000;

export function parseDay(day: string): Date {
  return new Date(day + "T00:00:00");
}

export function dayKey(date: Date): string {
  return (
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0")
  );
}

/** 0 = 周一 … 6 = 周日（Date.getDay() 的 0 是周日，要挪一位）。 */
export function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

export function levelFor(seconds: number, goalSeconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const goal = goalSeconds > 0 ? goalSeconds : 1800;
  const ratio = seconds / goal;
  if (ratio < 0.25) return 1;
  if (ratio < 0.5) return 2;
  if (ratio < 1) return 3;
  return 4;
}

/**
 * 生成热力图。endDay 是「今天」，最后一列是今天所在的那一周；
 * 一周从周一开始（中文习惯），而不是 GitHub 的周日。
 */
export function buildHeatmap(days: HeatDay[], endDay: string, weeks = 53, goalSeconds = 1800): Heatmap {
  const lookup = new Map<string, number>();
  for (const item of days) {
    if (!item?.day) continue;
    lookup.set(item.day, (lookup.get(item.day) ?? 0) + Math.max(0, Number(item.seconds) || 0));
  }
  const end = parseDay(endDay);
  const span = Math.max(1, Math.floor(weeks));
  const start = new Date(end.getTime() - (mondayIndex(end) + (span - 1) * 7) * DAY_MS);

  const columns: HeatColumn[] = [];
  const months: Array<{ column: number; label: string }> = [];
  let lastMonth = -1;
  let totalSeconds = 0;
  let activeDays = 0;

  for (let column = 0; column < span; column += 1) {
    const monday = new Date(start.getTime() + column * 7 * DAY_MS);
    if (monday.getMonth() !== lastMonth) {
      lastMonth = monday.getMonth();
      months.push({ column, label: monday.getMonth() + 1 + "月" });
    }
    const cells: Array<HeatCell | null> = [];
    for (let row = 0; row < 7; row += 1) {
      const date = new Date(monday.getTime() + row * DAY_MS);
      if (date.getTime() > end.getTime()) {
        cells.push(null);
        continue;
      }
      const key = dayKey(date);
      const seconds = lookup.get(key) ?? 0;
      if (seconds > 0) {
        totalSeconds += seconds;
        activeDays += 1;
      }
      cells.push({ day: key, seconds, level: levelFor(seconds, goalSeconds) });
    }
    columns.push({ cells });
  }

  return { columns, months, totalSeconds, activeDays };
}

/** 最长连续阅读天数；跨月、跨年都只是字符串日期序列的比较。 */
export function longestStreak(dayKeys: string[]): number {
  const unique = [...new Set(dayKeys)].sort();
  let best = 0;
  let run = 0;
  let previous = "";
  for (const key of unique) {
    if (!key) continue;
    const expected = previous ? dayKey(new Date(parseDay(previous).getTime() + DAY_MS)) : "";
    run = previous && key === expected ? run + 1 : 1;
    if (run > best) best = run;
    previous = key;
  }
  return best;
}
