import type { DB } from "../db/index.js";
import type {
  HealthStage,
  HealthStageStatus,
  HealthState,
  SourceHealth,
  SourceHealthSummary,
} from "@legado/shared";

export interface CheckOutcome {
  /** Error message when the check threw; empty on success. */
  error?: string;
  /** Number of books found; 0 means "reachable but nothing matched". */
  count?: number;
  ms?: number;
}

export const HEALTH_STAGES: HealthStage[] = ["search", "detail", "toc", "content"];
export const HEALTH_STATES: HealthState[] = ["unknown", "partial", "healthy", "degraded", "blocked", "broken"];

const STAGE_WEIGHTS: Record<HealthStage, number> = {
  search: 25,
  detail: 15,
  toc: 25,
  content: 35,
};

/** 阶段质量：blocked 是可解释的停用（没登录/没会员），empty 是「通了但没内容」，都不算硬坏。 */
const STAGE_QUALITY: Record<HealthStageStatus, number> = {
  ok: 1,
  blocked: 0.6,
  empty: 0.3,
  fail: 0,
  skip: 0,
};

const LEGACY_BY_STATE: Record<HealthState, string> = {
  unknown: "unknown",
  partial: "ok",
  healthy: "ok",
  degraded: "retest",
  blocked: "retest",
  broken: "error",
};

export function emptyHealth(): SourceHealth {
  return {
    version: 1,
    score: 0,
    state: "unknown",
    checks: 0,
    ok: 0,
    avgMs: 0,
    lastOkAt: null,
    lastFailAt: null,
    lastStage: "",
    lastStageError: "",
    lastStageAt: null,
    stages: {},
    failStreak: 0,
  };
}

function text(value: unknown, max = 300): string {
  return String(value ?? "").slice(0, max);
}

function validStage(value: unknown): value is HealthStage {
  return typeof value === "string" && (HEALTH_STAGES as string[]).includes(value);
}

function validStageStatus(value: unknown): value is HealthStageStatus {
  return typeof value === "string" && ["ok", "empty", "blocked", "fail", "skip"].includes(value);
}

/** 解析 health_json；坏 JSON/旧版本一律退回空快照，绝不让健康数据拖垮书源列表。 */
export function parseSourceHealth(raw: unknown): SourceHealth {
  const base = emptyHealth();
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return base;
    try {
      value = JSON.parse(raw);
    } catch {
      return base;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const obj = value as Record<string, unknown>;
  const stages: SourceHealth["stages"] = {};
  const rawStages = obj.stages;
  if (rawStages && typeof rawStages === "object" && !Array.isArray(rawStages)) {
    for (const [key, entry] of Object.entries(rawStages as Record<string, unknown>)) {
      if (!validStage(key) || !entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      if (!validStageStatus(item.status)) continue;
      const at = text(item.at, 40) || new Date().toISOString();
      const stage: NonNullable<SourceHealth["stages"][HealthStage]> = {
        status: item.status,
        at,
        ms: Math.max(0, Number(item.ms ?? 0)),
      };
      if (typeof item.count === "number") stage.count = Math.max(0, Math.floor(item.count));
      if (typeof item.chars === "number") stage.chars = Math.max(0, Math.floor(item.chars));
      if (typeof item.code === "string" && item.code) stage.code = text(item.code, 80);
      if (typeof item.message === "string" && item.message) stage.message = text(item.message);
      stages[key] = stage;
    }
  }
  const state = typeof obj.state === "string" && (HEALTH_STATES as string[]).includes(obj.state) ? (obj.state as HealthState) : base.state;
  return {
    version: 1,
    score: Math.max(0, Math.min(100, Math.round(Number(obj.score ?? 0)))),
    state,
    checks: Math.max(0, Math.floor(Number(obj.checks ?? 0))),
    ok: Math.max(0, Math.floor(Number(obj.ok ?? 0))),
    avgMs: Math.max(0, Math.round(Number(obj.avgMs ?? 0))),
    lastOkAt: typeof obj.lastOkAt === "string" && obj.lastOkAt ? text(obj.lastOkAt, 40) : null,
    lastFailAt: typeof obj.lastFailAt === "string" && obj.lastFailAt ? text(obj.lastFailAt, 40) : null,
    lastStage: validStage(obj.lastStage) ? obj.lastStage : "",
    lastStageError: text(obj.lastStageError),
    lastStageAt: typeof obj.lastStageAt === "string" && obj.lastStageAt ? text(obj.lastStageAt, 40) : null,
    stages,
    failStreak: Math.max(0, Math.floor(Number(obj.failStreak ?? 0))),
  };
}

/** book_sources 行里的物化字段优先，health_json 只当快照。 */
export function healthFromRow(row: Record<string, unknown> | undefined | null): SourceHealth {
  const health = parseSourceHealth(row?.health_json);
  if (row && Number(row.health_checks ?? 0) > 0) {
    health.checks = Math.floor(Number(row.health_checks ?? 0));
    health.ok = Math.floor(Number(row.health_ok ?? 0));
    health.avgMs = Math.round(Number(row.avg_ms ?? 0));
    health.score = Math.round(Number(row.health_score ?? 0));
    const state = String(row.health_state ?? health.state) as HealthState;
    if ((HEALTH_STATES as string[]).includes(state)) health.state = state;
    if (typeof row.last_ok_at === "string") health.lastOkAt = row.last_ok_at;
    if (typeof row.last_fail_at === "string") health.lastFailAt = row.last_fail_at;
    if (validStage(row.last_stage)) health.lastStage = row.last_stage;
    if (typeof row.last_stage_error === "string") health.lastStageError = row.last_stage_error;
    if (typeof row.last_stage_at === "string") health.lastStageAt = row.last_stage_at;
  }
  return health;
}

export function computeHealthScore(health: SourceHealth): number {
  let weighted = 0;
  let denominator = 0;
  let coveredWeight = 0;
  for (const stage of HEALTH_STAGES) {
    const entry = health.stages[stage];
    if (!entry || entry.status === "skip") continue;
    const weight = STAGE_WEIGHTS[stage];
    denominator += weight;
    coveredWeight += weight;
    weighted += weight * STAGE_QUALITY[entry.status];
  }
  const stageQuality = denominator ? weighted / denominator : 0;
  const coverage = coveredWeight / 100;
  const reliability = (health.ok + 2.5) / (health.checks + 5);
  const avg = health.avgMs;
  const latency = avg <= 0 ? 1 : avg <= 800 ? 1 : avg <= 2000 ? 0.8 : avg <= 5000 ? 0.5 : 0.2;
  const score = stageQuality * (0.5 + 0.5 * coverage) * 70 + reliability * 20 + latency * 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * 状态判定。主动巡检的硬失败连续两次才 broken；普通搜索的被动失败只降级。
 * blocked（未登录/无会员）是「源还在，但这一路暂时走不通」，不能当失效站点清掉。
 */
export function computeHealthState(health: SourceHealth, active = true): HealthState {
  if (health.checks <= 0) return "unknown";
  const entries = HEALTH_STAGES.map((stage) => health.stages[stage]).filter(Boolean) as NonNullable<SourceHealth["stages"][HealthStage]>[];
  const hasFail = entries.some((entry) => entry.status === "fail");
  const hasEmpty = entries.some((entry) => entry.status === "empty");
  const hasBlocked = entries.some((entry) => entry.status === "blocked");
  const contentBlocked = health.stages.content?.status === "blocked";
  if (contentBlocked) return "blocked";
  if (health.failStreak >= 2) return "broken";
  if (health.failStreak >= 1) return "degraded";
  if (hasFail && !active) return "degraded";
  if (hasBlocked) return "blocked";
  const attempted = HEALTH_STAGES.filter((stage) => health.stages[stage] && health.stages[stage]?.status !== "skip");
  // 只测到「搜索能通但没结果」时，不能断言源已降级：多数是关键词没命中，后续阶段根本没机会跑。
  // 归为待补测，等换关键词或补测详情/目录/正文后再下结论。
  if (attempted.length === 1 && health.stages.search?.status === "empty") return "partial";
  if (hasEmpty) return "degraded";
  if (health.score < 45) return "broken";
  const allFourOk = HEALTH_STAGES.every((stage) => health.stages[stage]?.status === "ok");
  if (allFourOk && health.score >= 75) return "healthy";
  if (attempted.length === 1 && health.stages.search?.status === "ok") return "partial";
  return "degraded";
}

export function projectLegacyStatus(state: HealthState): string {
  return LEGACY_BY_STATE[state] ?? "unknown";
}

export function sourceHealthSummary(health: SourceHealth): SourceHealthSummary {
  const stageSummary: SourceHealthSummary["stageSummary"] = {};
  for (const stage of HEALTH_STAGES) {
    const entry = health.stages[stage];
    if (entry) stageSummary[stage] = entry.status;
  }
  return {
    healthScore: health.score,
    healthState: health.state,
    healthChecks: health.checks,
    healthOk: health.ok,
    avgMs: health.avgMs,
    lastOkAt: health.lastOkAt,
    lastFailAt: health.lastFailAt,
    lastStage: health.lastStage,
    lastStageError: health.lastStageError,
    lastStageAt: health.lastStageAt,
    stageSummary,
  };
}

interface WriteHealthOptions {
  /** 覆盖旧 status；不传时按 health_state 投影。 */
  legacyStatus?: string;
  legacyFailCount?: number;
  /** 写 last_check_at / last_ms / last_error；默认 true。 */
  touchCheckAt?: boolean;
  lastError?: string;
  lastMs?: number;
}

function writeHealth(db: DB, id: number, health: SourceHealth, options: WriteHealthOptions = {}): void {
  const status = options.legacyStatus ?? projectLegacyStatus(health.state);
  const failCount = options.legacyFailCount ?? Math.min(2, health.failStreak);
  const touch = options.touchCheckAt !== false;
  const lastError = options.lastError ?? health.lastStageError;
  const lastMs = options.lastMs ?? health.avgMs;
  health.score = computeHealthScore(health);
  health.avgMs = Math.max(0, Math.round(health.avgMs));
  const checkSql = touch ? ", last_check_at = datetime('now'), last_error = ?" : "";
  db.prepare(
    "UPDATE book_sources SET health_score = ?, health_state = ?, health_json = ?, health_checks = ?, health_ok = ?, avg_ms = ?, last_ok_at = ?, last_fail_at = ?, last_stage = ?, last_stage_error = ?, last_stage_at = ?, status = ?, fail_count = ?, last_ms = ?" +
      checkSql +
      " WHERE id = ?",
  ).run(
    health.score,
    health.state,
    JSON.stringify(health),
    health.checks,
    health.ok,
    health.avgMs,
    health.lastOkAt,
    health.lastFailAt,
    health.lastStage,
    health.lastStageError,
    health.lastStageAt,
    status,
    failCount,
    Math.max(0, Math.round(lastMs)),
    ...(touch ? [lastError] : []),
    id,
  );
}

export interface StageRecordOptions {
  /** 主动巡检/体检为 true；普通搜索的被动结果为 false。 */
  active?: boolean;
  elapsedMs?: number;
  recordCheck?: boolean;
}

/**
 * 记录一次体检的多个阶段结果。只更新健康字段与兼容投影，不碰正文/书籍。
 * 每次只把本次出现的阶段合并进 health.stages，旧阶段保留，直到下一次完整体检覆盖。
 */
export function recordStageResults(
  db: DB,
  id: number,
  stages: Partial<Record<HealthStage, SourceHealth["stages"][HealthStage]>>,
  options: StageRecordOptions = {},
): SourceHealth {
  const row = db
    .prepare("SELECT health_json, health_checks, health_ok, avg_ms, health_score, health_state, last_ok_at, last_fail_at, last_stage, last_stage_error, last_stage_at FROM book_sources WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  const health = healthFromRow(row);
  const active = options.active !== false;
  let attempted = 0;
  let ok = 0;
  let lastError = "";
  let lastStage: HealthStage | "" = "";
  let lastStageAt: string | null = null;
  let batchFail = false;
  for (const stage of HEALTH_STAGES) {
    const entry = stages[stage];
    if (!entry) continue;
    health.stages[stage] = entry;
    if (entry.status === "skip") continue;
    attempted += 1;
    lastStage = stage;
    lastStageAt = entry.at;
    if (entry.status === "ok" || entry.status === "blocked") ok += 1;
    if (entry.status === "ok") {
      health.lastOkAt = entry.at;
    } else if (entry.status === "fail") {
      batchFail = true;
      health.lastFailAt = entry.at;
      health.failStreak = active ? health.failStreak + 1 : health.failStreak;
      lastError = entry.message || entry.code || "请求失败";
    } else if (entry.status === "blocked") {
      lastError = entry.message || entry.code || "需要登录或会员";
    } else if (entry.status === "empty") {
      lastError = entry.message || entry.code || "";
    }
  }
  if (!batchFail) health.failStreak = 0;
  health.checks += attempted;
  health.ok += ok;
  health.lastStage = lastStage;
  health.lastStageAt = lastStageAt;
  if (lastError) health.lastStageError = lastError;
  else if (attempted > 0) health.lastStageError = "";
  const elapsed = Math.max(0, Number(options.elapsedMs ?? 0));
  if (elapsed > 0) {
    health.avgMs = health.avgMs > 0 ? Math.round(health.avgMs * 0.7 + elapsed * 0.3) : Math.round(elapsed);
  }
  health.score = computeHealthScore(health);
  health.state = computeHealthState(health, active);
  writeHealth(db, id, health, {
    legacyStatus: projectLegacyStatus(health.state),
    legacyFailCount: Math.min(2, health.failStreak),
    lastError,
    lastMs: elapsed || health.avgMs,
  });
  if (options.recordCheck) {
    db.prepare(
      "INSERT INTO source_checks (source_id, kind, ok, code, message, elapsed_ms, meta) VALUES (?, 'health', ?, ?, ?, ?, ?)",
    ).run(
      id,
      health.state === "healthy" || health.state === "partial" ? 1 : 0,
      health.state,
      (health.lastStageError || "阶段体检完成").slice(0, 300),
      Math.max(0, elapsed || health.avgMs),
      JSON.stringify({ stages, score: health.score, state: health.state }).slice(0, 20_000),
    );
    pruneSourceChecks(db, id);
  }
  return health;
}

/**
 * 体检历史保留策略：每个源最多 50 条、最多 90 天。
 * 全量巡检 800+ 源时，source_checks 会以每天数千条增长；页面只需要最近 20 条，
 * 更老的明细既占空间又拖慢按源查询。正文缓存不在这里清理。
 */
export function pruneSourceChecks(db: DB, sourceId?: number): number {
  const scoped = Number.isInteger(sourceId) && Number(sourceId) > 0;
  const scope = scoped ? " AND source_id = ?" : "";
  const params = scoped ? [Number(sourceId)] : [];
  const old = db
    .prepare(`DELETE FROM source_checks WHERE created_at < datetime('now', '-90 days')${scope}`)
    .run(...params);
  const extra = db
    .prepare(
      `DELETE FROM source_checks WHERE id IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY id DESC) AS rn
           FROM source_checks WHERE 1 = 1${scope}
         ) WHERE rn > 50
       )`,
    )
    .run(...params);
  return Number(old.changes ?? 0) + Number(extra.changes ?? 0);
}

/**
 * 兼容 0.55 的搜索检查入口：把它当成一次 search 阶段写进新健康模型。
 * 普通搜索（countFailure: false）失败只降级，不改 status；主动巡检连续两次才 error。
 */
export function recordCheck(
  db: DB,
  id: number,
  outcome: CheckOutcome,
  options: { countFailure?: boolean; keepStatusWhenEmpty?: boolean } = {},
): { status: string; failCount: number } {
  const row = db
    .prepare("SELECT status, fail_count, health_json, health_checks, health_ok, avg_ms, health_score, health_state, last_ok_at, last_fail_at, last_stage, last_stage_error, last_stage_at FROM book_sources WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  const previous = Number(row?.fail_count ?? 0);
  const currentStatus = String(row?.status ?? "retest");
  const failed = Boolean(outcome.error);
  const passive = options.countFailure === false;
  let status: string;
  let failCount: number;
  if (failed) {
    failCount = passive ? previous : previous + 1;
    status = passive ? currentStatus : failCount >= 2 ? "error" : "retest";
  } else {
    failCount = 0;
    status = outcome.count ? "ok" : options.keepStatusWhenEmpty ? currentStatus : "retest";
  }
  const now = new Date().toISOString();
  const health = healthFromRow(row);
  health.stages.search = {
    status: failed ? "fail" : Number(outcome.count ?? 0) > 0 ? "ok" : "empty",
    at: now,
    ms: Math.max(0, Number(outcome.ms ?? 0)),
    count: Math.max(0, Number(outcome.count ?? 0)),
    ...(failed ? { message: String(outcome.error ?? "").slice(0, 300) } : {}),
  };
  health.checks += 1;
  if (!failed && Number(outcome.count ?? 0) > 0) {
    health.ok += 1;
    health.lastOkAt = now;
    health.failStreak = 0;
  } else if (failed) {
    health.lastFailAt = now;
    health.failStreak = passive ? health.failStreak : health.failStreak + 1;
    health.lastStageError = String(outcome.error ?? "").slice(0, 300);
  }
  health.lastStage = "search";
  health.lastStageAt = now;
  const ms = Math.max(0, Number(outcome.ms ?? 0));
  if (ms > 0) health.avgMs = health.avgMs > 0 ? Math.round(health.avgMs * 0.7 + ms * 0.3) : ms;
  health.score = computeHealthScore(health);
  health.state = computeHealthState(health, !passive);
  // 兼容列以旧逻辑为准：普通搜索的成功/失败不能把已有关闭的源重新打开，也不能把正常源降成 error。
  writeHealth(db, id, health, {
    legacyStatus: status,
    legacyFailCount: failCount,
    lastError: failed ? String(outcome.error ?? "") : "",
    lastMs: ms,
  });
  return { status, failCount };
}

/**
 * 一次性把 0.55 的 status 回填成健康快照。幂等：只处理 health_checks=0 且 health_json='{}'。
 * 必须在 getDb() 迁移之后调用；返回处理行数。
 */
export function backfillSourceHealth(db: DB): number {
  const rows = db
    .prepare("SELECT id, status, last_error, last_ms, last_check_at, health_checks, health_json FROM book_sources WHERE health_checks = 0 AND (health_json = '{}' OR health_json = '')")
    .all() as Array<Record<string, unknown>>;
  let changed = 0;
  const update = db.prepare(
    "UPDATE book_sources SET health_score = ?, health_state = ?, health_json = ?, health_checks = ?, health_ok = ?, avg_ms = ?, last_ok_at = ?, last_fail_at = ?, last_stage = ?, last_stage_error = ?, last_stage_at = ? WHERE id = ? AND health_checks = 0",
  );
  for (const row of rows) {
    const status = String(row.status ?? "unknown");
    const lastError = String(row.last_error ?? "").slice(0, 300);
    const lastMs = Math.max(0, Number(row.last_ms ?? 0));
    const checkedAt = typeof row.last_check_at === "string" && row.last_check_at ? row.last_check_at : null;
    const health = emptyHealth();
    if (status === "ok") {
      health.checks = 1;
      health.ok = 1;
      health.score = 70;
      health.state = "partial";
      health.avgMs = lastMs;
      health.lastOkAt = checkedAt;
      health.lastStage = "search";
      health.lastStageAt = checkedAt;
      health.stages.search = { status: "ok", at: checkedAt ?? new Date().toISOString(), ms: lastMs, count: 1 };
    } else if (status === "error") {
      health.checks = 1;
      health.ok = 0;
      health.score = 0;
      health.state = "broken";
      health.avgMs = lastMs;
      health.lastFailAt = checkedAt;
      health.failStreak = 2;
      health.lastStage = "search";
      health.lastStageError = lastError || "历史检查失败";
      health.lastStageAt = checkedAt;
      health.stages.search = { status: "fail", at: checkedAt ?? new Date().toISOString(), ms: lastMs, message: health.lastStageError };
    } else if (status === "retest") {
      health.checks = 1;
      health.ok = 0;
      health.score = 45;
      health.state = "degraded";
      health.avgMs = lastMs;
      health.lastStage = "search";
      health.lastStageAt = checkedAt;
      if (lastError) {
        health.lastFailAt = checkedAt;
        health.lastStageError = lastError;
        health.stages.search = { status: "fail", at: checkedAt ?? new Date().toISOString(), ms: lastMs, message: lastError };
      } else {
        health.stages.search = { status: "empty", at: checkedAt ?? new Date().toISOString(), ms: lastMs };
      }
    } else {
      continue;
    }
    health.lastStageError = health.lastStageError || "";
    update.run(
      health.score,
      health.state,
      JSON.stringify(health),
      health.checks,
      health.ok,
      health.avgMs,
      health.lastOkAt,
      health.lastFailAt,
      health.lastStage,
      health.lastStageError,
      health.lastStageAt,
      row.id,
    );
    changed += 1;
  }
  return changed;
}