<script setup lang="ts">
withDefaults(defineProps<{ name: ReaderIconName; size?: number; strokeWidth?: number }>(), {
  size: 20,
  strokeWidth: 1.7,
});

type ReaderIconName =
  | "back"
  | "catalog"
  | "settings"
  | "bookmark"
  | "highlight"
  | "volume"
  | "volume-off"
  | "play"
  | "pause"
  | "top"
  | "bottom"
  | "home"
  | "swap"
  | "search"
  | "more"
  | "prev"
  | "next"
  | "close";
</script>

<template>
  <svg
    class="reader-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <template v-if="name === 'back'">
      <path d="M15 5l-7 7 7 7" />
    </template>
    <template v-else-if="name === 'catalog'">
      <path d="M4 6.5h16M4 12h16M4 17.5h10" />
    </template>
    <template v-else-if="name === 'settings'">
      <path d="M4 7.5h7M16.5 7.5H20M4 16.5h3.5M13 16.5h7" />
      <circle cx="13.7" cy="7.5" r="2.2" />
      <circle cx="10.3" cy="16.5" r="2.2" />
    </template>
    <template v-else-if="name === 'bookmark'">
      <path d="M6.5 4.5h11a1 1 0 0 1 1 1v14l-6.5-4.2L5.5 19.5v-14a1 1 0 0 1 1-1z" />
    </template>
    <template v-else-if="name === 'highlight'">
      <path d="M4.5 19.5h4l10-10-4-4-10 10z" />
      <path d="M13.2 6.3l4 4" />
      <path d="M6.5 17.5l-2 2" />
    </template>
    <template v-else-if="name === 'volume'">
      <path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z" />
      <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />
      <path d="M18 6.8a7.4 7.4 0 0 1 0 10.4" />
    </template>
    <template v-else-if="name === 'volume-off'">
      <path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z" />
      <path d="M15.5 10l4 4M19.5 10l-4 4" />
    </template>
    <template v-else-if="name === 'play'">
      <path d="M8.5 5.5l9.5 6.5-9.5 6.5z" />
    </template>
    <template v-else-if="name === 'pause'">
      <path d="M9.5 5.5v13M14.5 5.5v13" />
    </template>
    <template v-else-if="name === 'top'">
      <path d="M12 19V6.5M6.5 11.5L12 6l5.5 5.5" />
    </template>
    <template v-else-if="name === 'bottom'">
      <path d="M12 5v12.5M6.5 12.5L12 18l5.5-5.5" />
    </template>
    <template v-else-if="name === 'more'">
      <circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="10.8" cy="10.8" r="5.8" />
      <path d="M15.2 15.2l4 4" />
    </template>
    <template v-else-if="name === 'swap'">
      <path d="M4 8h13M14 4.8L17.2 8 14 11.2" />
      <path d="M20 16H7M10 12.8L6.8 16 10 19.2" />
    </template>
    <template v-else-if="name === 'home'">
      <path d="M4 11.2L12 4.5l8 6.7" />
      <path d="M6.4 10v9.5h11.2V10" />
    </template>
    <template v-else-if="name === 'prev'">
      <path d="M14 6l-6 6 6 6" />
    </template>
    <template v-else-if="name === 'next'">
      <path d="M10 6l6 6-6 6" />
    </template>
    <template v-else-if="name === 'close'">
      <path d="M6 6l12 12M18 6L6 18" />
    </template>
  </svg>
</template>

<style scoped>
.reader-icon {
  display: block;
  flex: 0 0 auto;
}
</style>
