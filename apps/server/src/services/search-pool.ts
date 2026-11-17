import { Worker } from "node:worker_threads";
import os from "node:os";
import type { BookInfo, BookSource, SearchBook } from "@legado/engine";
import type { HealthStage, StageHealth } from "@legado/shared";

/**
 * 搜索线程池。
 *
 * 书源规则里的 JS / 正则 / cheerio 解析都是同步 CPU 活，跑在主线程上会把整个
 * HTTP 服务按住（实测单个书源能造成 4.5s 事件循环停摆，期间 SSE 推送、接口响应、
 * sqlite 写入全部卡住）。这里把「一个源的一次搜索」或「详情页 + 目录」整体丢进
 * worker_threads，主线程只负责调度与落库。
 *
 * 失败策略：worker 起不来（比如 tsx 直接跑 .ts 源码）就抛 PoolUnavailableError，
 * 由调用方回退到进程内执行；单个任务超时则杀掉该 worker 并重建——卡死的同步 JS
 * 无法中断，只能整条线程换掉。
 */

export class PoolUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PoolUnavailableError";
  }
}

export interface ProbeResult {
  info: BookInfo;
  chapters: number;
  tocError: string;
}

export interface HealthProbeResult {
  stages: Partial<Record<HealthStage, StageHealth>>;
  samples: { bookUrl?: string; tocUrl?: string; chapterUrl?: string };
  debug: Array<{ stage: string; url?: string; message?: string; data?: unknown }>;
  elapsedMs: number;
}

interface WorkerMessage {
  id: number;
  books?: SearchBook[];
  info?: BookInfo;
  chapters?: number;
  tocError?: string;
  stages?: Partial<Record<HealthStage, StageHealth>>;
  samples?: { bookUrl?: string; tocUrl?: string; chapterUrl?: string };
  debug?: Array<{ stage: string; url?: string; message?: string; data?: unknown }>;
  error?: string;
}

interface Pending {
  resolve: (message: WorkerMessage) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface Slot {
  worker: Worker;
  busy: number;
  pending: Map<number, Pending>;
  dead: boolean;
  /** 这个线程是否成功回过一次结果：没回过就崩，说明是加载/启动问题，不是偶发任务崩溃。 */
  delivered: boolean;
}

// 每个 worker 是一个独立线程：网络请求在 worker 里是异步的，CPU 只花在解析 HTML 上。
// 上限 8 而不是 6：换源要一次扫几百个站，多两条线程就是实打实的吞吐。
const WORKERS = Math.min(8, Math.max(2, Math.floor((os.cpus()?.length ?? 4) / 2) || 2));
const PER_WORKER = 8;
export const TASK_TIMEOUT_MS = 15_000;

let slots: Slot[] = [];
let nextId = 1;
let unavailable: Error | null = null;
let bootFailures = 0;

function spawnSlot(): Slot {
  const worker = new Worker(new URL("./search-worker.js", import.meta.url));
  const slot: Slot = { worker, busy: 0, pending: new Map(), dead: false, delivered: false };

  worker.on("message", (message: WorkerMessage) => {
    slot.delivered = true;
    bootFailures = 0;
    const pending = slot.pending.get(message.id);
    if (!pending) return;
    slot.pending.delete(message.id);
    slot.busy = Math.max(0, slot.busy - 1);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message);
    refreshRef(slot);
  });

  worker.on("error", (err) => {
    if (slot.dead) return;
    slot.dead = true;
    const failure = err instanceof Error ? err : new Error(String(err));
    // 一个已经正常回过结果的线程偶发崩溃，重建就行；连续 3 次连启动都失败
    // （比如 tsx 直接跑 .ts 源码、找不到 worker 文件）才判定线程池不可用。
    if (!slot.delivered) {
      bootFailures += 1;
      if (bootFailures >= 3) unavailable = failure;
    }
    // 线程崩了不等于这个源不可用：按「通道故障」抛给调用方，由它退回进程内重试一次。
    const transport = new PoolUnavailableError(`search worker failed: ${failure.message}`);
    for (const pending of slot.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(transport);
    }
    slot.pending.clear();
    slots = slots.filter((item) => item !== slot);
  });

  worker.on("exit", () => {
    if (slot.dead) return;
    slot.dead = true;
    slots = slots.filter((item) => item !== slot);
    for (const pending of slot.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("search worker exited"));
    }
    slot.pending.clear();
  });

  worker.unref();
  return slot;
}

function ensureSlots(): Slot[] {
  if (unavailable) throw new PoolUnavailableError(`search worker unavailable: ${unavailable.message}`);
  if (slots.length === 0) {
    try {
      for (let i = 0; i < WORKERS; i += 1) slots.push(spawnSlot());
    } catch (err) {
      slots = [];
      unavailable = err instanceof Error ? err : new Error(String(err));
      throw new PoolUnavailableError(`search worker unavailable: ${unavailable.message}`);
    }
  }
  return slots;
}

function pickSlot(): Slot {
  const live = ensureSlots();
  let best = live[0];
  for (const slot of live) {
    if (slot.busy < best.busy) best = slot;
  }
  return best;
}

/** 有任务在跑就 ref（保证进程不会在任务中途退出），空闲时 unref（不拖住退出）。 */
function refreshRef(slot: Slot): void {
  if (slot.dead) return;
  if (slot.pending.size > 0) slot.worker.ref();
  else slot.worker.unref();
}

function killSlot(slot: Slot, reason: string): void {
  slot.dead = true;
  slots = slots.filter((item) => item !== slot);
  void slot.worker.terminate().catch(() => undefined);
  for (const pending of slot.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error(reason));
  }
  slot.pending.clear();
}

function dispatch(payload: Record<string, unknown>, timeoutMs: number): Promise<WorkerMessage> {
  const slot = pickSlot();
  const id = nextId;
  nextId += 1;
  return new Promise<WorkerMessage>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!slot.pending.has(id)) return;
      slot.pending.delete(id);
      slot.busy = Math.max(0, slot.busy - 1);
      reject(new Error(`timeout after ${timeoutMs}ms: search worker`));
      killSlot(slot, `timeout after ${timeoutMs}ms: search worker`);
    }, timeoutMs);
    timer.unref?.();
    slot.pending.set(id, { resolve, reject, timer });
    slot.busy += 1;
    refreshRef(slot);
    slot.worker.postMessage({ id, ...payload });
  });
}

/** 在 worker 里跑一次搜索。超时会杀掉该线程，调用方当作普通失败处理。 */
export async function searchInPool(source: BookSource, key: string, timeoutMs = TASK_TIMEOUT_MS): Promise<SearchBook[]> {
  const message = await dispatch({ kind: "search", source, key }, timeoutMs);
  return message.books ?? [];
}

/** 在 worker 里取「详情页 + 目录」。目录失败不抛错，交给调用方判定候选可用性。 */
export async function probeInPool(source: BookSource, bookUrl: string, timeoutMs = TASK_TIMEOUT_MS): Promise<ProbeResult> {
  const message = await dispatch({ kind: "probe", source, bookUrl }, timeoutMs);
  if (!message.info) throw new Error("probe returned no book info");
  return { info: message.info, chapters: message.chapters ?? 0, tocError: message.tocError ?? "" };
}

/** 在 worker 里跑一次四阶段体检；返回阶段摘要与脱敏 debug，不返回正文。 */
export async function healthInPool(
  source: BookSource,
  key: string,
  stages: HealthStage[] = ["search", "detail", "toc", "content"],
  timeoutMs = 60_000,
): Promise<HealthProbeResult> {
  const started = Date.now();
  const message = await dispatch({ kind: "health", source, key, stages }, timeoutMs);
  return {
    stages: message.stages ?? {},
    samples: message.samples ?? {},
    debug: message.debug ?? [],
    elapsedMs: Date.now() - started,
  };
}

export function poolStats(): { workers: number; busy: number; available: boolean; perWorker: number } {
  return {
    workers: slots.length,
    busy: slots.reduce((sum, slot) => sum + slot.busy, 0),
    available: !unavailable,
    perWorker: PER_WORKER,
  };
}

export async function disposeSearchPool(): Promise<void> {
  const live = slots;
  slots = [];
  await Promise.all(live.map((slot) => slot.worker.terminate().catch(() => undefined)));
}
