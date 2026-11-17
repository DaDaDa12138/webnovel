import { computed, onBeforeUnmount, ref, type Ref } from "vue";
import {
  chapterSpan,
  measureMetrics,
  offsetForPage,
  pageAt,
  pageProgress,
  type PagerMetrics,
} from "../lib/reader-pager";

export interface ReaderPagerOptions {
  /** The scrolling element; in page mode it only clips, the flow is translated. */
  scroller: Ref<HTMLElement | null>;
  /** The multi-column flow element. */
  flow: Ref<HTMLElement | null>;
  /** Columns shown side by side: 1 on phones, 2 in the desktop spread. */
  perView?: () => number;
  /** Called after a re-measure so the caller can repaint decorations. */
  onRelayout?: () => void;
}

const TURN_MS = 240;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/**
 * Page geometry for the column-based reader.
 *
 * CSS multi-column lays the chapter window out sideways; a page is one column. Instead of
 * scrolling the container (which the browser can round to half pages and which fights with
 * touch scrolling) the flow is translated by an exact stride. Every write goes through
 * `goTo`, so there is one place that can leave the flow between two pages.
 */
export function useReaderPager(options: ReaderPagerOptions) {
  const metrics = ref<PagerMetrics>({ viewport: 0, gap: 0, columns: 1, stride: 0, perView: 1 });
  const page = ref(0);
  const pages = computed(() => Math.max(1, Math.ceil(metrics.value.columns / metrics.value.perView)));
  let turnTimer = 0;

  function perView(): number {
    const value = options.perView?.() ?? 1;
    return value >= 2 ? Math.round(value) : 1;
  }

  function flowEl(): HTMLElement | null {
    return options.flow.value;
  }

  function readGap(el: HTMLElement): number {
    const gap = getComputedStyle(el).columnGap;
    const parsed = Number.parseFloat(gap);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /** Re-read the geometry from the DOM. Safe to call at any time. */
  function measure(): PagerMetrics {
    const el = flowEl();
    const scroller = options.scroller.value;
    if (!el || !scroller) return metrics.value;
    const next = measureMetrics(el.scrollWidth, el.clientWidth, readGap(el), perView());
    metrics.value = next;
    const lastScreen = Math.max(0, Math.ceil(next.columns / next.perView) - 1);
    if (page.value > lastScreen) page.value = lastScreen;
    return next;
  }

  function apply(next: number, withAnimation: boolean): void {
    const el = flowEl();
    const m = metrics.value;
    const lastScreen = Math.max(0, Math.ceil(m.columns / m.perView) - 1);
    const clamped = Math.min(Math.max(0, Math.round(next)), lastScreen);
    page.value = clamped;
    if (!el) return;
    const animated = withAnimation && !reducedMotion();
    el.style.transform = "translate3d(" + -offsetForPage(clamped, m.stride, m.columns, m.perView) + "px, 0, 0)";
    el.classList.toggle("is-turning", animated);
    window.clearTimeout(turnTimer);
    if (animated) {
      turnTimer = window.setTimeout(() => {
        el.classList.remove("is-turning");
      }, TURN_MS);
    }
  }

  function goTo(next: number, withAnimation = true): void {
    apply(next, withAnimation);
  }

  /** Advance one page; returns false when the flow is already at that end. */
  function step(direction: 1 | -1, withAnimation = true): boolean {
    const target = page.value + direction;
    if (target < 0 || target > pages.value - 1) return false;
    apply(target, withAnimation);
    return true;
  }

  /** Horizontal offset of an element from the flow's own origin, in layout pixels. */
  function leftOf(el: HTMLElement | null): number {
    const flow = flowEl();
    if (!el || !flow) return 0;
    return el.getBoundingClientRect().left - flow.getBoundingClientRect().left;
  }

  /** Screen index for a horizontal offset from the flow's origin. */
  function pageOfLeft(x: number): number {
    return pageAt(x, metrics.value.stride, metrics.value.columns, metrics.value.perView);
  }

  function pageOf(el: HTMLElement | null): number {
    if (!el) return page.value;
    return pageOfLeft(leftOf(el));
  }

  function spanOf(section: HTMLElement | null, nextSection: HTMLElement | null): { start: number; pages: number } {
    const flow = flowEl();
    if (!section || !flow) return { start: page.value, pages: 1 };
    const startLeft = leftOf(section);
    const endLeft = nextSection ? leftOf(nextSection) : flow.scrollWidth;
    return chapterSpan(startLeft, endLeft, metrics.value);
  }

  /** Progress inside the whole rendered window, 0..1. */
  function progress(): number {
    return pageProgress(page.value, metrics.value.columns, metrics.value.perView);
  }

  /** Reset the transform, e.g. when switching back to scroll mode. */
  function clear(): void {
    const el = flowEl();
    if (el) {
      el.style.transform = "";
      el.classList.remove("is-turning");
    }
    page.value = 0;
  }

  function relayout(withAnimation = false): void {
    measure();
    apply(page.value, withAnimation);
    options.onRelayout?.();
  }

  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(() => relayout(false));
  }

  function observe(): void {
    const el = flowEl();
    const scroller = options.scroller.value;
    if (observer) {
      observer.disconnect();
      if (el) observer.observe(el);
      if (scroller) observer.observe(scroller);
    }
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
  }

  function onResize(): void {
    relayout(false);
  }

  function unobserve(): void {
    observer?.disconnect();
    window.removeEventListener("resize", onResize);
    window.visualViewport?.removeEventListener("resize", onResize);
    window.clearTimeout(turnTimer);
  }

  onBeforeUnmount(unobserve);

  return {
    metrics,
    page,
    pages,
    measure,
    goTo,
    step,
    leftOf,
    pageOf,
    pageOfLeft,
    spanOf,
    progress,
    clear,
    relayout,
    observe,
    unobserve,
  };
}
