import { isHealthUsable } from "@legado/shared";

export type SearchHealthFilter = "all" | "usable" | "healthy";

/**
 * 搜索页的“来源健康”筛选只作用于已经拿到的搜索结果，不重新发起搜索：
 * - all：全部来源；
 * - usable：排除 blocked/broken，保留 healthy/partial/unknown/degraded；
 * - healthy：只保留四阶段都正常、评分达标的源。
 */
export function filterSearchItems<T extends { healthState?: string | null }>(
  items: T[],
  filter: SearchHealthFilter,
): T[] {
  if (filter === "healthy") return items.filter((item) => item.healthState === "healthy");
  if (filter === "usable") return items.filter((item) => isHealthUsable(item.healthState));
  return items;
}

export function searchHealthFilterLabel(filter: SearchHealthFilter): string {
  return { all: "全部来源", usable: "可用来源", healthy: "仅健康" }[filter];
}
