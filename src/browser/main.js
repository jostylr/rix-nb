import "../styles.css";
import "katex/dist/katex.min.css";
import "./browser.css";
import MarkdownIt from "markdown-it";
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
let filename = "rix-notebook.md"; let activePath = "/rix-notebook.md"; let store = createSingleFileStore(filename, starter); let persistTimer = null; let saveHandle = null; let uploadedArchiveName = null;
let workspaceKind = "single"; let projectManager = null;
const htmlRenderer = new MarkdownIt({ html: false, linkify: true, typographer: true });

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
  const hasExtension = extension === ".md" ? /\.(?:md|markdown)$/i.test(name) : name.toLowerCase().endsWith(extension.toLowerCase());
  return hasExtension ? name : `${name}${extension}`;
}
function archiveLabel(value = uploadedArchiveName) { return basename(value || "rix-notebook.zip").replace(/\.zip$/i, "") || "rix-notebook"; }
function identity() { const name = workspaceKind === "single" ? filename : archiveName(); return `${workspaceKind}:${name}`; }
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
function updateSaveControls() {
  const project = workspaceKind !== "single";
  $("#save-as-markdown").textContent = project ? "Save project ZIP as…" : "Save Markdown as…";
  $("#download-markdown-copy").textContent = project ? "Download project ZIP" : "Download Markdown";
  keepLocal.closest("label").lastChild.textContent = project ? " Keep a local recovery copy of this project" : " Keep a local recovery copy in this browser";
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
  if (!keepLocal.checked) return;
  window.clearTimeout(persistTimer); persistTimer = window.setTimeout(async () => {
    try {
      const saved = workspaceKind === "single"
        ? { id: identity(), filename, source, kind: "markdown" }
        : { id: identity(), filename: archiveName(), archive: createZipProject(store), kind: "zip" };
      await saveLocalNotebook(saved); elements.status.textContent = "Saved local recovery copy";
    }
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
  title.textContent = workspaceKind === "project" ? projectManager.project.title : workspaceKind === "folder" ? archiveLabel() : filename;
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
  clearStore(); filename = file.name || "untitled.md"; uploadedArchiveName = null; const source = await file.text(); store = createSingleFileStore(filename, source); activePath = store.normalize(filename); workspaceKind = "single"; projectManager = null; updateWorkspaceChrome(); await setActiveDocument(activePath, source); elements.status.textContent = `Opened ${filename} in browser memory`;
}
async function openZipBytes(bytes, archiveFileName = "rix-notebook.zip") {
  clearStore(); uploadedArchiveName = archiveFileName; store = openZipProject(bytes); saveHandle = null; const root = findProjectRoot(store); workspaceKind = root ? "project" : "folder"; projectManager = root ? new ProjectManager(store) : null;
  try {
    if (projectManager) {
      const note = await projectManager.openProject(root); activePath = note.path; filename = basename(note.path);
      const manifest = await store.readText(projectManager.project.path);
      if (!/^\s*title\s*=/m.test(manifest)) projectManager.project.title = archiveLabel(archiveFileName);
    } else {
      const first = store.entries().map(([path]) => path).find(isEditable);
      if (!first) throw new Error("The ZIP has no editable Markdown or text files"); activePath = first; filename = basename(first);
    }
    updateWorkspaceChrome(); await setActiveDocument(activePath); elements.status.textContent = `Opened ${archiveFileName} as a virtual ${workspaceKind}`;
  } catch (error) { workspaceKind = "folder"; projectManager = null; updateWorkspaceChrome(); await renderSidebar(); throw error; }
}
async function openZip(file) { return openZipBytes(new Uint8Array(await file.arrayBuffer()), file.name); }
async function openInput(file) {
  if (!file) return;
  try { if (/\.zip$/i.test(file.name) || file.type === "application/zip") await openZip(file); else await openSingleMarkdown(file); }
  catch (error) { elements.status.textContent = `Could not open ${file.name}: ${error.message}`; }
  finally { fileInput.value = ""; }
}
function archiveName(suffix = "") {
  const base = (projectManager?.project.title || archiveLabel()).replace(/\.(?:md|markdown|zip)$/i, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "rix-notebook";
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
  const requested = window.prompt("Markdown filename", "untitled.md"); if (!requested) return; clearStore(); filename = normalizedFilename(requested); uploadedArchiveName = null; store = createSingleFileStore(filename, "# Untitled\n"); activePath = store.normalize(filename); workspaceKind = "single"; projectManager = null; updateWorkspaceChrome(); await setActiveDocument(activePath, "# Untitled\n"); elements.status.textContent = `Created ${filename} in browser memory`;
});
$("#browser-new-note").addEventListener("click", createBrowserNote);
$("#download-markdown").addEventListener("click", () => saveDocument()); $("#save-as-markdown").addEventListener("click", () => { $("#save-menu").hidden = true; $("#save-options").setAttribute("aria-expanded", "false"); saveDocument(true); }); $("#download-markdown-copy").addEventListener("click", () => { $("#save-menu").hidden = true; $("#save-options").setAttribute("aria-expanded", "false"); workspaceKind === "single" ? saveMarkdown(false) : saveArchive(false); });
$("#save-options").addEventListener("click", (event) => { event.stopPropagation(); closeOpenMenu(); const menu = $("#save-menu"); menu.hidden = !menu.hidden; $("#save-options").setAttribute("aria-expanded", String(!menu.hidden)); }); window.addEventListener("click", (event) => { if (!event.target.closest(".save-control")) { $("#save-menu").hidden = true; $("#save-options").setAttribute("aria-expanded", "false"); } if (!event.target.closest(".open-control-group")) closeOpenMenu(); }); keepLocal.addEventListener("change", () => { if (keepLocal.checked) persist(notebook.document); });
document.addEventListener("keydown", (event) => { if (!(event.metaKey || event.ctrlKey)) return; if (event.key.toLowerCase() === "s") { event.preventDefault(); saveDocument(event.shiftKey); } if (event.key === "Enter") { event.preventDefault(); notebook.run(); } });

const openMenu = $("#browser-open-menu"); const recentList = $("#browser-recent-list");
function closeOpenMenu() { openMenu.hidden = true; $("#recent-notebooks").setAttribute("aria-expanded", "false"); }
async function openLocalCopy(item) {
  const saved = await loadLocalNotebook(item.id); if (!saved) return;
  if (saved.kind === "zip" && saved.archive) await openZipBytes(new Uint8Array(saved.archive), saved.filename);
  else { clearStore(); filename = saved.filename; uploadedArchiveName = null; store = createSingleFileStore(filename, saved.source); activePath = store.normalize(filename); workspaceKind = "single"; projectManager = null; keepLocal.checked = true; updateWorkspaceChrome(); await setActiveDocument(activePath, saved.source); }
  closeOpenMenu();
}
async function renderRecents() {
  recentList.replaceChildren(); const recents = await listLocalNotebooks();
  if (!recents.length) { const empty = document.createElement("p"); empty.className = "browser-recent-empty"; empty.textContent = "No opted-in local copies yet."; recentList.append(empty); return; }
  for (const item of recents) {
    const row = document.createElement("div"); row.className = "browser-recent-row"; const open = document.createElement("button"); open.type = "button"; open.textContent = item.filename; open.title = `Open local copy saved ${new Date(item.updatedAt).toLocaleString()}`; open.onclick = () => openLocalCopy(item).catch((error) => { elements.status.textContent = error.message; });
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "secondary-button"; remove.textContent = "×"; remove.title = `Remove ${item.filename}`; remove.onclick = async () => { await removeLocalNotebook(item.id); renderRecents(); };
    row.append(open, remove); recentList.append(row);
  }
}
$("#recent-notebooks").addEventListener("click", async (event) => { event.stopPropagation(); $("#save-menu").hidden = true; $("#save-options").setAttribute("aria-expanded", "false"); const opening = openMenu.hidden; closeOpenMenu(); if (!opening) return; await renderRecents(); openMenu.hidden = false; $("#recent-notebooks").setAttribute("aria-expanded", "true"); });

let dragDepth = 0;
document.addEventListener("dragenter", (event) => { if (!event.dataTransfer?.types.includes("Files")) return; event.preventDefault(); dragDepth += 1; document.body.classList.add("is-file-dragging"); });
document.addEventListener("dragover", (event) => { if (event.dataTransfer?.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } });
document.addEventListener("dragleave", (event) => { if (!event.dataTransfer?.types.includes("Files")) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove("is-file-dragging"); });
document.addEventListener("drop", (event) => { if (!event.dataTransfer?.files?.length) return; event.preventDefault(); dragDepth = 0; document.body.classList.remove("is-file-dragging"); openInput(event.dataTransfer.files[0]); });

function exportRoot() { return projectManager?.project.directory || "/"; }
function relativeExportPath(path) { return path.slice(exportRoot().length).replace(/^\//, "") || basename(path); }
function exportNotePaths(scope, notebookPath) {
  if (workspaceKind === "single") return [activePath];
  if (workspaceKind === "folder") return scope === "note" ? (isMarkdown(activePath) ? [activePath] : []) : store.entries().map(([path]) => path).filter(isMarkdown);
  if (scope === "note") return [projectManager.currentNotePath];
  if (scope === "notebook") {
    const notebook = projectManager.notebooks.get(notebookPath || projectManager.currentNotebookPath);
    return notebook.notes.map((note) => joinPath(dirname(notebook.path), note));
  }
  return [...projectManager.notebooks.values()].flatMap((notebook) => notebook.notes.map((note) => joinPath(dirname(notebook.path), note)));
}
function staticHtml(titleText, source) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${titleText.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</title><style>body{max-width:52rem;margin:3rem auto;padding:0 1.5rem;color:#252827;font:17px/1.55 Georgia,serif}pre,code{font-family:ui-monospace,monospace}pre{padding:1rem;overflow:auto;background:#f1efe9}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{padding:.35rem .6rem;border:1px solid #d9d6ce}</style></head><body>${htmlRenderer.render(source)}</body></html>`;
}
async function buildStaticExport({ scope, notebookPath, targets }) {
  const output = new BrowserDocumentStore(); const notes = exportNotePaths(scope, notebookPath).filter(Boolean);
  if (!notes.length) throw new Error("Choose a Markdown note to export");
  const roots = { markdown: "/markdown", html: "/html", quarto: "/quarto" };
  for (const notePath of notes) {
    const relative = relativeExportPath(notePath); const staticSource = engine.executeDocument(await store.readText(notePath), { mode: "static", sliderOverrides: new Map() }).staticRenderedSource;
    if (targets.markdown) output.set(joinPath(roots.markdown, relative), staticSource);
    if (targets.html) output.set(joinPath(roots.html, relative.replace(/\.(?:md|markdown)$/i, ".html")), staticHtml(basename(notePath), staticSource));
    if (targets.quarto) output.set(joinPath(roots.quarto, relative.replace(/\.(?:md|markdown)$/i, ".qmd")), staticSource);
  }
  for (const [path, value] of store.entries()) {
    if (isMarkdown(path)) continue;
    const relative = relativeExportPath(path);
    for (const [target, root] of Object.entries(roots)) if (targets[target]) output.set(joinPath(root, relative), value);
  }
  if (targets.quarto) output.set("/quarto/_quarto.yml", `project:\n  type: website\nwebsite:\n  title: ${JSON.stringify(projectManager?.project.title || archiveLabel())}\nformat:\n  html:\n    toc: true\n`);
  return output;
}
const exportDialog = $("#export-dialog"); const exportScope = $("#browser-export-scope"); const exportNotebook = $("#browser-export-notebook"); const exportNotebookLabel = $("#browser-export-notebook-label");
const exportChecks = { markdown: $("#browser-export-markdown"), html: $("#browser-export-html"), quarto: $("#browser-export-quarto") };
function updateBrowserExportScope() { const notebookScope = workspaceKind === "project" && exportScope.value === "notebook"; exportNotebook.hidden = !notebookScope; exportNotebookLabel.hidden = !notebookScope; }
function openBrowserExportDialog() {
  exportNotebook.replaceChildren(); const project = workspaceKind === "project";
  exportScope.disabled = !project; exportScope.value = "note";
  for (const notebook of projectManager?.notebookList || []) { const option = document.createElement("option"); option.value = notebook.path; option.textContent = notebook.title; option.selected = notebook.path === projectManager.currentNotebookPath; exportNotebook.append(option); }
  for (const input of Object.values(exportChecks)) input.checked = true;
  updateBrowserExportScope(); exportDialog.showModal();
}
$("#export-notebook").addEventListener("click", openBrowserExportDialog); exportScope.addEventListener("change", updateBrowserExportScope);
exportDialog.querySelector("button[value=cancel]").addEventListener("click", () => exportDialog.close("cancel"));
exportDialog.addEventListener("close", async () => {
  if (exportDialog.returnValue !== "confirm") return;
  try {
    const targets = Object.fromEntries(Object.entries(exportChecks).map(([name, input]) => [name, input.checked]));
    if (!Object.values(targets).some(Boolean)) throw new Error("Select at least one output format");
    const output = await buildStaticExport({ scope: exportScope.value, notebookPath: exportNotebook.value, targets }); const entries = output.entries();
    if (workspaceKind === "single" && targets.markdown && Object.values(targets).filter(Boolean).length === 1) {
      const [path, source] = entries[0]; const name = `${filename.replace(/\.(?:md|markdown)$/i, "") || "rix-notebook"}-rendered.md`; downloadBlob(new Blob([source], { type: "text/markdown;charset=utf-8" }), name); elements.status.textContent = `Downloaded ${name}; Safari cannot choose a download location.`; return;
    }
    const name = archiveName("-export"); const blob = new Blob([createZipProject(output)], { type: "application/zip" }); if (await saveBlobWithPicker(blob, name, "RiX Notebook export")) return;
    const requested = window.prompt("Export filename", name); if (!requested) return; const exportName = normalizedFilename(requested, ".zip"); downloadBlob(blob, exportName); elements.status.textContent = `Downloaded ${exportName}; Safari cannot choose a download location.`;
  } catch (error) { elements.status.textContent = `Could not export: ${error.message}`; }
});
