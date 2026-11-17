<script setup lang="ts">
/**
 * 正文插图查看器：点开正文里的图，全屏看细节。
 *
 * 只做三件事——缩放（双击/双指/滚轮）、平移（拖动）、关闭。
 * 缩放与平移的边界都在 lib/reader-zoom.ts 里算，组件只管指针状态，
 * 这样「拖到哪算到头」这类容易写错的几何有单测兜底。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { clampPan, clampZoom, panLimit, pinchZoom, toggleZoom, zoomAround } from "../../lib/reader-zoom";

const props = defineProps<{
  src: string;
  alt?: string;
}>();

const emit = defineEmits<{ close: [] }>();

const frame = ref<HTMLElement | null>(null);
const imgEl = ref<HTMLImageElement | null>(null);
const scale = ref(1);
const offset = ref({ x: 0, y: 0 });
/** 图片在 1× 时的渲染尺寸，用来算平移上限。 */
const base = ref({ width: 0, height: 0 });
const dragging = ref(false);

const pointers = new Map<number, { x: number; y: number }>();
let start = { scale: 1, x: 0, y: 0, dist: 0, midX: 0, midY: 0, px: 0, py: 0 };
/** 拖动结束时会补一个 click：记下这次手势动过，别当成「点空白关闭」。 */
let moved = false;
/** 指针捕获会把 click 的 target 改成 frame，所以要自己记「按下时点的是空白还是图」。 */
let downOnFrame = false;

const style = computed(() => ({
  transform: `translate3d(${offset.value.x}px, ${offset.value.y}px, 0) scale(${scale.value})`,
}));

function distance(): number {
  const [a, b] = [...pointers.values()];
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(): { x: number; y: number } {
  const [a, b] = [...pointers.values()];
  if (!a || !b) return { x: 0, y: 0 };
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** 缩放变化后把偏移夹回边界；1× 时强制回中。 */
function settle(): void {
  if (scale.value <= 1.01) {
    offset.value = { x: 0, y: 0 };
    return;
  }
  const rect = frame.value?.getBoundingClientRect();
  if (!rect) return;
  offset.value = {
    x: clampPan(offset.value.x, panLimit(base.value.width, rect.width, scale.value)),
    y: clampPan(offset.value.y, panLimit(base.value.height, rect.height, scale.value)),
  };
}

function onLoad(): void {
  const rect = imgEl.value?.getBoundingClientRect();
  if (!rect) return;
  base.value = { width: rect.width / scale.value, height: rect.height / scale.value };
  settle();
}

function onPointerDown(event: PointerEvent): void {
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  if (pointers.size === 0) {
    moved = false;
    downOnFrame = event.target === frame.value;
  }
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  dragging.value = true;
  if (pointers.size === 1) {
    start = { ...start, scale: scale.value, x: offset.value.x, y: offset.value.y, px: event.clientX, py: event.clientY };
  } else if (pointers.size === 2) {
    const mid = midpoint();
    start = { ...start, scale: scale.value, x: offset.value.x, y: offset.value.y, dist: distance(), midX: mid.x, midY: mid.y };
  }
}

function onPointerMove(event: PointerEvent): void {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size >= 2) {
    const mid = midpoint();
    scale.value = pinchZoom(start.scale, start.dist, distance());
    offset.value = { x: start.x + (mid.x - start.midX), y: start.y + (mid.y - start.midY) };
  } else {
    offset.value = { x: start.x + (event.clientX - start.px), y: start.y + (event.clientY - start.py) };
    if (Math.hypot(event.clientX - start.px, event.clientY - start.py) > 6) moved = true;
  }
  settle();
}

/** 点图片周围的空白关闭；拖动结束时浏览器补发的 click 不算。 */
function onFrameClick(): void {
  const blank = downOnFrame && !moved;
  moved = false;
  downOnFrame = false;
  if (blank) emit("close");
}

function onPointerUp(event: PointerEvent): void {
  pointers.delete(event.pointerId);
  if (pointers.size === 0) dragging.value = false;
  // 松开一根手指后，剩下那根要接着拖：以当前状态作为新的起点
  if (pointers.size === 1) {
    const [rest] = [...pointers.values()];
    start = { ...start, scale: scale.value, x: offset.value.x, y: offset.value.y, px: rest.x, py: rest.y };
  }
  settle();
}

function onWheel(event: WheelEvent): void {
  event.preventDefault();
  const rect = frame.value?.getBoundingClientRect();
  if (!rect) return;
  const next = clampZoom(scale.value * (event.deltaY < 0 ? 1.12 : 0.89));
  const focalX = event.clientX - rect.left - rect.width / 2;
  const focalY = event.clientY - rect.top - rect.height / 2;
  const ratio = next / scale.value;
  offset.value = { x: zoomAround(offset.value.x, focalX, ratio), y: zoomAround(offset.value.y, focalY, ratio) };
  scale.value = next;
  settle();
}

function onDoubleClick(event: MouseEvent): void {
  const rect = frame.value?.getBoundingClientRect();
  if (!rect) return;
  const next = toggleZoom(scale.value);
  const focalX = event.clientX - rect.left - rect.width / 2;
  const focalY = event.clientY - rect.top - rect.height / 2;
  const ratio = next / scale.value;
  offset.value = { x: zoomAround(offset.value.x, focalX, ratio), y: zoomAround(offset.value.y, focalY, ratio) };
  scale.value = next;
  settle();
}

function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.stopPropagation();
    emit("close");
  } else if (event.key === "+" || event.key === "=") {
    scale.value = clampZoom(scale.value * 1.2);
    settle();
  } else if (event.key === "-") {
    scale.value = clampZoom(scale.value / 1.2);
    settle();
  } else if (event.key === "0") {
    scale.value = 1;
    settle();
  }
}

onMounted(() => window.addEventListener("keydown", onKey, true));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey, true));
</script>

<template>
  <div class="img-viewer" role="dialog" aria-modal="true" aria-label="查看插图">
    <div class="img-viewer-backdrop" />
    <div
      ref="frame"
      class="img-viewer-frame"
      :class="{ 'is-dragging': dragging }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @wheel.prevent="onWheel"
      @dblclick="onDoubleClick"
      @click.self="onFrameClick"
    >
      <img
        ref="imgEl"
        class="img-viewer-img"
        :src="src"
        :alt="alt ?? ''"
        :style="style"
        draggable="false"
        @load="onLoad"
      />
    </div>
    <div class="img-viewer-bar">
      <span class="img-viewer-scale">{{ scale.toFixed(1) }}×</span>
      <a class="img-viewer-btn" :href="src" download target="_blank" rel="noreferrer">保存</a>
      <button class="img-viewer-btn" type="button" @click="emit('close')">关闭</button>
    </div>
    <p class="img-viewer-hint">双击放大 · 双指或滚轮缩放 · 拖动平移</p>
  </div>
</template>
