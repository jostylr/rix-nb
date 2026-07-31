import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./.docshell-build/native", import.meta.url)),
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  resolve: {
    // RiX's shared editor package is imported from the sibling repository.
    // Deduping these parser/runtime packages keeps mounted Lezer trees on the
    // same class instances as CodeMirror's Markdown parser.
    dedupe: [
      "@codemirror/language",
      "@lezer/common",
      "@lezer/highlight",
      "@lezer/lr",
    ],
    alias: {
      "@ratmath/core": fileURLToPath(new URL("../packages/core/index.js", import.meta.url)),
      "node:fs": fileURLToPath(new URL("./docshell/src/browser/node-only.js", import.meta.url)),
      "node:module": fileURLToPath(new URL("./docshell/src/browser/node-only.js", import.meta.url)),
      "node:path": fileURLToPath(new URL("./docshell/src/browser/node-only.js", import.meta.url)),
    },
  },
});
