import { expect, test } from "bun:test";
import { createNotebookBundledPluginCatalog } from "./bundled-plugin-catalog.js";
import { configuredPluginDirectories, pluginTutorialIdFromPath, requestedPluginIds } from "./plugin-catalog-core.js";

test("the notebook bundles approved Phase 1 output plugins", () => {
  const ids = createNotebookBundledPluginCatalog().list().map(({ id }) => id);
  expect(ids).toContain("float");
  expect(ids).toContain("algebra");
  expect(ids).toContain("draw");
  expect(ids).toContain("plot");
  expect(ids).toContain("geometry");
  expect(ids).toContain("data");
  expect(ids).toContain("document");
  expect(ids).toContain("terminal-ascii");
  expect(ids).toContain("csv");
});

test("plugin tutorial paths select their lowercase plugin id", () => {
  expect(pluginTutorialIdFromPath("/repo/rix/plugins/draw/tutorial.md")).toBe("draw");
  expect(pluginTutorialIdFromPath("C:\\repo\\rix\\plugins\\float\\tutorial.md")).toBe("float");
  expect(pluginTutorialIdFromPath("/repo/rix/plugins/oracle/README.md")).toBeNull();
  expect(pluginTutorialIdFromPath("/repo/rix/tutorial.md")).toBeNull();
});

test("plugin roots combine settings with portable project and notebook paths", () => {
  expect(configuredPluginDirectories(
    { directory: "/work/project", pluginDirectories: ["shared", "/opt/rix"] },
    { path: "/work/project/Analysis/notebook.toml", pluginDirectories: ["lesson-plugins"] },
    { pluginDirectories: ["/Users/ada/.rix/plugins"] },
  )).toEqual([
    "/Users/ada/.rix/plugins",
    "/work/project/plugins",
    "/work/project/shared",
    "/opt/rix",
    "/work/project/Analysis/lesson-plugins",
  ]);
});

test("static Plugin.Load calls are found before a notebook starts evaluating", () => {
  expect(requestedPluginIds('.Plugin.Load("plot"); .Plugin(\'stats\')', ["float"])).toEqual(["float", "plot", "stats"]);
});

test("the desktop shell exposes the plugin rescan development workflow", async () => {
  const shell = await Bun.file(new URL("../shells/native.html", import.meta.url)).text();
  const main = await Bun.file(new URL("./main.js", import.meta.url)).text();
  expect(shell).toContain('id="reload-plugins"');
  expect(main).toContain("async function reloadPluginsAndRun()");
  expect(main).toContain("pluginTutorialIdFromPath(activeDocument.path)");
  expect(main).toContain("await refreshPluginCatalog();");
});
