import { ref, type Ref } from "vue";
import { toast } from "../lib/toast";

export interface ReaderAutoScrollDeps {
  scroller: Ref<HTMLElement | null>;
  index: Ref<number>;
  total: Ref<number>;
  /** 每秒滚动的像素数，实时读取设置。 */
  speed: () => number;
  mode: () => string;
  go: (next: number, charOffset?: number) => Promise<void>;
  onStart?: () => void;
}

/**
 * 自动阅读（滚动模式）：按速度匀速滚动，触底后自动进入下一章。
 * 页面只关心 autoPlaying 用来切换按钮，停止原因通过 toast 告知。
 */
export function useReaderAutoScroll(deps: ReaderAutoScrollDeps) {
  const autoPlaying = ref(false);
  let raf: number | undefined;
  let last = 0;
  let turning = false;

  function stop(): void {
    autoPlaying.value = false;
    turning = false;
    if (raf !== undefined) cancelAnimationFrame(raf);
    raf = undefined;
  }

  function pause(): void {
    if (!autoPlaying.value) return;
    stop();
    toast("已暂停自动阅读");
  }

  function start(): void {
    if (autoPlaying.value) return;
    if (deps.mode() !== "scroll") {
      toast("自动阅读仅支持滚动模式", "error");
      return;
    }
    const el = deps.scroller.value;
    if (!el) {
      toast("正文还没加载好，请稍后再试", "error");
      return;
    }
    autoPlaying.value = true;
    turning = false;
    last = performance.now();
    deps.onStart?.();
    const step = (now: number) => {
      if (!autoPlaying.value) return;
      const body = deps.scroller.value;
      if (!body) {
        raf = requestAnimationFrame(step);
        return;
      }
      const dt = Math.min(0.12, Math.max(0, (now - last) / 1000));
      last = now;
      const max = Math.max(0, body.scrollHeight - body.clientHeight);
      if (body.scrollTop >= max - 2) {
        if (turning) return;
        if (deps.total.value > 0 && deps.index.value >= deps.total.value - 1) {
          stop();
          toast("已经读到最后一章");
          return;
        }
        turning = true;
        void deps
          .go(deps.index.value + 1)
          .then(() => {
            turning = false;
            last = performance.now();
            if (!autoPlaying.value) return;
            window.setTimeout(() => {
              if (autoPlaying.value) raf = requestAnimationFrame(step);
            }, 320);
          })
          .catch(() => {
            turning = false;
            stop();
          });
        return;
      }
      body.scrollTop = Math.min(max, body.scrollTop + deps.speed() * dt);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  return { autoPlaying, start, stop, pause };
}
