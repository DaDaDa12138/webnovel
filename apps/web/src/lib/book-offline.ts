/**
 * 整本离线：把章节正文写进 Service Worker 用的同一个 Cache Storage，
 * 断网时 NetworkFirst 请求失败就会落到这份缓存上。
 *
 * 之所以不自己做一套「离线正文」存储：正文接口本来就被 PWA 缓存接管，
 * 再存一份会出现「在线读的是新正文、离线读的是旧副本」这种两套内容不一致。
 */

export const OFFLINE_CACHE = "chapter-content";

const CHAPTER_PATH = /^\/api\/books\/(\d+)\/chapters\/(\d+)\/content$/;

export function chapterContentUrl(bookId: number, index: number): string {
  return `/api/books/${bookId}/chapters/${index}/content`;
}

/** 从缓存键里挑出这本书已经缓存过的章节号。 */
export function filterChapterKeys(keys: string[], bookId: number): number[] {
  const out: number[] = [];
  for (const key of keys) {
    let path = key;
    try {
      path = new URL(key, "http://localhost").pathname;
    } catch {
      continue;
    }
    const matched = CHAPTER_PATH.exec(path);
    if (matched && Number(matched[1]) === bookId) out.push(Number(matched[2]));
  }
  return out.sort((a, b) => a - b);
}

export async function cachedChapters(bookId: number): Promise<number[]> {
  if (typeof caches === "undefined") return [];
  try {
    const cache = await caches.open(OFFLINE_CACHE);
    const keys = (await cache.keys()).map((request) => request.url);
    return filterChapterKeys(keys, bookId);
  } catch {
    return [];
  }
}

export async function removeCachedChapters(bookId: number): Promise<number> {
  if (typeof caches === "undefined") return 0;
  try {
    const cache = await caches.open(OFFLINE_CACHE);
    const requests = await cache.keys();
    let removed = 0;
    for (const request of requests) {
      if (filterChapterKeys([request.url], bookId).length) {
        await cache.delete(request);
        removed += 1;
      }
    }
    return removed;
  } catch {
    return 0;
  }
}

export interface DownloadOptions {
  /** 并发数：书源站点大多扛不住，2 已经够快，也避免被限流。 */
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, failed: number) => void;
}

export interface DownloadResult {
  done: number;
  total: number;
  failed: number;
  aborted: boolean;
}

export async function downloadChapters(bookId: number, indices: number[], options: DownloadOptions = {}): Promise<DownloadResult> {
  const total = indices.length;
  const result: DownloadResult = { done: 0, total, failed: 0, aborted: false };
  if (!total || typeof caches === "undefined") return result;

  const cache = await caches.open(OFFLINE_CACHE);
  const concurrency = Math.max(1, Math.min(4, options.concurrency ?? 2));
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (options.signal?.aborted) {
        result.aborted = true;
        return;
      }
      const slot = cursor;
      cursor += 1;
      if (slot >= total) return;
      const index = indices[slot];
      const url = chapterContentUrl(bookId, index);
      try {
        const response = await fetch(url, { signal: options.signal });
        if (response.ok) {
          await cache.put(url, response.clone());
        } else {
          result.failed += 1;
        }
      } catch {
        if (options.signal?.aborted) {
          result.aborted = true;
          return;
        }
        result.failed += 1;
      }
      result.done += 1;
      options.onProgress?.(result.done, total, result.failed);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return result;
}
