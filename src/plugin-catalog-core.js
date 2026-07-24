import { PluginCatalog } from "../../rix/src/index.js";

/** A catalog is stateful after loading, so every notebook run receives a fresh copy. */
export function clonePluginCatalog(template) {
  const catalog = new PluginCatalog();
  for (const entry of template.list()) {
    catalog.addMetadata(entry, { sourcePath: entry.sourcePath, source: entry.source, kind: entry.kind });
  }
  for (const [id, installer] of template.installers) catalog.registerInstaller(id, installer);
  return catalog;
}

/**
 * Recognize a first-party or project plugin tutorial without assuming a
 * particular repository root. Opening that Markdown source in the notebook can
 * then opt into the matching catalog entry for live exploration.
 */
export function pluginTutorialIdFromPath(path) {
  const normalized = String(path || "").replaceAll("\\", "/");
  return normalized.match(/(?:^|\/)plugins\/([^/]+)\/tutorial\.md$/i)?.[1] || null;
}
