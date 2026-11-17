<script setup lang="ts">
/**
 * 搜索导航条：关掉搜索面板之后还能「上一处 / 下一处」。
 *
 * 面板本身会盖住大半个屏幕，找到命中就关掉它；留一条细条在底部，
 * 不挡正文，又能继续翻命中。
 */
withDefaults(
  defineProps<{ count: number; position: number; scope: "chapter" | "book"; lifted?: boolean }>(),
  { lifted: false },
);

const emit = defineEmits<{ prev: []; next: []; close: [] }>();
</script>

<template>
  <div class="search-nav" :class="{ lifted }">
    <span class="search-nav-count">{{ position || 1 }} / {{ count }}</span>
    <span class="search-nav-scope">{{ scope === "chapter" ? "本章" : "全书" }}</span>
    <button class="search-nav-btn" type="button" aria-label="上一处" @click="emit('prev')">‹</button>
    <button class="search-nav-btn" type="button" aria-label="下一处" @click="emit('next')">›</button>
    <button class="search-nav-btn" type="button" aria-label="关闭搜索" @click="emit('close')">✕</button>
  </div>
</template>
