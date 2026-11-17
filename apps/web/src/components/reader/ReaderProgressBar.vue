<script setup lang="ts">
import { computed, ref, watch } from "vue";

type Unit = "chapter" | "page" | "book";

const props = defineProps<{
  chapter: number;
  total: number;
  page: number;
  pages: number;
  percent: number;
  /** Chapter titles for the drag preview (index === chapter index). */
  titles?: string[];
  /** 本章剩余字数与预计阅读分钟数：让页脚的进度条同时回答「还有多久」。 */
  remainingChars?: number;
  /** 本章已读字符数与本章总字符数：回答「读了多少」。 */
  readChars?: number;
  chapterChars?: number;
  minutes?: number;
}>();

const emit = defineEmits<{
  (event: "seek-chapter", index: number): void;
  (event: "seek-page", page: number): void;
}>();

const unit = ref<Unit>("chapter");
const draft = ref<number | null>(null);

const max = computed(() => Math.max(0, props.total - 1));

const value = computed(() => {
  if (draft.value !== null) return draft.value;
  if (unit.value === "page") return Math.max(0, props.page - 1);
  if (unit.value === "book") return Math.round(Math.min(100, Math.max(0, props.percent)) * 10);
  return Math.min(max.value, Math.max(0, props.chapter));
});

const bounds = computed(() => {
  if (unit.value === "page") return { min: 0, max: Math.max(0, props.pages - 1) };
  if (unit.value === "book") return { min: 0, max: 1000 };
  return { min: 0, max: max.value };
});

const label = computed(() => {
  if (unit.value === "page") return "第 " + props.page + " / " + Math.max(1, props.pages) + " 页";
  if (unit.value === "book") return Math.min(100, Math.max(0, props.percent)).toFixed(1) + "%";
  return "第 " + (props.chapter + 1) + " / " + Math.max(1, props.total) + " 章";
});

watch([unit, () => props.chapter, () => props.page], () => {
  draft.value = null;
});

function onInput(event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(raw)) return;
  draft.value = raw;
  // Dragging inside the current chapter is cheap: show the page immediately.
  if (unit.value === "page") emit("seek-page", raw + 1);
}

function onChange(event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value);
  draft.value = null;
  if (!Number.isFinite(raw)) return;
  if (unit.value === "page") {
    emit("seek-page", raw + 1);
    return;
  }
  if (unit.value === "book") {
    const index = Math.floor((raw / 1000) * Math.max(1, props.total));
    emit("seek-chapter", Math.min(max.value, Math.max(0, index)));
    return;
  }
  emit("seek-chapter", Math.min(max.value, Math.max(0, raw)));
}

/** 拖动时浮在页脚上方的目标提示：章名比百分比更能确认「我要去哪儿」。 */
const previewText = computed(() => {
  if (draft.value === null) return "";
  if (unit.value === "page") return "第 " + Math.round(draft.value + 1) + " / " + Math.max(1, props.pages) + " 页";
  if (unit.value === "book") {
    const index = Math.min(max.value, Math.floor((draft.value / 1000) * Math.max(1, props.total)));
    return (draft.value / 10).toFixed(1) + "% · 第 " + (index + 1) + " 章";
  }
  const index = Math.min(max.value, Math.max(0, Math.round(draft.value)));
  const title = (props.titles?.[index] ?? "").trim();
  // 书源标题通常自带「第 N 章」，再拼一次就变成「第 677 章 · 第678章 …」。
  if (/^第\s*[0-9零一二三四五六七八九十百千两]+\s*章/.test(title)) return title;
  return title ? "第 " + (index + 1) + " 章 · " + title : "第 " + (index + 1) + " 章";
});

const previewLeft = computed(() => {
  const span = Math.max(1, bounds.value.max - bounds.value.min);
  const ratio = Math.min(1, Math.max(0, (value.value - bounds.value.min) / span));
  return Math.min(92, Math.max(8, ratio * 100)) + "%";
});

const units: Array<{ id: Unit; label: string }> = [
  { id: "chapter", label: "章" },
  { id: "page", label: "页" },
  { id: "book", label: "全书" },
];
</script>

<template>
  <div class="reader-progress">
    <div v-if="draft !== null" class="reader-seek" :style="{ left: previewLeft }">{{ previewText }}</div>
    <div class="reader-meta">
      <span>{{ label }}</span>
      <span v-if="readChars && chapterChars" class="reader-remaining">
        已读 {{ readChars.toLocaleString("zh-CN") }} 字
        <span v-if="remainingChars && minutes" class="reader-remaining-extra"> · 剩 {{ remainingChars.toLocaleString("zh-CN") }} 字 · 约 {{ minutes }} 分钟</span>
      </span>
      <span v-else-if="remainingChars && minutes" class="reader-remaining">还剩 {{ remainingChars.toLocaleString("zh-CN") }} 字 · 约 {{ minutes }} 分钟</span>
      <div class="reader-units" role="group" aria-label="进度单位">
        <button
          v-for="item in units"
          :key="item.id"
          class="reader-unit"
          type="button"
          :class="{ active: unit === item.id }"
          :aria-pressed="unit === item.id"
          @click="unit = item.id"
        >
          {{ item.label }}
        </button>
      </div>
    </div>
    <input
      class="reader-slider"
      type="range"
      :min="bounds.min"
      :max="bounds.max"
      :value="value"
      :aria-valuetext="label"
      @input="onInput"
      @change="onChange"
    />
  </div>
</template>
