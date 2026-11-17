import type { HealthState } from "./api.js";

/**
 * 书源健康的统一排序/门禁语义。
 *
 * 0.57 起搜索、换源、自动换源、更新器都按同一套顺序判断，避免一个页面把
 * degraded 当可用、另一个页面又把它当坏源。unknown 排在 degraded 前面：
 * 没体检过不等于坏，只是还没有证据。
 */
export const HEALTH_STATE_ORDER: Record<HealthState, number> = {
  healthy: 0,
  partial: 1,
  unknown: 2,
  degraded: 3,
  blocked: 4,
  broken: 5,
};

export function healthStateRank(state?: string | null): number {
  const key = String(state ?? "") as HealthState;
  return key in HEALTH_STATE_ORDER ? HEALTH_STATE_ORDER[key] : HEALTH_STATE_ORDER.unknown;
}

/** 自动搜索/换源/更新可以尝试的源；blocked 需要登录，broken 已经连续硬失败。 */
export function isHealthUsable(state?: string | null): boolean {
  return state !== "blocked" && state !== "broken";
}

/**
 * 更新器门禁：健康分足够高的 degraded 仍可刷新元数据，只有 broken/blocked
 * 和低分 degraded 才拒绝。旧库没有 health_state 时退回原来的 status 规则。
 */
export function canRefreshFromHealth(
  state: string | null | undefined,
  score: number | null | undefined,
  legacyStatus: string | null | undefined,
): boolean {
  const normalized = String(state ?? "");
  if (normalized === "broken" || normalized === "blocked") return false;
  if (normalized === "healthy" || normalized === "partial") return true;
  if (normalized === "degraded") return Number(score ?? 0) >= 45;
  if (normalized === "unknown") return legacyStatus === "ok" || legacyStatus === "retest";
  return legacyStatus === "ok";
}

export function healthStateLabel(state?: string | null): string {
  switch (state) {
    case "healthy":
      return "健康";
    case "partial":
      return "待补测";
    case "degraded":
      return "降级";
    case "blocked":
      return "需登录";
    case "broken":
      return "失效";
    default:
      return "未测";
  }
}
