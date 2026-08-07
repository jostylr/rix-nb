import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import browserConfig from "../vite.browser.config.js";
import nativeConfig from "../vite.config.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const servers = [];

beforeAll(() => {
  const result = Bun.spawnSync(["bun", "scripts/extract-docshell.mjs"], { cwd: root });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
});

afterAll(async () => {
  for (const server of servers) await server.close();
});

test("generated DocShell entrypoints resolve in both Vite development roots", async () => {
  for (const host of ["browser", "native"]) {
    const configFile = resolve(root, host === "browser" ? "vite.browser.config.js" : "vite.config.js");
    const server = await createServer({ configFile, server: { middlewareMode: true }, logLevel: "silent" });
    servers.push(server);
    const html = await readFile(resolve(root, `.docshell-build/${host}/index.html`), "utf8");
    const source = html.match(/<script type="module" src="([^"]+)"/u)?.[1];
    expect(source).toBe("./entrypoint.js");
    expect(await server.transformRequest("/entrypoint.js")).not.toBeNull();
  }
});

test("application bundles deduplicate exact-value classes", () => {
  expect(browserConfig.resolve.dedupe).toContain("@ratmath/core");
  expect(nativeConfig.resolve.dedupe).toContain("@ratmath/core");
  expect(browserConfig.esbuild.keepNames).toBe(true);
  expect(nativeConfig.esbuild.keepNames).toBe(true);
});

test("every interactive notebook host mounts the shared widget protocol", async () => {
  for (const relativePath of [
    "webview/source/main.js",
    "webview/source/live-runtime.js",
    "webview/source/notebook-web/workbench.js",
  ]) {
    expect(await readFile(resolve(root, relativePath), "utf8"), relativePath).toContain("mountOutputWidgets");
  }
});
