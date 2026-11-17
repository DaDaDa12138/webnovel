import { describe, expect, it } from "vitest";
import { filterSearchItems, searchHealthFilterLabel } from "../apps/web/src/lib/search-health";

const items = [
  { name: "健康", healthState: "healthy" },
  { name: "待补测", healthState: "partial" },
  { name: "降级", healthState: "degraded" },
  { name: "未测", healthState: "unknown" },
  { name: "需登录", healthState: "blocked" },
  { name: "失效", healthState: "broken" },
  { name: "旧结果" },
];

describe("搜索页来源健康筛选", () => {
  it("全部来源原样返回", () => {
    expect(filterSearchItems(items, "all")).toHaveLength(7);
  });

  it("可用来源排除需登录与失效，保留旧结果", () => {
    expect(filterSearchItems(items, "usable").map((item) => item.name)).toEqual(["健康", "待补测", "降级", "未测", "旧结果"]);
  });

  it("仅健康只保留 healthy", () => {
    expect(filterSearchItems(items, "healthy").map((item) => item.name)).toEqual(["健康"]);
  });

  it("筛选文案固定", () => {
    expect(searchHealthFilterLabel("all")).toBe("全部来源");
    expect(searchHealthFilterLabel("usable")).toBe("可用来源");
    expect(searchHealthFilterLabel("healthy")).toBe("仅健康");
  });
});
