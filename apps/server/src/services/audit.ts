import type { HealthStage, HealthStageStatus, HealthState, SourceAuditState } from "@legado/shared";
import type { DB } from "../db/index.js";
import { loadSourceById } from "./engine.js";
import { probeSourceById, type ProbeMode } from "./source-probe.js";

/**
 * 后台巡检：把「点一次测速、关掉页面就断」改成服务端任务。
 *
 * 0.56 起巡检不再只测搜索：quick 模式测搜索，full 模式跑 search→detail→toc→content
 * 四阶段，结果写 health_json 与 source_checks。页面只轮询进度，不依赖 SSE 长连接。
 * 0.58 起每次完成一个源就把快照写进 settings；进程重启后标记「已中断」，
 * 可以继续跑剩下的源，而不是从头再扫一遍。
 */
export interface AuditOptions {
  key?: string;
  mode?: ProbeMode;
  concurrency?: number;
}

export interface AuditSnapshot {
  version: 1;
  state: SourceAuditState;
  ids: number[];
  remaining: number[];
  options: Required<AuditOptions>;
  savedAt: number;
}

export const AUDIT_SNAPSHOT_KEY = "sourceAuditSnapshot";

const STAGES: HealthStage[] = ["search", "detail", "toc", "content"];
const HEALTH_STATES: HealthState[] = ["unknown", "partial", "healthy", "degraded", "blocked", "broken"];

function emptyStages(): Record<HealthStage, Record<HealthStageStatus, number>> {
  const out = {} as Record<HealthStage, Record<HealthStageStatus, number>>;
  for (const stage of STAGES) out[stage] = { ok: 0, empty: 0, blocked: 0, fail: 0, skip: 0 };
  return out;
}

function emptyHealth(): Record<HealthState, number> {
  return { unknown: 0, partial: 0, healthy: 0, degraded: 0, blocked: 0, broken: 0 };
}

const idle = (): SourceAuditState => ({
  running: false,
  key: "",
  mode: "quick",
  total: 0,
  done: 0,
  ok: 0,
  failed: 0,
  current: "",
  startedAt: 0,
  finishedAt: 0,
  stopped: false,
  cursor: 0,
  stages: emptyStages(),
  health: emptyHealth(),
  errors: [],
  canResume: false,
  interrupted: false,
});

let state: SourceAuditState = idle();
let cancel = false;
let job: { ids: number[]; remaining: number[]; options: Required<AuditOptions> } | null = null;

function snapshot(): SourceAuditState {
  return {
    ...state,
    stages: { ...state.stages },
    health: { ...state.health },
    errors: state.errors.slice(),
  };
}

export function auditStatus(): SourceAuditState {
  return snapshot();
}

export function stopAudit(): SourceAuditState {
  cancel = true;
  return auditStatus();
}

function normalizeOptions(options: AuditOptions | string | undefined): Required<AuditOptions> {
  if (typeof options === "string") return { key: options, mode: "quick", concurrency: 12 };
  const mode: ProbeMode = options?.mode === "full" ? "full" : "quick";
  const requested = Number(options?.concurrency ?? 0);
  const fallback = mode === "full" ? 6 : 12;
  const concurrency = Number.isFinite(requested) && requested > 0 ? Math.min(24, Math.max(1, Math.round(requested))) : fallback;
  return { key: String(options?.key ?? "").trim(), mode, concurrency };
}

/** 把持久化快照补成完整状态；坏数据/旧版本一律退回空状态。 */
function hydrateState(raw: unknown): SourceAuditState {
  const base = idle();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const obj = raw as Record<string, unknown>;
  const stages = emptyStages();
  if (obj.stages && typeof obj.stages === "object" && !Array.isArray(obj.stages)) {
    for (const stage of STAGES) {
      const entry = (obj.stages as Record<string, unknown>)[stage];
      if (!entry || typeof entry !== "object") continue;
      for (const status of ["ok", "empty", "blocked", "fail", "skip"] as HealthStageStatus[]) {
        stages[stage][status] = Math.max(0, Math.floor(Number((entry as Record<string, unknown>)[status] ?? 0)));
      }
    }
  }
  const health = emptyHealth();
  if (obj.health && typeof obj.health === "object" && !Array.isArray(obj.health)) {
    for (const key of HEALTH_STATES) {
      health[key] = Math.max(0, Math.floor(Number((obj.health as Record<string, unknown>)[key] ?? 0)));
    }
  }
  const errors = Array.isArray(obj.errors)
    ? obj.errors
        .slice(0, 50)
        .map((item) => {
          const row = (item ?? {}) as Record<string, unknown>;
          return {
            sourceId: Number(row.sourceId ?? 0),
            name: String(row.name ?? "").slice(0, 120),
            error: String(row.error ?? "").slice(0, 300),
          };
        })
        .filter((item) => item.sourceId > 0)
    : [];
  return {
    ...base,
    ...obj,
    // 保留快照写入时的 running，restoreAudit 靠它判断「上次是不是跑到一半被杀」；
    // 真正展示给页面的状态会在 restoreAudit 里统一改成 running=false。
    running: Boolean(obj.running),
    mode: obj.mode === "full" ? "full" : "quick",
    total: Math.max(0, Math.floor(Number(obj.total ?? 0))),
    done: Math.max(0, Math.floor(Number(obj.done ?? 0))),
    ok: Math.max(0, Math.floor(Number(obj.ok ?? 0))),
    failed: Math.max(0, Math.floor(Number(obj.failed ?? 0))),
    current: String(obj.current ?? "").slice(0, 200),
    startedAt: Math.max(0, Number(obj.startedAt ?? 0)),
    finishedAt: Math.max(0, Number(obj.finishedAt ?? 0)),
    stopped: Boolean(obj.stopped),
    cursor: Math.max(0, Math.floor(Number(obj.cursor ?? 0))),
    stages,
    health,
    errors,
    canResume: false,
    interrupted: false,
  };
}

export function readAuditSnapshot(db: DB): AuditSnapshot | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(AUDIT_SNAPSHOT_KEY) as { value: string } | undefined;
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as Record<string, unknown>;
    if (parsed.version !== 1 || !Array.isArray(parsed.ids) || !Array.isArray(parsed.remaining)) return null;
    const ids = [...new Set(parsed.ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    const remaining = [...new Set(parsed.remaining.map(Number).filter((id) => ids.includes(id)))];
    const optionsRaw = (parsed.options ?? {}) as Record<string, unknown>;
    const options: Required<AuditOptions> = {
      key: String(optionsRaw.key ?? "").trim(),
      mode: optionsRaw.mode === "full" ? "full" : "quick",
      concurrency: Math.min(24, Math.max(1, Math.round(Number(optionsRaw.concurrency ?? 12) || 12))),
    };
    return { version: 1, state: hydrateState(parsed.state), ids, remaining, options, savedAt: Number(parsed.savedAt ?? 0) };
  } catch {
    return null;
  }
}

function saveSnapshot(db: DB): void {
  if (!job) return;
  const payload: AuditSnapshot = {
    version: 1,
    state: snapshot(),
    ids: job.ids,
    remaining: job.remaining,
    options: job.options,
    savedAt: Date.now(),
  };
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(AUDIT_SNAPSHOT_KEY, JSON.stringify(payload));
}

function complete(db: DB, id: number): void {
  if (!job) return;
  job.remaining = job.remaining.filter((item) => item !== id);
  state.done = job.ids.length - job.remaining.length;
  state.cursor = state.done;
  saveSnapshot(db);
}

function launch(
  db: DB,
  nextJob: { ids: number[]; remaining: number[]; options: Required<AuditOptions> },
  resumeState?: SourceAuditState,
): SourceAuditState {
  if (state.running) return auditStatus();
  job = nextJob;
  cancel = false;
  if (resumeState) {
    state = {
      ...resumeState,
      running: true,
      current: "",
      stopped: false,
      interrupted: false,
      finishedAt: 0,
      canResume: false,
    };
  } else {
    state = {
      ...idle(),
      running: true,
      key: nextJob.options.key,
      mode: nextJob.options.mode,
      total: nextJob.ids.length,
      startedAt: Date.now(),
    };
  }
  state.done = nextJob.ids.length - nextJob.remaining.length;
  state.cursor = state.done;
  saveSnapshot(db);

  const pending = nextJob.remaining.slice();
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < pending.length && !cancel) {
      const id = pending[cursor++];
      const loaded = loadSourceById(id);
      if (!loaded) {
        state.done += 1;
        state.failed += 1;
        state.cursor = Math.max(state.cursor, state.done);
        state.errors.push({ sourceId: id, name: "", error: "书源不存在或规则 JSON 损坏" });
        if (state.errors.length > 50) state.errors.shift();
        complete(db, id);
        continue;
      }
      state.current = String(loaded.row.name ?? "");
      try {
        const report = await probeSourceById(id, { mode: nextJob.options.mode, key: nextJob.options.key });
        state.health[report.health.state] = (state.health[report.health.state] ?? 0) + 1;
        for (const stage of STAGES) {
          const status = report.stages[stage]?.status;
          if (status) state.stages[stage][status] += 1;
        }
        if (report.health.state === "healthy" || report.health.state === "partial") state.ok += 1;
        if (report.health.state === "broken") state.failed += 1;
        if (report.error) {
          state.errors.push({ sourceId: id, name: String(loaded.row.name ?? ""), error: report.error });
          if (state.errors.length > 50) state.errors.shift();
        }
      } catch (err) {
        state.failed += 1;
        state.errors.push({
          sourceId: id,
          name: String(loaded.row.name ?? ""),
          error: String((err as Error)?.message ?? err).slice(0, 300),
        });
        if (state.errors.length > 50) state.errors.shift();
      }
      complete(db, id);
    }
  }

  void Promise.all(Array.from({ length: Math.min(nextJob.options.concurrency, Math.max(1, pending.length)) }, () => worker())).then(() => {
    state.running = false;
    state.current = "";
    state.finishedAt = Date.now();
    state.stopped = cancel;
    state.canResume = Boolean(job?.remaining.length);
    state.interrupted = false;
    saveSnapshot(db);
  });

  return auditStatus();
}

export function startAudit(db: DB, ids: number[], options: AuditOptions | string = {}): SourceAuditState {
  if (state.running) return auditStatus();
  const unique = [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!unique.length) return auditStatus();
  const opts = normalizeOptions(options);
  return launch(db, { ids: unique, remaining: unique.slice(), options: opts });
}

/** 继续上次中断/停止的巡检；没有可续跑的剩余源时返回 null。 */
export function resumeAudit(db: DB): SourceAuditState | null {
  if (state.running) return auditStatus();
  const saved = readAuditSnapshot(db);
  if (!saved || !saved.remaining.length) return null;
  return launch(db, { ids: saved.ids, remaining: saved.remaining.slice(), options: saved.options }, saved.state);
}

/**
 * 进程启动时恢复上次快照。上次仍在跑的任务已随进程消失，这里只把它标成
 * interrupted，保留已完成计数，等用户点「继续上次」再跑剩余源。
 */
export function restoreAudit(db: DB): SourceAuditState | null {
  const saved = readAuditSnapshot(db);
  if (!saved) return null;
  job = { ids: saved.ids, remaining: saved.remaining.slice(), options: saved.options };
  const wasRunning = Boolean(saved.state.running);
  state = {
    ...saved.state,
    running: false,
    current: "",
    canResume: saved.remaining.length > 0,
    interrupted: wasRunning,
    stopped: wasRunning ? true : saved.state.stopped,
    finishedAt: wasRunning ? Date.now() : saved.state.finishedAt,
  };
  return auditStatus();
}

export { HEALTH_STATES };
