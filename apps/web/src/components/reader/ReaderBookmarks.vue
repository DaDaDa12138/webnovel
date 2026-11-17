<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { BookmarkItem, ProgressHistoryItem } from "../../api";
import BottomSheet from "../BottomSheet.vue";

const props = defineProps<{
  modelValue: boolean;
  items: BookmarkItem[];
  /** 阅读位置历史：误点目录、翻过头之后能退回去。 */
  history?: ProgressHistoryItem[];
  historyLoading?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  select: [item: BookmarkItem];
  remove: [id: number];
  add: [];
  selectHistory: [item: ProgressHistoryItem];
  clearHistory: [];
}>();

const tab = ref<"marks" | "history">("marks");
// 每次打开都回到书签页：用户点「书签」按钮时的预期是书签，不是上次看的位置列表。
watch(
  () => props.modelValue,
  (open) => {
    if (open) tab.value = "marks";
  },
);

const historyItems = computed(() => props.history ?? []);
const subtitle = computed(() => `${props.items.length} 条书签 · ${historyItems.value.length} 条位置`);

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 服务端存的是 UTC 的 "YYYY-MM-DD HH:MM:SS"，先按 UTC 解析再按本地时区显示。 */
function when(iso: string): string {
  const date = new Date(iso.replace(" ", "T") + "Z");
  if (Number.isNaN(date.getTime())) return iso;
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now.getTime() - 86_400_000).toDateString() === date.toDateString();
  const clock = pad(date.getHours()) + ":" + pad(date.getMinutes());
  if (sameDay) return "今天 " + clock;
  if (yesterday) return "昨天 " + clock;
  return `${date.getMonth() + 1}/${date.getDate()} ${clock}`;
}
</script>

<template>
  <BottomSheet inline :open="modelValue" title="书签与位置" :subtitle="subtitle" @close="emit('update:modelValue', false)">
    <div class="seg bookmark-tabs">
      <button :class="{ active: tab === 'marks' }" @click="tab = 'marks'">书签</button>
      <button :class="{ active: tab === 'history' }" @click="tab = 'history'">位置</button>
    </div>

    <template v-if="tab === 'marks'">
      <div class="bookmark-actions">
        <button class="btn bookmark-add" @click="emit('add')">＋ 记住当前位置</button>
      </div>
      <div v-if="!items.length" class="bookmark-empty">
        <p>还没有书签</p>
        <p class="muted">点上方「记住当前位置」保存当前段落</p>
      </div>
      <div v-else class="bookmark-list">
        <div v-for="item in items" :key="item.id" class="setting-row bookmark-row">
          <button class="bookmark-main" @click="emit('select', item)">
            <span class="bookmark-title">{{ item.title || "第 " + (item.chapterIndex + 1) + " 章" }}</span>
            <span class="muted bookmark-excerpt">{{ item.excerpt || "第 " + (item.chapterIndex + 1) + " 章" }}</span>
          </button>
          <button class="icon-btn" aria-label="删除书签" @click="emit('remove', item.id)">🗑</button>
        </div>
      </div>
    </template>

    <template v-else>
      <div v-if="historyLoading && !historyItems.length" class="bookmark-empty">
        <p class="muted">正在读取位置历史…</p>
      </div>
      <div v-else-if="!historyItems.length" class="bookmark-empty">
        <p>还没有位置记录</p>
        <p class="muted">读过几章之后，这里会留下可回跳的位置</p>
      </div>
      <div v-else class="bookmark-list">
        <div v-for="item in historyItems" :key="item.id" class="setting-row bookmark-row">
          <button class="bookmark-main" @click="emit('selectHistory', item)">
            <span class="bookmark-title">{{ item.chapterTitle || "第 " + (item.chapterIndex + 1) + " 章" }}</span>
            <span class="muted bookmark-excerpt">{{ when(item.updatedAt) }} · {{ item.percent.toFixed(1) }}%</span>
          </button>
        </div>
        <div class="bookmark-actions">
          <button class="btn ghost bookmark-clear" @click="emit('clearHistory')">清空位置历史</button>
        </div>
      </div>
    </template>
  </BottomSheet>
</template>
