# RiX Notebook Web Surface

`notebook-web/` is the browser-only core of RiX Notebook. It has no Tauri,
filesystem, dialog, Git, or macOS imports.

* `contracts.js` defines the narrow `NotebookEngine`, `DocumentStore`, and
  host callback boundaries.
* `rix-engine.js` is the RiX implementation of `NotebookEngine`: it parses
  Markdown/RiX documents, performs linear evaluation, exposes sliders, and
  produces static Markdown output.
* `workbench.js` mounts a standalone CodeMirror editor, result list, and
  Markdown/KaTeX preview in any browser DOM.

The native app is a consumer, not a prerequisite: it provides a Tauri
`DocumentStore` from `../tauri-document-store.js`, then adds project/sidebar,
menus, dialogs, recents, Git, and export destination UI around this web core.
For a hosted version, replace that store and callbacks with HTTP-backed
implementations; no engine or workbench changes are required.

```js
import { createRixNotebookEngine } from "./notebook-web/rix-engine.js";
import { mountNotebookWeb } from "./notebook-web/workbench.js";

const notebook = mountNotebookWeb({
  engine: createRixNotebookEngine({ pluginCatalog }),
  editorHost: document.querySelector("#editor"),
  preview: document.querySelector("#preview"),
  output: document.querySelector("#results"),
  host: { onDocumentChange(source) { saveDraft(source); } },
});
```
