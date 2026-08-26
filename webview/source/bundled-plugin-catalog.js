/**
 * Plugins intentionally shipped in the RiX Notebook application.
 *
 * These imports are static so Vite includes their trusted JavaScript in the
 * application bundle. Project plugins are added separately by
 * plugin-catalog.js and do not receive this approval merely by being found.
 */
import { PluginCatalog } from "../../../rix/src/index.js";
import { installBundledPlugins } from "../../../rix/plugins/bundled.js";

export function createNotebookBundledPluginCatalog() {
  const catalog = new PluginCatalog();
  installBundledPlugins(catalog);
  return catalog;
}
