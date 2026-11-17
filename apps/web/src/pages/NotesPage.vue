<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, type NoteItem } from "../api";
import { goBack } from "../lib/nav";
import { notesMarkdown } from "../lib/notes-markdown";
import { toast } from "../lib/toast";
import EmptyState from "../components/EmptyState.vue";

const router = useRouter();
const items = ref<NoteItem[]>([]);
const total = ref(0);
const loading = ref(true);
const query = ref("");
const type = ref("");
const PAGE = 40;

const FILTERS = [
  { value: "", label: "全部" },
  { value: "highlight", label: "划线" },
  { value: "note", label: "批注" },
];

const bookCount = computed(() => new Set(items.value.map((item) => item.bookId)).size);

/** 服务端时间是 UTC 的 "YYYY-MM-DD HH:MM:SS"，直接 new Date 会当成本地时间。 */
function when(raw: string): string {
  if (!raw) return "";
  const date = new Date(raw.replace(" ", "T") + "Z");
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

let timer = 0;

async function load(reset = true) {
  loading.value = true;
  try {
    const data = await api.notes({
      q: query.value.trim() || undefined,
      type: type.value || undefined,
      limit: PAGE,
      offset: reset ? 0 : items.value.length,
    });
    total.value = data.total;
    items.value = reset ? data.items : [...items.value, ...data.items];
  } catch (error) {
    toast("笔记加载失败：" + (error instanceof Error ? error.message : String(error)));
  } finally {
    loading.value = false;
  }
}

function onSearch() {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void load(), 250);
}

function setType(next: string) {
  if (type.value === next) return;
  type.value = next;
  void load();
}

function loadMore() {
  if (loading.value) return;
  void load(false);
}

function open(item: NoteItem) {
  void router.push({ name: "read", params: { id: item.bookId, index: item.chapterIndex }, query: { mark: item.id } });
}

function exportAll() {
  if (!items.value.length) return;
  const markdown = notesMarkdown(
    items.value.map((item) => ({
      bookName: item.bookName,
      chapterTitle: item.chapterTitle,
      quote: item.quote,
      comment: item.comment,
      type: item.type,
    })),
  );
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "我的笔记.md";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast("已导出 Markdown");
}

onMounted(() => {
  void load();
});

onBeforeUnmount(() => {
  window.clearTimeout(timer);
});
</script>

<template>
  <section class="page notes-page">
    <header class="page-head">
      <button class="back-btn" @click="goBack('/me')">← 返回</button>
      <div class="row">
        <div class="grow">
          <h1 class="page-title">笔记</h1>
          <p class="page-sub">{{ total }} 条 · 来自 {{ bookCount }} 本书</p>
        </div>
        <button class="icon-chip" :disabled="!items.length" @click="exportAll">导出</button>
      </div>
    </header>

    <div class="notes-tools">
      <label class="search-box notes-search">
        <input v-model="query" type="search" placeholder="搜索划线、批注或书名" @input="onSearch" />
      </label>
      <div class="notes-filters">
        <button
          v-for="filter in FILTERS"
          :key="filter.value"
          class="chip"
          :class="{ active: type === filter.value }"
          @click="setType(filter.value)"
        >
          {{ filter.label }}
        </button>
      </div>
    </div>

    <EmptyState v-if="!loading && !items.length" title="还没有笔记" :desc="query ? '换个关键词试试' : '阅读时选中一段文字，就能划线或写批注'" />

    <div v-else class="notes-list">
      <article v-for="item in items" :key="item.id" class="note-card" :class="'note-' + item.color" @click="open(item)">
        <div class="note-head">
          <span class="note-book">{{ item.bookName }}</span>
          <span class="note-chapter">{{ item.chapterTitle }}</span>
        </div>
        <p class="note-quote">{{ item.quote }}</p>
        <p v-if="item.comment" class="note-comment">{{ item.comment }}</p>
        <div class="note-meta">
          <span>{{ when(item.updatedAt) }}</span>
          <span v-if="item.type === 'note'" class="note-tag">批注</span>
        </div>
      </article>
      <button v-if="items.length < total" class="notes-more" :disabled="loading" @click="loadMore">
        {{ loading ? "加载中…" : `加载更多（还剩 ${total - items.length} 条）` }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.notes-tools {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.notes-search {
  width: 100%;
}

.notes-filters {
  display: flex;
  gap: 8px;
}

.notes-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 24px;
}

.note-card {
  position: relative;
  padding: 12px 14px 10px 18px;
  border: 1px solid var(--color-outline);
  border-radius: 16px;
  background: #fffdf8;
  box-shadow: var(--shadow-card);
  cursor: pointer;
}

.note-card::before {
  content: "";
  position: absolute;
  left: 0;
  top: 12px;
  bottom: 12px;
  width: 3px;
  border-radius: 3px;
  background: rgba(255, 214, 64, 0.85);
}

.note-card.note-green::before { background: rgba(120, 219, 140, 0.85); }
.note-card.note-blue::before { background: rgba(118, 190, 255, 0.85); }
.note-card.note-pink::before { background: rgba(255, 152, 190, 0.85); }
.note-card.note-purple::before { background: rgba(190, 158, 255, 0.85); }

.note-head {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--color-on-surface-variant);
}

.note-book {
  font-weight: 600;
  color: var(--color-on-surface);
}

.note-chapter {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-quote {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.note-comment {
  margin: 6px 0 0;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--color-surface-container);
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-on-surface-variant);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.note-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
  font-size: 11px;
  color: var(--color-on-surface-variant);
}

.note-tag {
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--color-surface-container);
}

.notes-more {
  padding: 12px;
  border: 1px solid var(--color-outline);
  border-radius: 12px;
  background: transparent;
  color: var(--color-on-surface-variant);
  font-size: 13px;
}
</style>
