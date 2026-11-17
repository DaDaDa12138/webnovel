<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ChapterItem } from "../../api";
import { scrollTopForIndex, visibleRange } from "../../lib/virtual-list";
import { buildCatalogRows, filterCatalog, hasVolumes, volumeOf, type CatalogFilter, type CatalogRow } from "../../lib/catalog-rows";
import { readCount } from "../../lib/reader-read";

const ROW_HEIGHT = 44;

/** 目录列表本体：搜索框 + 按卷折叠 + 虚拟滚动。抽屉（手机）与侧栏（宽屏）共用同一份实现。 */
const props = defineProps<{
  items: ChapterItem[];
  current: number;
  loading?: boolean;
  /** 当前章变化时自动滚到它；抽屉里关掉，免得读者翻页时列表自己乱跳。 */
  follow?: boolean;
  /** 读过的章节号；目录里压暗，一眼看出还剩多少。 */
  read?: Set<number>;
  /** 当前章已读百分比（0–100）；只显示在当前章上，点它回到正文原位置。 */
  currentPercent?: number;
}>();

const emit = defineEmits<{ select: [index: number]; locate: [] }>();

const rawQuery = ref("");
const query = ref("");
const listEl = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewport = ref(420);
/** 收起的卷（章节下标）；只影响显示，章节号与跳转不受影响。 */
const collapsed = ref<Set<number>>(new Set());
/** 全部 / 未读 / 已读；搜索时临时按「全部」查，免得筛选把要找的章节藏起来。 */
const filter = ref<CatalogFilter>("all");
let queryTimer = 0;
let observer: ResizeObserver | null = null;

const searching = computed(() => query.value.trim().length > 0);
const isRead = (row: CatalogRow): boolean => row.kind === "chapter" && props.read?.has(row.index) === true;
const chapterTotal = computed(() => props.items.reduce((total, item) => total + (item.isVolume ? 0 : 1), 0));
const readTotal = computed(() => readCount(props.read ?? [], props.items.length));
const showFilters = computed(() => props.read !== undefined && chapterTotal.value > 0);
const safeCurrentPercent = computed(() => Math.min(100, Math.max(0, Math.round(props.currentPercent ?? 0))));
const activeFilter = computed<CatalogFilter>(() => (searching.value ? "all" : filter.value));

const FILTERS: Array<{ id: CatalogFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "unread", label: "未读" },
  { id: "read", label: "已读" },
];

/** 当前章不再“重新打开本章”（那会把读者送回章首），而是回到正文里正在读的位置。 */
function pickRow(row: CatalogRow): void {
  if (row.kind === "volume") {
    toggleVolume(row.index);
    return;
  }
  if (row.index === props.current) {
    emit("locate");
    return;
  }
  emit("select", row.index);
}

function filterCount(id: CatalogFilter): number {
  if (id === "read") return readTotal.value;
  if (id === "unread") return Math.max(0, chapterTotal.value - readTotal.value);
  return chapterTotal.value;
}

const baseItems = computed(() => {
  const mapped = props.items.map((item, index) => ({ item, index }));
  if (!props.read || activeFilter.value === "all") return mapped;
  const kept = filterCatalog(
    mapped.map(({ item, index }) => ({ index, title: item.title, isVolume: item.isVolume })),
    props.read,
    activeFilter.value,
  );
  const keep = new Set(kept.map((item) => item.index));
  return mapped.filter(({ index }) => keep.has(index));
});

const hasVolumeRows = computed(() =>
  hasVolumes(baseItems.value.map(({ item, index }) => ({ index, title: item.title, isVolume: item.isVolume }))),
);

const filtered = computed(() => {
  const q = query.value.trim();
  if (!q) return baseItems.value;
  return baseItems.value.filter(({ item, index }) => item.title.includes(q) || String(index + 1) === q);
});

const emptyText = computed(() => {
  if (searching.value) return "没有匹配的章节";
  if (filter.value === "unread") return "没有未读章节";
  if (filter.value === "read") return "还没有读过任何章节";
  return "目录还是空的";
});

/** 搜索时不折叠：读者已经在缩小范围，再把结果藏进卷里只会让人以为搜不到。 */
const rows = computed<CatalogRow[]>(() => {
  if (searching.value) return filtered.value.map(({ item, index }) => ({ kind: "chapter", index, title: item.title }));
  return buildCatalogRows(
    baseItems.value.map(({ item, index }) => ({ index, title: item.title, isVolume: item.isVolume })),
    collapsed.value,
  );
});

const range = computed(() =>
  visibleRange({
    scrollTop: scrollTop.value,
    viewport: viewport.value,
    rowHeight: ROW_HEIGHT,
    count: rows.value.length,
  }),
);

const visibleRows = computed(() => rows.value.slice(range.value.start, range.value.end));
const allCollapsed = computed(
  () =>
    hasVolumeRows.value &&
    baseItems.value.every(({ item, index }) => !item.isVolume || collapsed.value.has(index)),
);

function rowFor(index: number): number {
  return rows.value.findIndex((row) => row.kind === "chapter" && row.index === index);
}

/** 当前章所在卷若被收起，先展开它，否则列表里根本找不到这一行。 */
function expandAround(index: number): void {
  const volume = volumeOf(
    props.items.map((item, i) => ({ index: i, title: item.title, isVolume: item.isVolume })),
    index,
  );
  if (volume === null || !collapsed.value.has(volume)) return;
  const next = new Set(collapsed.value);
  next.delete(volume);
  collapsed.value = next;
}

function revealCurrent(): void {
  const el = listEl.value;
  if (!el) return;
  // 过滤后行号不再等于章节号，找不到就保持不动（别把读者正在搜的列表跳走）。
  let row = rowFor(props.current);
  if (row < 0 && !searching.value) {
    expandAround(props.current);
    row = rowFor(props.current);
  }
  if (row < 0) return;
  el.scrollTop = scrollTopForIndex(row, ROW_HEIGHT, el.clientHeight, rows.value.length);
  scrollTop.value = el.scrollTop;
}

function toggleVolume(index: number): void {
  const next = new Set(collapsed.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  collapsed.value = next;
}

function toggleAll(): void {
  if (allCollapsed.value) {
    collapsed.value = new Set();
    return;
  }
  const next = new Set<number>();
  baseItems.value.forEach(({ item, index }) => {
    if (item.isVolume) next.add(index);
  });
  collapsed.value = next;
}

function setFilter(next: CatalogFilter): void {
  if (filter.value === next) return;
  filter.value = next;
  scrollTop.value = 0;
  if (listEl.value) listEl.value.scrollTop = 0;
}

function bindObserver(): void {
  const el = listEl.value;
  if (!el || typeof ResizeObserver === "undefined") return;
  observer?.disconnect();
  observer = new ResizeObserver(measure);
  observer.observe(el);
}

watch(rawQuery, (value) => {
  window.clearTimeout(queryTimer);
  // Debounce the filter so typing does not re-window on every keystroke.
  queryTimer = window.setTimeout(() => {
    query.value = value;
    scrollTop.value = 0;
    if (listEl.value) listEl.value.scrollTop = 0;
  }, 150);
});

watch(
  () => props.current,
  () => {
    if (props.follow) revealCurrent();
  },
);

watch(
  () => props.loading,
  async (loading) => {
    if (loading) return;
    await nextTick();
    measure();
    revealCurrent();
    bindObserver();
  },
);

function measure(): void {
  const el = listEl.value;
  if (!el) return;
  viewport.value = el.clientHeight || viewport.value;
  scrollTop.value = el.scrollTop;
}

function onScroll(event: Event): void {
  scrollTop.value = (event.target as HTMLElement).scrollTop;
}

onMounted(async () => {
  await nextTick();
  measure();
  revealCurrent();
  bindObserver();
});

onBeforeUnmount(() => {
  window.clearTimeout(queryTimer);
  observer?.disconnect();
});

defineExpose({ revealCurrent });
</script>

<template>
  <div class="catalog-search">
    <input v-model="rawQuery" type="search" placeholder="搜索章节名或章节号" />
  </div>
  <div v-if="showFilters && !searching" class="catalog-filters" role="group" aria-label="目录筛选">
    <button
      v-for="entry in FILTERS"
      :key="entry.id"
      type="button"
      class="catalog-filter"
      :class="{ active: filter === entry.id }"
      :aria-pressed="filter === entry.id"
      @click="setFilter(entry.id)"
    >
      {{ entry.label }}<span class="catalog-filter-count">{{ filterCount(entry.id) }}</span>
    </button>
  </div>
  <div v-if="hasVolumeRows && !searching" class="catalog-bulk">
    <button type="button" @click="toggleAll">
      {{ allCollapsed ? "展开全部卷" : "收起全部卷" }}
    </button>
  </div>
  <div v-if="loading" class="catalog-loading"><span class="spinner" /> 正在加载目录…</div>
  <div v-else ref="listEl" class="catalog-list" @scroll.passive="onScroll">
    <p v-if="!rows.length" class="muted catalog-empty">{{ emptyText }}</p>
    <div v-else class="catalog-spacer" :style="{ height: range.totalHeight + 'px' }">
      <div class="catalog-window" :style="{ transform: 'translateY(' + range.offsetY + 'px)' }">
        <button
          v-for="row in visibleRows"
          :key="row.kind + ':' + row.index"
          class="catalog-item"
          :class="{
            active: row.kind === 'chapter' && row.index === current,
            volume: row.kind === 'volume',
            collapsed: row.kind === 'volume' && row.collapsed,
            read: isRead(row),
          }"
          :style="{ height: ROW_HEIGHT + 'px' }"
          :aria-current="row.kind === 'chapter' && row.index === current ? 'true' : undefined"
          :aria-expanded="row.kind === 'volume' ? String(!row.collapsed) : undefined"
          :title="row.kind === 'chapter' && row.index === current ? '回到当前阅读位置' : undefined"
          @click="pickRow(row)"
        >
          <span v-if="row.kind === 'volume'" class="catalog-chevron" :class="{ open: !row.collapsed }">›</span>
          <span v-else class="catalog-index">{{ row.index + 1 }}</span>
          <span class="catalog-title">{{ row.title }}</span>
          <span v-if="row.kind === 'chapter' && row.index === current" class="catalog-current-badge">
            {{ safeCurrentPercent > 0 ? safeCurrentPercent + "%" : "当前" }}
          </span>
          <span v-if="row.kind === 'volume'" class="catalog-volume-count">{{ row.count }} 章</span>
        </button>
      </div>
    </div>
  </div>
</template>
