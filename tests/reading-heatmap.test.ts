import { describe, expect, it } from "vitest";
import { buildHeatmap, dayKey, levelFor, longestStreak, mondayIndex } from "../apps/web/src/lib/reading-heatmap";

describe("levelFor", () => {
  it("按每日目标的四档分级", () => {
    expect(levelFor(0, 1800)).toBe(0);
    expect(levelFor(60, 1800)).toBe(1);
    expect(levelFor(600, 1800)).toBe(2);
    expect(levelFor(1200, 1800)).toBe(3);
    expect(levelFor(1800, 1800)).toBe(4);
    expect(levelFor(3600, 1800)).toBe(4);
  });

  it("目标非法时按 30 分钟兜底", () => {
    expect(levelFor(1200, 0)).toBe(3);
  });
});

describe("buildHeatmap", () => {
  it("周一起始，最后一列是今天所在的那一周", () => {
    // 2026-11-02 是周一
    const map = buildHeatmap([{ day: "2026-11-01", seconds: 900 }], "2026-11-02", 2, 1800);
    expect(map.columns).toHaveLength(2);
    expect(map.columns[0].cells[0]?.day).toBe("2026-10-26");
    expect(map.columns[0].cells[6]?.day).toBe("2026-11-01");
    expect(map.columns[1].cells[0]?.day).toBe("2026-11-02");
    // 明天以后是 null，不会画出「未来已读」
    expect(map.columns[1].cells[1]).toBeNull();
    expect(map.columns[0].cells[6]).toMatchObject({ seconds: 900, level: 3 });
    expect(map.activeDays).toBe(1);
    expect(map.totalSeconds).toBe(900);
  });

  it("月份标签只挂在月份变化的那一列", () => {
    const map = buildHeatmap([], "2026-11-02", 6, 1800);
    const labels = map.months.map((item) => item.label);
    expect(labels[0]).toBe("9月");
    expect(labels).toContain("10月");
    expect(labels).toContain("11月");
    // 同一个月不会重复打标签
    expect(new Set(map.months.map((item) => item.column)).size).toBe(map.months.length);
  });

  it("同一天多条记录会累加", () => {
    const map = buildHeatmap(
      [
        { day: "2026-11-01", seconds: 600 },
        { day: "2026-11-01", seconds: 600 },
      ],
      "2026-11-02",
      2,
      1800,
    );
    expect(map.columns[0].cells[6]).toMatchObject({ seconds: 1200, level: 3 });
  });
});

describe("longestStreak", () => {
  it("连续三天算 3", () => {
    expect(longestStreak(["2026-10-30", "2026-10-31", "2026-11-01"])).toBe(3);
  });

  it("中断后重新计数，取最长的一段", () => {
    expect(longestStreak(["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"])).toBe(3);
  });

  it("重复日期只算一次", () => {
    expect(longestStreak(["2026-10-01", "2026-10-01", "2026-10-02"])).toBe(2);
  });

  it("空数据是 0", () => {
    expect(longestStreak([])).toBe(0);
  });
});

describe("helpers", () => {
  it("mondayIndex 把周日算成 6", () => {
    expect(mondayIndex(new Date("2026-11-02T00:00:00"))).toBe(0);
    expect(mondayIndex(new Date("2026-11-08T00:00:00"))).toBe(6);
  });

  it("dayKey 补零", () => {
    expect(dayKey(new Date("2026-01-05T00:00:00"))).toBe("2026-01-05");
  });
});
