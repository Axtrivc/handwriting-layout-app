import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 桌面端通过 file:// 加载时需要相对路径
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@hw-layout/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
