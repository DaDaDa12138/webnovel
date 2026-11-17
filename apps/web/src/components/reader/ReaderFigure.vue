<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ChapterImage } from "@legado/shared";

const props = defineProps<{
  image: ChapterImage;
  paged?: boolean;
}>();

const emit = defineEmits<{
  zoom: [src: string];
  load: [];
}>();

const root = ref<HTMLElement | null>(null);
const broken = ref(false);
const naturalWidth = ref(0);
const naturalHeight = ref(0);
const boxWidth = ref(0);
const pageHeight = ref(0);

const imageLoading = computed(() => (props.paged ? "eager" : "lazy"));
const renderedHeight = computed(() => {
  if (!naturalWidth.value || !boxWidth.value) return 0;
  return (naturalHeight.value * boxWidth.value) / naturalWidth.value;
});
/** 分页模式且整图高于一页才切；切之前仍按普通插图显示，不会闪空白。 */
const sliced = computed(() => Boolean(props.paged) && pageHeight.value > 0 && renderedHeight.value > pageHeight.value * 1.02);
const sliceCount = computed(() => {
  if (!sliced.value) return 0;
  return Math.min(24, Math.max(2, Math.ceil(renderedHeight.value / pageHeight.value)));
});
const slices = computed(() => Array.from({ length: sliceCount.value }, (_, index) => index));

function measure(): void {
  const el = root.value;
  if (!el) return;
  boxWidth.value = el.clientWidth || 0;
  const body = el.closest(".reader-body") as HTMLElement | null;
  const flow = el.closest(".reader-flow") as HTMLElement | null;
  if (!body || !flow || !props.paged) {
    pageHeight.value = 0;
    return;
  }
  const style = window.getComputedStyle(flow);
  const padding = parseFloat(style.paddingTop || "0") + parseFloat(style.paddingBottom || "0");
  // 留 8px 余量，避免小数像素把 slice 顶到下一页造成空白页。
  pageHeight.value = Math.max(180, Math.floor(body.clientHeight - padding - 8));
}

function onLoad(event: Event): void {
  const img = event.target as HTMLImageElement;
  naturalWidth.value = img.naturalWidth || 0;
  naturalHeight.value = img.naturalHeight || 0;
  emit("load");
  void nextTick(() => requestAnimationFrame(measure));
}

function onError(): void {
  broken.value = true;
}

let observer: ResizeObserver | null = null;
function onResize(): void {
  measure();
}

onMounted(() => {
  measure();
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(() => measure());
    if (root.value) observer.observe(root.value);
    const body = root.value?.closest(".reader-body");
    if (body) observer.observe(body);
  }
  window.addEventListener("resize", onResize);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  window.removeEventListener("resize", onResize);
});

watch(
  () => props.paged,
  () => {
    void nextTick(() => requestAnimationFrame(measure));
  },
);
</script>

<template>
  <figure ref="root" class="para-img" :class="{ 'is-broken': broken, 'is-long': sliced }">
    <template v-if="sliced">
      <button
        v-for="index in slices"
        :key="index"
        class="para-img-btn para-img-slice"
        :style="{ height: pageHeight + 'px' }"
        type="button"
        aria-label="查看大图"
        @click="emit('zoom', image.src)"
      >
        <img
          :src="image.src"
          alt=""
          :loading="imageLoading"
          decoding="async"
          :style="{ transform: `translateY(-${index * pageHeight}px)` }"
        />
      </button>
    </template>
    <button v-else class="para-img-btn" type="button" aria-label="查看大图" @click="emit('zoom', image.src)">
      <img :src="image.src" alt="" :loading="imageLoading" decoding="async" @load="onLoad" @error="onError" />
    </button>
  </figure>
</template>

<style scoped>
.para-img.is-long {
  margin: 0;
}
.para-img-slice {
  position: relative;
  overflow: hidden;
  line-height: 0;
  font-size: 0;
  break-inside: avoid;
}
.para-img-slice img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  max-width: none;
  height: auto;
  border-radius: 0;
}
</style>
