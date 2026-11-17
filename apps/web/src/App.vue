<template>
  <div class="app">
    <aside v-if="route.meta.tab" class="side-nav">
      <div class="brand">
        <span class="brand-mark">阅</span>
        <div>
          <p class="brand-title">legado-web</p>
          <p class="brand-sub">自托管 Web 阅读</p>
        </div>
      </div>
      <nav class="side-links">
        <router-link
          v-for="tab in tabs"
          :key="tab.path"
          :to="tab.path"
          class="side-link"
          :class="{ active: isActive(tab.path) }"
        >
          <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path :d="tab.icon" fill="currentColor" />
          </svg>
          <span>{{ tab.label }}</span>
        </router-link>
        <div class="side-divider"></div>
        <router-link
          v-for="link in more"
          :key="link.path"
          :to="link.path"
          class="side-link"
          :class="{ active: isActive(link.path) }"
        >
          <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path :d="link.icon" fill="currentColor" />
          </svg>
          <span>{{ link.label }}</span>
        </router-link>
      </nav>
    </aside>
    <main class="app-main">
      <router-view />
    </main>
    <div class="toast-host" aria-live="polite">
      <div v-for="item in toasts" :key="item.id" class="toast" :class="item.kind">{{ item.text }}</div>
    </div>
    <nav v-if="route.meta.tab" class="bottom-nav">
      <router-link
        v-for="tab in tabs"
        :key="tab.path"
        :to="tab.path"
        class="nav-item"
        :class="{ active: isActive(tab.path) }"
      >
        <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path :d="tab.icon" fill="currentColor" />
        </svg>
        <span class="nav-label">{{ tab.label }}</span>
      </router-link>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from "vue-router";
import { toasts } from "./lib/toast";

const route = useRoute();
const tabs = [
  {
    path: "/shelf",
    label: "书架",
    icon: "M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM6 4h5v8l-2.5-1.5L6 12V4z",
  },
  {
    path: "/explore",
    label: "发现",
    icon: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm3.5 6.5-2.1 4.9-4.9 2.1 2.1-4.9 4.9-2.1z",
  },
  {
    path: "/search",
    label: "搜索",
    icon: "M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zM10 14a4 4 0 1 1 0-8 4 4 0 0 1 0 8z",
  },
  {
    path: "/me",
    label: "我的",
    icon: "M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z",
  },
];

const more = [
  {
    path: "/sources",
    label: "书源",
    icon: "M4 5h16v3H4zM4 10.5h16v3H4zM4 16h10v3H4z",
  },
  {
    path: "/lists",
    label: "书单",
    icon: "M4 3h4v18H4zM10 3h4v18h-4zM16 3h4v18h-4z",
  },
  {
    path: "/subscriptions",
    label: "订阅源",
    icon: "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3H4V6zm0 5h16v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7zm3 4h6v2H7v-2z",
  },
  {
    path: "/replace",
    label: "替换规则",
    icon: "M3 7h11l-2.5-2.5L13 3l5 5-5 5-1.5-1.5L14 9H3V7zm18 10H10l2.5 2.5L11 21l-5-5 5-5 1.5 1.5L10 15h11v2z",
  },
  {
    path: "/settings",
    label: "设置",
    icon: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9.4 4.9.1-1.4-.1-1.4 1.7-1.3-1.6-2.8-2 .7a7.6 7.6 0 0 0-2.4-1.4L16.6 3h-3.2l-.5 2.1a7.6 7.6 0 0 0-2.4 1.4l-2-.7-1.6 2.8L8.6 9.9 8.5 11.3l.1 1.4-1.7 1.3 1.6 2.8 2-.7c.7.6 1.5 1.1 2.4 1.4l.5 2.1h3.2l.5-2.1c.9-.3 1.7-.8 2.4-1.4l2 .7 1.6-2.8-1.7-1.3z",
  },
];

function isActive(path: string): boolean {
  return route.path === path || route.path.startsWith(path + "/");
}
</script>

<style scoped>
.nav-icon {
  width: 22px;
  height: 22px;
}
</style>
