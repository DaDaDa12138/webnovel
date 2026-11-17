<script setup lang="ts">
import { computed } from "vue";
import type { AnnotationItem } from "../../api";
import BottomSheet from "../BottomSheet.vue";

const props = defineProps<{ modelValue: boolean; items: AnnotationItem[]; loading?: boolean }>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  select: [item: AnnotationItem];
  remove: [id: string];
  edit: [item: AnnotationItem];
  export: [];
}>();

const notes = computed(() => props.items.filter((item) => item.comment.trim()).length);

/** 按章分组：同章的多条划线挨在一起，跳转时不会来回翻。 */
const groups = computed(() => {
  const map = new Map<number, AnnotationItem[]>();
  for (const item of props.items) {
    const bucket = map.get(item.chapterIndex);
    if (bucket) bucket.push(item);
    else map.set(item.chapterIndex, [item]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([chapterIndex, items]) => ({ chapterIndex, title: items[0]?.chapterTitle || "第 " + (chapterIndex + 1) + " 章", items }));
});

function shortTime(value: string): string {
  const text = value.trim();
  return text.length >= 16 ? text.slice(5, 16) : text;
}
</script>

<template>
  <BottomSheet
    inline
    tall
    :open="modelValue"
    title="划线与笔记"
    :subtitle="items.length ? items.length + ' 条划线 · ' + notes + ' 条批注' : '还没有划线'"
    @close="emit('update:modelValue', false)"
  >
    <div class="annotation-actions">
      <button class="btn ghost" :disabled="!items.length" @click="emit('export')">导出 Markdown</button>
    </div>

    <div v-if="!items.length" class="bookmark-empty">
      <p>{{ loading ? "正在加载…" : "还没有划线" }}</p>
      <p class="muted">在正文里长按或拖选文字，就能划线、写笔记</p>
    </div>

    <div v-else class="annotation-list">
      <section v-for="group in groups" :key="group.chapterIndex" class="annotation-group">
        <h4 class="annotation-chapter">{{ group.title }}</h4>
        <div v-for="item in group.items" :key="item.id" class="annotation-item">
          <button class="annotation-main" @click="emit('select', item)">
            <span class="annotation-quote" :class="'annotation-quote-' + item.color">{{ item.quote || (item.comment ? "（本章笔记）" : "（本章书签）") }}</span>
            <span v-if="item.comment" class="annotation-comment">{{ item.comment }}</span>
            <span class="muted annotation-time">{{ shortTime(item.updatedAt || item.createdAt) }}</span>
          </button>
          <div class="annotation-tools">
            <button class="icon-btn" aria-label="编辑批注" @click="emit('edit', item)">✎</button>
            <button class="icon-btn" aria-label="删除划线" @click="emit('remove', item.id)">🗑</button>
          </div>
        </div>
      </section>
    </div>
  </BottomSheet>
</template>
