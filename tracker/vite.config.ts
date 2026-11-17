import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "PLVSiteMonitor",
      formats: ["es", "iife"],
      fileName: (format) =>
        format === "es" ? "plv-tracker.js" : "plv-tracker.iife.js",
    },
    sourcemap: true,
    minify: "esbuild",
  },
});
