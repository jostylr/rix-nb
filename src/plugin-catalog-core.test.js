import { expect, test } from "bun:test";
import { createNotebookBundledPluginCatalog } from "./bundled-plugin-catalog.js";
import { pluginTutorialIdFromPath } from "./plugin-catalog-core.js";

test("the notebook bundles approved Phase 1 output plugins", () => {
  const ids = createNotebookBundledPluginCatalog().list().map(({ id }) => id);
  expect(ids).toContain("float");
  expect(ids).toContain("draw");
  expect(ids).toContain("plot");
});

test("plugin tutorial paths select their lowercase plugin id", () => {
  expect(pluginTutorialIdFromPath("/repo/rix/plugins/draw/tutorial.md")).toBe("draw");
  expect(pluginTutorialIdFromPath("C:\\repo\\rix\\plugins\\float\\tutorial.md")).toBe("float");
  expect(pluginTutorialIdFromPath("/repo/rix/plugins/oracle/README.md")).toBeNull();
  expect(pluginTutorialIdFromPath("/repo/rix/tutorial.md")).toBeNull();
});

test("the desktop shell exposes the plugin rescan development workflow", async () => {
  const shell = await Bun.file(new URL("../index.html", import.meta.url)).text();
  const main = await Bun.file(new URL("./main.js", import.meta.url)).text();
  expect(shell).toContain('id="reload-plugins"');
  expect(main).toContain("async function reloadPluginsAndRun()");
  expect(main).toContain("pluginTutorialIdFromPath(activeDocument.path)");
  expect(main).toContain("await refreshPluginCatalog();");
});
