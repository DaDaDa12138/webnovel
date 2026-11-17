import { onBeforeUnmount, ref } from "vue";
import { toast } from "../lib/toast";

export interface ReaderAutoTurnDeps {
  /** 每页停留毫秒，实时读取（屏高与速度换算）。 */
  dwell: () => number;
  /** 当前阅读模式：只有分页模式能自动翻页。 */
  mode: () => string;
  /** 翻一页；返回 false 表示已经到全书末尾，由调用方决定提示文案。 */
  turn: () => boolean;
  onStart?: () => void;
}

/**
 * 自动阅读（分页模式）：按停留时间翻页，翻到全书末尾自动停。
 * 与 useReaderAutoScroll 同一套对外形状（autoPlaying / start / stop / pause），
 * 页面按模式选一个用。
 */
export function useReaderAutoTurn(deps: ReaderAutoTurnDeps) {
  const autoPlaying = ref(false);
  let timer = 0;

  function clear(): void {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  }

  function schedule(): void {
    clear();
    if (!autoPlaying.value) return;
    // 至少 400ms：dwell 被设成极小值时也别把主线程转成死循环。
    timer = window.setTimeout(tick, Math.max(400, deps.dwell()));
  }

  function tick(): void {
    timer = 0;
    if (!autoPlaying.value) return;
    if (!deps.turn()) {
      autoPlaying.value = false;
      return;
    }
    schedule();
  }

  function start(): void {
    if (autoPlaying.value) return;
    if (deps.mode() !== "page") {
      toast("自动翻页仅支持分页模式", "error");
      return;
    }
    autoPlaying.value = true;
    deps.onStart?.();
    schedule();
  }

  function stop(): void {
    autoPlaying.value = false;
    clear();
  }

  function pause(): void {
    if (!autoPlaying.value) return;
    stop();
    toast("已暂停自动阅读");
  }

  /** 手动翻页后重新计时，免得刚翻过去就被自动再翻一页。 */
  function nudge(): void {
    if (autoPlaying.value) schedule();
  }

  onBeforeUnmount(stop);

  return { autoPlaying, start, stop, pause, nudge };
}
