import type { SyncOp } from "@legado/shared";

/**
 * 离线写入队列。
 *
 * 只有「写」进队列：断网时保存进度、新建划线、加书签都会失败，失败本身不可怕，
 * 可怕的是失败被 `catch {}` 吞掉——读者在地铁上读的 20 分钟就这么没了。
 * 队列按语义键去重，所以它记录的是「这台设备上还没送到服务器的最终状态」，不是流水账：
 * 同一本书翻十页只留最后一条进度，同一条划线改了三次只留最后一次。
 */
export interface QueueState {
  ops: SyncOp[];
  /** 连续失败次数，用于指数退避；成功后清零。 */
  attempts: number;
  /** 退避到期时间（毫秒时间戳），在此之前不发请求。 */
  retryAt: number;
  /** 上次成功同步的服务端时间（YYYY-MM-DD HH:MM:SS），只用于显示。 */
  lastSyncAt: string;
}

export const MAX_OPS = 300;
export const BATCH_SIZE = 100;

export const EMPTY_QUEUE: QueueState = { ops: [], attempts: 0, retryAt: 0, lastSyncAt: "" };

const KINDS = new Set(["progress", "annotation", "annotation-delete", "bookmark-add", "bookmark-delete", "read"]);

/**
 * 去重键 = 这条操作最终会改动的那份数据的身份。
 * 进度按书、划线按 id、书签按「章 + 字符偏移」（离线新建的书签没有服务端 id，
 * 只能用锚点当身份，和 addBookmark 判重用的是同一套规则）。
 */
export function opKey(op: SyncOp): string {
  switch (op.kind) {
    case "progress":
      return "progress:" + op.bookId;
    case "annotation":
      return "annotation:" + op.bookId + ":" + (op.annotation?.id ?? "");
    case "annotation-delete":
      return "annotation:" + op.bookId + ":" + op.annotationId;
    case "read":
      return "read:" + op.bookId + ":" + op.chapterIndex;
    default:
      return "bookmark:" + op.bookId + ":" + op.chapterIndex + ":" + op.charOffset;
  }
}

/** 入队：同键的旧操作被替换（后写覆盖先写），队列长度封顶，先丢最老的。 */
export function enqueue(state: QueueState, op: SyncOp): QueueState {
  const key = opKey(op);
  const kept = state.ops.filter((item) => opKey(item) !== key);
  const ops = [...kept, op];
  return { ...state, ops: ops.length > MAX_OPS ? ops.slice(ops.length - MAX_OPS) : ops };
}

export function pendingCount(state: QueueState): number {
  return state.ops.length;
}

/** 取一批要发的操作（最老的先发），剩下的留在队列里等下一轮。 */
export function batchOf(state: QueueState, limit = BATCH_SIZE): SyncOp[] {
  return state.ops.slice(0, Math.max(1, limit));
}

/**
 * 确认送达：按 id 移除。
 *
 * 为什么按 id 而不是按 key：补传期间读者可能又翻了一页，同键的新操作会以新 id 入队，
 * 按 key 删会把这条更新的位置一起删掉——进度就永久停在了补传开始的那一刻。
 */
export function ack(state: QueueState, sent: SyncOp[]): QueueState {
  const done = new Set(sent.map((op) => op.id));
  return { ...state, ops: state.ops.filter((op) => !done.has(op.id)), attempts: 0, retryAt: 0 };
}

export function retryDelay(attempts: number): number {
  const step = Math.max(0, attempts - 1);
  return Math.min(2000 * 2 ** step, 120_000);
}

/** 记一次失败：下一次最早在 retryDelay 之后。 */
export function markFailure(state: QueueState, now = Date.now()): QueueState {
  const attempts = state.attempts + 1;
  return { ...state, attempts, retryAt: now + retryDelay(attempts) };
}

export function canFlush(state: QueueState, now = Date.now()): boolean {
  return state.ops.length > 0 && now >= state.retryAt;
}

function isValidOp(value: unknown): value is SyncOp {
  if (!value || typeof value !== "object") return false;
  const op = value as Record<string, unknown>;
  if (typeof op.id !== "string" || !op.id) return false;
  if (typeof op.kind !== "string" || !KINDS.has(op.kind)) return false;
  if (!Number.isFinite(Number(op.bookId))) return false;
  return true;
}

/**
 * 从 localStorage 读回来的队列。这里必须容错到「最坏情况是空队列」：
 * 队列本身是缓存，读坏了最多丢几条离线写入，绝不能让阅读页白屏。
 */
export function parseQueue(raw: string | null): QueueState {
  if (!raw) return EMPTY_QUEUE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_QUEUE;
  }
  if (!parsed || typeof parsed !== "object") return EMPTY_QUEUE;
  const data = parsed as Record<string, unknown>;
  const ops = Array.isArray(data.ops) ? data.ops.filter(isValidOp).slice(-MAX_OPS) : [];
  return {
    ops,
    attempts: Number.isFinite(Number(data.attempts)) ? Math.max(0, Number(data.attempts)) : 0,
    retryAt: Number.isFinite(Number(data.retryAt)) ? Number(data.retryAt) : 0,
    lastSyncAt: typeof data.lastSyncAt === "string" ? data.lastSyncAt : "",
  };
}

/**
 * 这次失败是不是「网络不通」而不是「服务器拒绝」。
 *
 * 这个判断决定了要不要入队：断网必须攒下来补传，而 400（比如划线跨度过长）重试一万次也不会成功，
 * 攒进去只会堵住后面的操作。fetch 在断网时抛 TypeError("Failed to fetch")，各浏览器文案不同，
 * 所以先看 navigator.onLine，再兜底匹配几种常见文案。
 */
export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(message);
}

/** 生成一个队列操作 id：同一毫秒入队两条也不会撞。 */
export function newOpId(prefix: string, at = Date.now()): string {
  return prefix + ":" + at.toString(36) + ":" + Math.random().toString(36).slice(2, 8);
}
