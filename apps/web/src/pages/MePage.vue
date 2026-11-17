<template>
  <section class="page me-page">
    <header class="page-head">
      <h1 class="page-title">我的</h1>
    </header>

    <div class="me-hero">
      <div class="me-brand">
        <div class="me-logo">L</div>
        <div class="grow">
          <p class="me-name">Legado Web</p>
          <p class="me-version">v0.47.0 · 自建书源 · 本地阅读</p>
        </div>
      </div>
      <div class="me-metrics">
        <div class="me-metric">
          <span class="me-metric-value">{{ bookCount }}</span>
          <span class="me-metric-label">书架</span>
        </div>
        <div class="me-metric">
          <span class="me-metric-value">{{ stats.total }}</span>
          <span class="me-metric-label">书源</span>
        </div>
        <div class="me-metric">
          <span class="me-metric-value">{{ todayMinutes }}</span>
          <span class="me-metric-label">今日分钟</span>
        </div>
      </div>
      <div class="me-health">
        <div class="me-health-track"><div class="me-health-fill" :style="{ width: okPercent + '%' }"></div></div>
        <p class="me-health-note">{{ okCount }} / {{ stats.total }} 个书源已验证可用</p>
      </div>
    </div>

    <h2 class="section-title">书源</h2>
    <div class="me-group">
      <button class="me-row" @click="router.push('/sources')">
        <span class="me-ico">📚</span>
        <span class="me-main"><span class="me-label">书源列表</span><span class="me-hint">管理 · 启停 · 调试</span></span>
        <span class="me-count">{{ stats.total }}</span>
        <span class="me-chevron">›</span>
      </button>
      <button class="me-row" @click="router.push('/sources/organize')">
        <span class="me-ico">🧹</span>
        <span class="me-main"><span class="me-label">书源整理</span><span class="me-hint">去重 · 清理失效</span></span>
        <span class="me-chevron">›</span>
      </button>
      <label class="me-row">
        <span class="me-ico">📥</span>
        <span class="me-main"><span class="me-label">导入书源</span><span class="me-hint">{{ importHint }}</span></span>
        <span class="me-chevron">›</span>
        <input type="file" accept=".json,application/json" hidden @change="onFile" />
      </label>
      <button class="me-row" @click="exportSources">
        <span class="me-ico">📤</span>
        <span class="me-main"><span class="me-label">导出书源</span><span class="me-hint">JSON 备份</span></span>
        <span class="me-chevron">›</span>
      </button>
    </div>

    <h2 class="section-title">阅读</h2>
    <div class="me-group">
      <button class="me-row" @click="router.push('/history')">
        <span class="me-ico">🕯️</span>
        <span class="me-main"><span class="me-label">阅读记录</span><span class="me-hint">今日 {{ todayMinutes }} 分钟 · 连续 {{ readStats.streak }} 天</span></span>
        <span class="me-chevron">›</span>
      </button>
      <button class="me-row" @click="router.push('/notes')">
        <span class="me-ico">✍️</span>
        <span class="me-main"><span class="me-label">笔记</span><span class="me-hint">{{ noteCount ? noteCount + " 条划线 · 批注" : "划线 · 批注 · 导出" }}</span></span>
        <span class="me-count">{{ noteCount }}</span>
        <span class="me-chevron">›</span>
      </button>
      <button class="me-row" @click="router.push('/lists')">
        <span class="me-ico">🗂️</span>
        <span class="me-main"><span class="me-label">我的书单</span><span class="me-hint">主题收藏</span></span>
        <span class="me-chevron">›</span>
      </button>
      <button class="me-row" @click="router.push('/subscriptions')">
        <span class="me-ico">🔗</span>
        <span class="me-main"><span class="me-label">订阅源</span><span class="me-hint">订阅链接 · 发布</span></span>
        <span class="me-chevron">›</span>
      </button>
      <button class="me-row" @click="router.push('/replace')">
        <span class="me-ico">🩹</span>
        <span class="me-main"><span class="me-label">替换规则</span><span class="me-hint">正文净化</span></span>
        <span class="me-chevron">›</span>
      </button>
      <button class="me-row" @click="router.push('/settings')">
        <span class="me-ico">⚙️</span>
        <span class="me-main"><span class="me-label">设置</span><span class="me-hint">主题 · 搜索 · 阅读</span></span>
        <span class="me-chevron">›</span>
      </button>
    </div>

    <div class="me-about">
      <p>基于 Legado 书源规则的网页阅读服务，书籍内容来自你导入的书源，本站只做规则解析与阅读界面。</p>
      <p class="muted">多源并发搜索 · 详情/目录/正文全链路抓取 · 换源与进度接续</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, type ReadingStats, type Stats } from "../api";

const router = useRouter();
const stats = ref<Stats>({ total: 0, status: {}, types: {}, groups: [] });
const readStats = ref<ReadingStats>({ today: 0, week: 0, total: 0, streak: 0, books: 0, chapters: 0, readWords: 0, goal: 0 });
const bookCount = ref(0);
const noteCount = ref(0);
const importHint = ref("选择 JSON 文件");

const okCount = computed(() => stats.value.status.ok ?? 0);
const okPercent = computed(() => (stats.value.total ? Math.round((okCount.value / stats.value.total) * 100) : 0));
const todayMinutes = computed(() => Math.round((readStats.value.today ?? 0) / 60));

async function refresh() {
  const [nextStats, nextReading, shelf, notes] = await Promise.allSettled([
    api.stats(),
    api.readingStats(),
    api.books(),
    api.notes({ limit: 1 }),
  ]);
  if (nextStats.status === "fulfilled") stats.value = nextStats.value;
  if (nextReading.status === "fulfilled") readStats.value = nextReading.value;
  if (shelf.status === "fulfilled") bookCount.value = shelf.value.items.length;
  if (notes.status === "fulfilled") noteCount.value = notes.value.total;
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  importHint.value = "导入中…";
  try {
    const text = await file.text();
    const res = await api.importJson(text);
    importHint.value = `新增 ${res.inserted}，更新 ${res.updated}`;
    await refresh();
  } catch (err) {
    importHint.value = `失败：${(err as Error).message}`;
  } finally {
    input.value = "";
  }
}

function exportSources() {
  window.open("/api/sources/export", "_blank");
}

onMounted(refresh);
</script>

<style scoped>
.me-page {
  padding-bottom: calc(24px + env(safe-area-inset-bottom));
}
.me-hero {
  padding: 16px;
  border-radius: var(--radius-xl);
  border: 1px solid var(--color-outline);
  background: linear-gradient(160deg, var(--color-primary-container), #fffdf8 72%);
}
.me-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}
.me-logo {
  flex: none;
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  color: #fff;
  font-size: 20px;
  font-weight: 700;
}
.me-name {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 700;
}
.me-version {
  margin: 3px 0 0;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.me-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 16px;
}
.me-metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 12px;
  border-left: 1px solid rgba(0, 0, 0, 0.08);
}
.me-metric:first-child {
  padding-left: 0;
  border-left: 0;
}
.me-metric-value {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.1;
}
.me-metric-label {
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.me-health {
  margin-top: 14px;
}
.me-health-track {
  height: 4px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.08);
  overflow: hidden;
}
.me-health-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--color-primary);
  transition: width 0.4s var(--ease-standard);
}
.me-health-note {
  margin: 6px 0 0;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.me-group {
  margin-top: 8px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-xl);
  background: #fffdf8;
  overflow: hidden;
}
.me-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  border: 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.me-row:last-child {
  border-bottom: 0;
}
.me-row:active {
  background: var(--color-surface-container);
}
.me-ico {
  flex: none;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--color-surface-container);
  font-size: 15px;
}
.me-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.me-label {
  font-size: var(--text-md);
}
.me-hint {
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.me-count {
  font-size: var(--text-sm);
  color: var(--color-on-surface-variant);
}
.me-chevron {
  flex: none;
  font-size: 18px;
  line-height: 1;
  color: var(--color-outline);
}
.me-about {
  margin-top: 20px;
  padding: 14px;
  border-radius: var(--radius-lg);
  background: var(--color-surface-container);
}
.me-about p {
  margin: 0 0 6px;
  font-size: var(--text-sm);
  line-height: 1.7;
}
.me-about p:last-child {
  margin-bottom: 0;
}
</style>
