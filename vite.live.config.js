import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  esbuild: {
    keepNames: true,
  },
  resolve: {
    dedupe: [
      "@codemirror/language",
      "@lezer/common",
      "@lezer/highlight",
      "@lezer/lr",
      "@ratmath/core",
    ],
    alias: {
      "@ratmath/core": fileURLToPath(new URL("../packages/core/index.js", import.meta.url)),
      "node:fs": fileURLToPath(new URL("./src/browser/node-only.js", import.meta.url)),
      "node:module": fileURLToPath(new URL("./src/browser/node-only.js", import.meta.url)),
      "node:path": fileURLToPath(new URL("./src/browser/node-only.js", import.meta.url)),
    },
  },
  build: {
    outDir: "public/rix-live",
    emptyOutDir: false,
    minify: "esbuild",
    lib: {
      entry: "src/live-runtime.js",
      formats: ["es"],
      fileName: () => "rix-live.js",
    },
  },
});
