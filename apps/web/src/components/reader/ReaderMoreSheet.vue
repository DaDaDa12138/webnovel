<script setup lang="ts">
import BottomSheet from "../BottomSheet.vue";
import ReaderIcon from "./ReaderIcon.vue";

const props = defineProps<{ modelValue: boolean; autoPlaying: boolean; speaking: boolean; noteCount: number }>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  auto: [];
  speech: [];
  swap: [];
  search: [];
  marks: [];
  notes: [];
}>();

function close(): void {
  emit("update:modelValue", false);
}
</script>

<template>
  <BottomSheet inline :open="modelValue" title="更多操作" subtitle="窄屏把次要按钮收在这里" @close="close">
    <div class="more-list">
      <button class="more-row" type="button" @click="emit('auto')">
        <span class="more-row-icon"><ReaderIcon :name="autoPlaying ? 'pause' : 'play'" :size="18" /></span>
        <span class="more-row-label">自动阅读</span>
        <span class="more-row-meta">{{ autoPlaying ? "进行中" : "关闭" }}</span>
      </button>
      <button class="more-row" type="button" @click="emit('speech')">
        <span class="more-row-icon"><ReaderIcon name="volume" :size="18" /></span>
        <span class="more-row-label">朗读</span>
        <span class="more-row-meta">{{ speaking ? "朗读中" : "未开始" }}</span>
      </button>
      <button class="more-row" type="button" @click="emit('swap')">
        <span class="more-row-icon"><ReaderIcon name="swap" :size="18" /></span>
        <span class="more-row-label">换源</span>
        <span class="more-row-meta">按章节匹配</span>
      </button>
      <button class="more-row" type="button" @click="emit('search')">
        <span class="more-row-icon"><ReaderIcon name="search" :size="18" /></span>
        <span class="more-row-label">搜索本章</span>
        <span class="more-row-meta">本章 / 全书</span>
      </button>
      <button class="more-row" type="button" @click="emit('marks')">
        <span class="more-row-icon"><ReaderIcon name="bookmark" :size="18" /></span>
        <span class="more-row-label">书签与位置</span>
      </button>
      <button class="more-row" type="button" @click="emit('notes')">
        <span class="more-row-icon"><ReaderIcon name="highlight" :size="18" /></span>
        <span class="more-row-label">划线与笔记</span>
        <span class="more-row-meta">{{ noteCount ? noteCount + " 条" : "暂无" }}</span>
      </button>
    </div>
  </BottomSheet>
</template>
