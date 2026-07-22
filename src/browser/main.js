import "../styles.css";
import "katex/dist/katex.min.css";
import "./browser.css";
import { createNotebookBundledPluginCatalog } from "../bundled-plugin-catalog.js";
import { createRixNotebookEngine } from "../notebook-web/rix-engine.js";
import { mountNotebookWeb } from "../notebook-web/workbench.js";
import { createSingleFileStore } from "./browser-document-store.js";
import { listLocalNotebooks, loadLocalNotebook, removeLocalNotebook, saveLocalNotebook } from "./local-notebooks.js";

const starter = `# Welcome to RiX Notebook Web

This is an ordinary Markdown file running entirely in your browser.

\`\`\`rix
radius := .slider(1:5, 1/10, 3);
area := 22/7 * radius^2;
area;
\`\`\`

The current area is @{area}.
`;
const $ = (selector) => document.querySelector(selector);
const elements = { editorHost: $("#markdown-editor"), preview: $("#markdown-preview"), output: $("#rix-output"), previewPane: $("#preview-pane"), outputPane: $("#output-pane"), sliderControls: $("#slider-controls"), sliderControlList: $("#slider-control-list"), runButton: $("#run-notebook"), toggleRightPaneButton: $("#toggle-right-pane"), status: $("#document-status") };
const title = $("#workspace-title"); const fileInput = $("#markdown-file"); const keepLocal = $("#keep-local-copy");
let filename = "rix-notebook.md"; let store = createSingleFileStore(filename, starter); let persistTimer = null;

function identity() { return `${filename}:${new TextEncoder().encode(filename).length}`; }
function download() {
  const blob = new Blob([notebook.document], { type: "text/markdown;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0); elements.status.textContent = `Downloaded ${filename}`;
}
async function persist(source) {
  if (!keepLocal.checked) return;
  window.clearTimeout(persistTimer); persistTimer = window.setTimeout(async () => {
    try { await saveLocalNotebook({ id: identity(), filename, source }); elements.status.textContent = "Saved local recovery copy"; }
    catch { elements.status.textContent = "Could not save browser recovery copy"; }
  }, 500);
}
const notebook = mountNotebookWeb({ engine: createRixNotebookEngine({ pluginCatalog: createNotebookBundledPluginCatalog() }), elements, initialDocument: starter, host: { onDocumentChange(source) { store.writeText(filename, source); persist(source); } } });

async function openMarkdown(file) {
  if (!file) return;
  filename = file.name || "untitled.md"; title.textContent = filename; const source = await file.text(); store = createSingleFileStore(filename, source); notebook.setDocument(source); elements.status.textContent = `Opened ${filename} in browser memory`;
}
$("#open-markdown").addEventListener("click", () => fileInput.click()); fileInput.addEventListener("change", () => openMarkdown(fileInput.files?.[0]));
$("#download-markdown").addEventListener("click", download);
keepLocal.addEventListener("change", () => { if (keepLocal.checked) persist(notebook.document); });
document.addEventListener("keydown", (event) => { if (!(event.metaKey || event.ctrlKey)) return; if (event.key.toLowerCase() === "s") { event.preventDefault(); download(); } if (event.key === "Enter") { event.preventDefault(); notebook.run(); } });

const recentDialog = $("#recent-dialog"); const recentList = $("#recent-list");
async function renderRecents() {
  recentList.replaceChildren(); const recents = await listLocalNotebooks();
  if (!recents.length) { recentList.textContent = "No opted-in local copies yet."; return; }
  for (const item of recents) {
    const row = document.createElement("section"); row.className = "recent-item"; const info = document.createElement("div"); info.innerHTML = `<strong>${item.filename}</strong><p>Saved locally ${new Date(item.updatedAt).toLocaleString()}</p>`;
    const actions = document.createElement("div"); actions.className = "recent-actions"; const open = document.createElement("button"); open.textContent = "Open"; open.onclick = async () => { const saved = await loadLocalNotebook(item.id); if (saved) { filename = saved.filename; title.textContent = filename; store = createSingleFileStore(filename, saved.source); notebook.setDocument(saved.source); keepLocal.checked = true; recentDialog.close(); } };
    const remove = document.createElement("button"); remove.className = "secondary-button"; remove.textContent = "Remove"; remove.onclick = async () => { await removeLocalNotebook(item.id); renderRecents(); }; actions.append(open, remove); row.append(info, actions); recentList.append(row);
  }
}
$("#recent-notebooks").addEventListener("click", async () => { await renderRecents(); recentDialog.showModal(); }); $("#close-recent").addEventListener("click", () => recentDialog.close());
