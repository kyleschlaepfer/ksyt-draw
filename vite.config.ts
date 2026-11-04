/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { resolve } from "node:path";

// Two pages: the playground at / and the embed at /embed/.
export default defineConfig({
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        play: resolve(__dirname, "index.html"),
        embed: resolve(__dirname, "embed/index.html"),
      },
    },
  },
  test: { include: ["test/**/*.test.ts"] },
});
