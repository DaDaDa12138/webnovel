<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { READOUT_SLOTS, formatReadout, type ReadoutConfig, type ReadoutContext, type ReadoutField } from "../../lib/reader-readout";

const props = withDefaults(
  defineProps<{
    config: ReadoutConfig;
    book: string;
    chapter: string;
    percent: number;
    page: number;
    pages: number;
    remainingChars?: number;
    /** 本章已读字符数（页角读数可单独选「已读字数」）。 */
    readChars?: number;
    /** 睡眠定时剩余毫秒（父组件每秒刷新一次）。 */
    sleepLeft?: number;
    /** 当前书源名（页角读数里可以放「书源」这一格）。 */
    source?: string;
    /** Keep showing while the toolbars are hidden. */
    always?: boolean;
    chromeVisible?: boolean;
    /** 顶部两格与标题栏重复，标题栏露出来时就不画它们。 */
    topVisible?: boolean;
  }>(),
  { remainingChars: 0, readChars: 0, sleepLeft: 0, source: "", always: true, chromeVisible: true, topVisible: true },
);

const now = ref(new Date());
let timer = 0;

/** Align to the next minute: a status clock that drifts by seconds looks broken. */
function schedule(): void {
  window.clearTimeout(timer);
  const delay = 60_000 - (Date.now() % 60_000);
  timer = window.setTimeout(() => {
    now.value = new Date();
    schedule();
  }, delay);
}

function refresh(): void {
  now.value = new Date();
  schedule();
}

onMounted(() => {
  schedule();
  document.addEventListener("visibilitychange", refresh);
});

onBeforeUnmount(() => {
  window.clearTimeout(timer);
  document.removeEventListener("visibilitychange", refresh);
});

const context = computed<ReadoutContext>(() => ({
  book: props.book,
  chapter: props.chapter,
  source: props.source,
  percent: props.percent,
  page: props.page,
  pages: props.pages,
  remainingChars: props.remainingChars,
  readChars: props.readChars,
  sleepLeft: props.sleepLeft,
  now: now.value,
}));

/** 工具栏打开时标题栏已经有章节名和进度，页角读数只在沉浸阅读时出现。 */
const visible = computed(() => props.always || !props.chromeVisible);

function text(field: ReadoutField): string {
  return formatReadout(field, context.value);
}

const cells = computed(() => READOUT_SLOTS.map((slot) => ({ slot, value: text(props.config[slot]) })));

function shown(slot: string): boolean {
  return props.topVisible || !slot.startsWith("top");
}
</script>

<template>
  <div v-if="visible" class="reader-readout" aria-hidden="true">
    <span v-for="cell in cells" v-show="shown(cell.slot)" :key="cell.slot" class="reader-readout-cell" :class="'slot-' + cell.slot">{{
      cell.value
    }}</span>
  </div>
</template>
