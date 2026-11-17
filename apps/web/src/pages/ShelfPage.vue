<template>
  <section class="page shelf-page" :class="{ 'has-batch': selecting }">
    <header class="shelf-head">
      <div class="shelf-head-row">
        <div class="grow">
          <h1 class="page-title">书架</h1>
          <p class="page-sub">
            {{ books.length ? "共 " + books.length + " 本 · 今日阅读 " + todayMinutes + " 分钟" : "还没有书，去搜索或发现里找一本" }}
          </p>
        </div>
        <button class="icon-chip" :disabled="importing" aria-label="导入本地文件" @click="pickTxt">{{ importing ? "导入中" : "导入" }}</button>
        <button class="icon-chip" :disabled="loading" aria-label="刷新书架" @click="load">{{ loading ? "…" : "↻" }}</button>
        <button v-if="books.length" class="icon-chip" :class="{ active: selecting }" :aria-label="selecting ? '退出多选' : '多选'" @click="toggleSelecting">
          {{ selecting ? "完成" : "选择" }}
        </button>
      </div>

      <div v-if="books.length" class="shelf-tools">
        <label class="shelf-search">
          <span class="shelf-search-ico" aria-hidden="true">🔍</span>
          <input v-model="keyword" type="search" placeholder="搜索书架" aria-label="搜索书架" />
          <button v-if="keyword" class="shelf-search-clear" aria-label="清空搜索" @click="keyword = ''">✕</button>
        </label>
        <div class="shelf-tools-row">
          <select v-model="sort" class="shelf-sort" aria-label="排序">
            <option value="read">最近阅读</option>
            <option value="updated">最近更新</option>
            <option value="name">书名</option>
            <option value="added">加入时间</option>
          </select>
          <button class="icon-chip" :aria-label="view === 'grid' ? '切换列表视图' : '切换网格视图'" @click="toggleView">
            {{ view === "grid" ? "☰" : "▦" }}
          </button>
        </div>
      </div>

      <div v-if="books.length" class="group-scroller">
        <button class="group-chip" :class="{ active: group === 'all' }" @click="setGroup('all')">全部</button>
        <button class="group-chip" :class="{ active: group === 'reading' }" @click="setGroup('reading')">在读</button>
        <button class="group-chip" :class="{ active: group === 'new' }" @click="setGroup('new')">有更新</button>
        <button class="group-chip" :class="{ active: group === 'done' }" @click="setGroup('done')">已读完</button>
        <button v-for="item in groups" :key="item.id" class="group-chip" :class="{ active: group === String(item.id) }" @click="setGroup(String(item.id))">
          {{ item.name }}<span v-if="item.count" class="group-chip-count">{{ item.count }}</span>
        </button>
        <button class="group-chip ghost" @click="openGroups">分组管理</button>
      </div>
    </header>

    <input
      ref="fileInput"
      class="shelf-file"
      type="file"
      accept=".txt,.epub,text/plain,application/epub+zip"
      aria-hidden="true"
      tabindex="-1"
      @change="onFile"
    />

    <EmptyState v-if="!loading && !books.length" title="书架空空的" desc="在「搜索」里找到书后点「加入书架」，或者导入本地的 TXT 小说">
      <button class="btn btn-primary" @click="router.push('/search')">去搜索</button>
      <button class="btn btn-tonal" @click="pickTxt">导入本地书</button>
    </EmptyState>

    <template v-if="books.length">
      <section class="shelf-goal">
        <div class="goal-ring" :style="{ '--goal': goalPercent + '%' }" role="img" :aria-label="'今日阅读目标 ' + goalPercent + '%'">
          <div class="goal-ring-inner">{{ goalPercent }}%</div>
        </div>
        <div class="goal-main">
          <p class="goal-title">今日 {{ todayMinutes }} 分钟<span class="goal-dim"> / {{ goalMinutes }}</span></p>
          <p class="goal-sub">连续 {{ streak }} 天 · {{ chapters }} 章 · 读完 {{ finished }} 本</p>
        </div>
        <button v-if="recent.length" class="btn btn-primary btn-sm goal-cta" @click="read(recent[0])">继续读</button>
        <button v-else class="btn btn-ghost btn-sm goal-cta" @click="router.push('/search')">找书</button>
      </section>

      <section v-if="recent.length && !selecting" class="recent-block">
        <div class="row recent-head">
          <h2 class="section-title">最近阅读</h2>
          <button class="link-btn" @click="router.push('/history')">全部记录</button>
        </div>
        <div class="recent-row">
          <button v-for="book in recent" :key="book.id" class="recent-card" @click="read(book)">
            <BookCover class="recent-cover" :url="book.coverUrl" :source-id="book.sourceId" :name="book.name" :width="30" :height="42" :radius="5" :initial-font="13" />
            <span class="recent-info">
              <strong class="ellipsis">{{ book.name }}</strong>
              <small class="ellipsis">{{ progressText(book) }}</small>
            </span>
          </button>
        </div>
      </section>

      <div v-if="view === 'grid'" class="shelf-grid">
        <article v-for="book in books" :key="book.id" class="shelf-card" :class="{ picked: selected.has(book.id) }">
          <button v-if="!selecting" class="detail-btn" type="button" aria-label="书籍详情" title="书籍详情" @click.stop="openDetail(book)">···</button>
          <button class="cover-btn" :aria-label="'阅读 ' + book.name" @click="onCover(book)">
            <BookCover class="shelf-cover" :url="book.coverUrl" :source-id="book.sourceId" :name="book.name" :radius="8" :initial-font="22" />
            <span v-if="book.newChapters > 0" class="new-badge">+{{ book.newChapters }}</span>
            <span v-if="selecting" class="pick-dot" :class="{ on: selected.has(book.id) }">{{ selected.has(book.id) ? "✓" : "" }}</span>
            <span v-if="!selecting" class="cover-progress"><span :style="{ width: Math.min(100, book.percent) + '%' }"></span></span>
          </button>
          <h3 class="shelf-name" @click="selecting ? togglePick(book.id) : openDetail(book)">{{ book.name }}</h3>
          <p class="shelf-meta">
            <template v-if="!book.chapterCount">目录待加载</template>
            <template v-else-if="book.percent >= 99">已读完</template>
            <template v-else>{{ book.percent }}% · {{ book.chapterIndex + 1 }}/{{ book.chapterCount }} 章</template>
          </p>
        </article>
      </div>

      <div v-else class="shelf-list">
        <article v-for="book in books" :key="book.id" class="list-row" :class="{ picked: selected.has(book.id) }" @click="onCard(book)">
          <span v-if="selecting" class="pick-dot inline" :class="{ on: selected.has(book.id) }">{{ selected.has(book.id) ? "✓" : "" }}</span>
          <BookCover class="list-cover" :url="book.coverUrl" :source-id="book.sourceId" :name="book.name" :width="48" :height="64" :radius="6" :initial-font="18" />
          <span class="list-main">
            <span class="list-title-row">
              <strong class="ellipsis">{{ book.name }}</strong>
              <span v-if="book.newChapters > 0" class="new-badge inline">+{{ book.newChapters }}</span>
            </span>
            <small class="ellipsis">{{ book.author || "佚名" }} · {{ book.chapterCount }} 章</small>
            <small class="ellipsis">已读：{{ chapterLabel(book) }}</small>
            <small v-if="book.lastChapter" class="ellipsis">最新：{{ book.lastChapter }}</small>
            <span class="list-foot">
              <span class="list-progress"><span :style="{ width: book.percent + '%' }"></span></span>
              <small>{{ book.percent }}% · {{ timeAgo(book.readAt || book.updatedAt) }}</small>
            </span>
          </span>
          <button class="list-more" type="button" aria-label="书籍详情" title="书籍详情" @click.stop="openDetail(book)">›</button>
        </article>
      </div>
    </template>

    <div v-if="selecting" class="batch-bar">
      <span class="batch-count">已选 {{ selected.size }}</span>
      <button class="mini-btn" :disabled="!selected.size || batchBusy" @click="batchRefresh">{{ batchBusy ? "追更中" : "追更" }}</button>
      <button class="mini-btn" :disabled="!selected.size" @click="openBatchGroup">分组</button>
      <button class="mini-btn danger" :disabled="!selected.size" @click="batchRemove">移出</button>
      <button class="mini-btn ghost" @click="selectAll">{{ selected.size === books.length ? "取消全选" : "全选" }}</button>
    </div>

    <BottomSheet :open="showGroups" title="分组管理" :subtitle="groups.length ? groups.length + ' 个自定义分组' : '还没有自定义分组'" @close="showGroups = false">
      <div class="group-sheet">
        <div class="group-add">
          <input v-model="newGroup" placeholder="新分组名称" maxlength="20" @keyup.enter="addGroup" />
          <button class="btn btn-primary btn-sm" :disabled="!newGroup.trim()" @click="addGroup">添加</button>
        </div>
        <p v-if="!groups.length" class="muted small group-empty">先建一个分组，把书架按题材或状态分开。</p>
        <div v-for="item in groups" :key="item.id" class="group-row-item">
          <span class="grow">{{ item.name }}<span class="muted small"> · {{ item.count }} 本</span></span>
          <button class="mini-btn ghost" @click="renameGroup(item)">重命名</button>
          <button class="mini-btn danger" @click="removeGroup(item)">删除</button>
        </div>
      </div>
    </BottomSheet>

    <BottomSheet :open="showBatchGroup" title="移动到分组" :subtitle="'已选 ' + selected.size + ' 本'" @close="showBatchGroup = false">
      <div class="group-sheet">
        <button class="group-pick" @click="applyGroup(0)"><span class="grow">未分组</span><span class="group-pick-chev">›</span></button>
        <button v-for="item in groups" :key="item.id" class="group-pick" @click="applyGroup(item.id)">
          <span class="grow">{{ item.name }}</span><span class="group-pick-chev">›</span>
        </button>
      </div>
    </BottomSheet>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { api, type BookGroup, type BookItem } from "../api";
import { toast } from "../lib/toast";
import { decodeTextFile, txtNameOf } from "../lib/text-file";
import BookCover from "../components/BookCover.vue";
import BottomSheet from "../components/BottomSheet.vue";
import EmptyState from "../components/EmptyState.vue";

const router = useRouter();
const books = ref<BookItem[]>([]);
const groups = ref<BookGroup[]>([]);
const loading = ref(true);
const importing = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const keyword = ref("");
const sort = ref(localStorage.getItem("shelf-sort") || "read");
const view = ref<"grid" | "list">((localStorage.getItem("shelf-view") as "grid" | "list") || "grid");
const group = ref("all");
const selecting = ref(false);
const selected = reactive(new Set<number>());
const showGroups = ref(false);
const showBatchGroup = ref(false);
const newGroup = ref("");
const batchBusy = ref(false);
const todaySeconds = ref(0);
const streak = ref(0);
const goalMinutes = ref(30);

const chapters = computed(() => books.value.reduce((sum, book) => sum + book.chapterCount, 0));
const finished = computed(() => books.value.filter((book) => book.percent >= 99).length);
const todayMinutes = computed(() => Math.round(todaySeconds.value / 60));
const goalPercent = computed(() => Math.min(100, Math.round((todayMinutes.value / Math.max(1, goalMinutes.value)) * 100)));
const recent = computed(() =>
  [...books.value]
    .filter((book) => book.readAt)
    .sort((a, b) => String(b.readAt).localeCompare(String(a.readAt)))
    .slice(0, 3),
);

let searchTimer: number | undefined;
watch(keyword, () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(load, 300);
});
watch(sort, () => {
  localStorage.setItem("shelf-sort", sort.value);
  load();
});
watch(group, () => {
  selected.clear();
  load();
});

function progressText(book: BookItem): string {
  if (!book.chapterCount) return "目录待加载";
  if (book.percent >= 99) return "已读完 · " + book.chapterCount + " 章";
  return "读至 " + (book.chapterIndex + 1) + "/" + book.chapterCount + " 章 · " + book.percent + "%";
}

function chapterLabel(book: BookItem): string {
  if (!book.chapterCount) return "尚未开始";
  return "第 " + (book.chapterIndex + 1) + " 章";
}

function timeAgo(value?: string | null): string {
  if (!value) return "未读";
  const then = new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z")).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  const minute = 60 * 1000;
  if (diff < minute) return "刚刚";
  if (diff < 60 * minute) return Math.floor(diff / minute) + " 分钟前";
  if (diff < 24 * 60 * minute) return Math.floor(diff / (60 * minute)) + " 小时前";
  if (diff < 30 * 24 * 60 * minute) return Math.floor(diff / (24 * 60 * minute)) + " 天前";
  return new Date(then).toLocaleDateString("zh-CN");
}

function pickTxt() {
  fileInput.value?.click();
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || importing.value) return;
  if (file.size > 20 * 1024 * 1024) {
    toast("文件太大，上限 20MB", "error");
    return;
  }
  importing.value = true;
  try {
    const buffer = await file.arrayBuffer();
    const name = txtNameOf(file.name);
    const result = /\.epub$/i.test(file.name)
      ? await api.importEpub(name, buffer)
      : await api.importTxt({ name, content: decodeTextFile(new Uint8Array(buffer)) });
    toast(result.existed ? `《${result.title}》已经在书架里了` : `已导入《${result.title}》${result.chapters} 章`, "success");
    await load();
    router.push(`/book/${result.bookId}`);
  } catch (err) {
    toast("导入失败：" + String((err as Error).message).slice(0, 60), "error");
  } finally {
    importing.value = false;
  }
}

async function load() {
  loading.value = true;
  try {
    const data = await api.books({ q: keyword.value.trim(), sort: sort.value, group: group.value });
    books.value = data.items;
    for (const book of books.value) if (selected.has(book.id) && !data.items.some((item) => item.id === book.id)) selected.delete(book.id);
  } catch (err) {
    toast("书架加载失败：" + String((err as Error).message), "error");
  } finally {
    loading.value = false;
  }
}

async function loadGroups() {
  try {
    groups.value = (await api.bookGroups()).items;
  } catch {
    groups.value = [];
  }
}

async function loadStats() {
  try {
    const stats = await api.readingStats();
    todaySeconds.value = stats.today;
    streak.value = stats.streak;
    goalMinutes.value = stats.goal || 30;
  } catch {
    todaySeconds.value = 0;
  }
}

function read(book: BookItem) {
  if (selecting.value) return togglePick(book.id);
  router.push("/read/" + book.id + "/" + (book.chapterIndex || 0));
}

/** 列表视图整行就是「继续阅读」：以前这里只处理多选，非多选时点书名/封面没反应。 */
function onCard(book: BookItem) {
  if (selecting.value) togglePick(book.id);
  else read(book);
}

function onCover(book: BookItem) {
  if (selecting.value) togglePick(book.id);
  else read(book);
}

/** 书架上的「详情」入口：网格卡右上角的・・・按钮、书名、列表行尾的 › 都走这里。 */
function openDetail(book: BookItem) {
  if (selecting.value) {
    togglePick(book.id);
    return;
  }
  router.push("/book/" + book.id);
}

function togglePick(id: number) {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
}

function toggleSelecting() {
  selecting.value = !selecting.value;
  if (!selecting.value) selected.clear();
}

function selectAll() {
  if (selected.size === books.value.length) selected.clear();
  else for (const book of books.value) selected.add(book.id);
}

function toggleView() {
  view.value = view.value === "grid" ? "list" : "grid";
  localStorage.setItem("shelf-view", view.value);
}

function setGroup(value: string) {
  group.value = value;
}

async function batchRemove() {
  if (!selected.size) return;
  if (!window.confirm("把选中的 " + selected.size + " 本移出书架？")) return;
  try {
    await api.batchBooks([...selected], "remove");
    toast("已移出 " + selected.size + " 本");
    selected.clear();
    selecting.value = false;
    await Promise.all([load(), loadGroups()]);
  } catch (err) {
    toast("移出失败：" + String((err as Error).message), "error");
  }
}

async function batchRefresh() {
  if (!selected.size || batchBusy.value) return;
  batchBusy.value = true;
  try {
    const result = await api.batchBooks([...selected], "refresh");
    const fresh = (result.items || []).reduce((sum, item) => sum + (item.newChapters || 0), 0);
    toast(fresh ? "追更完成，发现 " + fresh + " 个新章节" : "追更完成，暂无新章节");
    await load();
  } catch (err) {
    toast("追更失败：" + String((err as Error).message), "error");
  } finally {
    batchBusy.value = false;
  }
}

function openBatchGroup() {
  if (!selected.size) return;
  showBatchGroup.value = true;
}

async function applyGroup(groupId: number) {
  try {
    await api.batchBooks([...selected], "group", groupId);
    showBatchGroup.value = false;
    selected.clear();
    selecting.value = false;
    toast("已移动分组");
    await Promise.all([load(), loadGroups()]);
  } catch (err) {
    toast("分组失败：" + String((err as Error).message), "error");
  }
}

function openGroups() {
  showGroups.value = true;
  loadGroups();
}

async function addGroup() {
  const name = newGroup.value.trim();
  if (!name) return;
  try {
    await api.addBookGroup(name);
    newGroup.value = "";
    await loadGroups();
    toast("已添加分组「" + name + "」");
  } catch (err) {
    toast("添加失败：" + String((err as Error).message), "error");
  }
}

async function renameGroup(item: BookGroup) {
  const name = window.prompt("重命名分组", item.name);
  if (!name || !name.trim() || name.trim() === item.name) return;
  try {
    await api.patchBookGroup(item.id, { name: name.trim() });
    await Promise.all([loadGroups(), load()]);
  } catch (err) {
    toast("重命名失败：" + String((err as Error).message), "error");
  }
}

async function removeGroup(item: BookGroup) {
  if (!window.confirm("删除分组「" + item.name + "」？组内书籍会回到未分组。")) return;
  try {
    await api.removeBookGroup(item.id);
    if (group.value === String(item.id)) group.value = "all";
    await Promise.all([loadGroups(), load()]);
  } catch (err) {
    toast("删除失败：" + String((err as Error).message), "error");
  }
}

onMounted(async () => {
  await Promise.all([load(), loadGroups(), loadStats()]);
});
</script>

<style scoped>
.shelf-page {
  padding-bottom: 24px;
}

/* 页头 */
.shelf-head {
  padding-top: 4px;
}
.shelf-file {
  display: none;
}
.shelf-head-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.shelf-head-row .grow {
  min-width: 0;
}
.shelf-tools {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.shelf-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  background: var(--color-surface-container);
  color: var(--color-on-surface-variant);
  font-size: var(--text-sm);
}
.shelf-search-ico {
  font-size: 12px;
  opacity: 0.7;
}
.shelf-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: var(--color-on-surface);
  outline: none;
}
.shelf-search-clear {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.08);
  color: inherit;
  font-size: 10px;
  line-height: 1;
}
.shelf-tools-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.shelf-sort {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-outline, #ddd6c6);
  background: transparent;
  color: var(--color-on-surface);
  font: inherit;
  font-size: var(--text-sm);
}

/* 分组胶囊：横向滚动，避免几十个分组把首屏撑满 */
.group-scroller {
  display: flex;
  gap: 8px;
  margin: 12px -16px 0;
  padding: 2px 16px 4px;
  overflow-x: auto;
  scrollbar-width: none;
}
.group-scroller::-webkit-scrollbar {
  display: none;
}
.group-chip {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-outline, #ddd6c6);
  background: transparent;
  color: var(--color-on-surface-variant);
  font-size: var(--text-sm);
  white-space: nowrap;
  transition: background 0.18s var(--ease-standard), color 0.18s var(--ease-standard), border-color 0.18s var(--ease-standard);
}
.group-chip.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.group-chip.ghost {
  border-style: dashed;
}
.group-chip-count {
  font-size: var(--text-xs);
  opacity: 0.75;
}

/* 今日目标条 */
.shelf-goal {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: var(--radius-lg);
  background: var(--color-surface-container);
}
.goal-ring {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: conic-gradient(var(--color-primary) var(--goal, 0%), rgba(0, 0, 0, 0.09) 0);
}
.goal-ring-inner {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--color-surface-container);
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 600;
}
.goal-main {
  flex: 1;
  min-width: 0;
}
.goal-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}
.goal-dim {
  font-size: var(--text-sm);
  font-weight: 400;
  opacity: 0.55;
}
.goal-sub {
  margin: 2px 0 0;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.goal-cta {
  flex: 0 0 auto;
}

/* 最近阅读 */
.recent-block {
  margin-top: 18px;
}
.recent-head {
  align-items: baseline;
  margin-bottom: 8px;
}
.recent-row {
  display: flex;
  gap: 8px;
  margin: 0 -16px;
  padding: 0 16px 2px;
  overflow-x: auto;
  scrollbar-width: none;
}
.recent-row::-webkit-scrollbar {
  display: none;
}
.recent-card {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 178px;
  padding: 8px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-outline, #e6e0d2);
  background: var(--color-surface);
  text-align: left;
}
.recent-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.recent-info strong {
  font-size: var(--text-sm);
  font-weight: 600;
}
.recent-info small {
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}

/* 网格：三列，封面不再占满半屏 */
.shelf-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px 12px;
  margin-top: 18px;
}
.shelf-card {
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.detail-btn {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 2;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.46);
  color: #fff;
  font-size: 14px;
  line-height: 28px;
  letter-spacing: 1px;
}
.detail-btn:active { background: rgba(0, 0, 0, 0.66); }
.cover-btn {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  border-radius: var(--radius-sm);
  line-height: 0;
}
.shelf-card :deep(.book-cover) {
  box-shadow: var(--shadow-cover);
}
.shelf-card.picked :deep(.book-cover) {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
.cover-progress {
  position: absolute;
  left: 6px;
  right: 6px;
  bottom: 6px;
  height: 3px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.28);
  overflow: hidden;
}
.cover-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: rgba(255, 255, 255, 0.95);
}
.new-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: var(--color-primary);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.22);
}
.new-badge.inline {
  position: static;
  flex: 0 0 auto;
  box-shadow: none;
}
.pick-dot {
  position: absolute;
  top: 6px;
  left: 6px;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.9);
  background: rgba(0, 0, 0, 0.25);
  color: #fff;
  font-size: 11px;
  line-height: 1;
}
.pick-dot.on {
  background: var(--color-primary);
  border-color: #fff;
}
.pick-dot.inline {
  position: static;
  flex: 0 0 auto;
}
.shelf-name {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.shelf-meta {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}

/* 列表视图 */
.shelf-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 18px;
}
.list-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-outline, #e6e0d2);
  background: var(--color-surface);
  cursor: pointer;
}
.list-row.picked {
  border-color: var(--color-primary);
  background: var(--color-surface-container);
}
.list-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.list-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.list-title-row strong {
  font-size: var(--text-md);
  font-weight: 600;
}
.list-main small {
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.list-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}
.list-progress {
  flex: 1;
  height: 3px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.08);
  overflow: hidden;
}
.list-progress span {
  display: block;
  height: 100%;
  background: var(--color-primary);
  border-radius: inherit;
}
/* 整行点进去是继续阅读，详情放在右侧这个角上，避免「想看书又不想开读」时没入口 */
.list-more {
  flex: 0 0 auto;
  width: 28px;
  height: 44px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--color-on-surface-variant);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.list-more:active { background: var(--color-surface-container); }

/* 多选操作条 */
.shelf-page.has-batch {
  padding-bottom: 96px;
}
.batch-bar {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: calc(72px + env(safe-area-inset-bottom));
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: var(--radius-pill);
  background: var(--color-surface-container-high, #e9e3d5);
  box-shadow: var(--shadow-sheet);
  animation: batch-in 0.18s var(--ease-standard);
}
@keyframes batch-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
.batch-count {
  flex: 1;
  padding-left: 4px;
  font-size: var(--text-sm);
  font-weight: 600;
}
.mini-btn {
  height: 30px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-outline, #ddd6c6);
  background: var(--color-surface);
  color: var(--color-on-surface);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.mini-btn.ghost {
  background: transparent;
}
.mini-btn.danger {
  color: #b3261e;
  border-color: rgba(179, 38, 30, 0.35);
}
.mini-btn:disabled {
  opacity: 0.45;
}
.link-btn {
  border: 0;
  background: none;
  padding: 0;
  color: var(--color-primary);
  font-size: var(--text-xs);
}

/* 分组面板 */
.group-sheet {
  padding: 0 16px 8px;
}
.group-add {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.group-add input {
  flex: 1;
  min-width: 0;
  height: 38px;
  padding: 0 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-outline, #ddd6c6);
  background: var(--color-surface);
  font: inherit;
  font-size: var(--text-sm);
}
.group-empty {
  margin: 4px 0 8px;
}
.group-row-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  font-size: var(--text-sm);
}
.group-pick {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 13px 0;
  border: 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  background: none;
  color: var(--color-on-surface);
  font: inherit;
  font-size: var(--text-md);
  text-align: left;
}
.group-pick-chev {
  color: var(--color-on-surface-variant);
}
</style>
