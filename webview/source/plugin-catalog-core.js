import { PluginCatalog } from "../../../rix/src/index.js";

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

function isAbsolutePath(path) {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function joinPath(...parts) {
  return parts.filter(Boolean).join("/").replace(/\/{2,}/g, "/");
}

function dirname(path) {
  return path.slice(0, path.lastIndexOf("/")) || ".";
}

/** Resolve configured roots without making project manifests machine-specific. */
export function configuredPluginDirectories(project, notebook, settings = {}) {
  const roots = [];
  const add = (directory, base) => {
    if (typeof directory !== "string" || !directory.trim()) return;
    const normalized = directory.trim().replaceAll("\\", "/");
    roots.push(isAbsolutePath(normalized) ? normalized : joinPath(base, normalized));
  };
  for (const directory of settings.pluginDirectories || []) add(directory, "");
  if (!project?.directory) return [...new Set(roots)];
  add(joinPath(project.directory, "plugins"), "");
  for (const directory of project.pluginDirectories || []) add(directory, project.directory);
  for (const directory of notebook?.pluginDirectories || []) add(directory, dirname(notebook.path));
  return [...new Set(roots)];
}

/** Static plugin ids that can be approved before synchronous RiX evaluation. */
export function requestedPluginIds(source, configured = []) {
  const ids = new Set(configured);
  const expression = /\.Plugin(?:\.Load)?\s*\(\s*(["'])([^"']+)\1/g;
  let match;
  while ((match = expression.exec(String(source))) !== null) ids.add(match[2]);
  return [...ids];
}
