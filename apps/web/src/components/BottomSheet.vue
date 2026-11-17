<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

/** 底部弹层：遮罩点击关闭、Esc 关闭、打开时锁滚动，头部的标题/副标题/右侧操作统一。 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    subtitle?: string;
    tall?: boolean;
    inline?: boolean;
    /** 阅读设置等长面板：顶部加拖拽条，可在半屏与全屏之间调高度。 */
    resizable?: boolean;
    /** 记住高度用的 localStorage key；留空则不持久化。 */
    storageKey?: string;
    /** 展开时的默认高度（vh）。 */
    defaultHeight?: number;
    /** 半屏高度（vh）。 */
    compactHeight?: number;
  }>(),
  {
    tall: false,
    inline: false,
    resizable: false,
    storageKey: "",
    defaultHeight: 82,
    compactHeight: 56,
  },
);
const emit = defineEmits<{ close: []; resize: [height: number] }>();

const MIN_HEIGHT = 46;
const MAX_HEIGHT = 92;
const COMPACT_MAX = 64;

const sheetEl = ref<HTMLElement | null>(null);
const heightVh = ref<number | null>(null);
const dragging = ref(false);
let dragStartY = 0;
let dragStartHeight = 0;

const isCompact = computed(() => heightVh.value !== null && heightVh.value <= COMPACT_MAX);
const sheetStyle = computed(() =>
  heightVh.value === null
    ? undefined
    : { height: heightVh.value + "vh", maxHeight: MAX_HEIGHT + "vh" },
);

function clampHeight(value: number): number {
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(value * 2) / 2));
}

function readStored(): number | null {
  if (!props.resizable || !props.storageKey) return null;
  try {
    const raw = localStorage.getItem(props.storageKey);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? clampHeight(value) : null;
  } catch {
    /* 隐私模式下 localStorage 可能直接抛错 */
    return null;
  }
}

function saveHeight(): void {
  if (!props.storageKey) return;
  try {
    if (heightVh.value !== null) localStorage.setItem(props.storageKey, String(heightVh.value));
  } catch {
    /* 存不下就算了，本次仍然生效 */
  }
}

function applyHeight(value: number, persist = false): void {
  if (!props.resizable) return;
  const next = clampHeight(value);
  heightVh.value = next;
  emit("resize", next);
  if (persist) saveHeight();
}

function measuredHeight(): number {
  const el = sheetEl.value;
  return el ? (el.getBoundingClientRect().height / Math.max(1, window.innerHeight)) * 100 : props.defaultHeight;
}

/** 供父组件调用：半屏与展开之间切换。 */
function toggleCompact(): void {
  if (!props.resizable) return;
  const current = heightVh.value ?? measuredHeight();
  applyHeight(current <= COMPACT_MAX ? props.defaultHeight : props.compactHeight, true);
}

function onPointerDown(event: PointerEvent): void {
  if (!props.resizable) return;
  const el = sheetEl.value;
  if (!el) return;
  dragging.value = true;
  dragStartY = event.clientY;
  dragStartHeight = (el.getBoundingClientRect().height / Math.max(1, window.innerHeight)) * 100;
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return;
  const delta = ((dragStartY - event.clientY) / Math.max(1, window.innerHeight)) * 100;
  applyHeight(dragStartHeight + delta);
}

function onPointerUp(event: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  saveHeight();
}

function onHandleKey(event: KeyboardEvent): void {
  if (!props.resizable) return;
  const current = heightVh.value ?? measuredHeight();
  if (event.key === "ArrowUp") {
    event.preventDefault();
    applyHeight(current + 2, true);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    applyHeight(current - 2, true);
  } else if (event.key === "Home") {
    event.preventDefault();
    applyHeight(props.compactHeight, true);
  } else if (event.key === "End") {
    event.preventDefault();
    applyHeight(props.defaultHeight, true);
  }
}

let locked = false;
function lock(on: boolean) {
  if (on === locked) return;
  locked = on;
  document.body.style.overflow = on ? "hidden" : "";
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
}

watch(
  () => props.open,
  (open) => {
    lock(open);
    if (open) {
      heightVh.value = readStored();
      dragging.value = false;
      if (heightVh.value !== null) emit("resize", heightVh.value);
      window.addEventListener("keydown", onKey);
    } else {
      window.removeEventListener("keydown", onKey);
    }
  },
  { immediate: true },
);

watch(
  () => props.storageKey,
  () => {
    if (!props.open) return;
    heightVh.value = readStored();
    if (heightVh.value !== null) emit("resize", heightVh.value);
  },
);

onBeforeUnmount(() => {
  lock(false);
  dragging.value = false;
  window.removeEventListener("keydown", onKey);
});

defineExpose({ toggleCompact, isCompact, heightVh });
</script>

<template>
  <Teleport to="body" :disabled="inline">
    <div
      v-if="open"
      class="sheet-mask"
      :class="{ 'sheet-mask-compact': resizable && isCompact }"
      @click.self="emit('close')"
    >
      <div
        ref="sheetEl"
        class="sheet"
        :class="{ 'sheet-tall': tall, 'sheet-resizable': resizable, 'sheet-dragging': dragging }"
        :style="sheetStyle"
        role="dialog"
        aria-modal="true"
      >
        <div
          v-if="resizable"
          class="sheet-drag"
          role="separator"
          aria-orientation="horizontal"
          aria-label="调整设置面板高度"
          :aria-valuemin="MIN_HEIGHT"
          :aria-valuemax="MAX_HEIGHT"
          :aria-valuenow="heightVh ?? undefined"
          tabindex="0"
          title="上下拖动调整高度，双击切换半屏"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @dblclick="toggleCompact"
          @keydown="onHandleKey"
        >
          <span />
        </div>
        <div class="sheet-head">
          <div class="bs-head-text">
            <h3 class="sheet-title">{{ title }}</h3>
            <p v-if="subtitle" class="sheet-sub">{{ subtitle }}</p>
          </div>
          <slot name="head" />
          <button class="icon-btn" aria-label="关闭" @click="emit('close')">✕</button>
        </div>
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.bs-head-text {
  flex: 1;
  min-width: 0;
}
</style>
