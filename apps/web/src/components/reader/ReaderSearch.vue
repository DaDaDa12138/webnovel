<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { BookSearchHit } from "@legado/shared";
import BottomSheet from "../BottomSheet.vue";
import type { SearchMatch } from "../../lib/reader-search";

/**
 * 搜索面板：本章（即时）与全书（流式）两种范围共用同一个输入框。
 *
 * 面板只负责显示与派发，匹配与抓取都在 useReaderSearch 里——这样「点结果跳转」
 * 与「上一处/下一处」走的是同一条定位逻辑，不会出现两套偏移算法。
 */
const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    query: string;
    scope: "chapter" | "book";
    chapterMatches: SearchMatch[];
    bookHits: BookSearchHit[];
    scanning: boolean;
    progress: { done: number; total: number };
    error: string;
    /** 这一轮是否已经搜过全书（决定显示「搜索全书」按钮还是结果）。 */
    scannedOnce: boolean;
    canContinue: boolean;
    nextIndex: number;
    chapterIndex: number;
    chapterTitle: string;
    total: number;
    activeMatch: number;
    pinnedIndex: number;
    hasQuery: boolean;
  }>(),
  { error: "", nextIndex: 0, activeMatch: 0, pinnedIndex: -1, hasQuery: false },
);

const emit = defineEmits<{
  (event: "update:modelValue", value: boolean): void;
  (event: "update:query", value: string): void;
  (event: "update:scope", value: "chapter" | "book"): void;
  (event: "search-book"): void;
  (event: "continue"): void;
  (event: "stop"): void;
  (event: "select-chapter", index: number): void;
  (event: "select-book", index: number): void;
  (event: "clear"): void;
}>();

const input = ref<HTMLInputElement | null>(null);

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return;
    await nextTick();
    input.value?.focus();
  },
);

const subtitle = () => {
  if (props.scope === "chapter") return `本章 · ${props.chapterTitle}`;
  return `全书 ${props.total} 章 · 先扫已缓存，再联网补抓`;
};

const percent = () => {
  const total = props.progress.total || 0;
  if (!total) return 0;
  return Math.min(100, Math.round((props.progress.done / total) * 100));
};

function onInput(event: Event): void {
  emit("update:query", (event.target as HTMLInputElement).value);
}

function onKey(event: KeyboardEvent): void {
  if (event.key !== "Enter") return;
  event.preventDefault();
  if (props.scope === "book") emit("search-book");
  else if (props.chapterMatches.length) emit("select-chapter", 0);
}
</script>

<template>
  <BottomSheet
    :open="modelValue"
    title="搜索"
    :subtitle="subtitle()"
    tall
    @close="emit('update:modelValue', false)"
  >
    <div class="search-box">
      <input
        ref="input"
        class="search-input"
        type="search"
        :value="query"
        placeholder="输入关键词，本章即时 / 全书流式"
        enterkeyhint="search"
        @input="onInput"
        @keydown="onKey"
      />
      <button v-if="query" class="search-clear" type="button" aria-label="清空" @click="emit('clear')">✕</button>
    </div>

    <div class="seg search-scope">
      <button type="button" :class="{ active: scope === 'chapter' }" @click="emit('update:scope', 'chapter')">本章</button>
      <button type="button" :class="{ active: scope === 'book' }" @click="emit('update:scope', 'book')">全书</button>
    </div>

    <!-- 本章：正文已经在内存里，边打字边出结果 -->
    <div v-if="scope === 'chapter'" class="search-body">
      <p v-if="!hasQuery" class="search-hint">输入关键词，会在本章正文里即时标出。</p>
      <p v-else-if="!chapterMatches.length" class="search-hint">本章没有找到「{{ query }}」。</p>
      <template v-else>
        <p class="search-hint">本章 {{ chapterMatches.length }} 处命中，点一条跳过去。</p>
        <button
          v-for="(match, i) in chapterMatches"
          :key="i"
          type="button"
          class="search-hit"
          :class="{ active: i === activeMatch }"
          @click="emit('select-chapter', i)"
        >
          <span class="search-hit-text">{{ match.excerpt }}</span>
          <span class="search-hit-meta">第 {{ match.para + 1 }} 段</span>
        </button>
      </template>
    </div>

    <!-- 全书：SSE 边扫边推 -->
    <div v-else class="search-body">
      <p v-if="error" class="search-error">{{ error }}</p>
      <p v-else-if="!hasQuery" class="search-hint">输入关键词后点「搜索全书」。</p>
      <template v-else>
        <div v-if="scanning" class="search-progress">
          <div class="reader-search-bar"><span :style="{ width: percent() + '%' }" /></div>
          <p class="search-hint">
            已扫 {{ progress.done }} / {{ progress.total }} 章 · 找到 {{ bookHits.length }} 章
          </p>
          <button class="btn ghost" type="button" @click="emit('stop')">停止</button>
        </div>
        <div v-else-if="!scannedOnce" class="search-start">
          <button class="btn" type="button" @click="emit('search-book')">搜索全书（{{ total }} 章）</button>
          <p class="search-hint">已离线缓存的章节会先扫，剩下的再联网抓；一千章大约要一两分钟，可以随时停。</p>
        </div>
        <template v-else>
          <p v-if="!bookHits.length" class="search-hint">已经扫过 {{ progress.done }} 章，没有找到「{{ query }}」。</p>
          <template v-else>
            <p class="search-hint">{{ bookHits.length }} 章命中，点一条跳过去。</p>
            <button
              v-for="(hit, i) in bookHits"
              :key="hit.chapterIndex"
              type="button"
              class="search-hit"
              :class="{ active: i === pinnedIndex }"
              @click="emit('select-book', i)"
            >
              <span class="search-hit-title">{{ hit.chapterTitle || "第 " + (hit.chapterIndex + 1) + " 章" }}</span>
              <span class="search-hit-text">{{ hit.excerpt }}</span>
              <span class="search-hit-meta">{{ hit.count }} 处</span>
            </button>
          </template>
          <button v-if="canContinue" class="btn ghost" type="button" @click="emit('continue')">
            继续扫描（从第 {{ nextIndex + 1 }} 章起）
          </button>
        </template>
      </template>
    </div>
  </BottomSheet>
</template>
