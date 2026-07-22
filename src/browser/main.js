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
const elements = { editorHost: $("#markdown-editor"), preview: $("#markdown-preview"), output: $("#rix-output"), previewPane: $("#preview-pane"), outputPane: $("#output-pane"), sliderControls: $("#slider-controls"), sliderControlList: $("#slider-control-list"), runButton: $("#run-notebook"), toggleRightPaneButton: $("#toggle-right-pane"), rightPaneTitle: $("#right-pane-title"), status: $("#document-status") };
const title = $("#workspace-title"); const fileInput = $("#markdown-file"); const keepLocal = $("#keep-local-copy");
let filename = "rix-notebook.md"; let store = createSingleFileStore(filename, starter); let persistTimer = null;
let saveHandle = null;

function identity() { return `${filename}:${new TextEncoder().encode(filename).length}`; }
function normalizedFilename(value) {
  const name = value.trim() || "rix-notebook";
  return /\.(?:md|markdown)$/i.test(name) ? name : `${name}.md`;
}
function download() {
  const blob = new Blob([notebook.document], { type: "text/markdown;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0); elements.status.textContent = `Downloaded ${filename}`;
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
async function saveDocument(saveAs = false) {
  if ("showSaveFilePicker" in window) {
    try {
      if (!saveHandle || saveAs) saveHandle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: "Markdown", accept: { "text/markdown": [".md", ".markdown"] } }] });
      const writable = await saveHandle.createWritable(); await writable.write(notebook.document); await writable.close();
      filename = saveHandle.name || filename; title.textContent = filename; elements.status.textContent = `Saved ${filename}`; return;
    } catch (error) { if (error?.name === "AbortError") return; elements.status.textContent = "Could not save with the browser file picker"; return; }
  }
  if (saveAs) {
    const requested = window.prompt("Markdown filename", filename);
    if (!requested) return;
    filename = normalizedFilename(requested); title.textContent = filename;
  }
  download(); elements.status.textContent = `Downloaded ${filename}; this browser cannot choose a download location.`;
}
async function persist(source) {
  if (!keepLocal.checked) return;
  window.clearTimeout(persistTimer); persistTimer = window.setTimeout(async () => {
    try { await saveLocalNotebook({ id: identity(), filename, source }); elements.status.textContent = "Saved local recovery copy"; }
    catch { elements.status.textContent = "Could not save browser recovery copy"; }
  }, 500);
}
const engine = createRixNotebookEngine({ pluginCatalog: createNotebookBundledPluginCatalog() });
const notebook = mountNotebookWeb({ engine, elements, initialDocument: starter, host: { onDocumentChange(source) { store.writeText(filename, source); persist(source); } } });

// The browser host uses the same divider behavior as the native shell, but
// stores the current split only for this open page (persistent layout can come
// later with the opted-in project persistence work).
const workspace = document.querySelector(".workspace");
const editorPane = document.querySelector(".editor-pane");
const resizer = $("#main-resizer");
const collapseDocument = $("#collapse-document-pane");
const collapseEditor = $("#collapse-editor-pane");
const centerPanes = $("#center-panes");
let paneLayout = "both";
let editorRatio = null;
function availablePaneWidth() { return workspace.getBoundingClientRect().width - resizer.getBoundingClientRect().width; }
function setBrowserPaneLayout(layout) {
  paneLayout = layout; workspace.classList.toggle("editor-collapsed", layout === "editor"); workspace.classList.toggle("document-collapsed", layout === "document");
  collapseEditor.disabled = layout === "editor"; collapseDocument.disabled = layout === "document";
}
function setBrowserEditorWidth(width, remember = true) {
  if (paneLayout !== "both") setBrowserPaneLayout("both"); const available = availablePaneWidth(); const resolved = Math.max(330, Math.min(Math.max(330, available - 380), width));
  workspace.style.setProperty("--editor-pane-width", `${resolved}px`); if (remember && available > 0) editorRatio = resolved / available;
}
function centerBrowserPanes() { setBrowserPaneLayout("both"); setBrowserEditorWidth(availablePaneWidth() / 2); }
function preserveBrowserRatio() { if (paneLayout !== "both" || window.matchMedia("(max-width: 900px)").matches) return; const available = availablePaneWidth(); if (available <= 0) return; if (editorRatio === null) editorRatio = editorPane.getBoundingClientRect().width / available; setBrowserEditorWidth(available * editorRatio, false); }
let dragPointer = null;
resizer.addEventListener("pointerdown", (event) => { if (event.target.closest(".divider-control") || window.matchMedia("(max-width: 900px)").matches) return; dragPointer = event.pointerId; resizer.setPointerCapture(dragPointer); document.body.classList.add("is-resizing"); setBrowserEditorWidth(event.clientX - workspace.getBoundingClientRect().left); });
resizer.addEventListener("pointermove", (event) => { if (event.pointerId === dragPointer) setBrowserEditorWidth(event.clientX - workspace.getBoundingClientRect().left); });
for (const eventName of ["pointerup", "pointercancel"]) resizer.addEventListener(eventName, (event) => { if (event.pointerId !== dragPointer) return; if (resizer.hasPointerCapture(dragPointer)) resizer.releasePointerCapture(dragPointer); dragPointer = null; document.body.classList.remove("is-resizing"); });
collapseDocument.addEventListener("click", () => setBrowserPaneLayout("document")); collapseEditor.addEventListener("click", () => setBrowserPaneLayout("editor"));
let centerPointer = null; let centerStartX = 0; let centerMoved = false;
centerPanes.addEventListener("pointerdown", (event) => { if (window.matchMedia("(max-width: 900px)").matches) return; event.preventDefault(); centerPointer = event.pointerId; centerStartX = event.clientX; centerMoved = false; centerPanes.setPointerCapture(centerPointer); setBrowserPaneLayout("both"); document.body.classList.add("is-resizing"); });
centerPanes.addEventListener("pointermove", (event) => { if (event.pointerId !== centerPointer) return; if (Math.abs(event.clientX - centerStartX) > 3) centerMoved = true; if (centerMoved) setBrowserEditorWidth(event.clientX - workspace.getBoundingClientRect().left); });
for (const eventName of ["pointerup", "pointercancel"]) centerPanes.addEventListener(eventName, (event) => { if (event.pointerId !== centerPointer) return; if (centerPanes.hasPointerCapture(centerPointer)) centerPanes.releasePointerCapture(centerPointer); const moved = centerMoved; centerPointer = null; document.body.classList.remove("is-resizing"); if (!moved) centerBrowserPanes(); });
window.addEventListener("resize", () => window.requestAnimationFrame(preserveBrowserRatio)); window.requestAnimationFrame(preserveBrowserRatio);

async function openMarkdown(file) {
  if (!file) return;
  filename = file.name || "untitled.md"; saveHandle = null; title.textContent = filename; const source = await file.text(); store = createSingleFileStore(filename, source); notebook.setDocument(source); elements.status.textContent = `Opened ${filename} in browser memory`;
}
$("#open-markdown").addEventListener("click", () => fileInput.click()); fileInput.addEventListener("change", () => openMarkdown(fileInput.files?.[0]));
$("#new-markdown").addEventListener("click", () => {
  if (!window.confirm("Create a new Markdown document? Unsaved changes in the current browser document will be replaced.")) return;
  const requested = window.prompt("Markdown filename", "untitled.md"); if (!requested) return;
  filename = normalizedFilename(requested); saveHandle = null; title.textContent = filename; store = createSingleFileStore(filename, "# Untitled\n"); notebook.setDocument("# Untitled\n"); elements.status.textContent = `Created ${filename} in browser memory`;
});
$("#download-markdown").addEventListener("click", () => saveDocument());
$("#save-as-markdown").addEventListener("click", () => { $("#save-menu").hidden = true; $("#save-options").setAttribute("aria-expanded", "false"); saveDocument(true); });
$("#download-markdown-copy").addEventListener("click", () => { $("#save-menu").hidden = true; $("#save-options").setAttribute("aria-expanded", "false"); download(); });
$("#save-options").addEventListener("click", (event) => { event.stopPropagation(); const menu = $("#save-menu"); menu.hidden = !menu.hidden; $("#save-options").setAttribute("aria-expanded", String(!menu.hidden)); });
window.addEventListener("click", (event) => { if (!event.target.closest(".save-control")) { $("#save-menu").hidden = true; $("#save-options").setAttribute("aria-expanded", "false"); } });
keepLocal.addEventListener("change", () => { if (keepLocal.checked) persist(notebook.document); });
document.addEventListener("keydown", (event) => { if (!(event.metaKey || event.ctrlKey)) return; if (event.key.toLowerCase() === "s") { event.preventDefault(); saveDocument(event.shiftKey); } if (event.key === "Enter") { event.preventDefault(); notebook.run(); } });

const recentDialog = $("#recent-dialog"); const recentList = $("#recent-list");
async function renderRecents() {
  recentList.replaceChildren(); const recents = await listLocalNotebooks();
  if (!recents.length) { recentList.textContent = "No opted-in local copies yet."; return; }
  for (const item of recents) {
    const row = document.createElement("section"); row.className = "recent-item"; const info = document.createElement("div"); info.innerHTML = `<strong>${item.filename}</strong><p>Saved locally ${new Date(item.updatedAt).toLocaleString()}</p>`;
    const actions = document.createElement("div"); actions.className = "recent-actions"; const open = document.createElement("button"); open.textContent = "Open"; open.onclick = async () => { const saved = await loadLocalNotebook(item.id); if (saved) { filename = saved.filename; saveHandle = null; title.textContent = filename; store = createSingleFileStore(filename, saved.source); notebook.setDocument(saved.source); keepLocal.checked = true; recentDialog.close(); } };
    const remove = document.createElement("button"); remove.className = "secondary-button"; remove.textContent = "Remove"; remove.onclick = async () => { await removeLocalNotebook(item.id); renderRecents(); }; actions.append(open, remove); row.append(info, actions); recentList.append(row);
  }
}
$("#recent-notebooks").addEventListener("click", async () => { await renderRecents(); recentDialog.showModal(); }); $("#close-recent").addEventListener("click", () => recentDialog.close());

const exportDialog = $("#export-dialog");
$("#export-notebook").addEventListener("click", () => exportDialog.showModal());
exportDialog.querySelector("button[value=cancel]").addEventListener("click", () => exportDialog.close("cancel"));
exportDialog.addEventListener("close", () => {
  if (exportDialog.returnValue !== "confirm") return;
  const staticRun = engine.executeDocument(notebook.document, { mode: "static", sliderOverrides: new Map() });
  const baseName = filename.replace(/\.(?:md|markdown)$/i, "") || "rix-notebook";
  const fallbackName = `${baseName}-rendered.md`;
  const requested = "showSaveFilePicker" in window ? fallbackName : window.prompt("Export filename", fallbackName);
  if (!requested) return;
  const exportName = normalizedFilename(requested);
  const blob = new Blob([staticRun.staticRenderedSource], { type: "text/markdown;charset=utf-8" });
  if ("showSaveFilePicker" in window) {
    window.showSaveFilePicker({ suggestedName: exportName, types: [{ description: "Rendered Markdown", accept: { "text/markdown": [".md"] } }] })
      .then((handle) => handle.createWritable().then(async (writable) => { await writable.write(blob); await writable.close(); elements.status.textContent = `Exported ${handle.name}`; }))
      .catch((error) => { if (error?.name !== "AbortError") elements.status.textContent = "Could not save export with the browser file picker"; });
    return;
  }
  downloadBlob(blob, exportName); elements.status.textContent = `Downloaded ${exportName}; Safari cannot choose a download location.`;
});
