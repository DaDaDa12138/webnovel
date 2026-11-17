<script setup lang="ts">
import type { ChapterItem } from "../../api";
import BottomSheet from "../BottomSheet.vue";
import ReaderCatalogList from "./ReaderCatalogList.vue";
import { readLabel } from "../../lib/reader-read";

defineProps<{
  modelValue: boolean;
  items: ChapterItem[];
  current: number;
  loading?: boolean;
  read?: Set<number>;
  /** 当前章已读百分比；显示在目录当前行，点它回到正文原位置。 */
  currentPercent?: number;
}>();

const emit = defineEmits<{ "update:modelValue": [value: boolean]; select: [index: number]; locate: [] }>();

function close(): void {
  emit("update:modelValue", false);
}

function pick(index: number): void {
  emit("select", index);
  close();
}

function locateCurrent(): void {
  emit("locate");
  close();
}
</script>

<template>
  <BottomSheet inline :open="modelValue" title="目录" :subtitle="readLabel(read ?? [], items.length)" tall @close="close">
    <ReaderCatalogList
      :items="items"
      :current="current"
      :loading="loading"
      :read="read"
      :current-percent="currentPercent"
      @select="pick"
      @locate="locateCurrent"
    />
  </BottomSheet>
</template>
