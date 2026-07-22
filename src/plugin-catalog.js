import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { readPluginHeader } from "../../rix/src/index.js";
import { createNotebookBundledPluginCatalog } from "./bundled-plugin-catalog.js";
export { clonePluginCatalog } from "./plugin-catalog-core.js";

function joinPath(...parts) {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

function pluginKind(name) {
  if (name.endsWith(".plugin.rix")) return "rix";
  if (name.endsWith(".plugin.rix.js")) return "host";
  return null;
}

async function scanPluginDirectory(catalog, directory) {
  for (const entry of await readDir(directory)) {
    const path = joinPath(directory, entry.name);
    if (entry.isDirectory) {
      await scanPluginDirectory(catalog, path);
      continue;
    }
    if (!entry.isFile) continue;
    const kind = pluginKind(entry.name);
    if (!kind) continue;
    const source = await readTextFile(path);
    const metadata = readPluginHeader(source, path);
    catalog.addMetadata(metadata, {
      sourcePath: path,
      source: kind === "rix" ? source : null,
      kind,
    });
  }
}

/**
 * Create the catalog available to an opened desktop project. The project
 * `plugins/` tree is read for metadata and RiX source only. A discovered JS
 * plugin deliberately has no installer: executing it requires an explicit
 * app-bundle approval in bundled-plugin-catalog.js.
 */
export async function createProjectPluginCatalog(projectDirectory) {
  const catalog = createNotebookBundledPluginCatalog();
  const pluginDirectory = joinPath(projectDirectory, "plugins");
  if (await exists(pluginDirectory)) await scanPluginDirectory(catalog, pluginDirectory);
  return catalog;
}

export function configuredPluginIds(project, notebook) {
  return [...new Set([...(project?.plugins || []), ...(notebook?.plugins || [])])];
}
