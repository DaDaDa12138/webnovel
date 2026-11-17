<template>
  <section class="page search-page">
    <header class="search-head">
      <h1 class="page-title">搜索</h1>
      <p class="page-sub">一次检索全部书源，同一本书自动合并多个来源</p>
    </header>

    <div class="search-bar">
      <label class="search-pill">
        <span class="search-pill-ico" aria-hidden="true">🔍</span>
        <input v-model="keyword" class="search-pill-input" placeholder="书名" aria-label="书名" @keyup.enter="onSearch" />
        <span class="search-pill-div" aria-hidden="true"></span>
        <input v-model="authorQuery" class="search-pill-input author" placeholder="作者" aria-label="作者" @keyup.enter="onSearch" />
        <button v-if="keyword || authorQuery" class="search-pill-clear" aria-label="清空搜索词" @click="keyword = ''; authorQuery = ''">✕</button>
      </label>
      <button class="btn btn-primary search-go" :disabled="loading || (!keyword.trim() && !authorQuery.trim())" @click="onSearch">
        {{ loading ? "…" : "搜索" }}
      </button>
    </div>

    <div class="search-scope">
      <span class="search-scope-label">搜索源</span>
      <div class="search-scope-chips">
        <button
          class="scope-chip"
          :class="{ active: sourceScope === 'usable' }"
          :aria-pressed="sourceScope === 'usable'"
          title="跳过需要登录和已经失效的书源"
          @click="setSourceScope('usable')"
        >
          可用源
        </button>
        <button
          class="scope-chip"
          :class="{ active: sourceScope === 'healthy' }"
          :aria-pressed="sourceScope === 'healthy'"
          title="只搜四阶段体检都正常的书源"
          @click="setSourceScope('healthy')"
        >
          仅健康源
        </button>
      </div>
      <span class="search-scope-note">{{ scopeNote }}</span>
    </div>

    <div v-if="loading || done" class="search-progress">
      <div class="progress-track"><div class="progress-fill" :style="{ width: progress + '%' }"></div></div>
      <p class="search-progress-text">{{ done }} / {{ total || "?" }} 个书源 · {{ items.length }} 条来源 · {{ aggregated.length }} 本书</p>
    </div>

    <p v-else class="search-hint">书名与作者至少填一项；只填作者时按作者检索全部书源。</p>

    <div v-if="!loading && !items.length" class="suggest-block">
      <template v-if="suggest.hot.length">
        <div class="suggest-head">
          <h2 class="section-title">热门搜索</h2>
          <button class="link-btn" @click="clearHistory">清除记录</button>
        </div>
        <div class="term-cloud">
          <button v-for="item in suggest.hot" :key="'hot-' + item.keyword + '|' + item.author" class="term-chip" @click="fillTerm(item)">
            <span class="term-text">{{ termLabel(item) }}</span>
            <span v-if="item.keyword && item.author" class="term-author">{{ item.author }}</span>
            <span class="term-count">{{ item.count }}</span>
          </button>
        </div>
      </template>

      <template v-if="suggest.recent.length">
        <div class="suggest-head">
          <h2 class="section-title">最近搜索</h2>
        </div>
        <div class="term-cloud">
          <button v-for="term in suggest.recent" :key="'recent-' + term.keyword + '|' + term.author" class="term-chip ghost" @click="fillTerm(term)">
            <span class="term-text">{{ termLabel(term) }}</span>
            <span v-if="term.keyword && term.author" class="term-author">{{ term.author }}</span>
          </button>
        </div>
      </template>

      <template v-if="!suggest.hot.length && !suggest.recent.length">
        <div class="suggest-head">
          <h2 class="section-title">试试这些</h2>
        </div>
        <div class="term-cloud">
          <button v-for="term in fallbackHot" :key="term.keyword + '|' + term.author" class="term-chip" @click="fillTerm(term)">
            <span class="term-text">{{ term.keyword }}</span>
            <span v-if="term.author" class="term-author">{{ term.author }}</span>
          </button>
        </div>
      </template>
    </div>

    <template v-if="items.length">
      <div class="result-tools">
        <span class="muted small">{{ aggregated.length }} 本 · {{ filteredItems.length }} 条来源<span v-if="hiddenByHealth"> · 已隐藏 {{ hiddenByHealth }}</span></span>
        <span class="grow"></span>
        <label class="multi-toggle"><input v-model="multiOnly" type="checkbox" /> 仅看多源</label>
        <select v-model="healthFilter" class="result-sort" aria-label="来源健康筛选" title="按来源健康筛选">
          <option value="all">全部来源</option>
          <option value="usable">可用来源</option>
          <option value="healthy">仅健康</option>
        </select>
        <select v-model="sortMode" class="result-sort" aria-label="结果排序">
          <option value="match">匹配度</option>
          <option value="health">健康优先</option>
          <option value="sources">来源数</option>
          <option value="name">书名</option>
        </select>
      </div>

      <div class="result-list">
        <article v-for="group in visibleGroups" :key="group.key" class="result-card">
          <div class="result-head">
            <BookCover class="result-cover" :url="group.best.coverUrl" :source-id="group.best.sourceId" :name="group.name" :width="56" :height="76" :radius="6" :initial-font="20" />
            <div class="result-main">
              <div class="result-title-row">
                <h3 class="result-name ellipsis">{{ group.name }}</h3>
                <span v-if="group.versions.length > 1" class="source-count">{{ group.versions.length }} 源</span>
              </div>
              <p class="result-meta ellipsis">{{ group.author || "佚名" }}<span v-if="kindLabel(group.best.kind)"> · {{ kindLabel(group.best.kind) }}</span></p>
              <p class="result-chapter ellipsis">{{ groupChapter(group) }}</p>
              <p v-if="group.best.intro" class="result-intro">{{ group.best.intro }}</p>
            </div>
          </div>

          <div class="version-list">
            <div v-for="version in shownVersions(group)" :key="version.sourceId + ':' + version.bookUrl" class="version-row">
              <span class="version-info">
                <span class="version-source-line">
                  <strong class="version-source ellipsis">{{ version.originName || "未知来源" }}</strong>
                  <span v-if="version.healthState" class="version-health" :class="'health-' + version.healthState" :title="healthTitle(version)">
                    {{ healthText(version) }}
                  </span>
                </span>
                <small v-if="version.lastChapter" class="version-chapter ellipsis">{{ version.lastChapter }}</small>
              </span>
              <button class="btn btn-tonal btn-sm version-add" :disabled="isBusy(version) || isAdded(version)" @click="addToShelf(version)">
                {{ isAdded(version) ? "已在书架" : isBusy(version) ? "加入中…" : "用这个源" }}
              </button>
            </div>
            <button v-if="group.versions.length > 1" class="expand-btn" @click="toggleExpand(group.key)">
              {{ expanded[group.key] ? "收起来源" : "展开全部 " + group.versions.length + " 个来源" }}
            </button>
          </div>
        </article>
      </div>
      <div v-if="!visibleGroups.length" class="result-empty">
        <p v-if="hiddenByHealth">当前健康筛选隐藏了 {{ hiddenByHealth }} 条来源。</p>
        <p v-else>没有符合「仅看多源」的结果。</p>
        <button v-if="hiddenByHealth" class="link-btn" @click="healthFilter = 'all'">显示全部来源</button>
        <button v-else class="link-btn" @click="multiOnly = false">取消仅看多源</button>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, type SearchBook, type SearchSuggestion } from "../api";
import { healthStateLabel, healthStateRank, type HealthState } from "@legado/shared";
import { filterSearchItems, type SearchHealthFilter } from "../lib/search-health";
import { aggregateBooks, normalizeTitle, type AggregatedBook } from "../lib/aggregate";
import { toast } from "../lib/toast";
import BookCover from "../components/BookCover.vue";

const router = useRouter();
const route = useRoute();
const keyword = ref("");
const authorQuery = ref("");
const loading = ref(false);
const done = ref(0);
const total = ref(0);
const items = ref<SearchBook[]>([]);
const busyKey = ref("");
const expanded = reactive<Record<string, boolean>>({});
const added = reactive<Record<string, boolean>>({});
const multiOnly = ref(false);
const healthFilter = ref<SearchHealthFilter>("all");
const SEARCH_SCOPE_KEY = "legado-search-source-scope";
type SearchSourceScope = "usable" | "healthy";
function loadSourceScope(): SearchSourceScope {
  try {
    return localStorage.getItem(SEARCH_SCOPE_KEY) === "healthy" ? "healthy" : "usable";
  } catch {
    return "usable";
  }
}
const sourceScope = ref<SearchSourceScope>(loadSourceScope());
const hasExplicitSources = computed(() => Boolean(String(route.query.sources ?? "").trim()));
const scopeNote = computed(() => {
  if (hasExplicitSources.value) return "已指定书源，范围选择不生效";
  if (sourceScope.value === "healthy") return "只搜四阶段都正常的源，结果更少但更稳";
  return "跳过需登录与失效源";
});
const sortMode = ref("match");
const suggest = ref<SearchSuggestion>({ hot: [], recent: [] });
const fallbackHot = [
  { keyword: "诡秘之主", author: "爱潜水的乌贼" },
  { keyword: "三体", author: "刘慈欣" },
  { keyword: "凡人修仙传", author: "忘语" },
  { keyword: "剑来", author: "烽火戏诸侯" },
  { keyword: "庆余年", author: "猫腻" },
  { keyword: "大奉打更人", author: "卖报小郎君" },
];

const progress = computed(() => (total.value ? Math.min(100, Math.round((done.value / total.value) * 100)) : 0));
const searchLabel = computed(() => {
  if (loading.value) return "搜索中…";
  const hasTitle = Boolean(keyword.value.trim());
  const hasAuthor = Boolean(authorQuery.value.trim());
  if (hasTitle && hasAuthor) return "按书名 + 作者搜索";
  if (!hasTitle && hasAuthor) return "按作者搜索";
  return "搜索";
});
const filteredItems = computed(() => filterSearchItems(items.value, healthFilter.value));
const hiddenByHealth = computed(() => items.value.length - filteredItems.value.length);
const aggregated = computed(() => aggregateBooks(filteredItems.value));
const visibleGroups = computed(() => {
  let list: AggregatedBook[] = multiOnly.value ? aggregated.value.filter((group) => group.versions.length > 1) : [...aggregated.value];
  if (sortMode.value === "sources") list.sort((a, b) => b.versions.length - a.versions.length || a.name.localeCompare(b.name, "zh-CN"));
  else if (sortMode.value === "health") {
    list.sort(
      (a, b) =>
        healthStateRank(a.best.healthState) - healthStateRank(b.best.healthState) ||
        (b.best.healthScore ?? 0) - (a.best.healthScore ?? 0) ||
        b.versions.length - a.versions.length ||
        a.name.localeCompare(b.name, "zh-CN"),
    );
  } else if (sortMode.value === "name") list.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  else if (keyword.value.trim()) {
    const key = normalizeTitle(keyword.value);
    list.sort((a, b) => {
      const aExact = normalizeTitle(a.name) === key ? 1 : 0;
      const bExact = normalizeTitle(b.name) === key ? 1 : 0;
      return bExact - aExact || b.versions.length - a.versions.length || a.name.localeCompare(b.name, "zh-CN");
    });
  } else {
    list.sort((a, b) => b.versions.length - a.versions.length || a.name.localeCompare(b.name, "zh-CN"));
  }
  return list;
});

/** 主来源没给最新章节时，从同书其它来源里补一条。 */
function groupChapter(group: AggregatedBook): string {
  if (group.best.lastChapter) return group.best.lastChapter;
  const withChapter = group.versions.find((version) => version.lastChapter);
  return withChapter ? withChapter.lastChapter : "暂无最新章节信息";
}

function healthText(book: SearchBook): string {
  if (!book.healthState) return "";
  return healthStateLabel(book.healthState) + (book.healthScore ? " " + book.healthScore : "");
}

function healthTitle(book: SearchBook): string {
  if (!book.healthState) return "还没有体检数据";
  return healthStateLabel(book.healthState) + (book.healthScore ? " · 健康分 " + book.healthScore : "");
}

/** 书源的 kind 字段经常塞进「作者：xxx」这类脏值，过长的也不可信。 */
function kindLabel(kind: string): string {
  const value = String(kind || "").trim();
  if (!value || value.length > 8) return "";
  if (/作者|书名|简介|状态|更新|章节|分类/.test(value)) return "";
  return value;
}

function termLabel(term: { keyword: string; author?: string }) {
  return term.keyword || "作者：" + (term.author ?? "");
}

function setSourceScope(scope: SearchSourceScope) {
  if (sourceScope.value === scope) return;
  sourceScope.value = scope;
  try {
    localStorage.setItem(SEARCH_SCOPE_KEY, scope);
  } catch {
    /* 隐私模式下 localStorage 不可用，本次会话内仍然生效 */
  }
  if (items.value.length && !hasExplicitSources.value) void onSearch();
}

function fillTerm(term: { keyword: string; author?: string }) {
  keyword.value = term.keyword ?? "";
  authorQuery.value = term.author ?? "";
  void onSearch();
}

function readQuery() {
  const key = String(route.query.key ?? "").trim();
  const author = String(route.query.author ?? "").trim();
  if ((key || author) && (key !== keyword.value.trim() || author !== authorQuery.value.trim())) {
    keyword.value = key;
    authorQuery.value = author;
    void onSearch();
  }
}

async function loadSuggest() {
  try {
    suggest.value = await api.searchSuggest();
  } catch {
    suggest.value = { hot: [], recent: [] };
  }
}

onMounted(() => {
  readQuery();
  loadSuggest();
});
watch(() => [route.query.key, route.query.author], readQuery);

let controller: AbortController | null = null;
onBeforeUnmount(() => controller?.abort());

async function onSearch() {
  const key = keyword.value.trim();
  const author = authorQuery.value.trim();
  if ((!key && !author) || loading.value) return;
  const sources = String(route.query.sources ?? "").trim();
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  items.value = [];
  done.value = 0;
  total.value = 0;
  try {
    const params = new URLSearchParams();
    if (key) params.set("key", key);
    if (author) params.set("author", author);
    if (sources) {
      params.set("sources", sources);
    } else {
      params.set("health", sourceScope.value);
    }
    const res = await fetch("/api/search/stream?" + params.toString(), { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error("搜索服务不可用");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      buffer += decoder.decode(value, { stream: true });
      let cut = buffer.indexOf("\n\n");
      while (cut >= 0) {
        const chunk = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        cut = buffer.indexOf("\n\n");
        const lines = chunk.split("\n");
        const ev = lines.find((line) => line.startsWith("event: "))?.slice(7) ?? "";
        const raw = lines.find((line) => line.startsWith("data: "))?.slice(6) ?? "";
        if (!ev || !raw) continue;
        const data = JSON.parse(raw);
        if (ev === "start") total.value = data.total ?? 0;
        if (ev === "source") {
          done.value += 1;
          if (data.items?.length) {
            items.value = items.value.concat(
              data.items.map((book: SearchBook) => ({
                ...book,
                sourceId: data.sourceId,
                healthState: data.healthState as HealthState | undefined,
                healthScore: typeof data.healthScore === "number" ? data.healthScore : undefined,
              })),
            );
          }
        }
        if (ev === "done") loading.value = false;
      }
    }
    if (!items.value.length) toast(key ? "这次没有搜到结果，换个关键词或书源试试" : "没有搜到这位作者的书，换个作者名试试", "info");
    void loadSuggest();
  } catch (err) {
    if ((err as Error).name !== "AbortError") toast("搜索失败：" + String((err as Error).message), "error");
  } finally {
    loading.value = false;
  }
}

function versionKey(book: SearchBook): string {
  return book.sourceId + ":" + book.bookUrl;
}

function isAdded(book: SearchBook): boolean {
  return Boolean(added[versionKey(book)]);
}

function isBusy(book: SearchBook): boolean {
  return busyKey.value === versionKey(book);
}

function shownVersions(group: AggregatedBook): SearchBook[] {
  if (expanded[group.key] || group.versions.length <= 1) return group.versions;
  return group.versions.slice(0, 1);
}

function toggleExpand(key: string) {
  expanded[key] = !expanded[key];
}

async function addToShelf(book: SearchBook) {
  if (isBusy(book)) return;
  busyKey.value = versionKey(book);
  try {
    const created = await api.createBook({
      sourceId: book.sourceId,
      bookUrl: book.bookUrl,
      name: book.name,
      author: book.author,
      coverUrl: book.coverUrl,
      intro: book.intro,
      wordCount: book.wordCount,
      lastChapter: book.lastChapter,
    });
    added[versionKey(book)] = true;
    if (created.tocError) toast("已加入书架，但目录拉取失败：" + created.tocError, "error");
    else toast(created.existed ? "已在书架中" : "已加入书架", "success");
    router.push("/book/" + created.book.id);
  } catch (err) {
    toast("加入书架失败：" + String((err as Error).message), "error");
  } finally {
    busyKey.value = "";
  }
}

async function clearHistory() {
  try {
    await api.clearSearchHistory();
    suggest.value = { hot: [], recent: [] };
    toast("已清除搜索记录");
  } catch (err) {
    toast("清除失败：" + String((err as Error).message), "error");
  }
}
</script>

<style scoped>
.search-page {
  padding-bottom: 24px;
}
.search-head {
  padding-top: 4px;
}

/* 搜索条：单行胶囊，书名 / 作者同框 */
.search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
}
.search-pill {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 42px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  background: var(--color-surface-container);
}
.search-pill-ico {
  font-size: 12px;
  opacity: 0.65;
}
.search-pill-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: var(--text-sm);
  color: var(--color-on-surface);
  outline: none;
}
.search-pill-input.author {
  flex: 0 1 34%;
}
.search-pill-div {
  width: 1px;
  height: 16px;
  background: rgba(0, 0, 0, 0.12);
}
.search-pill-clear {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.08);
  color: var(--color-on-surface-variant);
  font-size: 10px;
  line-height: 1;
}
.search-go {
  flex: 0 0 auto;
  height: 42px;
  padding: 0 18px;
  font-size: var(--text-sm);
}

.search-scope {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
  margin-top: 8px;
  padding: 0 2px;
}
.search-scope-label {
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.search-scope-chips {
  display: inline-flex;
  gap: 4px;
}
.scope-chip {
  height: 26px;
  padding: 0 10px;
  border-radius: var(--radius-pill);
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-on-surface-variant);
  font: inherit;
  font-size: var(--text-xs);
  transition: background 0.16s var(--ease-standard), border-color 0.16s var(--ease-standard), color 0.16s var(--ease-standard);
}
.scope-chip:hover {
  background: var(--color-surface-container);
}
.scope-chip.active {
  border-color: var(--color-primary);
  background: var(--color-primary-container, #e4ece2);
  color: var(--color-primary);
  font-weight: 600;
}
.search-scope-note {
  font-size: 11px;
  color: var(--color-on-surface-variant);
  opacity: 0.8;
}

.search-progress {
  margin-top: 12px;
}
.search-progress-text {
  margin: 6px 0 0;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.search-hint {
  margin: 10px 2px 0;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}

/* 热门 / 最近搜索 */
.suggest-block {
  margin-top: 20px;
}
.suggest-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
}
.suggest-head + .term-cloud {
  margin-bottom: 20px;
}
.term-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.term-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 13px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-outline, #ddd6c6);
  background: transparent;
  color: var(--color-on-surface);
  font-size: var(--text-sm);
  max-width: 100%;
  transition: background 0.16s var(--ease-standard), border-color 0.16s var(--ease-standard);
}
.term-chip:active {
  background: var(--color-surface-container);
}
.term-chip.ghost {
  border-style: dashed;
  color: var(--color-on-surface-variant);
}
.term-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.term-author {
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
  max-width: 84px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.term-count {
  font-size: 10px;
  padding: 0 5px;
  height: 15px;
  display: inline-grid;
  place-items: center;
  border-radius: 8px;
  background: var(--color-surface-container);
  color: var(--color-on-surface-variant);
}
.link-btn {
  border: 0;
  background: none;
  padding: 0;
  color: var(--color-primary);
  font-size: var(--text-xs);
}

/* 结果工具条 */
.result-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 18px;
}
.multi-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
  white-space: nowrap;
}
.result-sort {
  height: 30px;
  padding: 0 8px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-outline, #ddd6c6);
  background: transparent;
  color: var(--color-on-surface);
  font: inherit;
  font-size: var(--text-xs);
}

/* 结果卡片 */
.result-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}
.result-card {
  padding: 12px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-outline, #e6e0d2);
  background: var(--color-surface);
}
.result-head {
  display: flex;
  gap: 10px;
  min-width: 0;
}
.result-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.result-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.result-name {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
  min-width: 0;
}
.source-count {
  flex: 0 0 auto;
  height: 17px;
  padding: 0 6px;
  display: inline-grid;
  place-items: center;
  border-radius: 9px;
  background: var(--color-primary-container, #e4ece2);
  color: var(--color-primary);
  font-size: 10px;
  font-weight: 600;
}
.result-meta {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.result-chapter {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
  opacity: 0.85;
}
.result-intro {
  margin: 2px 0 0;
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--color-on-surface-variant);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 来源列表 */
.version-list {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.version-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
}
.version-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.version-source-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.version-source {
  flex: 1;
  min-width: 0;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-on-surface);
}
.version-health {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  font-size: 10px;
  line-height: 1.5;
  color: var(--color-on-surface-variant);
  background: var(--color-surface-container);
}
.version-health::before {
  content: "";
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.75;
}
.version-health.health-healthy { color: #2e7d4f; background: rgba(46, 125, 79, 0.1); }
.version-health.health-partial { color: #a9761f; background: rgba(169, 118, 31, 0.1); }
.version-health.health-degraded { color: #a9761f; background: rgba(169, 118, 31, 0.1); }
.version-health.health-blocked { color: #b4463c; background: rgba(180, 70, 60, 0.1); }
.version-health.health-broken { color: #b4463c; background: rgba(180, 70, 60, 0.12); }
.version-health.health-unknown { color: var(--color-on-surface-variant); }
.result-empty {
  margin-top: 12px;
  padding: 18px 16px;
  border-radius: var(--radius-md);
  background: var(--color-surface-container);
  color: var(--color-on-surface-variant);
  font-size: var(--text-sm);
  text-align: center;
}
.result-empty p { margin: 0 0 6px; }
.version-chapter {
  font-size: 11px;
  color: var(--color-on-surface-variant);
}
.version-add {
  flex: 0 0 auto;
}
.expand-btn {
  align-self: flex-start;
  margin-top: 4px;
  border: 0;
  background: none;
  padding: 0;
  color: var(--color-primary);
  font-size: var(--text-xs);
}
</style>
