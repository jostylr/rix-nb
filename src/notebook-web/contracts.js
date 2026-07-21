/**
 * Boundaries for the reusable notebook web surface.
 *
 * These contracts deliberately use plain JavaScript objects rather than a
 * Tauri type.  A desktop application, a static web site, or a hosted editor
 * can provide the same small set of capabilities without the web surface
 * knowing where bytes, dialogs, or project state originate.
 */

export function assertNotebookEngine(engine) {
  const required = ["parseDocument", "executeDocument", "validate", "getCompletions"];
  for (const name of required) {
    if (typeof engine?.[name] !== "function") {
      throw new TypeError(`Notebook engine must implement ${name}()`);
    }
  }
  return engine;
}

export function assertDocumentStore(store) {
  const required = ["readText", "writeText", "exists", "readDirectory"];
  for (const name of required) {
    if (typeof store?.[name] !== "function") {
      throw new TypeError(`Document store must implement ${name}()`);
    }
  }
  return store;
}

export function createNotebookHost(callbacks = {}) {
  return {
    onDocumentChange: callbacks.onDocumentChange || (() => {}),
    onRun: callbacks.onRun || (() => {}),
    onError: callbacks.onError || (() => {}),
    onStatus: callbacks.onStatus || (() => {}),
    resolveAsset: callbacks.resolveAsset || ((source) => source),
  };
}
