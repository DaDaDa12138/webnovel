import { onBeforeUnmount, onMounted, reactive, watch, type Ref } from "vue";
import { dragScrollLeft, horizontalScrollState } from "../lib/horizontal-scroll";

export type HorizontalScrollerOptions = {
  /** 点一次箭头滚动多少像素；默认按可视宽度取 70%，至少 180px。 */
  step?: number;
};

/**
 * 给横向 chip 轨道补上桌面端缺失的交互：
 * - 鼠标按住拖动（触屏保留原生滑动）
 * - 左右方向键
 * - 左右箭头按钮
 * - 可滚动状态（用于边缘渐隐和按钮禁用）
 *
 * 拖动超过 4px 才进入拖拽态，并在 capture 阶段吞掉紧随其后的 click，
 * 避免「想拖动却误选了分类」。
 */
export function useHorizontalScroller(target: Ref<HTMLElement | null>, options: HorizontalScrollerOptions = {}) {
  const state = reactive({
    canLeft: false,
    canRight: false,
    overflowing: false,
    dragging: false,
  });

  let attached: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let stopWatch: (() => void) | null = null;
  let scrollRaf = 0;
  let disposed = false;

  let active = false;
  let moved = false;
  let startX = 0;
  let startLeft = 0;
  let pointerId: number | null = null;
  let selectionLocked = false;
  let previousUserSelect = "";
  let suppressClick = false;
  let suppressTimer = 0;

  function refresh(): void {
    const node = target.value;
    if (!node) {
      state.canLeft = false;
      state.canRight = false;
      state.overflowing = false;
      return;
    }
    const next = horizontalScrollState(node.scrollLeft, node.clientWidth, node.scrollWidth);
    state.canLeft = next.canLeft;
    state.canRight = next.canRight;
    state.overflowing = next.overflowing;
  }

  function scheduleRefresh(): void {
    if (scrollRaf || disposed) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      refresh();
    });
  }

  function lockSelection(): void {
    if (selectionLocked) return;
    selectionLocked = true;
    previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
  }

  function unlockSelection(): void {
    if (!selectionLocked) return;
    selectionLocked = false;
    document.body.style.userSelect = previousUserSelect;
    previousUserSelect = "";
  }

  function clearPointerListeners(): void {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    active = false;
    pointerId = null;
  }

  function finishPointer(didMove: boolean): void {
    clearPointerListeners();
    unlockSelection();
    state.dragging = false;
    if (didMove) {
      suppressClick = true;
      window.clearTimeout(suppressTimer);
      suppressTimer = window.setTimeout(() => {
        suppressClick = false;
      }, 0);
    }
    refresh();
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType === "touch" || event.button !== 0 || !event.isPrimary) return;
    if (!state.overflowing || !target.value) return;
    active = true;
    moved = false;
    startX = event.clientX;
    startLeft = target.value.scrollLeft;
    pointerId = event.pointerId;
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!active || event.pointerId !== pointerId) return;
    const node = target.value;
    if (!node) return;
    const dx = event.clientX - startX;
    if (!moved) {
      if (Math.abs(dx) < 4) return;
      moved = true;
      state.dragging = true;
      lockSelection();
    }
    event.preventDefault();
    node.scrollLeft = dragScrollLeft(startLeft, startX, event.clientX);
  }

  function onPointerUp(event: PointerEvent): void {
    if (!active || event.pointerId !== pointerId) return;
    finishPointer(moved);
  }

  function onWindowBlur(): void {
    if (active) finishPointer(moved);
  }

  function onClickCapture(event: MouseEvent): void {
    if (!suppressClick) return;
    suppressClick = false;
    window.clearTimeout(suppressTimer);
    event.preventDefault();
    event.stopPropagation();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    scrollBy(event.key === "ArrowLeft" ? -1 : 1);
  }

  function scrollBy(direction: -1 | 1): void {
    const node = target.value;
    if (!node || !state.overflowing) return;
    const step = options.step ?? Math.max(180, Math.round(node.clientWidth * 0.7));
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollBy({ left: direction * step, behavior: reduced ? "auto" : "smooth" });
  }

  function attach(): void {
    const node = target.value;
    if (node === attached) return;
    detach();
    attached = node;
    if (!node) {
      refresh();
      return;
    }
    node.addEventListener("scroll", scheduleRefresh, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleRefresh);
      resizeObserver.observe(node);
    }
    if (typeof MutationObserver !== "undefined") {
      mutationObserver = new MutationObserver(scheduleRefresh);
      mutationObserver.observe(node, { childList: true, subtree: true });
    }
    refresh();
    scheduleRefresh();
  }

  function detach(): void {
    if (attached) {
      attached.removeEventListener("scroll", scheduleRefresh);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    }
    resizeObserver = null;
    mutationObserver = null;
    attached = null;
    if (active) finishPointer(false);
  }

  onMounted(() => {
    window.addEventListener("blur", onWindowBlur);
    stopWatch = watch(target, attach, { immediate: true, flush: "post" });
  });

  onBeforeUnmount(() => {
    disposed = true;
    stopWatch?.();
    stopWatch = null;
    window.removeEventListener("blur", onWindowBlur);
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    scrollRaf = 0;
    clearPointerListeners();
    unlockSelection();
    detach();
  });

  return {
    state,
    refresh,
    onPointerDown,
    onClickCapture,
    onKeydown,
    scrollBy,
  };
}
