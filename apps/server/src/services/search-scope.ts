/**
 * 搜索源池的健康范围。
 *
 * - usable：默认值，排除 blocked/broken，保留 healthy/partial/unknown/degraded；
 * - healthy：只搜四阶段都正常、评分达标的源；
 * - all：不按健康过滤，只给调试/显式单源测试使用。
 *
 * 显式传入 sourceIds 时调用方会绕过这个范围：用户已经点名某个源，就不该被
 * 默认门禁悄悄吞掉。
 */
export type SearchHealthScope = "all" | "usable" | "healthy";

export function normalizeSearchHealthScope(value: unknown): SearchHealthScope {
  const scope = String(value ?? "").trim().toLowerCase();
  if (scope === "healthy" || scope === "all") return scope;
  return "usable";
}

/** 生成 book_sources 查询里的健康过滤 SQL；只拼接固定字符串，不接受用户输入。 */
export function searchHealthWhere(scope: SearchHealthScope): string {
  if (scope === "healthy") return " AND health_state = 'healthy'";
  if (scope === "all") return "";
  return " AND status != 'error' AND health_state NOT IN ('blocked', 'broken')";
}
