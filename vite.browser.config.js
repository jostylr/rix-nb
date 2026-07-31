import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./.docshell-build/browser", import.meta.url)),
  publicDir: false,
  build: { outDir: fileURLToPath(new URL("./dist-web", import.meta.url)), emptyOutDir: true },
  resolve: { dedupe: ["@codemirror/language", "@lezer/common", "@lezer/highlight", "@lezer/lr"], alias: { "@ratmath/core": fileURLToPath(new URL("../packages/core/index.js", import.meta.url)), "node:fs": fileURLToPath(new URL("./docshell/src/browser/node-only.js", import.meta.url)), "node:module": fileURLToPath(new URL("./docshell/src/browser/node-only.js", import.meta.url)), "node:path": fileURLToPath(new URL("./docshell/src/browser/node-only.js", import.meta.url)) } },
});
