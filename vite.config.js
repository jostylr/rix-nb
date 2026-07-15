import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@ratmath/core": fileURLToPath(new URL("../packages/core/index.js", import.meta.url)),
      "node:fs": fileURLToPath(new URL("./src/browser/node-only.js", import.meta.url)),
      "node:module": fileURLToPath(new URL("./src/browser/node-only.js", import.meta.url)),
      "node:path": fileURLToPath(new URL("./src/browser/node-only.js", import.meta.url)),
    },
  },
});
