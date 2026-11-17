<template>
  <section class="page hist-page">
    <header class="page-head">
      <button class="back-btn" @click="router.back()">← 返回</button>
      <div class="row">
        <div class="grow">
          <h1 class="page-title">阅读记录</h1>
          <p class="page-sub">最近 30 天 · {{ days.length }} 天有记录</p>
        </div>
        <button class="icon-chip" :disabled="loading" @click="load">{{ loading ? "刷新中" : "刷新" }}</button>
      </div>
    </header>

    <section v-if="heatmap.columns.length" class="hist-heat">
      <div class="hist-heat-head">
        <h2>最近 {{ heatmap.columns.length }} 周</h2>
        <span class="muted">{{ heatmap.activeDays }} 天有记录 · 最长连续 {{ longest }} 天</span>
      </div>
      <div class="heat-scroll">
        <div class="heat-inner" :style="{ width: heatmap.columns.length * 15 + 'px' }">
          <div class="heat-months">
            <span v-for="month in heatmap.months" :key="month.column" :style="{ left: month.column * 15 + 'px' }">{{ month.label }}</span>
          </div>
          <div class="heat-grid">
            <div v-for="(column, ci) in heatmap.columns" :key="ci" class="heat-col">
              <span
                v-for="(cell, ri) in column.cells"
                :key="ri"
                class="heat-cell"
                :class="[cell ? 'lv' + cell.level : 'is-future']"
                :title="cell ? cell.day + ' · ' + Math.round(cell.seconds / 60) + ' 分钟' : ''"
              />
            </div>
          </div>
        </div>
      </div>
      <div class="heat-legend">
        <span class="muted">少</span>
        <i class="heat-cell lv0" /><i class="heat-cell lv1" /><i class="heat-cell lv2" /><i class="heat-cell lv3" /><i class="heat-cell lv4" />
        <span class="muted">多</span>
      </div>
    </section>

    <div class="hist-hero">
      <div class="hist-hero-top">
        <div class="hist-today">
          <span class="hist-today-value">{{ minutes(stats.today) }}</span>
          <span class="hist-today-unit">分钟</span>
        </div>
        <span class="hist-today-label">今日阅读</span>
      </div>
      <div class="hist-goal-track"><span class="hist-goal-fill" :style="{ width: goalPercent + '%' }" /></div>
      <p class="hist-goal-note">
        {{ goalPercent >= 100 ? "今日目标已达成，休息一下眼睛吧。" : "还差 " + Math.max(0, stats.goal - minutes(stats.today)) + " 分钟达成 " + stats.goal + " 分钟目标" }}
      </p>
      <div class="hist-mini">
        <div class="hist-mini-cell">
          <strong>{{ minutes(stats.week) }}</strong>
          <span>本周分钟</span>
        </div>
        <div class="hist-mini-cell">
          <strong>{{ minutes(stats.total) }}</strong>
          <span>累计分钟</span>
        </div>
        <div class="hist-mini-cell">
          <strong>{{ stats.streak }}</strong>
          <span>连续天数</span>
        </div>
        <div class="hist-mini-cell">
          <strong>{{ stats.readWords ? formatCharCount(stats.readWords) : "—" }}</strong>
          <span>已读字数</span>
        </div>
      </div>
    </div>

    <div v-if="loading && !days.length" class="loading">正在加载阅读记录…</div>
    <EmptyState v-else-if="!days.length" title="还没有阅读记录" desc="阅读满 1 分钟后会在这里按天统计">
      <button class="btn btn-primary" @click="router.push('/shelf')">回书架</button>
    </EmptyState>

    <div v-else class="hist-days">
      <section v-for="day in days" :key="day.day" class="hist-day">
        <div class="hist-day-head">
          <h2 class="hist-day-title">{{ dayLabel(day.day) }}</h2>
          <span class="hist-day-meta">{{ minutes(day.seconds) }} 分钟<span v-if="day.chapters"> · {{ day.chapters }} 章</span></span>
        </div>
        <div class="hist-day-card">
          <button v-for="item in day.items" :key="item.bookId" class="hist-row" @click="open(item)">
            <span class="hist-row-main">
              <span class="hist-row-name ellipsis">{{ item.name }}</span>
              <span class="hist-row-chapter ellipsis">{{ item.chapterTitle || "第 " + (item.chapterIndex + 1) + " 章" }}</span>
            </span>
            <span class="hist-row-time">{{ minuteLabel(item.seconds) }} 分</span>
          </button>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, type ReadingHistoryDay, type ReadingStats } from "../api";
import { toast } from "../lib/toast";
import { buildHeatmap } from "../lib/reading-heatmap";
import { formatCharCount } from "../lib/switch-rank";
import EmptyState from "../components/EmptyState.vue";

const router = useRouter();
const stats = ref<ReadingStats>({ today: 0, week: 0, total: 0, streak: 0, books: 0, chapters: 0, readWords: 0, goal: 30 });
const goalPercent = computed(() => Math.min(100, Math.round((minutes(stats.value.today) / Math.max(1, stats.value.goal)) * 100)));
const days = ref<ReadingHistoryDay[]>([]);
const loading = ref(true);
const heatmap = ref(buildHeatmap([], todayKey(), 53, 1800));
const longest = ref(0);

function todayKey(): string {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
}

function minutes(seconds: number): number {
  return Math.round((seconds || 0) / 60);
}

function minuteLabel(seconds: number): string {
  const value = minutes(seconds);
  if (value === 0 && (seconds || 0) > 0) return "<1";
  return String(value);
}

function dayLabel(day: string): string {
  const today = new Date();
  const key = (date: Date) => date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  if (day === key(today)) return "今天";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (day === key(yesterday)) return "昨天";
  const date = new Date(day + "T00:00:00");
  return Number.isNaN(date.getTime()) ? day : date.getMonth() + 1 + " 月 " + date.getDate() + " 日";
}

async function load() {
  loading.value = true;
  try {
    const [stat, history, heat] = await Promise.all([api.readingStats(), api.readingHistory(30), api.readingHeatmap(53)]);
    stats.value = stat;
    days.value = history.items;
    heatmap.value = buildHeatmap(heat.days, todayKey(), heat.weeks, heat.goal * 60);
    longest.value = heat.longest;
  } catch (err) {
    toast("阅读记录加载失败：" + String((err as Error).message), "error");
  } finally {
    loading.value = false;
  }
}

function open(item: ReadingHistoryDay["items"][number]) {
  router.push("/read/" + item.bookId + "/" + (item.chapterIndex || 0));
}

onMounted(load);
</script>

<style scoped>
.hist-page {
  padding-bottom: calc(24px + env(safe-area-inset-bottom));
}
.hist-hero {
  padding: 16px;
  border-radius: var(--radius-xl);
  border: 1px solid var(--color-outline);
  background: #fffdf8;
}
.hist-hero-top {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.hist-today-value {
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
}
.hist-today-unit {
  font-size: var(--text-sm);
  color: var(--color-on-surface-variant);
}
.hist-today-label {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.hist-goal-track {
  height: 6px;
  margin-top: 12px;
  border-radius: 999px;
  background: var(--color-surface-container);
  overflow: hidden;
}
.hist-goal-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
  transition: width 0.4s var(--ease-standard);
}
.hist-goal-note {
  margin: 8px 0 0;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.hist-mini {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px 0;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}
@media (max-width: 420px) {
  .hist-mini { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 0; }
}
.hist-mini-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.hist-mini-cell strong {
  font-size: var(--text-lg);
  line-height: 1.1;
}
.hist-mini-cell span {
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.hist-days {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 18px;
}
.hist-day {
  position: relative;
  padding-left: 14px;
}
.hist-day::before {
  content: "";
  position: absolute;
  top: 6px;
  bottom: -16px;
  left: 0;
  width: 2px;
  border-radius: 999px;
  background: var(--color-surface-container);
}
.hist-day:last-child::before {
  bottom: 0;
}
.hist-day-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
}
.hist-day-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}
.hist-day-meta {
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.hist-day-card {
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-lg);
  background: #fffdf8;
  overflow: hidden;
}
.hist-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.hist-row:last-child {
  border-bottom: 0;
}
.hist-row:active {
  background: var(--color-surface-container);
}
.hist-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.hist-row-name {
  font-size: var(--text-sm);
  font-weight: 600;
}
.hist-row-chapter {
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.hist-row-time {
  flex: none;
  font-size: var(--text-xs);
  color: var(--color-primary);
}
.hist-heat {
  margin-bottom: 14px;
  padding: 14px 14px 10px;
  border-radius: var(--radius-xl);
  border: 1px solid var(--color-outline);
  background: #fffdf8;
}
.hist-heat-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.hist-heat-head h2 {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}
.hist-heat-head .muted {
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.heat-scroll {
  overflow-x: auto;
  padding-bottom: 2px;
  /* 53 列比手机宽得多，靠横向滚动看完整年，不要压缩格子（12px 已是可点/可辨的下限）。 */
  scrollbar-width: none;
}
.heat-scroll::-webkit-scrollbar {
  display: none;
}
.heat-inner {
  position: relative;
}
.heat-months {
  position: relative;
  height: 14px;
  font-size: 10px;
  color: var(--color-on-surface-variant);
}
.heat-months span {
  position: absolute;
  top: 0;
  white-space: nowrap;
}
.heat-grid {
  display: flex;
  gap: 3px;
}
.heat-col {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.heat-cell {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: var(--color-surface-container);
}
.heat-cell.lv1 {
  background: color-mix(in srgb, var(--color-primary) 22%, transparent);
}
.heat-cell.lv2 {
  background: color-mix(in srgb, var(--color-primary) 42%, transparent);
}
.heat-cell.lv3 {
  background: color-mix(in srgb, var(--color-primary) 68%, transparent);
}
.heat-cell.lv4 {
  background: var(--color-primary);
}
.heat-cell.is-future {
  background: transparent;
}
.heat-legend {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 8px;
  font-size: 10px;
  color: var(--color-on-surface-variant);
}
</style>
