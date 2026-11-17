<template>
  <section class="page subs-page">
    <header class="subs-head">
      <button class="back-btn" @click="goBack('/me')">← 返回</button>
      <h1 class="subs-title">订阅源</h1>
      <p class="subs-sub">{{ items.length }} 个订阅 · 共 {{ totalSources }} 个书源</p>
    </header>

    <div class="subs-add">
      <div class="subs-add-row">
        <input v-model="newUrl" class="subs-input" placeholder="https://example.com/sources.json" inputmode="url" />
        <button class="subs-add-btn" :disabled="adding || !newUrl.trim()" @click="add">
          {{ adding ? "拉取中…" : "添加" }}
        </button>
      </div>
      <input v-model="newName" class="subs-input subs-input-sub" placeholder="备注名称（可选）" />
      <p v-if="message" class="subs-note">{{ message }}</p>
    </div>

    <div class="subs-list-head">
      <span>已订阅</span>
      <span class="subs-count">{{ items.length }}</span>
    </div>

    <EmptyState v-if="!items.length" title="还没有订阅" desc="粘贴别人的书源列表地址，服务端会自动增量同步。" />

    <div v-else class="subs-list">
      <article v-for="item in items" :key="item.id" class="subs-item">
        <div class="subs-item-main">
          <strong class="subs-name">{{ item.name }}</strong>
          <span class="subs-url">{{ item.url }}</span>
          <span class="subs-meta">{{ item.count }} 个书源 · {{ item.lastFetchAt || "未拉取" }}</span>
        </div>
        <div class="subs-item-actions">
          <button class="subs-act" :disabled="busyId === item.id" @click="refresh(item)">
            {{ busyId === item.id ? "刷新中" : "刷新" }}
          </button>
          <button class="subs-act subs-act-danger" @click="remove(item)">删除</button>
        </div>
      </article>
    </div>

    <div class="subs-publish">
      <div class="subs-publish-head">
        <strong>发布到手机</strong>
        <span class="subs-publish-tag">{{ publish ? "已启用" : "未启用" }}</span>
      </div>
      <p class="subs-publish-desc">
        生成一个订阅链接，在阅读 App 的「书源管理 → 网络导入」里粘贴；之后服务端书源变化时，手机可以重新拉取。
      </p>
      <template v-if="publish">
        <code class="subs-feed">{{ absoluteFeed }}</code>
        <div class="subs-publish-actions">
          <button class="btn btn-primary btn-sm" @click="copy">复制链接</button>
          <button class="btn btn-sm" @click="unpublish">停用</button>
        </div>
      </template>
      <button v-else class="btn btn-primary btn-sm" @click="publishFeed">生成订阅链接</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import { goBack } from "../lib/nav";
import EmptyState from "../components/EmptyState.vue";

interface SubItem {
  id: number;
  name: string;
  url: string;
  enabled: boolean;
  autoRefresh: boolean;
  lastFetchAt: string | null;
  count: number;
}

const items = ref<SubItem[]>([]);
const publish = ref<{ token: string; url: string } | null>(null);
const newUrl = ref("");
const newName = ref("");
const adding = ref(false);
const busyId = ref(0);
const message = ref("");

const absoluteFeed = computed(() => (publish.value ? location.origin + publish.value.url : ""));
const totalSources = computed(() => items.value.reduce((sum, item) => sum + item.count, 0));

async function load() {
  const res = await api.subscriptions();
  items.value = res.items as SubItem[];
  publish.value = res.publish;
}

async function add() {
  const url = newUrl.value.trim();
  if (!url) return;
  adding.value = true;
  message.value = "";
  try {
    const res = await api.addSubscription(url, newName.value.trim() || undefined);
    const r = res.refresh as { added?: number; updated?: number; total?: number; error?: string };
    message.value = r.error ? "拉取失败：" + r.error : `拉取完成：新增 ${r.added}，更新 ${r.updated}`;
    newUrl.value = "";
    newName.value = "";
    await load();
  } catch (err) {
    message.value = "添加失败：" + String((err as Error).message);
  } finally {
    adding.value = false;
  }
}

async function refresh(item: SubItem) {
  busyId.value = item.id;
  message.value = "正在刷新 " + item.name + "…";
  try {
    const res = await api.refreshSubscription(item.id);
    message.value = res.skipped ? "内容未变化" : `更新完成：新增 ${res.added}，更新 ${res.updated}`;
    await load();
  } catch (err) {
    message.value = "刷新失败：" + String((err as Error).message);
  } finally {
    busyId.value = 0;
  }
}

async function remove(item: SubItem) {
  if (!confirm(`删除订阅「${item.name}」？（不会删除已导入的书源）`)) return;
  await api.deleteSubscription(item.id);
  await load();
}

async function publishFeed() {
  publish.value = await api.publishFeed();
}

async function unpublish() {
  await api.unpublishFeed();
  publish.value = null;
}

async function copy() {
  await navigator.clipboard.writeText(absoluteFeed.value).catch(() => undefined);
  message.value = "已复制订阅链接";
}

onMounted(load);
</script>

<style scoped>
.subs-page {
  padding-bottom: 32px;
}
.subs-head {
  padding: 16px 0 12px;
}
.subs-title {
  margin: 10px 0 0;
  font-size: var(--text-2xl);
  font-weight: 700;
  letter-spacing: -0.01em;
}
.subs-sub {
  margin: 5px 0 0;
  font-size: var(--text-sm);
  color: var(--color-on-surface-variant);
}

.subs-add {
  padding: 12px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-lg);
  background: #fffdf8;
}
.subs-add-row {
  display: flex;
  gap: 8px;
}
.subs-input {
  flex: 1;
  min-width: 0;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-md);
  background: #fff;
  font-size: var(--text-sm);
  font-family: inherit;
  color: inherit;
}
.subs-input-sub {
  width: 100%;
  margin-top: 8px;
  height: 34px;
  font-size: var(--text-xs);
}
.subs-add-btn {
  flex: 0 0 auto;
  height: 38px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  color: #fff;
  font-size: var(--text-sm);
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
}
.subs-add-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.subs-note {
  margin: 10px 0 0;
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--color-on-surface-variant);
}

.subs-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 20px 4px 8px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-on-surface-variant);
}
.subs-count {
  font-size: var(--text-xs);
  font-weight: 500;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  background: var(--color-surface-container);
}
.subs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.subs-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-md);
  background: #fffdf8;
}
.subs-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.subs-name {
  font-size: var(--text-md);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subs-url {
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subs-meta {
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
  opacity: 0.85;
}
.subs-item-actions {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.subs-act {
  padding: 4px 10px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--color-on-surface-variant);
  font-size: var(--text-xs);
  font-family: inherit;
  cursor: pointer;
}
.subs-act:disabled {
  opacity: 0.55;
  cursor: default;
}
.subs-act-danger {
  color: #b4432f;
  border-color: rgba(180, 67, 47, 0.24);
}

.subs-publish {
  margin-top: 20px;
  padding: 14px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-lg);
  background: #fffdf8;
}
.subs-publish-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-md);
}
.subs-publish-tag {
  font-size: var(--text-xs);
  font-weight: 500;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  background: var(--color-surface-container);
  color: var(--color-on-surface-variant);
}
.subs-publish-desc {
  margin: 8px 0 12px;
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-on-surface-variant);
}
.subs-feed {
  display: block;
  padding: 10px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-container);
  font-size: 11px;
  line-height: 1.6;
  word-break: break-all;
}
.subs-publish-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
</style>
