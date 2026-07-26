import "../styles.css";
import "katex/dist/katex.min.css";
import "./browser.css";
import { createNotebookBundledPluginCatalog } from "../bundled-plugin-catalog.js";
import { ProjectManager } from "../project.js";
import { createRixNotebookEngine } from "../notebook-web/rix-engine.js";
import { mountNotebookWeb } from "../notebook-web/workbench.js";
import { BrowserDocumentStore, createSingleFileStore } from "./browser-document-store.js";
import { listLocalNotebooks, loadLocalNotebook, removeLocalNotebook, saveLocalNotebook } from "./local-notebooks.js";
import { createZipProject, findProjectRoot, openZipProject } from "./zip-project.js";

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
const elements = {
  editorHost: $("#markdown-editor"), preview: $("#markdown-preview"), output: $("#rix-output"), previewPane: $("#preview-pane"), outputPane: $("#output-pane"),
  sliderControls: $("#slider-controls"), sliderControlList: $("#slider-control-list"), runButton: $("#run-notebook"), toggleRightPaneButton: $("#toggle-right-pane"), rightPaneTitle: $("#right-pane-title"), status: $("#document-status"),
};
const title = $("#workspace-title"); const fileInput = $("#markdown-file"); const keepLocal = $("#keep-local-copy");
const workspace = document.querySelector(".workspace"); const sidebar = $("#browser-project-sidebar"); const sidebarTitle = $("#browser-sidebar-title"); const sidebarTree = $("#browser-project-tree");
let filename = "rix-notebook.md"; let activePath = "/rix-notebook.md"; let store = createSingleFileStore(filename, starter); let persistTimer = null; let saveHandle = null;
let workspaceKind = "single"; let projectManager = null;

function basename(path) { return path.split("/").filter(Boolean).at(-1) || "untitled.md"; }
function dirname(path) { const parts = path.split("/").filter(Boolean); parts.pop(); return `/${parts.join("/")}` || "/"; }
function joinPath(...parts) {
  const output = [];
  for (const part of parts.join("/").replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") output.pop(); else output.push(part);
  }
  return `/${output.join("/")}`;
}
function isMarkdown(path) { return /\.(?:md|markdown)$/i.test(path); }
function isEditable(path) { return /\.(?:md|markdown|toml|txt|json|ya?ml|csv|tsv|svg|html?|css|js|mjs|qmd)$/i.test(path); }
function normalizedFilename(value, extension = ".md") {
  const name = value.trim() || `rix-notebook${extension}`;
  return new RegExp(`\\${extension.replace(".", "\\.")}$`, "i").test(name) ? name : `${name}${extension}`;
}
function identity() { return `${filename}:${new TextEncoder().encode(filename).length}`; }
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
function updateSaveControls() {
  const project = workspaceKind !== "single";
  $("#save-as-markdown").textContent = project ? "Save project ZIP as…" : "Save Markdown as…";
  $("#download-markdown-copy").textContent = project ? "Download project ZIP" : "Download Markdown";
  keepLocal.closest("label").hidden = project;
  keepLocal.closest("label").nextElementSibling.hidden = project;
}
function updateWorkspaceChrome() {
  const hasFiles = workspaceKind !== "single";
  sidebar.hidden = !hasFiles; workspace.classList.toggle("has-project", hasFiles); updateSaveControls();
}
function resolveAsset(source) {
  if (!source || /^(?:[a-z]+:|\/\/|#)/i.test(source)) return source;
  const [path] = source.split(/(?=[?#])/);
  const resolved = path.startsWith("/") ? joinPath(path) : joinPath(dirname(activePath), path);
  return store.assetUrl(resolved) || source;
}
async function persist(source) {
  if (workspaceKind !== "single" || !keepLocal.checked) return;
  window.clearTimeout(persistTimer); persistTimer = window.setTimeout(async () => {
    try { await saveLocalNotebook({ id: identity(), filename, source }); elements.status.textContent = "Saved local recovery copy"; }
    catch { elements.status.textContent = "Could not save browser recovery copy"; }
  }, 500);
}
const engine = createRixNotebookEngine({ pluginCatalog: createNotebookBundledPluginCatalog() });
const notebook = mountNotebookWeb({
  engine, elements, initialDocument: starter,
  host: { resolveAsset, onDocumentChange(source) { store.writeText(activePath, source); persist(source); } },
});

function clearStore() { store.dispose?.(); }
async function setActiveDocument(path, source = null) {
  activePath = store.normalize(path); filename = basename(activePath); saveHandle = null;
  title.textContent = workspaceKind === "project" ? projectManager.project.title : filename;
  notebook.setDocument(source ?? await store.readText(activePath)); await renderSidebar();
}
function treeButton(label, path, className = "tree-note", open = null) {
  const button = document.createElement("button"); button.type = "button"; button.className = className; button.textContent = label;
  button.setAttribute("aria-current", String(store.normalize(path) === activePath));
  button.addEventListener("click", async () => {
    try {
      if (open) { await open(); return; }
      if (projectManager && isMarkdown(path)) {
        const note = await projectManager.selectNote(store.normalize(path)); await setActiveDocument(note.path, note.source); return;
      }
      await setActiveDocument(path);
    } catch (error) { elements.status.textContent = error.message; }
  });
  return button;
}
async function renderFolderTree(root = "/", indent = 0) {
  const fragment = document.createDocumentFragment();
  for (const entry of await store.readDirectory(root)) {
    const path = joinPath(root, entry.name);
    if (entry.isDirectory) {
      const heading = document.createElement("div"); heading.className = "browser-tree-folder"; heading.style.paddingLeft = `${0.35 + indent * 0.8}rem`; heading.textContent = entry.name; fragment.append(heading, await renderFolderTree(path, indent + 1));
    } else if (isEditable(path)) {
      const button = treeButton(entry.name, path, "tree-note browser-tree-file"); button.style.paddingLeft = `${1.15 + indent * 0.8}rem`; fragment.append(button);
    } else {
      const asset = document.createElement("div"); asset.className = "browser-tree-asset"; asset.style.paddingLeft = `${1.15 + indent * 0.8}rem`; asset.textContent = entry.name; fragment.append(asset);
    }
  }
  return fragment;
}
async function renderSidebar() {
  if (workspaceKind === "single") return;
  sidebarTree.replaceChildren();
  if (workspaceKind === "project") {
    sidebarTitle.textContent = projectManager.project.title;
    sidebarTree.append(treeButton("project.toml", projectManager.project.path, "tree-manifest"));
    for (const notebookInfo of projectManager.notebookList) {
      const notebook = projectManager.notebooks.get(notebookInfo.path); const row = document.createElement("div"); row.className = "tree-notebook-row";
      const marker = document.createElement("span"); marker.className = "browser-notebook-marker"; marker.textContent = "▾";
      row.append(marker, treeButton(notebook.title, notebook.path, "tree-notebook", async () => {
        const note = await projectManager.selectNotebook(notebook.path); await setActiveDocument(note.path, note.source);
      })); sidebarTree.append(row);
      sidebarTree.append(treeButton("notebook.toml", notebook.path, "tree-manifest tree-notebook-manifest"));
      for (const note of notebook.notes) sidebarTree.append(treeButton(note, joinPath(dirname(notebook.path), note)));
    }
    return;
  }
  sidebarTitle.textContent = "Files"; sidebarTree.append(await renderFolderTree());
}
async function openSingleMarkdown(file) {
  clearStore(); filename = file.name || "untitled.md"; const source = await file.text(); store = createSingleFileStore(filename, source); activePath = store.normalize(filename); workspaceKind = "single"; projectManager = null; updateWorkspaceChrome(); await setActiveDocument(activePath, source); elements.status.textContent = `Opened ${filename} in browser memory`;
}
async function openZip(file) {
  clearStore(); store = openZipProject(new Uint8Array(await file.arrayBuffer())); saveHandle = null; const root = findProjectRoot(store); workspaceKind = root ? "project" : "folder"; projectManager = root ? new ProjectManager(store) : null;
  try {
    if (projectManager) {
      const note = await projectManager.openProject(root); activePath = note.path; filename = basename(note.path);
    } else {
      const first = store.entries().map(([path]) => path).find(isEditable);
      if (!first) throw new Error("The ZIP has no editable Markdown or text files"); activePath = first; filename = basename(first);
    }
    updateWorkspaceChrome(); await setActiveDocument(activePath); elements.status.textContent = `Opened ${file.name} as a virtual ${workspaceKind}`;
  } catch (error) { workspaceKind = "folder"; projectManager = null; updateWorkspaceChrome(); await renderSidebar(); throw error; }
}
async function openInput(file) {
  if (!file) return;
  try { if (/\.zip$/i.test(file.name) || file.type === "application/zip") await openZip(file); else await openSingleMarkdown(file); }
  catch (error) { elements.status.textContent = `Could not open ${file.name}: ${error.message}`; }
  finally { fileInput.value = ""; }
}
function archiveName(suffix = "") {
  const base = (projectManager?.project.title || filename).replace(/\.(?:md|markdown|zip)$/i, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "rix-notebook";
  return `${base}${suffix}.zip`;
}
async function saveBlobWithPicker(blob, suggestedName, description) {
  if (!("showSaveFilePicker" in window)) return false;
  try {
    const handle = await window.showSaveFilePicker({ suggestedName, types: [{ description, accept: { "application/zip": [".zip"] } }] });
    const writable = await handle.createWritable(); await writable.write(blob); await writable.close(); elements.status.textContent = `Saved ${handle.name}`; return true;
  } catch (error) { if (error?.name !== "AbortError") elements.status.textContent = "Could not save with the browser file picker"; return true; }
}
async function saveArchive(saveAs = false) {
  const name = archiveName(); const blob = new Blob([createZipProject(store)], { type: "application/zip" });
  if (await saveBlobWithPicker(blob, name, "RiX Notebook project")) return;
  const requested = saveAs ? window.prompt("Project ZIP filename", name) : name; if (!requested) return;
  downloadBlob(blob, normalizedFilename(requested, ".zip")); elements.status.textContent = `Downloaded ${normalizedFilename(requested, ".zip")}; Safari cannot choose a download location.`;
}
async function saveMarkdown(saveAs = false) {
  if ("showSaveFilePicker" in window) {
    try {
      if (!saveHandle || saveAs) saveHandle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: "Markdown", accept: { "text/markdown": [".md", ".markdown"] } }] });
      const writable = await saveHandle.createWritable(); await writable.write(notebook.document); await writable.close(); filename = saveHandle.name || filename; title.textContent = filename; elements.status.textContent = `Saved ${filename}`; return;
    } catch (error) { if (error?.name !== "AbortError") elements.status.textContent = "Could not save with the browser file picker"; return; }
  }
  const requested = saveAs ? window.prompt("Markdown filename", filename) : filename; if (!requested) return;
  filename = normalizedFilename(requested); activePath = store.normalize(filename); await store.writeText(activePath, notebook.document); title.textContent = filename;
  downloadBlob(new Blob([notebook.document], { type: "text/markdown;charset=utf-8" }), filename); elements.status.textContent = `Downloaded ${filename}; Safari cannot choose a download location.`;
}
async function saveDocument(saveAs = false) { return workspaceKind === "single" ? saveMarkdown(saveAs) : saveArchive(saveAs); }
async function createBrowserNote() {
  const requested = window.prompt("Markdown filename", "untitled.md"); if (!requested) return; const name = normalizedFilename(requested);
  try {
    if (projectManager) { const note = await projectManager.createNote(name.replace(/\.(?:md|markdown)$/i, "")); await setActiveDocument(note.path, note.source); }
    else { const path = joinPath(dirname(activePath), name); if (await store.exists(path)) throw new Error(`${name} already exists`); await store.writeText(path, "# Untitled\n"); await setActiveDocument(path); }
    elements.status.textContent = `Created ${name}`;
  } catch (error) { elements.status.textContent = error.message; }
}

// Browser version of the native draggable pane divider.
const editorPane = document.querySelector(".editor-pane"); const resizer = $("#main-resizer"); const collapseDocument = $("#collapse-document-pane"); const collapseEditor = $("#collapse-editor-pane"); const centerPanes = $("#center-panes");
let paneLayout = "both"; let editorRatio = null;
function availablePaneWidth() { return workspace.getBoundingClientRect().width - resizer.getBoundingClientRect().width - (sidebar.hidden ? 0 : sidebar.getBoundingClientRect().width); }
function setBrowserPaneLayout(layout) { paneLayout = layout; workspace.classList.toggle("editor-collapsed", layout === "editor"); workspace.classList.toggle("document-collapsed", layout === "document"); collapseEditor.disabled = layout === "editor"; collapseDocument.disabled = layout === "document"; }
function setBrowserEditorWidth(width, remember = true) { if (paneLayout !== "both") setBrowserPaneLayout("both"); const available = availablePaneWidth(); const resolved = Math.max(330, Math.min(Math.max(330, available - 380), width)); workspace.style.setProperty("--editor-pane-width", `${resolved}px`); if (remember && available > 0) editorRatio = resolved / available; }
function centerBrowserPanes() { setBrowserPaneLayout("both"); setBrowserEditorWidth(availablePaneWidth() / 2); }
function preserveBrowserRatio() { if (paneLayout !== "both" || window.matchMedia("(max-width: 900px)").matches) return; const available = availablePaneWidth(); if (available <= 0) return; if (editorRatio === null) editorRatio = editorPane.getBoundingClientRect().width / available; setBrowserEditorWidth(available * editorRatio, false); }
let dragPointer = null;
resizer.addEventListener("pointerdown", (event) => { if (event.target.closest(".divider-control") || window.matchMedia("(max-width: 900px)").matches) return; dragPointer = event.pointerId; resizer.setPointerCapture(dragPointer); document.body.classList.add("is-resizing"); setBrowserEditorWidth(event.clientX - editorPane.getBoundingClientRect().left); });
resizer.addEventListener("pointermove", (event) => { if (event.pointerId === dragPointer) setBrowserEditorWidth(event.clientX - editorPane.getBoundingClientRect().left); });
for (const eventName of ["pointerup", "pointercancel"]) resizer.addEventListener(eventName, (event) => { if (event.pointerId !== dragPointer) return; if (resizer.hasPointerCapture(dragPointer)) resizer.releasePointerCapture(dragPointer); dragPointer = null; document.body.classList.remove("is-resizing"); });
collapseDocument.addEventListener("click", () => setBrowserPaneLayout("document")); collapseEditor.addEventListener("click", () => setBrowserPaneLayout("editor"));
let centerPointer = null; let centerStartX = 0; let centerMoved = false;
centerPanes.addEventListener("pointerdown", (event) => { if (window.matchMedia("(max-width: 900px)").matches) return; event.preventDefault(); centerPointer = event.pointerId; centerStartX = event.clientX; centerMoved = false; centerPanes.setPointerCapture(centerPointer); setBrowserPaneLayout("both"); document.body.classList.add("is-resizing"); });
centerPanes.addEventListener("pointermove", (event) => { if (event.pointerId !== centerPointer) return; if (Math.abs(event.clientX - centerStartX) > 3) centerMoved = true; if (centerMoved) setBrowserEditorWidth(event.clientX - editorPane.getBoundingClientRect().left); });
for (const eventName of ["pointerup", "pointercancel"]) centerPanes.addEventListener(eventName, (event) => { if (event.pointerId !== centerPointer) return; if (centerPanes.hasPointerCapture(centerPointer)) centerPanes.releasePointerCapture(centerPointer); const moved = centerMoved; centerPointer = null; document.body.classList.remove("is-resizing"); if (!moved) centerBrowserPanes(); });
window.addEventListener("resize", () => window.requestAnimationFrame(preserveBrowserRatio)); window.requestAnimationFrame(preserveBrowserRatio);

$("#open-markdown").addEventListener("click", () => fileInput.click()); fileInput.addEventListener("change", () => openInput(fileInput.files?.[0]));
$("#new-markdown").addEventListener("click", async () => {
  if (!window.confirm("Create a new Markdown document? Unsaved changes in the current browser document will be replaced.")) return;
  const requested = window.prompt("Markdown filename", "untitled.md"); if (!requested) return; clearStore(); filename = normalizedFilename(requested); store = createSingleFileStore(filename, "# Untitled\n"); activePath = store.normalize(filename); workspaceKind = "single"; projectManager = null; updateWorkspaceChrome(); await setActiveDocument(activePath, "# Untitled\n"); elements.status.textContent = `Created ${filename} in browser memory`;
});
$("#browser-new-note").addEventListener("click", createBrowserNote);
$("#download-markdown").addEventListener("click", () => saveDocument()); $("#save-as-markdown").addEventListener("click", () => { $("#save-menu").hidden = true; $("#save-options").setAttribute("aria-expanded", "false"); saveDocument(true); }); $("#download-markdown-copy").addEventListener("click", () => { $("#save-menu").hidden = true; $("#save-options").setAttribute("aria-expanded", "false"); workspaceKind === "single" ? saveMarkdown(false) : saveArchive(false); });
$("#save-options").addEventListener("click", (event) => { event.stopPropagation(); const menu = $("#save-menu"); menu.hidden = !menu.hidden; $("#save-options").setAttribute("aria-expanded", String(!menu.hidden)); }); window.addEventListener("click", (event) => { if (!event.target.closest(".save-control")) { $("#save-menu").hidden = true; $("#save-options").setAttribute("aria-expanded", "false"); } }); keepLocal.addEventListener("change", () => { if (keepLocal.checked) persist(notebook.document); });
document.addEventListener("keydown", (event) => { if (!(event.metaKey || event.ctrlKey)) return; if (event.key.toLowerCase() === "s") { event.preventDefault(); saveDocument(event.shiftKey); } if (event.key === "Enter") { event.preventDefault(); notebook.run(); } });

const recentDialog = $("#recent-dialog"); const recentList = $("#recent-list");
async function renderRecents() { recentList.replaceChildren(); const recents = await listLocalNotebooks(); if (!recents.length) { recentList.textContent = "No opted-in local copies yet."; return; } for (const item of recents) { const row = document.createElement("section"); row.className = "recent-item"; const info = document.createElement("div"); info.innerHTML = `<strong>${item.filename}</strong><p>Saved locally ${new Date(item.updatedAt).toLocaleString()}</p>`; const actions = document.createElement("div"); actions.className = "recent-actions"; const open = document.createElement("button"); open.textContent = "Open"; open.onclick = async () => { const saved = await loadLocalNotebook(item.id); if (saved) { clearStore(); filename = saved.filename; store = createSingleFileStore(filename, saved.source); activePath = store.normalize(filename); workspaceKind = "single"; projectManager = null; keepLocal.checked = true; updateWorkspaceChrome(); await setActiveDocument(activePath, saved.source); recentDialog.close(); } }; const remove = document.createElement("button"); remove.className = "secondary-button"; remove.textContent = "Remove"; remove.onclick = async () => { await removeLocalNotebook(item.id); renderRecents(); }; actions.append(open, remove); row.append(info, actions); recentList.append(row); } }
$("#recent-notebooks").addEventListener("click", async () => { await renderRecents(); recentDialog.showModal(); }); $("#close-recent").addEventListener("click", () => recentDialog.close());

async function staticProjectArchive() {
  const rendered = new BrowserDocumentStore();
  for (const [path, value] of store.entries()) {
    if (!isMarkdown(path)) { rendered.set(path, value); continue; }
    const source = await store.readText(path); const run = engine.executeDocument(source, { mode: "static", sliderOverrides: new Map() }); rendered.set(path, run.staticRenderedSource);
  }
  return new Blob([createZipProject(rendered)], { type: "application/zip" });
}
const exportDialog = $("#export-dialog");
$("#export-notebook").addEventListener("click", () => { const project = workspaceKind !== "single"; $("#browser-export-hint").textContent = project ? "Download a ZIP containing static rendered Markdown and the project’s original assets." : "Download a static rendered Markdown copy."; $("#browser-export-confirm").textContent = project ? "Download rendered project ZIP" : "Download rendered Markdown"; exportDialog.showModal(); });
exportDialog.querySelector("button[value=cancel]").addEventListener("click", () => exportDialog.close("cancel"));
exportDialog.addEventListener("close", async () => {
  if (exportDialog.returnValue !== "confirm") return;
  if (workspaceKind !== "single") { const blob = await staticProjectArchive(); const name = archiveName("-rendered"); if (await saveBlobWithPicker(blob, name, "Rendered RiX Notebook project")) return; const requested = window.prompt("Export filename", name); if (!requested) return; const exportName = normalizedFilename(requested, ".zip"); downloadBlob(blob, exportName); elements.status.textContent = `Downloaded ${exportName}; Safari cannot choose a download location.`; return; }
  const staticRun = engine.executeDocument(notebook.document, { mode: "static", sliderOverrides: new Map() }); const fallbackName = `${filename.replace(/\.(?:md|markdown)$/i, "") || "rix-notebook"}-rendered.md`; const requested = "showSaveFilePicker" in window ? fallbackName : window.prompt("Export filename", fallbackName); if (!requested) return; const exportName = normalizedFilename(requested); const blob = new Blob([staticRun.staticRenderedSource], { type: "text/markdown;charset=utf-8" });
  if ("showSaveFilePicker" in window) { try { const handle = await window.showSaveFilePicker({ suggestedName: exportName, types: [{ description: "Rendered Markdown", accept: { "text/markdown": [".md"] } }] }); const writable = await handle.createWritable(); await writable.write(blob); await writable.close(); elements.status.textContent = `Exported ${handle.name}`; } catch (error) { if (error?.name !== "AbortError") elements.status.textContent = "Could not save export with the browser file picker"; } return; }
  downloadBlob(blob, exportName); elements.status.textContent = `Downloaded ${exportName}; Safari cannot choose a download location.`;
});
