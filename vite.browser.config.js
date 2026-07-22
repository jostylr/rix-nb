import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist-web", rollupOptions: { input: fileURLToPath(new URL("./web.html", import.meta.url)) } },
  resolve: { dedupe: ["@codemirror/language", "@lezer/common", "@lezer/highlight", "@lezer/lr"], alias: { "@ratmath/core": fileURLToPath(new URL("../packages/core/index.js", import.meta.url)), "node:fs": fileURLToPath(new URL("./src/browser/node-only.js", import.meta.url)), "node:module": fileURLToPath(new URL("./src/browser/node-only.js", import.meta.url)), "node:path": fileURLToPath(new URL("./src/browser/node-only.js", import.meta.url)) } },
});
