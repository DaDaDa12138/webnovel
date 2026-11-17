import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "icons/icon-192.png", "icons/icon-512.png"],
      manifest: {
        name: "阅 · legado-web",
        short_name: "阅",
        description: "自托管的 Web 阅读服务：书架、搜索、发现与沉浸式阅读器。",
        lang: "zh-CN",
        start_url: "/shelf",
        scope: "/",
        display: "standalone",
        background_color: "#faf8f3",
        theme_color: "#4e6b57",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/healthz/, /^\/opds(\/|$)/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /\/api\/books\/[^/]+\/chapters\/[^/]+\/content/,
            handler: "NetworkFirst",
            options: {
              cacheName: "chapter-content",
              networkTimeoutSeconds: 4,
              // 整本离线（lib/book-offline.ts）会把章节写进同一个缓存，
              // 80 条只够随手翻几章，下载一本 1000 章的书会被反复挤掉。
              expiration: { maxEntries: 4000, maxAgeSeconds: 30 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/api\/books\/[^/]+\/chapters(\?.*)?$/,
            handler: "NetworkFirst",
            options: {
              cacheName: "book-toc",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 40, maxAgeSeconds: 7 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/api\/books\/[^/]+(\?.*)?$/,
            handler: "NetworkFirst",
            options: {
              cacheName: "book-meta",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 60, maxAgeSeconds: 7 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/api\/books(\?.*)?$/,
            handler: "NetworkFirst",
            options: {
              cacheName: "shelf",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 10, maxAgeSeconds: 3 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // 本地导入 EPUB 的插图是内容寻址的，地址不变、内容不变，直接长缓存。
            urlPattern: /\/api\/local-images\//,
            handler: "CacheFirst",
            options: {
              cacheName: "local-images",
              expiration: { maxEntries: 1200, maxAgeSeconds: 30 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/api\/img/,
            handler: "CacheFirst",
            options: {
              cacheName: "covers",
              // 封面之外这里还缓存正文插图：一本图多的书几百张，240 条会被反复挤掉。
              expiration: { maxEntries: 1200, maxAgeSeconds: 30 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:18080",
      "/healthz": "http://127.0.0.1:18080",
      "/opds": "http://127.0.0.1:18080",
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1200,
  },
});
