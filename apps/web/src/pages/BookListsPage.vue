<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { api, type BookList } from "../api";
import { goBack } from "../lib/nav";
import { toast } from "../lib/toast";
import BookCover from "../components/BookCover.vue";
import BottomSheet from "../components/BottomSheet.vue";
import EmptyState from "../components/EmptyState.vue";

const router = useRouter();
const lists = ref<BookList[]>([]);
const selected = ref<BookList | null>(null);
const loading = ref(true);
const showCreate = ref(false);
const saving = ref(false);
const form = reactive({ name: "", description: "" });

const totalBooks = computed(() => lists.value.reduce((sum, list) => sum + list.count, 0));

function previewCovers(list: BookList) {
  return list.books.slice(0, 3);
}

async function load() {
  loading.value = true;
  try {
    const data = await api.bookLists();
    lists.value = data.items;
    if (selected.value) {
      selected.value = data.items.find((item) => item.id === selected.value?.id) ?? null;
    }
  } catch (error) {
    toast("书单加载失败：" + (error instanceof Error ? error.message : String(error)));
  } finally {
    loading.value = false;
  }
}

async function open(list: BookList) {
  try {
    selected.value = await api.bookList(list.id);
  } catch (error) {
    toast("打开书单失败：" + (error instanceof Error ? error.message : String(error)));
  }
}

function closeDetail() {
  selected.value = null;
}

async function create() {
  const name = form.name.trim();
  if (!name) {
    toast("请先给书单起个名字", "error");
    return;
  }
  saving.value = true;
  try {
    await api.addBookList({ name, description: form.description.trim() });
    form.name = "";
    form.description = "";
    showCreate.value = false;
    await load();
    toast("书单已创建");
  } catch (error) {
    toast("创建失败：" + (error instanceof Error ? error.message : String(error)));
  } finally {
    saving.value = false;
  }
}

async function rename() {
  if (!selected.value) return;
  const name = window.prompt("书单名称", selected.value.name)?.trim();
  if (!name) return;
  try {
    await api.patchBookList(selected.value.id, { name });
    await load();
    toast("已重命名");
  } catch (error) {
    toast("重命名失败：" + (error instanceof Error ? error.message : String(error)));
  }
}

async function removeList() {
  if (!selected.value) return;
  if (!window.confirm(`删除书单「${selected.value.name}」？书籍本身不会被删除。`)) return;
  try {
    await api.removeBookList(selected.value.id);
    selected.value = null;
    await load();
    toast("书单已删除");
  } catch (error) {
    toast("删除失败：" + (error instanceof Error ? error.message : String(error)));
  }
}

async function removeBook(bookId: number) {
  if (!selected.value) return;
  try {
    await api.removeBookFromList(selected.value.id, bookId);
    await load();
    toast("已移出书单");
  } catch (error) {
    toast("移出失败：" + (error instanceof Error ? error.message : String(error)));
  }
}

function goBook(id: number) {
  void router.push("/book/" + id);
}

onMounted(load);
</script>

<template>
  <div class="page booklists-page">
    <header class="bl-head">
      <button class="back-btn" @click="selected ? closeDetail() : goBack('/me')">← 返回</button>
      <div class="bl-head-row">
        <div class="bl-head-main">
          <h1 class="bl-title">{{ selected ? selected.name : "我的书单" }}</h1>
          <p class="bl-sub">
            <template v-if="selected">{{ selected.count }} 本书 · {{ selected.updatedAt.slice(0, 10) }}</template>
            <template v-else>{{ lists.length }} 个书单 · {{ totalBooks }} 本书</template>
          </p>
        </div>
        <button v-if="!selected" class="bl-new" @click="showCreate = true">
          <span class="bl-new-plus">＋</span>新建
        </button>
      </div>
    </header>

    <div v-if="loading" class="bl-skeleton">
      <div v-for="i in 4" :key="i" class="bl-skel-card" />
    </div>

    <template v-else-if="!selected">
      <EmptyState
        v-if="!lists.length"
        title="还没有书单"
        desc="把喜欢的书整理成主题书单，比如「年度最佳」「硬核科幻」「睡前短篇」。"
      >
        <button class="btn btn-primary" @click="showCreate = true">创建第一个书单</button>
      </EmptyState>

      <div v-else class="bl-grid">
        <article v-for="list in lists" :key="list.id" class="bl-card" @click="open(list)">
          <div class="bl-stack">
            <div
              v-for="(book, i) in previewCovers(list)"
              :key="book.id"
              class="bl-stack-item"
              :style="{ zIndex: 3 - i, transform: `rotate(${(i - 1) * 5}deg) translateX(${(i - 1) * 16}px)` }"
            >
              <BookCover :url="book.coverUrl" :source-id="book.sourceId" :name="book.name" :radius="5" :initial-font="12" />
            </div>
            <div v-if="!previewCovers(list).length" class="bl-stack-empty">书</div>
          </div>
          <strong class="bl-name">{{ list.name }}</strong>
          <span class="bl-meta">{{ list.count }} 本 · {{ list.updatedAt.slice(5, 10) }}</span>
          <p v-if="list.description" class="bl-desc">{{ list.description }}</p>
        </article>
      </div>
    </template>

    <template v-else>
      <div class="bl-detail-head">
        <p class="bl-detail-desc">{{ selected.description || "还没有简介" }}</p>
        <div class="bl-detail-actions">
          <button class="btn btn-sm" @click="rename">重命名</button>
          <button class="btn btn-sm bl-danger" @click="removeList">删除书单</button>
        </div>
      </div>

      <EmptyState
        v-if="!selected.books.length"
        title="书单还是空的"
        desc="打开任意一本书的详情页，点「加入书单」就能放进来。"
      />

      <div v-else class="bl-books">
        <article v-for="book in selected.books" :key="book.id" class="bl-book">
          <button class="bl-book-cover" @click="goBook(book.id)">
            <BookCover :url="book.coverUrl" :source-id="book.sourceId" :name="book.name" :width="48" :height="64" :radius="6" :initial-font="18" />
          </button>
          <button class="bl-book-main" @click="goBook(book.id)">
            <strong>{{ book.name }}</strong>
            <span>{{ book.author || "佚名" }} · {{ book.chapterCount }} 章</span>
          </button>
          <button class="bl-remove" aria-label="移出书单" @click="removeBook(book.id)">移出</button>
        </article>
      </div>
    </template>

    <BottomSheet :open="showCreate" title="新建书单" subtitle="给一组书起个主题名" @close="showCreate = false">
      <div class="bl-form">
        <label class="bl-label">书单名</label>
        <input v-model="form.name" class="bl-input" maxlength="40" placeholder="如：年度最佳" />
        <label class="bl-label">一句话简介（可选）</label>
        <textarea v-model="form.description" class="bl-textarea" maxlength="300" rows="3" placeholder="写给自己的备注，比如「看完想二刷的」" />
        <button class="btn btn-primary bl-submit" :disabled="saving" @click="create">
          {{ saving ? "创建中…" : "创建书单" }}
        </button>
      </div>
    </BottomSheet>
  </div>
</template>

<style scoped>
.booklists-page {
  padding-bottom: 32px;
}

.bl-head {
  padding: 16px 0 10px;
}
.bl-head-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
}
.bl-head-main {
  min-width: 0;
}
.bl-title {
  margin: 0;
  font-size: var(--text-2xl);
  font-weight: 700;
  letter-spacing: -0.01em;
}
.bl-sub {
  margin: 5px 0 0;
  font-size: var(--text-sm);
  color: var(--color-on-surface-variant);
}
.bl-new {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
  color: #fff;
  font-size: var(--text-sm);
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: transform 0.16s var(--ease-standard);
}
.bl-new:active {
  transform: scale(0.97);
}
.bl-new-plus {
  font-size: 15px;
  line-height: 1;
}

/* 列表网格 */
.bl-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 4px;
}
@media (min-width: 640px) {
  .bl-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
.bl-card {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-lg);
  background: #fffdf8;
  cursor: pointer;
  transition: transform 0.16s var(--ease-standard);
}
.bl-card:active {
  transform: scale(0.985);
}
.bl-stack {
  position: relative;
  height: 98px;
  margin-bottom: 10px;
  border-radius: var(--radius-md);
  background: linear-gradient(180deg, #f5f0e7, #eee7d9);
  overflow: hidden;
}
.bl-stack-item {
  position: absolute;
  left: 50%;
  top: 12px;
  width: 58px;
  margin-left: -29px;
  box-shadow: var(--shadow-cover);
}
.bl-stack-item :deep(.book-cover) {
  width: 100%;
}
.bl-stack-empty {
  position: absolute;
  left: 50%;
  top: 12px;
  width: 58px;
  margin-left: -29px;
  height: 77px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: var(--color-surface-container);
  color: var(--color-on-surface-variant);
  font-size: 12px;
}
.bl-name {
  display: block;
  font-size: var(--text-md);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bl-meta {
  display: block;
  margin-top: 3px;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.bl-desc {
  margin: 8px 0 0;
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--color-on-surface-variant);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 详情 */
.bl-detail-head {
  padding: 14px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-lg);
  background: #fffdf8;
}
.bl-detail-desc {
  margin: 0;
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--color-on-surface-variant);
}
.bl-detail-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.bl-danger {
  color: #b4432f;
  border-color: rgba(180, 67, 47, 0.28);
}
.bl-books {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.bl-book {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-md);
  background: #fffdf8;
}
.bl-book-cover,
.bl-book-main {
  border: 0;
  background: none;
  padding: 0;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  color: inherit;
}
.bl-book-cover {
  flex: 0 0 auto;
  display: block;
}
.bl-book-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.bl-book-main strong {
  font-size: var(--text-md);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bl-book-main span {
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bl-remove {
  flex: 0 0 auto;
  padding: 5px 10px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--color-on-surface-variant);
  font-size: var(--text-xs);
  font-family: inherit;
  cursor: pointer;
}
.bl-remove:active {
  background: var(--color-surface-container);
}

/* 新建面板 */
.bl-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 16px 8px;
}
.bl-label {
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
  margin-top: 4px;
}
.bl-input,
.bl-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-md);
  background: #fffdf8;
  font-size: var(--text-md);
  font-family: inherit;
  color: inherit;
}
.bl-textarea {
  resize: none;
  line-height: 1.6;
}
.bl-submit {
  margin-top: 12px;
  width: 100%;
}

/* 骨架 */
.bl-skeleton {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.bl-skel-card {
  height: 168px;
  border-radius: var(--radius-lg);
  background: linear-gradient(100deg, #f1ece2 20%, #f8f4ec 40%, #f1ece2 60%);
  background-size: 220% 100%;
  animation: bl-shimmer 1.2s linear infinite;
}
@keyframes bl-shimmer {
  from {
    background-position: 120% 0;
  }
  to {
    background-position: -20% 0;
  }
}
</style>
