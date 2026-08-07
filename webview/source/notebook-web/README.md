# RiX Notebook Web Surface

`notebook-web/` is the browser-only core of RiX Notebook. It has no Tauri,
filesystem, dialog, Git, or macOS imports.

* `../../../docshell/src/contracts.js` defines the narrow `NotebookEngine`,
  `DocumentStore`, and host callback boundaries shared with other editors.
* `rix-engine.js` is the RiX implementation of `NotebookEngine`: it parses
  Markdown/RiX documents, performs linear evaluation, exposes sliders, and
  produces static Markdown output.
* `workbench.js` mounts a standalone CodeMirror editor, result list, and
  Markdown/KaTeX preview in any browser DOM.

The native app is a consumer, not a prerequisite: it uses the same RiX engine
and shared output-widget protocol with a Tauri `DocumentStore` from
`../../../docshell/src/tauri-document-store.js`, then supplies its own richer
project/sidebar, menus, dialogs, recents, Git, export, and editor workbench.
The portable `mountNotebookWeb` workbench is used by the browser host and is
available to other compact hosts.
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
