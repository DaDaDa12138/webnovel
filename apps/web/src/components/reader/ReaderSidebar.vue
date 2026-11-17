<script setup lang="ts">
import type { ChapterItem } from "../../api";
import ReaderCatalogList from "./ReaderCatalogList.vue";
import ReaderIcon from "./ReaderIcon.vue";
import { readLabel } from "../../lib/reader-read";

/** 宽屏常驻目录：正文左侧的窄栏，翻页时跟着高亮当前章，点一下换章。 */
defineProps<{
  items: ChapterItem[];
  current: number;
  loading?: boolean;
  read?: Set<number>;
  currentPercent?: number;
}>();

const emit = defineEmits<{ select: [index: number]; close: []; locate: [] }>();
</script>

<template>
  <aside class="reader-side" aria-label="目录">
    <div class="reader-side-head">
      <span class="reader-side-title">目录</span>
      <span class="reader-side-count">{{ readLabel(read ?? [], items.length) }}</span>
      <button class="icon-btn" type="button" aria-label="收起目录" @click="emit('close')">
        <ReaderIcon name="back" />
      </button>
    </div>
    <ReaderCatalogList
      :items="items"
      :current="current"
      :loading="loading"
      :read="read"
      :current-percent="currentPercent"
      follow
      @select="emit('select', $event)"
      @locate="emit('locate')"
    />
  </aside>
</template>
