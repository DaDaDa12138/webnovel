import { computed, ref } from "vue";
import type { SyncOp } from "@legado/shared";
import { api } from "../api";
import {
  EMPTY_QUEUE,
  ack,
  batchOf,
  canFlush,
  enqueue,
  markFailure,
  parseQueue,
  pendingCount,
  type QueueState,
} from "../lib/sync-queue";

/**
 * 全局唯一的离线写入队列。
 *
 * 阅读页和设置页共享同一份状态：阅读页负责往里塞，设置页负责显示「还有几条没送出去」。
 * 队列落 localStorage 而不是内存，是因为最常见的场景就是「关掉标签页之前刚断网」。
 */
const STORAGE_KEY = "legado-sync-queue";

function readQueue(): QueueState {
  try {
    return parseQueue(localStorage.getItem(STORAGE_KEY));
  } catch {
    // 隐私模式下 localStorage 会直接抛错，队列退化成内存态。
    return EMPTY_QUEUE;
  }
}

const state = ref<QueueState>(readQueue());
const flushing = ref(false);
const lastError = ref("");
const pending = computed(() => pendingCount(state.value));
const lastSyncAt = computed(() => state.value.lastSyncAt);

let flushTimer: number | undefined;
let installed = false;

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.value));
  } catch {
    /* 存不下就算了，内存里的队列还能发出去 */
  }
}

function schedule(delay: number): void {
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => void flush(), delay);
}

async function flush(force = false): Promise<void> {
  if (flushing.value) return;
  if (!state.value.ops.length) return;
  // 断网时不必试探：浏览器已经告诉我们了，白跑一次请求只会让退避时间越拉越长。
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  if (!force && !canFlush(state.value)) return;
  flushing.value = true;
  const batch = batchOf(state.value);
  try {
    const result = await api.sync(batch);
    // 失败的条目也一起出队：同一份坏数据重试一百次也不会变好，留着只会堵住后面的。
    state.value = { ...ack(state.value, batch), lastSyncAt: result.at };
    lastError.value = result.failed.length ? result.failed.length + " 条未能补传" : "";
    persist();
    if (state.value.ops.length) schedule(400);
  } catch (err) {
    state.value = markFailure(state.value);
    lastError.value = (err as Error).message;
    persist();
    schedule(30_000);
  } finally {
    flushing.value = false;
  }
}

function push(op: SyncOp): void {
  state.value = enqueue(state.value, op);
  persist();
  schedule(1500);
}

/** 装上「网络恢复 / 切回前台 / 每 30 秒」三个触发点，只装一次。 */
function install(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("online", () => void flush(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flush();
  });
  window.setInterval(() => void flush(), 30_000);
  if (canFlush(state.value)) schedule(1200);
}

export function useSyncQueue() {
  install();
  return { pending, lastSyncAt, lastError, flushing, push, flush, ops: computed(() => state.value.ops) };
}
