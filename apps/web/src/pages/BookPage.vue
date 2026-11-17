<template>
  <section class="page book-page">
    <div class="top-bar">
      <button class="back-btn" @click="back">← 返回</button>
      <span class="spacer"></span>
      <button class="icon-chip" :disabled="refreshing" @click="refresh">{{ refreshing ? "刷新中" : "刷新目录" }}</button>
      <button class="icon-chip" @click="openSwitch">换源</button>
      <button class="icon-chip" @click="router.push('/shelf')">书架</button>
    </div>

    <div v-if="loading" class="empty-state"><p class="empty-desc">加载中…</p></div>
    <template v-else-if="book">
      <header class="book-head">
        <BookCover :url="book.coverUrl" :source-id="book.sourceId" :name="book.name" :width="96" :height="132" :radius="10" :initial-font="28" eager />
        <div class="grow">
          <h1 class="book-name" role="button" tabindex="0" @click="openReader(progressIndex)" @keyup.enter="openReader(progressIndex)">
            {{ book.name }}
          </h1>
          <p class="book-meta">{{ book.author || "佚名" }}</p>
          <p class="book-meta ellipsis">
            {{ book.originName || "未知来源" }}
            <span v-if="sourceHealthText" class="book-source-health" :class="'health-' + (sourceInfo?.healthState ?? 'unknown')" :title="sourceHealthTitle">
              {{ sourceHealthText }}
            </span>
            · {{ chapters.length }} 章
            <span v-if="book.wordCount && /\d/.test(book.wordCount)"> · {{ book.wordCount }}</span>
          </p>
          <p class="book-meta ellipsis">{{ book.lastChapter }}</p>
          <p v-if="readStats.chapters" class="book-meta book-read-stat">
            读过 {{ readStats.chapters }} 章<span v-if="readStats.words"> · {{ formatCharCount(readStats.words) }}</span>
          </p>
          <button class="link-btn book-edit" type="button" @click="openEdit">编辑资料</button>
        </div>
      </header>

      <div class="book-actions">
        <button class="btn btn-primary book-cta" :disabled="!chapters.length" @click="openReader(progressIndex)">
          {{ progressIndex > 0 ? "继续阅读" : "开始阅读" }}
          <span v-if="chapters.length" class="cta-sub">第 {{ progressIndex + 1 }} 章</span>
        </button>
        <button class="icon-chip" @click="openLists">书单</button>
        <button v-if="!book.inShelf" class="icon-chip" :disabled="addingToShelf" @click="addToShelf">
          {{ addingToShelf ? "加入中…" : "加入书架" }}
        </button>
        <button v-else class="icon-chip" @click="remove">移出</button>
      </div>

      <div v-if="notice" class="card notice-card">
        <p class="notice-text">{{ notice }}</p>
      </div>

      <div v-if="book.intro" class="card intro-card">
        <p class="intro-text" :class="{ expanded: introOpen }">{{ book.intro }}</p>
        <button class="link-btn" @click="introOpen = !introOpen">{{ introOpen ? "收起" : "展开" }}</button>
      </div>

      <div class="card meta-card">
        <label class="meta-label" for="book-note">备注与分组</label>
        <textarea id="book-note" v-model="noteDraft" rows="2" maxlength="500" placeholder="记点什么，例如读到第几卷、为什么换源"></textarea>
        <div class="meta-row">
          <select v-model.number="groupId" aria-label="书籍分组">
            <option :value="0">未分组</option>
            <option v-for="item in groups" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
          <button class="btn btn-tonal btn-sm" :disabled="savingMeta" @click="saveMeta">{{ savingMeta ? "保存中…" : "保存" }}</button>
        </div>
      </div>

      <div class="card offline-card">
        <div class="offline-head">
          <div class="grow">
            <p class="offline-title">整本离线</p>
            <p class="offline-sub">{{ offlineText }}</p>
          </div>
          <button class="btn btn-tonal btn-sm" :disabled="!chapters.length" @click="offlineBusy ? stopOffline() : startOffline()">
            {{ offlineBusy ? "停止" : cachedCount ? "补全" : "下载" }}
          </button>
          <button v-if="cachedCount && !offlineBusy" class="link-btn offline-clear" @click="clearOffline">清除</button>
        </div>
        <div v-if="offlineTotal" class="offline-bar" role="progressbar" :aria-valuenow="offlinePercent" aria-valuemin="0" aria-valuemax="100">
          <i :style="{ width: offlinePercent + '%' }"></i>
        </div>
        <div class="offline-export">
          <span class="offline-export-hint">{{ exportHint }}</span>
          <button class="link-btn" :disabled="Boolean(exporting) || !exportInfo.cached" @click="exportAs('txt')">
            {{ exporting === "txt" ? "导出中…" : "TXT" }}
          </button>
          <button class="link-btn" :disabled="Boolean(exporting) || !exportInfo.cached" @click="exportAs('epub')">
            {{ exporting === "epub" ? "导出中…" : "EPUB" }}
          </button>
        </div>
      </div>

      <h2 class="section-title">目录 <span class="muted" style="font-weight: 400">（{{ chapters.length }} 章）</span></h2>
      <div v-if="chapters.length" class="toc-tools">
        <div class="toc-search">
          <span class="toc-search-icon" aria-hidden="true">🔍</span>
          <input v-model="tocQuery" type="search" placeholder="搜索章节标题" aria-label="搜索章节标题" />
          <button v-if="tocQuery" class="toc-search-clear" type="button" aria-label="清空章节搜索" @click="tocQuery = ''">✕</button>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" @click="locateCurrent">当前章</button>
      </div>
      <p v-if="tocQuery.trim()" class="toc-result">
        匹配 {{ tocSearch.matched }} 章<span v-if="tocSearch.truncated">，先显示前 {{ tocSearch.items.length }} 章</span>
        <button v-if="tocSearch.truncated" class="link-btn" type="button" @click="tocSearchLimit += 300">显示更多</button>
      </p>
      <div v-if="!chapters.length" class="empty-state" style="padding: 24px 12px">
        <p class="empty-desc">{{ tocLoading ? "正在加载目录…" : "这个书源没能取到目录，可能是规则失效或站点需要验证。" }}</p>
        <button v-if="!tocLoading" class="btn btn-tonal" :disabled="refreshing" @click="refresh">重试拉取目录</button>
      </div>
      <div v-else-if="tocEmpty" class="empty-state toc-empty">
        <p class="empty-desc">没有标题包含「{{ tocQuery.trim() }}」的章节，换个词试试。</p>
      </div>
      <div v-else class="toc-list">
        <button
          v-for="chapter in tocItems"
          :key="chapter.id"
          class="toc-item"
          :class="{ current: chapter.idx === progressIndex }"
          @click="openReader(chapter.idx)"
        >
          <span class="toc-title ellipsis">{{ chapter.title }}</span>
          <span class="toc-tail">
            <span v-if="chapter.words" class="toc-words">{{ formatWords(chapter.words) }}</span>
            <span v-if="chapter.isVip" class="badge retest">VIP</span>
          </span>
        </button>
      </div>
      <button v-if="!tocQuery.trim() && chapters.length > visibleChapters.length" class="btn btn-tonal more-btn" @click="limit += 300">
        显示更多（还有 {{ chapters.length - visibleChapters.length }} 章）
      </button>
    </template>
    <div v-else class="empty-state">
      <p class="empty-title">加载失败</p>
      <p class="empty-desc">{{ error }}</p>
      <button class="btn btn-tonal" @click="router.push('/shelf')">回书架</button>
    </div>

    <ReaderSwitchSheet
      v-model="showSwitch"
      :book-id="id"
      :book-name="book?.name ?? ''"
      :book-author="book?.author"
      :chapter-index="progressIndex"
      :chapter-title="chapters[progressIndex]?.title"
      :current-chapters="chapters.length"
      :current-source-id="book?.sourceId"
      :current-source-name="sourceInfo?.name || book?.originName || ''"
      :current-toc-url="book?.tocUrl || ''"
      :current-source-health-state="sourceInfo?.healthState"
      :current-source-health-score="sourceInfo?.healthScore"
      :can-undo="Boolean(lastSwitch)"
      :last-source-name="lastSwitch?.sourceName"
      @switched="onSwitched"
    />

    <BottomSheet :open="showLists" title="加入书单" @close="showLists = false">
        <div v-if="listsLoading" class="muted" style="padding: 16px">加载中…</div>
        <div v-else class="list-choice">
          <button v-for="item in listOptions" :key="item.id" class="list-choice-row" @click="toggleList(item)">
            <span class="list-check" :class="{ on: item.has }">{{ item.has ? "✓" : "" }}</span>
            <span class="grow">{{ item.name }}</span>
            <span class="muted">{{ item.count }} 本</span>
          </button>
          <p v-if="!listOptions.length" class="muted" style="padding: 8px 16px">还没有书单，先创建一个：</p>
        </div>
        <div class="create-list-row">
          <input v-model="newListName" maxlength="40" placeholder="新书单名" @keyup.enter="createListAndAdd" />
          <button class="btn btn-tonal" :disabled="!newListName.trim()" @click="createListAndAdd">新建并加入</button>
        </div>
    </BottomSheet>

    <BottomSheet :open="showEdit" title="编辑书籍资料" subtitle="书名、作者、简介与封面" tall @close="showEdit = false">
      <div class="edit-form">
        <div class="edit-cover-row">
          <BookCover :url="editCover" :source-id="book?.sourceId" :name="editName || book?.name" :width="48" :height="66" :radius="6" :initial-font="14" />
          <div class="grow">
            <label class="meta-label" for="edit-cover">封面地址</label>
            <input id="edit-cover" v-model="editCover" class="edit-input" maxlength="1000" placeholder="https://… 或 /api/…，留空恢复默认封面" />
          </div>
        </div>
        <label class="meta-label" for="edit-name">书名</label>
        <input id="edit-name" v-model="editName" class="edit-input" maxlength="200" placeholder="书名" />
        <label class="meta-label" for="edit-author">作者</label>
        <input id="edit-author" v-model="editAuthor" class="edit-input" maxlength="100" placeholder="作者，可留空" />
        <label class="meta-label" for="edit-intro">简介</label>
        <textarea id="edit-intro" v-model="editIntro" class="edit-textarea" rows="5" maxlength="2000" placeholder="简介，可留空"></textarea>
        <p class="edit-hint">只改这本书在书架里的资料，不会改动书源；刷新目录也不会覆盖。</p>
        <div class="edit-actions">
          <button class="btn btn-ghost" type="button" @click="showEdit = false">取消</button>
          <button class="btn btn-primary" type="button" :disabled="savingEdit || !editName.trim()" @click="saveEdit">
            {{ savingEdit ? "保存中…" : "保存资料" }}
          </button>
        </div>
      </div>
    </BottomSheet>

  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, downloadBook, type BookGroup, type BookItem, type BookReadStats, type ChapterItem } from "../api";
import { goBack } from "../lib/nav";
import { toast } from "../lib/toast";
import { cachedChapters, downloadChapters, removeCachedChapters } from "../lib/book-offline";
import { searchToc } from "../lib/toc-search";
import { formatCharCount } from "../lib/switch-rank";
import { healthStateLabel } from "@legado/shared";
import BookCover from "../components/BookCover.vue";
import BottomSheet from "../components/BottomSheet.vue";
import ReaderSwitchSheet from "../components/reader/ReaderSwitchSheet.vue";

const route = useRoute();
const router = useRouter();
const id = Number(route.params.id);
const book = ref<BookItem | null>(null);
const chapters = ref<ChapterItem[]>([]);
const loading = ref(true);
const refreshing = ref(false);
/** 预览书（发现页点进来、还没入书架）自动拉目录时的状态。 */
const tocLoading = ref(false);
const addingToShelf = ref(false);
const error = ref("");
const notice = ref("");
const introOpen = ref(false);
const progressIndex = ref(0);
/** 当前书源的健康状态：详情页和换源面板都用它，避免读者点进一个已经失效的源。 */
const sourceInfo = ref<{ name: string; healthState?: string; healthScore?: number } | null>(null);
const lastSwitch = ref<{ sourceName: string } | null>(null);
const sourceHealthText = computed(() => {
  const state = sourceInfo.value?.healthState;
  if (!state || state === "unknown") return "";
  const label = healthStateLabel(state);
  return typeof sourceInfo.value?.healthScore === "number" && sourceInfo.value.healthScore > 0
    ? label + " " + sourceInfo.value.healthScore
    : label;
});
const sourceHealthTitle = computed(() => {
  const state = sourceInfo.value?.healthState;
  if (!state) return "还没有这个书源的体检数据";
  return "当前书源" + healthStateLabel(state) + (sourceInfo.value?.healthScore ? " · 健康分 " + sourceInfo.value.healthScore : "");
});
/** 读过章节与实际读到的字数；没有缓存正文时字数可能为 0，仍显示章数。 */
const readStats = ref<BookReadStats>({ chapters: 0, words: 0 });
const limit = ref(300);
/** 详情页目录搜索：空串时仍按 limit 分页，输入后只在命中里截断。 */
const tocQuery = ref("");
const tocSearchLimit = ref(300);
const showSwitch = ref(false);
const noteDraft = ref("");
const groupId = ref(0);
const showEdit = ref(false);
const editName = ref("");
const editAuthor = ref("");
const editCover = ref("");
const editIntro = ref("");
const savingEdit = ref(false);
const groups = ref<BookGroup[]>([]);
const savingMeta = ref(false);
const showLists = ref(false);
const listsLoading = ref(false);
const listOptions = ref<Array<{ id: number; name: string; count: number; has: boolean }>>([]);
const newListName = ref("");
const offlineBusy = ref(false);
const offlineDone = ref(0);
const offlineTotal = ref(0);
const offlineFailed = ref(0);
const cachedCount = ref(0);
/** 正在导出的格式（"txt" / "epub"），空串表示空闲。 */
const exporting = ref("");
/** 服务端缓存了多少章可导出（与浏览器 Cache Storage 的整本离线不是同一份）。 */
const exportInfo = ref({ cached: 0, total: 0 });
const exportHint = computed(() =>
  exportInfo.value.cached ? `可导出 ${exportInfo.value.cached}/${exportInfo.value.total} 章` : "还没有可导出的章节",
);
let offlineController: AbortController | null = null;

const visibleChapters = computed(() => chapters.value.slice(0, limit.value));
const tocSearch = computed(() => searchToc(chapters.value, tocQuery.value, tocSearchLimit.value));
const tocItems = computed(() => (tocQuery.value.trim() ? tocSearch.value.items : visibleChapters.value));
const tocEmpty = computed(() => Boolean(tocQuery.value.trim()) && tocSearch.value.matched === 0);

watch(tocQuery, () => {
  tocSearchLimit.value = 300;
});

const offlinePercent = computed(() =>
  offlineTotal.value ? Math.min(100, Math.round((offlineDone.value / offlineTotal.value) * 100)) : 0,
);
const offlineText = computed(() => {
  if (offlineBusy.value) {
    return `正在缓存 ${offlineDone.value}/${offlineTotal.value} 章` + (offlineFailed.value ? ` · ${offlineFailed.value} 章失败` : "");
  }
  if (cachedCount.value && cachedCount.value >= chapters.value.length) return `已缓存全部 ${cachedCount.value} 章，断网也能读`;
  if (cachedCount.value) return `已缓存 ${cachedCount.value}/${chapters.value.length} 章`;
  return `未缓存 · 全书 ${chapters.value.length} 章`;
});

async function refreshCached() {
  cachedCount.value = (await cachedChapters(id)).length;
}

async function refreshExport() {
  try {
    exportInfo.value = await api.exportInfo(id);
  } catch {
    /* 导出信息只是提示，失败不打扰阅读 */
  }
}

async function startOffline() {
  if (offlineBusy.value || !chapters.value.length) return;
  const cached = new Set(await cachedChapters(id));
  const todo = chapters.value.map((chapter) => chapter.idx).filter((index) => !cached.has(index));
  if (!todo.length) {
    toast("整本已经缓存好了");
    return;
  }
  offlineBusy.value = true;
  offlineDone.value = 0;
  offlineTotal.value = todo.length;
  offlineFailed.value = 0;
  offlineController = new AbortController();
  try {
    const result = await downloadChapters(id, todo, {
      signal: offlineController.signal,
      onProgress: (done, total, failed) => {
        offlineDone.value = done;
        offlineTotal.value = total;
        offlineFailed.value = failed;
      },
    });
    if (result.aborted) toast("已停止缓存", "warn");
    else if (result.failed) toast(`缓存完成，${result.failed} 章失败`, "warn");
    else toast(`已缓存 ${result.done} 章`, "success");
  } finally {
    offlineBusy.value = false;
    offlineController = null;
    await refreshCached();
    void refreshExport();
  }
}

function stopOffline() {
  offlineController?.abort();
}

async function clearOffline() {
  const removed = await removeCachedChapters(id);
  await refreshCached();
  toast(`已清除 ${removed} 章离线缓存`);
}

/** 导出服务端缓存过的章节；一章都没有时服务端会回 409，这里只负责把话说清楚。 */
async function exportAs(format: "txt" | "epub") {
  if (exporting.value) return;
  exporting.value = format;
  try {
    const { blob, filename } = await downloadBook(id, format);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`已导出 ${format.toUpperCase()}`, "success");
  } catch (err) {
    toast((err as Error).message || "导出失败", "error");
  } finally {
    exporting.value = "";
  }
}


async function loadReadStats(): Promise<void> {
  try {
    readStats.value = await api.bookReadStats(id);
  } catch {
    // 统计失败不影响详情页阅读；下一次进入或换源后会重试。
    readStats.value = { chapters: 0, words: 0 };
  }
}

function back() {
  goBack("/shelf");
}


function formatWords(count: number): string {
  if (!count) return "";
  if (count >= 10000) return (count / 10000).toFixed(count >= 100000 ? 0 : 1) + "万字";
  return count + "字";
}

/** 详情页复用阅读页的换源面板：换完只重新拉详情和目录，进度以服务端接续结果为准。 */
async function onSwitched(): Promise<void> {
  showSwitch.value = false;
  await load();
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const detail = await api.book(id);
    book.value = detail.book;
    sourceInfo.value = detail.source;
    lastSwitch.value = detail.lastSwitch ?? null;
    progressIndex.value = detail.progress?.chapterIndex ?? 0;
    const toc = await api.chapters(id);
    chapters.value = toc.items;
    book.value.chapterCount = toc.total;
    noteDraft.value = detail.book.note ?? "";
    groupId.value = detail.book.groupId ?? 0;
    void loadGroups();
    void loadReadStats();
    void refreshCached();
    void refreshExport();
    // 发现页点进来的「预览书」是本地秒建的，目录还没抓过：静默补一次，读完简介就能直接看。
    if (!detail.book.inShelf && !toc.items.length) void ensureToc();
  } catch (err) {
    error.value = String((err as Error).message);
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

async function saveMeta() {
  if (!book.value || savingMeta.value) return;
  savingMeta.value = true;
  try {
    await api.patchBook(id, { note: noteDraft.value.trim(), groupId: groupId.value });
    book.value.note = noteDraft.value.trim();
    book.value.groupId = groupId.value;
    toast("已保存备注与分组");
  } catch (err) {
    toast("保存失败：" + String((err as Error).message), "error");
  } finally {
    savingMeta.value = false;
  }
}

function openEdit() {
  if (!book.value) return;
  editName.value = book.value.name;
  editAuthor.value = book.value.author;
  editCover.value = book.value.coverUrl;
  editIntro.value = book.value.intro;
  showEdit.value = true;
}

async function saveEdit() {
  if (!book.value || savingEdit.value) return;
  const name = editName.value.trim();
  if (!name) {
    toast("书名不能为空", "error");
    return;
  }
  savingEdit.value = true;
  try {
    const author = editAuthor.value.trim();
    const intro = editIntro.value.trim();
    const coverUrl = editCover.value.trim();
    await api.patchBook(id, { name, author, intro, coverUrl });
    book.value = { ...book.value, name, author, intro, coverUrl };
    showEdit.value = false;
    toast("已保存书籍资料", "success");
  } catch (err) {
    toast("保存失败：" + String((err as Error).message), "error");
  } finally {
    savingEdit.value = false;
  }
}

async function openLists() {
  showLists.value = true;
  listsLoading.value = true;
  try {
    listOptions.value = (await api.bookListsOf(id)).items;
  } catch (error) {
    toast("书单加载失败：" + (error instanceof Error ? error.message : String(error)), "error");
  } finally {
    listsLoading.value = false;
  }
}

async function toggleList(item: { id: number; name: string; count: number; has: boolean }) {
  try {
    if (item.has) {
      await api.removeBookFromList(item.id, id);
      item.has = false;
      item.count = Math.max(0, item.count - 1);
    } else {
      await api.addBookToList(item.id, id);
      item.has = true;
      item.count += 1;
    }
  } catch (error) {
    toast("操作失败：" + (error instanceof Error ? error.message : String(error)), "error");
  }
}

async function createListAndAdd() {
  const name = newListName.value.trim();
  if (!name) return;
  try {
    const created = await api.addBookList({ name });
    await api.addBookToList(created.id, id);
    newListName.value = "";
    listOptions.value = (await api.bookListsOf(id)).items;
    toast("已加入书单「" + name + "」");
  } catch (error) {
    toast("创建失败：" + (error instanceof Error ? error.message : String(error)), "error");
  }
}

/** 预览书按需拉目录：不弹 toast、不清空页面，失败了详情页照样能看简介。 */
async function ensureToc(): Promise<void> {
  if (!book.value || tocLoading.value || chapters.value.length) return;
  tocLoading.value = true;
  try {
    const res = await api.refreshBook(id);
    book.value = { ...book.value, ...res.book };
    const toc = await api.chapters(id);
    chapters.value = toc.items;
    book.value.chapterCount = toc.total;
  } catch {
    /* 简介页不因目录失败而不可用 */
  } finally {
    tocLoading.value = false;
  }
}

/** 加入书架：预览书只是 in_shelf=0，置 1 即入架，不重复抓详情。 */
async function addToShelf(): Promise<void> {
  if (!book.value || addingToShelf.value) return;
  addingToShelf.value = true;
  try {
    await api.patchBook(id, { inShelf: true });
    book.value.inShelf = true;
    toast("已加入书架", "success");
  } catch (err) {
    toast("加入失败：" + String((err as Error).message).slice(0, 60), "error");
  } finally {
    addingToShelf.value = false;
  }
}

async function refresh() {
  if (!book.value) return;
  refreshing.value = true;
  try {
    const res = await api.refreshBook(id);
    book.value = { ...book.value, ...res.book };
    const toc = await api.chapters(id);
    chapters.value = toc.items;
    book.value.chapterCount = toc.total;
    notice.value = res.tocError ? `目录刷新失败：${res.tocError}` : res.chapters ? `已更新，共 ${res.chapters} 章` : "";
    if (notice.value) toast(notice.value, res.tocError ? "error" : "success");
  } catch (err) {
    toast("刷新失败：" + String((err as Error).message), "error");
  } finally {
    refreshing.value = false;
  }
}

/** 把搜索词填成当前章标题，过滤后滚到那条；比把 limit 拉到一千更轻。 */
function locateCurrent(): void {
  const current = chapters.value[progressIndex.value];
  if (!current) return;
  tocQuery.value = current.title;
  void nextTick(() => {
    document.querySelector(".toc-item.current")?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

function openReader(index: number) {
  if (!chapters.value.length) {
    toast("还没有目录，先点「刷新目录」", "error");
    return;
  }
  router.push(`/read/${id}/${index}`);
}

async function remove() {
  await api.removeBook(id);
  toast("已移出书架", "success");
  router.push("/shelf");
}

onMounted(load);
onBeforeUnmount(() => {
  offlineController?.abort();
});
</script>

<style scoped>
.book-page {
  padding-bottom: 24px;
}
.book-head {
  display: flex;
  gap: 14px;
}
.book-head :deep(.book-cover) {
  box-shadow: var(--shadow-cover);
}
.book-name {
  margin: 0 0 6px;
  font-size: 19px;
  line-height: 1.3;
  cursor: pointer;
}
.book-meta {
  margin: 0 0 3px;
  font-size: 12px;
  color: var(--color-on-surface-variant);
}
.book-source-health {
  display: inline-block;
  margin: 0 3px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 16px;
  vertical-align: 1px;
  background: var(--color-surface-container);
  color: var(--color-on-surface-variant);
  font-variant-numeric: tabular-nums;
}
.book-source-health.health-healthy {
  background: rgba(46, 138, 87, 0.14);
  color: #226b43;
}
.book-source-health.health-degraded,
.book-source-health.health-blocked {
  background: rgba(208, 138, 0, 0.14);
  color: #9a620f;
}
.book-source-health.health-broken {
  background: rgba(209, 67, 67, 0.14);
  color: #b3261e;
}
.book-edit {
  margin-top: 5px;
  font-size: 12px;
}
.edit-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 2px 2px 10px;
}
.edit-cover-row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  margin-bottom: 4px;
}
.edit-cover-row .grow {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.edit-input,
.edit-textarea {
  width: 100%;
  box-sizing: border-box;
  border-radius: 10px;
  border: 1px solid var(--color-outline);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  padding: 9px 10px;
}
.edit-input {
  height: 38px;
}
.edit-textarea {
  resize: vertical;
  min-height: 96px;
  line-height: 1.6;
}
.edit-hint {
  margin: 2px 0 0;
  font-size: 11px;
  line-height: 1.55;
  color: var(--color-on-surface-variant);
}
.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
/* 三个按钮原来会各自折行：主按钮撑满，次要动作收成小胶囊，永远一行。 */
.book-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}
.offline-card {
  margin-top: 12px;
}
.offline-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.offline-title {
  margin: 0 0 2px;
  font-size: 14px;
  font-weight: 600;
}
.offline-sub {
  margin: 0;
  font-size: 12px;
  color: var(--color-on-surface-variant);
}
.offline-clear {
  flex: none;
  font-size: 12px;
}
.offline-bar {
  height: 4px;
  margin-top: 10px;
  border-radius: 999px;
  background: var(--color-surface-container);
  overflow: hidden;
}
.offline-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
  transition: width 0.2s ease;
}
.offline-export {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--color-outline);
}
.offline-export-hint {
  flex: 1;
  font-size: 12px;
  color: var(--color-on-surface-variant);
}
.offline-export .link-btn {
  padding: 2px 8px;
}
.offline-export .link-btn:disabled {
  opacity: 0.5;
}
.book-cta {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  gap: 8px;
}
.cta-sub {
  font-size: 11px;
  font-weight: 400;
  opacity: 0.75;
}
.book-actions .icon-chip {
  flex: none;
}
.notice-card {
  margin-top: 14px;
  padding: 12px 14px;
  border-color: #f0d7a8;
  background: #fdf6e7;
}
.notice-text {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: #7a4a00;
}
.intro-card {
  margin-top: 14px;
  padding: 14px;
}
.intro-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-on-surface-variant);
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-wrap;
}
.intro-text.expanded {
  -webkit-line-clamp: unset;
  display: block;
}
.link-btn {
  margin-top: 8px;
  border: none;
  background: transparent;
  color: var(--color-primary);
  font-size: 13px;
  padding: 0;
  font-family: inherit;
  cursor: pointer;
}
.meta-card {
  margin-top: 14px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.meta-label {
  font-size: 12px;
  color: var(--color-on-surface-variant);
}
.meta-card textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 48px;
  border-radius: 10px;
  border: 1px solid var(--color-outline);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  padding: 8px 10px;
}
.meta-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.meta-row select {
  flex: 1;
  min-width: 0;
  height: 34px;
  border-radius: 10px;
  border: 1px solid var(--color-outline);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  padding: 0 8px;
}
.btn-sm {
  padding: 4px 14px;
  font-size: 12px;
  min-height: 30px;
}
.toc-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px;
}
.toc-search {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--color-surface-container);
}
.toc-search:focus-within {
  border-color: var(--color-primary);
}
.toc-search-icon {
  flex: none;
  font-size: 12px;
  opacity: 0.7;
}
.toc-search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
}
.toc-search input::-webkit-search-cancel-button {
  display: none;
}
.toc-search-clear {
  flex: none;
  padding: 4px;
  border: none;
  background: transparent;
  color: var(--color-on-surface-variant);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.toc-tools .btn {
  flex: none;
}
.toc-result {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 0 0 8px;
  color: var(--color-on-surface-variant);
  font-size: 12px;
}
.toc-empty {
  padding: 24px 12px;
}
.toc-list {
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  background: var(--color-surface-container);
  overflow: hidden;
}
.toc-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 12px 14px;
  border: none;
  border-bottom: 1px solid #e9e5da;
  background: transparent;
  font-size: 14px;
  text-align: left;
  color: var(--color-on-surface);
  font-family: inherit;
  cursor: pointer;
}
.toc-item:last-child {
  border-bottom: none;
}
.toc-item.current {
  color: var(--color-primary);
  font-weight: 600;
}
.toc-title {
  flex: 1;
  min-width: 0;
}
.toc-tail {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.toc-words {
  font-size: 10px;
  color: var(--color-on-surface-variant);
  opacity: 0.8;
}
.more-btn {
  width: 100%;
  margin-top: 12px;
}
</style>
