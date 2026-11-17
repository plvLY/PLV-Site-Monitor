import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),

  // 直接将现有 SDK dist 目录作为静态资源目录
  publicDir: fileURLToPath(new URL("../dist", import.meta.url)),

  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
});