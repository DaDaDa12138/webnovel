<script setup lang="ts">
import ReaderIcon from "./ReaderIcon.vue";

withDefaults(
  defineProps<{
    bookName: string;
    chapterTitle: string;
    percent: number;
    offline?: boolean;
    speaking?: boolean;
    autoPlaying?: boolean;
    noteCount?: number;
    /** 断网期间还没补传的写入条数；>0 时离线徽标会带上「待同步 N」。 */
    pending?: number;
    /** 当前这本书来自哪个书源：顶栏第二行右侧的小标签，换源后立刻跟着变。 */
    source?: string;
  }>(),
  { offline: false, speaking: false, autoPlaying: false, noteCount: 0, pending: 0, source: "" },
);

const emit = defineEmits<{
  (event: "back"): void;
  (event: "catalog"): void;
  (event: "settings"): void;
  (event: "marks"): void;
  (event: "notes"): void;
  (event: "speech"): void;
  (event: "swap"): void;
  (event: "search"): void;
  (event: "more"): void;
  (event: "auto"): void;
  (event: "top"): void;
  (event: "bottom"): void;
  (event: "shelf"): void;
}>();
</script>

<template>
  <header class="reader-top">
    <button class="icon-btn" type="button" aria-label="返回书架" @click="emit('back')">
      <ReaderIcon name="back" />
    </button>
    <button class="reader-title" type="button" aria-label="打开目录" @click="emit('catalog')">
      <strong>{{ bookName }}</strong>
      <span class="reader-title-sub">
        <em class="reader-chapter">{{ chapterTitle }}</em>
        <em v-if="source" class="reader-source">{{ source }}</em>
      </span>
    </button>
    <span v-if="offline || pending" class="reader-offline" :title="pending ? '断网期间的阅读记录会在联网后补传' : '当前处于离线状态'">
      {{ offline ? "离线" : "待同步" }}<template v-if="pending"> · {{ pending }}</template>
    </span>
    <button
      class="icon-btn secondary"
      type="button"
      :class="{ active: autoPlaying }"
      :aria-pressed="autoPlaying"
      aria-label="自动阅读"
      @click="emit('auto')"
    >
      <ReaderIcon :name="autoPlaying ? 'pause' : 'play'" />
    </button>
    <button
      class="icon-btn secondary"
      type="button"
      :class="{ active: speaking }"
      :aria-pressed="speaking"
      aria-label="朗读"
      @click="emit('speech')"
    >
      <ReaderIcon name="volume" />
    </button>
    <button class="icon-btn secondary" type="button" aria-label="换源" @click="emit('swap')">
      <ReaderIcon name="swap" />
    </button>
    <button class="icon-btn secondary" type="button" aria-label="搜索" @click="emit('search')">
      <ReaderIcon name="search" />
    </button>
    <button class="icon-btn secondary" type="button" aria-label="书签" @click="emit('marks')">
      <ReaderIcon name="bookmark" />
    </button>
    <button class="icon-btn secondary" type="button" :aria-label="'划线与笔记（' + noteCount + ' 条）'" @click="emit('notes')">
      <ReaderIcon name="highlight" />
      <span v-if="noteCount" class="reader-badge">{{ noteCount > 99 ? "99+" : noteCount }}</span>
    </button>
    <button class="icon-btn more-btn" type="button" aria-label="更多操作" @click="emit('more')">
      <ReaderIcon name="more" />
    </button>
    <button class="icon-btn catalog-btn" type="button" aria-label="目录" @click="emit('catalog')">
      <ReaderIcon name="catalog" />
    </button>
    <button class="icon-btn" type="button" aria-label="阅读设置" @click="emit('settings')">
      <ReaderIcon name="settings" />
    </button>
    <div class="reader-top-progress" :style="{ width: Math.min(100, Math.max(0, percent)) + '%' }" />
  </header>

  <nav class="reader-rail" aria-label="阅读工具栏">
    <button class="icon-btn" type="button" aria-label="目录" @click="emit('catalog')">
      <ReaderIcon name="catalog" />
    </button>
    <button class="icon-btn" type="button" aria-label="阅读设置" @click="emit('settings')">
      <ReaderIcon name="settings" />
    </button>
    <button class="icon-btn" type="button" aria-label="书签" @click="emit('marks')">
      <ReaderIcon name="bookmark" />
    </button>
    <button class="icon-btn" type="button" aria-label="划线与笔记" @click="emit('notes')">
      <ReaderIcon name="highlight" />
      <span v-if="noteCount" class="reader-badge">{{ noteCount > 99 ? "99+" : noteCount }}</span>
    </button>
    <button
      class="icon-btn"
      type="button"
      :class="{ active: autoPlaying }"
      aria-label="自动阅读"
      @click="emit('auto')"
    >
      <ReaderIcon :name="autoPlaying ? 'pause' : 'play'" />
    </button>
    <button
      class="icon-btn"
      type="button"
      :class="{ active: speaking }"
      aria-label="朗读"
      @click="emit('speech')"
    >
      <ReaderIcon name="volume" />
    </button>
    <button class="icon-btn" type="button" aria-label="换源" @click="emit('swap')">
      <ReaderIcon name="swap" />
    </button>
    <button class="icon-btn" type="button" aria-label="搜索" @click="emit('search')">
      <ReaderIcon name="search" />
    </button>
    <div class="reader-rail-sep" />
    <button class="icon-btn" type="button" aria-label="回到本章开头" @click="emit('top')">
      <ReaderIcon name="top" />
    </button>
    <button class="icon-btn" type="button" aria-label="跳到本章末尾" @click="emit('bottom')">
      <ReaderIcon name="bottom" />
    </button>
    <div class="reader-rail-sep" />
    <button class="icon-btn" type="button" aria-label="返回书架" @click="emit('shelf')">
      <ReaderIcon name="home" />
    </button>
  </nav>
</template>
