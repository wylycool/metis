/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // 阻止 Vite 在非 Tauri 环境打开浏览器
  // 并配置 dev server 用于 Tauri 开发
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // 监听 src 目录变化
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    setupFiles: ["src/test/setup.ts"],
  },
});
