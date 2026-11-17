<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { SearchBook } from "../api";
import BookCover from "./BookCover.vue";
import {
  authorLabel,
  categoryLine,
  detailLine,
  displayOf,
  gridMeta,
  statusTone,
  updateLabel,
} from "../lib/explore-display";

/**
 * 发现页的书单：默认列表（信息密度高），可切网格；滚到底自动加载下一页。
 *
 * 发现接口返回的 display 已经把各书源五花八门的 kind/字数/日期清洗过；
 * 这里只负责排版：有可靠字段就展示，缺字段就降级，绝不拿作者/章节互相顶替。
 *
 * 用 IntersectionObserver 盯住列表末尾的哨兵，rootMargin 预取一屏——用户滚到
 * 底时下一页通常已经在路上了。
 */
const props = withDefaults(
  defineProps<{
    items: SearchBook[];
    sourceId: number;
    layout?: "list" | "grid";
    loading?: boolean;
    hasMore?: boolean;
    emptyText?: string;
  }>(),
  { layout: "list", loading: false, hasMore: false, emptyText: "这里还没有内容" },
);

const emit = defineEmits<{
  (event: "open", book: SearchBook): void;
  (event: "more"): void;
}>();

const rows = computed(() =>
  props.items.map((book) => {
    const display = displayOf(book);
    return {
      book,
      display,
      author: authorLabel(display),
      categories: categoryLine(display),
      detail: detailLine(display),
      updated: updateLabel(display.updatedAt),
      tone: statusTone(display.status),
      rating: display.rating == null ? "" : display.rating.toFixed(1).replace(/\.0$/, ""),
    };
  }),
);

const skeletons = Array.from({ length: 6 }, (_, index) => index);

const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

function nearBottom(): boolean {
  const el = sentinel.value;
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.top < window.innerHeight + 360;
}

function requestMore(): void {
  if (!props.hasMore || props.loading || !props.items.length) return;
  emit("more");
}

onMounted(async () => {
  await nextTick();
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) requestMore();
    },
    { rootMargin: "360px 0px" },
  );
  if (sentinel.value) observer.observe(sentinel.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

// 新一页填进来后哨兵可能还在视口里：观察器不会再触发一次，得手动补一脚。
watch(
  () => props.items.length,
  async () => {
    await nextTick();
    if (nearBottom()) requestMore();
  },
);
</script>

<template>
  <div v-if="layout === 'list'" class="explore-list" :aria-busy="!items.length && loading">
    <template v-if="!items.length && loading">
      <div v-for="n in skeletons" :key="'sk-' + n" class="explore-row is-skeleton">
        <span class="sk-cover" />
        <div class="explore-row-main">
          <span class="sk-line" style="width: 58%" />
          <span class="sk-line" style="width: 40%" />
          <span class="sk-line" style="width: 70%" />
        </div>
      </div>
    </template>

    <article
      v-for="row in rows"
      v-else
      :key="row.book.bookUrl || row.book.name"
      class="explore-row"
      @click="emit('open', row.book)"
    >
      <BookCover
        :url="row.book.coverUrl"
        :source-id="sourceId"
        :name="row.book.name"
        :width="54"
        :height="74"
        :radius="7"
      />
      <div class="explore-row-main">
        <div class="explore-title-row">
          <p class="explore-row-name">{{ row.book.name }}</p>
          <span v-if="row.rating" class="explore-rating" :title="'评分 ' + row.rating">
            <b>{{ row.rating }}</b><small>分</small>
          </span>
        </div>

        <p class="explore-row-meta">
          <span class="explore-author">{{ row.author }}</span>
          <template v-for="category in row.categories" :key="category">
            <span class="explore-dot" aria-hidden="true">·</span>
            <span class="explore-category">{{ category }}</span>
          </template>
        </p>

        <p v-if="row.display.status || row.display.wordCountText || row.updated" class="explore-row-stats">
          <span v-if="row.display.status" class="explore-status" :class="row.tone">{{ row.display.status }}</span>
          <span v-if="row.display.wordCountText">{{ row.display.wordCountText }}</span>
          <span v-if="row.updated" class="explore-update">{{ row.updated }}</span>
        </p>

        <p v-if="row.detail" class="explore-row-detail">{{ row.detail }}</p>
      </div>
      <span class="explore-row-arrow" aria-hidden="true">›</span>
    </article>
  </div>

  <div v-else class="explore-grid" :aria-busy="!items.length && loading">
    <template v-if="!items.length && loading">
      <div v-for="n in skeletons" :key="'sk-' + n" class="explore-card is-skeleton">
        <span class="sk-cover sk-cover-grid" />
        <span class="sk-line" style="width: 86%" />
        <span class="sk-line" style="width: 56%" />
      </div>
    </template>

    <article
      v-for="row in rows"
      v-else
      :key="row.book.bookUrl || row.book.name"
      class="explore-card"
      @click="emit('open', row.book)"
    >
      <div class="explore-card-cover">
        <BookCover :url="row.book.coverUrl" :source-id="sourceId" :name="row.book.name" :radius="8" />
        <span v-if="row.rating" class="explore-card-rating">{{ row.rating }}</span>
      </div>
      <p class="explore-card-name">{{ row.book.name }}</p>
      <p class="explore-card-meta">{{ gridMeta(row.display) }}</p>
      <p v-if="row.display.status || row.display.wordCountText" class="explore-card-foot">
        <span v-if="row.display.status" class="explore-status" :class="row.tone">{{ row.display.status }}</span>
        <span v-if="row.display.wordCountText">{{ row.display.wordCountText }}</span>
      </p>
    </article>
  </div>

  <p v-if="!items.length && !loading" class="explore-empty">{{ emptyText }}</p>

  <div ref="sentinel" class="explore-sentinel">
    <span v-if="loading && items.length">正在加载更多…</span>
    <span v-else-if="hasMore">继续下滑加载更多</span>
    <span v-else-if="items.length">已经到底了 · 共 {{ items.length }} 本</span>
  </div>
</template>

<style scoped>
.explore-list {
  display: flex;
  flex-direction: column;
  margin-top: 8px;
}
.explore-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 4px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-outline, #ded9cc) 34%, transparent);
  cursor: pointer;
}
.explore-row:active {
  background: color-mix(in srgb, var(--color-primary) 6%, transparent);
}
.explore-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 1px;
}
.explore-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.explore-row-name {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 14.5px;
  font-weight: 600;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.explore-rating {
  flex: none;
  display: inline-flex;
  align-items: baseline;
  gap: 1px;
  padding: 1px 6px;
  border-radius: 6px;
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  font-size: 11px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
}
.explore-rating b {
  font-size: 11.5px;
  font-weight: 700;
}
.explore-rating small {
  font-size: 9px;
  opacity: 0.8;
}
.explore-row-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  margin: 0;
  font-size: 11.5px;
  color: var(--color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
}
.explore-author {
  flex: none;
  max-width: 52%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}
.explore-dot {
  flex: none;
  opacity: 0.45;
}
.explore-category {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.explore-row-stats {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  font-size: 10.5px;
  line-height: 16px;
  color: var(--color-on-surface-variant);
  font-variant-numeric: tabular-nums;
}
.explore-status {
  display: inline-flex;
  align-items: center;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 10px;
  line-height: 16px;
  background: color-mix(in srgb, var(--color-on-surface-variant) 10%, transparent);
}
.explore-status.ongoing {
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 11%, transparent);
}
.explore-status.done {
  color: var(--color-on-surface-variant);
}
.explore-status.paused {
  color: #a5671a;
  background: color-mix(in srgb, #d99a3d 16%, transparent);
}
.explore-update {
  opacity: 0.78;
}
.explore-row-detail {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--color-on-surface-variant);
  opacity: 0.9;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.explore-row-arrow {
  flex: none;
  align-self: center;
  font-size: 18px;
  color: var(--color-on-surface-variant);
  opacity: 0.5;
}

.explore-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px 12px;
  margin-top: 12px;
}
.explore-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  cursor: pointer;
}
.explore-card:active {
  opacity: 0.82;
}
.explore-card-cover {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  background: var(--color-surface-container-high, #eae5d8);
}
.explore-card-rating {
  position: absolute;
  top: 5px;
  left: 5px;
  padding: 1px 5px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 700;
  line-height: 15px;
  color: #fff;
  background: color-mix(in srgb, #1d1b16 58%, transparent);
  backdrop-filter: blur(3px);
  font-variant-numeric: tabular-nums;
}
.explore-card-name {
  min-height: 2.6em;
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.explore-card-meta {
  margin: 0;
  font-size: 10.5px;
  color: var(--color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.explore-card-foot {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  font-size: 10px;
  color: var(--color-on-surface-variant);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
}
.explore-card-foot .explore-status {
  flex: none;
  font-size: 9.5px;
  line-height: 15px;
}

.explore-empty {
  margin: 18px 0;
  font-size: 13px;
  color: var(--color-on-surface-variant);
  text-align: center;
}
.explore-sentinel {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 46px;
  padding: 10px 0 4px;
  font-size: 11px;
  color: var(--color-on-surface-variant);
  opacity: 0.72;
}

.is-skeleton {
  pointer-events: none;
}
.sk-cover {
  flex: none;
  width: 54px;
  height: 74px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--color-on-surface-variant) 13%, transparent);
  animation: explore-pulse 1.3s ease-in-out infinite;
}
.sk-cover-grid {
  width: 100%;
  height: auto;
  aspect-ratio: 3 / 4;
  border-radius: 8px;
}
.sk-line {
  display: block;
  height: 10px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-on-surface-variant) 11%, transparent);
  animation: explore-pulse 1.3s ease-in-out infinite;
}
.explore-row-main .sk-line + .sk-line {
  margin-top: 7px;
}
@keyframes explore-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 0.95;
  }
}

@media (min-width: 640px) {
  .explore-grid {
    grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
    gap: 18px 16px;
  }
  .explore-row-name {
    font-size: 15px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sk-cover,
  .sk-line {
    animation: none;
  }
}
</style>
