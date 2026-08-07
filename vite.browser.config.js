import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { notebookManualChunks } from "./vite.shared.js";

export default defineConfig({
  root: fileURLToPath(new URL("./.docshell-build/browser", import.meta.url)),
  publicDir: false,
  esbuild: { keepNames: true },
  build: {
    outDir: fileURLToPath(new URL("./dist-web", import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 650,
    rollupOptions: { output: { manualChunks: notebookManualChunks } },
  },
  resolve: { dedupe: ["@codemirror/language", "@lezer/common", "@lezer/highlight", "@lezer/lr", "@ratmath/core"], alias: { "@ratmath/core": fileURLToPath(new URL("../packages/core/index.js", import.meta.url)), "node:fs": fileURLToPath(new URL("./docshell/src/browser/node-only.js", import.meta.url)), "node:module": fileURLToPath(new URL("./docshell/src/browser/node-only.js", import.meta.url)), "node:path": fileURLToPath(new URL("./docshell/src/browser/node-only.js", import.meta.url)) } },
});
