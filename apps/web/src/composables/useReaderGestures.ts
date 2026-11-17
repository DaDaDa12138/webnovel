import { onBeforeUnmount, type Ref } from "vue";
import { adjustZoneAt, type AdjustKind } from "../lib/reader-adjust";
import { cellOf, tapActionAt, type TapAction, type TapGrid } from "../lib/reader-tap";

export interface ReaderGestureOptions {
  target: Ref<HTMLElement | null>;
  tapGrid: () => TapGrid;
  /** Horizontal swipes turn the page; only meaningful in page mode. */
  swipeTurn: () => boolean;
  /** Mirrors the tap grid for right-to-left books. */
  rtl?: () => boolean;
  onTap: (action: TapAction, target?: Element | null) => void;
  onSwipe: (direction: 1 | -1) => void;
  onLongPress?: () => void;
  /** Fired as soon as a gesture starts, so auto-scroll can stop before the page moves. */
  onGestureStart?: () => void;
  /** 边缘上下滑是否参与（滚动模式下竖向滑动就是滚动，不能抢）。 */
  adjustEnabled?: () => boolean;
  onAdjustStart?: (kind: AdjustKind) => void;
  onAdjustMove?: (dy: number) => void;
  onAdjustEnd?: () => void;
}

const TAP_MAX_DISTANCE = 10;
const TAP_MAX_DURATION = 450;
const SWIPE_MIN_DISTANCE = 48;
const SWIPE_MAX_OFF_AXIS = 0.8;
const LONG_PRESS_MS = 500;
const CLICK_SUPPRESS_MS = 320;

const INTERACTIVE = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "[role='button']",
  "[role='slider']",
  "[role='link']",
  "[contenteditable='true']",
  ".sheet",
  ".sheet-mask",
  ".reader-readout",
].join(",");

interface Pending {
  id: number;
  x: number;
  y: number;
  time: number;
  moved: boolean;
  consumed: boolean;
  /** 这一指落在左/右边缘时要调的东西；中间为 null。 */
  adjust: AdjustKind | null;
  adjusting: boolean;
  /** 手指落点，用来判断是不是点在划线上。 */
  target: Element | null;
}

/**
 * Pointer gesture layer: one decision per gesture, made on pointerdown and never revisited.
 *
 * The reader used to guess from `click` whether the reader had tapped or dragged; a drag on a
 * scrolling surface still fires click on the element it started on, so taps and drags were
 * indistinguishable. Pointer events plus a movement threshold fix that, and a consumed gesture
 * swallows the synthetic click so a drag never presses a button.
 */
export function useReaderGestures(options: ReaderGestureOptions) {
  let pending: Pending | null = null;
  let longPressTimer = 0;
  let suppressUntil = 0;
  let attached: HTMLElement | null = null;

  function hasSelection(): boolean {
    const selection = window.getSelection?.();
    return Boolean(selection && !selection.isCollapsed && selection.toString().trim().length > 0);
  }

  function interactive(target: EventTarget | null): boolean {
    const el = target as Element | null;
    return Boolean(el && typeof el.closest === "function" && el.closest(INTERACTIVE));
  }

  function layoutPoint(el: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
    const rect = el.getBoundingClientRect();
    // Pinch zoom makes client coordinates disagree with layout coordinates; divide by the
    // ratio so a tap in the visual left third is still the layout left third.
    const scale = rect.width > 0 && el.offsetWidth > 0 ? el.offsetWidth / rect.width : 1;
    return { x: (clientX - rect.left) * scale, y: (clientY - rect.top) * scale };
  }

  function clearLongPress(): void {
    if (longPressTimer) window.clearTimeout(longPressTimer);
    longPressTimer = 0;
  }

  function suppressNextClick(): void {
    suppressUntil = Date.now() + CLICK_SUPPRESS_MS;
  }

  function onClickCapture(event: MouseEvent): void {
    if (Date.now() > suppressUntil) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerDown(event: PointerEvent): void {
    if (!event.isPrimary || event.button > 0) return;
    if (hasSelection() || interactive(event.target)) return;
    const el = attached;
    if (!el) return;
    const zone = options.adjustEnabled?.()
      ? adjustZoneAt(layoutPoint(el, event.clientX, event.clientY).x, el.offsetWidth)
      : null;
    pending = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: Date.now(),
      moved: false,
      consumed: false,
      adjust: zone,
      adjusting: false,
      target: event.target instanceof Element ? event.target : null,
    };
    options.onGestureStart?.();
    clearLongPress();
    longPressTimer = window.setTimeout(() => {
      if (!pending || pending.moved) return;
      pending.consumed = true;
      suppressNextClick();
      options.onLongPress?.();
    }, LONG_PRESS_MS);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!pending || event.pointerId !== pending.id) return;
    const dx = event.clientX - pending.x;
    const dy = event.clientY - pending.y;
    if (Math.hypot(dx, dy) > TAP_MAX_DISTANCE) {
      pending.moved = true;
      clearLongPress();
    }
    // 竖向为主的拖动才交给调整：横向滑动仍归翻页，斜着划一下不会误调亮度。
    if (pending.adjust) {
      const vertical = Math.abs(dy) > TAP_MAX_DISTANCE && Math.abs(dy) > Math.abs(dx) * 1.2;
      if (!pending.adjusting && vertical) {
        pending.adjusting = true;
        pending.consumed = true;
        suppressNextClick();
        // 竖向拖动会顺手选中正文（桌面端尤其明显），先清掉选区再开始调。
        window.getSelection?.()?.removeAllRanges();
        options.onAdjustStart?.(pending.adjust);
      }
      if (pending.adjusting) options.onAdjustMove?.(dy);
    }
  }

  function finish(event: PointerEvent, cancelled: boolean): void {
    const gesture = pending;
    if (!gesture || event.pointerId !== gesture.id) return;
    pending = null;
    clearLongPress();
    if (gesture.adjusting) {
      options.onAdjustEnd?.();
      return;
    }
    if (cancelled || gesture.consumed) return;

    const el = attached;
    if (!el) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    const elapsed = Date.now() - gesture.time;
    const distance = Math.hypot(dx, dy);

    if (distance <= TAP_MAX_DISTANCE && elapsed <= TAP_MAX_DURATION) {
      const point = layoutPoint(el, event.clientX, event.clientY);
      const cell = cellOf(point.x, point.y, el.offsetWidth, el.offsetHeight);
      const action = tapActionAt(options.tapGrid(), cell.column, cell.row, options.rtl?.() ?? false);
      // 即使这一格是「无动作」也要交给上层：点划线看批注不受热区设置影响。
      options.onTap(action, gesture.target);
      return;
    }

    if (!options.swipeTurn()) return;
    if (Math.abs(dx) < SWIPE_MIN_DISTANCE) return;
    if (Math.abs(dx) < Math.abs(dy) / SWIPE_MAX_OFF_AXIS) return;
    suppressNextClick();
    options.onSwipe(dx < 0 ? 1 : -1);
  }

  function onPointerUp(event: PointerEvent): void {
    finish(event, false);
  }

  function onPointerCancel(event: PointerEvent): void {
    finish(event, true);
  }

  function attach(el: HTMLElement | null): void {
    detach();
    if (!el) return;
    attached = el;
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerCancel);
    el.addEventListener("click", onClickCapture, true);
  }

  function detach(): void {
    if (!attached) return;
    attached.removeEventListener("pointerdown", onPointerDown);
    attached.removeEventListener("pointermove", onPointerMove);
    attached.removeEventListener("pointerup", onPointerUp);
    attached.removeEventListener("pointercancel", onPointerCancel);
    attached.removeEventListener("click", onClickCapture, true);
    attached = null;
    clearLongPress();
    pending = null;
  }

  onBeforeUnmount(detach);

  return { attach, detach, hasSelection };
}
