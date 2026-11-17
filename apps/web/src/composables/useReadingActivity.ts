import type { Ref } from "vue";
import { api } from "../api";

export interface ReaderActivityDeps {
  bookId: number;
  index: Ref<number>;
  /** 页面切到后台时先落盘阅读进度。 */
  saveProgress: () => void | Promise<void>;
}

/**
 * 阅读时长统计：可见时每 15 秒累计一次，满 1 分钟上报；离开页面或切到后台时补报。
 * 与 DOM 无关，页面只负责 start()/stop()。
 */
export function useReadingActivity(deps: ReaderActivityDeps) {
  let activeSeconds = 0;
  let lastActive = Date.now();
  let visited = new Set<number>();
  let timer: number | undefined;

  function tick(): void {
    if (document.visibilityState !== "visible") {
      lastActive = Date.now();
      return;
    }
    const now = Date.now();
    const delta = Math.min(60, Math.round((now - lastActive) / 1000));
    lastActive = now;
    if (delta <= 0) return;
    activeSeconds += delta;
    visited.add(deps.index.value);
    if (activeSeconds < 60) return;
    const seconds = activeSeconds;
    const chapters = visited.size;
    activeSeconds = 0;
    visited = new Set();
    void api.readingTime(deps.bookId, { seconds, chapters }).catch(() => {});
  }

  function flush(): void {
    if (activeSeconds >= 5) {
      void api.readingTime(deps.bookId, { seconds: activeSeconds, chapters: visited.size }).catch(() => {});
    }
    activeSeconds = 0;
    visited = new Set();
  }

  function onVisibility(): void {
    if (document.visibilityState === "hidden") {
      void deps.saveProgress();
      flush();
    }
    lastActive = Date.now();
  }

  function start(): void {
    if (timer !== undefined) return;
    document.addEventListener("visibilitychange", onVisibility);
    timer = window.setInterval(tick, 15_000);
  }

  function stop(): void {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
    document.removeEventListener("visibilitychange", onVisibility);
  }

  return { start, stop, tick, flush };
}
