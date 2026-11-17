import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      "@legado/engine": fileURLToPath(new URL("./packages/engine/src/index.ts", import.meta.url)),
    },
  },
});
