import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/shelf" },
    { path: "/shelf", name: "shelf", component: () => import("./pages/ShelfPage.vue"), meta: { tab: true } },
    { path: "/explore", name: "explore", component: () => import("./pages/ExplorePage.vue"), meta: { tab: true } },
    { path: "/search", name: "search", component: () => import("./pages/SearchPage.vue"), meta: { tab: true } },
    { path: "/sources", name: "sources", component: () => import("./pages/SourcesPage.vue") },
    { path: "/me", name: "me", component: () => import("./pages/MePage.vue"), meta: { tab: true } },
    { path: "/history", name: "history", component: () => import("./pages/HistoryPage.vue"), meta: { tab: true } },
    { path: "/notes", name: "notes", component: () => import("./pages/NotesPage.vue"), meta: { tab: true } },
    { path: "/lists", name: "lists", component: () => import("./pages/BookListsPage.vue"), meta: { tab: true } },
    { path: "/book/:id", name: "book", component: () => import("./pages/BookPage.vue"), meta: { tab: true } },
    { path: "/sources/organize", name: "organize", component: () => import("./pages/OrganizePage.vue"), meta: { tab: true } },
    { path: "/sources/:id/debug", name: "debug", component: () => import("./pages/DebugPage.vue") },
    { path: "/read/:id/:index", name: "read", component: () => import("./pages/ReaderPage.vue") },
    { path: "/subscriptions", name: "subscriptions", component: () => import("./pages/SubscriptionsPage.vue"), meta: { tab: true } },
    { path: "/replace", name: "replace", component: () => import("./pages/ReplacePage.vue"), meta: { tab: true } },
    { path: "/settings", name: "settings", component: () => import("./pages/SettingsPage.vue"), meta: { tab: true } },
  ],
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition;
    return { top: 0 };
  },
});
