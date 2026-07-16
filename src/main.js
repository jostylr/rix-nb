import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import MarkdownIt from "markdown-it";
import renderMathInElement from "katex/contrib/auto-render";
import "katex/dist/katex.min.css";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { copyFile, mkdir, readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  Context,
  createDefaultRegistry,
  createDefaultSystemContext,
  evaluate,
  formatValue,
  lower,
  parse,
  posToLineCol,
  tokenize,
} from "../../rix/src/index.js";
import { ProjectManager } from "./project.js";
import "./styles.css";

const editorHost = document.querySelector("#markdown-editor");
const initialDocument = editorHost.textContent.trim();
editorHost.textContent = "";
const preview = document.querySelector("#markdown-preview");
const output = document.querySelector("#rix-output");
const outputPane = document.querySelector("#output-pane");
const previewPane = document.querySelector("#preview-pane");
const runButton = document.querySelector("#run-notebook");
const toggleRightPaneButton = document.querySelector("#toggle-right-pane");
const status = document.querySelector("#document-status");
const workspaceTitle = document.querySelector("#workspace-title");
const workspace = document.querySelector(".workspace");
const editorKind = document.querySelector("#editor-kind");
const newProjectButton = document.querySelector("#new-project");
const openProjectButton = document.querySelector("#open-project");
const saveNoteButton = document.querySelector("#save-note");
const newNotebookButton = document.querySelector("#new-notebook");
const newNoteButton = document.querySelector("#new-note");
const projectSidebar = document.querySelector("#project-sidebar");
const projectTree = document.querySelector("#project-tree");
const nameDialog = document.querySelector("#name-dialog");
const nameDialogTitle = document.querySelector("#name-dialog-title");
const nameDialogLabel = document.querySelector("#name-dialog-label");
const nameDialogInput = document.querySelector("#name-dialog-input");
const messageDialog = document.querySelector("#message-dialog");
const messageDialogTitle = document.querySelector("#message-dialog-title");
const messageDialogBody = document.querySelector("#message-dialog-body");
const confirmDialog = document.querySelector("#confirm-dialog");
const confirmDialogTitle = document.querySelector("#confirm-dialog-title");
const confirmDialogBody = document.querySelector("#confirm-dialog-body");
const fileContextMenu = document.querySelector("#file-context-menu");
const exportDialog = document.querySelector("#export-dialog");
const exportScopeSelect = document.querySelector("#export-scope");
const exportNotebookLabel = document.querySelector("#export-notebook-label");
const exportNotebookSelect = document.querySelector("#export-notebook");
const exportMarkdown = document.querySelector("#export-markdown");
const exportHtml = document.querySelector("#export-html");
const setQuickExport = document.querySelector("#set-quick-export");
const appNotice = document.querySelector("#app-notice");
const appNoticeMessage = document.querySelector("#app-notice-message");
const closeAppNoticeButton = document.querySelector("#close-app-notice");
const projects = new ProjectManager();
let latestRuns = [];
let activeRightPane = "results";
let loadingDocument = false;
let dirty = false;
let fileContext = null;
let activeDocument = { kind: "note", path: null };
const collapsedNotebooks = new Set();
let recentProjectPath = null;

const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

const exportMarkdownRenderer = new MarkdownIt({ html: false, linkify: true, typographer: true });
const KATEX_PUBLIC_ROOT = new URL(`${import.meta.env.BASE_URL}katex/`, window.location.origin);

const defaultFenceRenderer = markdownRenderer.renderer.rules.fence;
const defaultImageRenderer = markdownRenderer.renderer.rules.image;

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pathJoin(...parts) {
  return parts.filter(Boolean).join("/").replace(/\/{2,}/g, "/");
}

function pathDirectory(path) {
  return path.slice(0, path.lastIndexOf("/")) || ".";
}

function pathRelative(root, path) {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path.split("/").at(-1);
}

function pathSlug(value, fallback = "export") {
  return value.trim().replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || fallback;
}

markdownRenderer.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const language = token.info.trim().split(/\s+/)[0];
  const code = defaultFenceRenderer(tokens, index, options, env, self);
  if (language !== "rix") return code;

  const run = env.rixRuns?.[env.rixCellIndex++] || null;
  if (!run || run.statements.length === 0) return `<div class="rix-preview-cell">${code}</div>`;

  const results = run.statements.map((statement) => (
    `<div class="rix-preview-result rix-preview-result-${statement.kind}">`
      + `<span>line ${statement.line}</span><pre>${escapeHtml(statement.content)}</pre></div>`
  )).join("");
  return `<div class="rix-preview-cell">${code}<div class="rix-preview-results">${results}</div></div>`;
};

function resolveProjectAsset(source) {
  if (!projects.currentNotePath || /^(?:[a-z]+:|\/)/i.test(source)) return source;
  const pieces = [...projects.currentNotePath.split("/").slice(0, -1), ...source.split("/")];
  const resolved = [];
  for (const piece of pieces) {
    if (!piece || piece === ".") continue;
    if (piece === "..") resolved.pop();
    else resolved.push(piece);
  }
  return `/${resolved.join("/")}`;
}

markdownRenderer.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const source = token.attrGet("src");
  if (!source || !projects.currentNotePath || /^(?:[a-z]+:|\/)/i.test(source)) {
    return defaultImageRenderer(tokens, index, options, env, self);
  }
  token.attrSet("src", convertFileSrc(resolveProjectAsset(source)));
  const rendered = defaultImageRenderer(tokens, index, options, env, self);
  token.attrSet("src", source);
  return rendered;
};

function renderMarkdown(source, runs = latestRuns) {
  preview.innerHTML = markdownRenderer.render(source, { rixRuns: runs, rixCellIndex: 0 });
  renderMathInElement(preview, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
      { left: "\\(", right: "\\)", display: false },
      { left: "\\[", right: "\\]", display: true },
    ],
    throwOnError: false,
  });
}

function extractRixCells(source) {
  const cells = [];
  const fencePattern = /^```rix(?:[ \t]+([^\n]*))?[ \t]*\n([\s\S]*?)^```[ \t]*$/gim;
  let match;

  while ((match = fencePattern.exec(source)) !== null) {
    const line = source.slice(0, match.index).split("\n").length;
    cells.push({
      code: match[2],
      codeLine: line + 1,
      line,
      options: new Set((match[1] || "").trim().split(/\s+/).filter(Boolean)),
    });
  }

  return cells;
}

function splitTopLevelStatements(source) {
  const statements = [];
  let start = null;
  let depth = 0;
  const openers = new Set(["(", "[", "{", "{!", "{=", "{?", "{;", "{|", "{:", "{..", "{@", "{#", "{$", "{^", "{>"]);
  const closers = new Set([")", "]", "}"]);

  for (const token of tokenize(source)) {
    if (token.type === "End") break;
    if (start === null) start = token.pos[1] ?? token.pos[0];
    if (openers.has(token.value)) depth += 1;
    if (closers.has(token.value)) depth = Math.max(0, depth - 1);

    if (token.value === ";" && depth === 0) {
      statements.push({ start, end: token.pos[2], code: source.slice(start, token.pos[2]).trim() });
      start = null;
    }
  }

  if (start !== null) {
    statements.push({ start, end: source.length, code: source.slice(start).trim() });
  }
  return statements.filter((statement) => statement.code.length > 0);
}

function makeNotebookRuntime() {
  const registry = createDefaultRegistry();
  const systemContext = createDefaultSystemContext();
  return { registry, systemContext, context: new Context() };
}

function jumpToLine(line) {
  const target = editor.state.doc.line(Math.min(line, editor.state.doc.lines));
  editor.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
  editor.focus();
}

function appendOutput(statement) {
  const result = document.createElement("section");
  result.className = `cell-result cell-result-${statement.kind}`;
  result.tabIndex = 0;
  result.setAttribute("role", "button");
  result.setAttribute("aria-label", `Jump to RiX statement on line ${statement.line}`);

  const title = document.createElement("p");
  title.className = "cell-result-title";
  title.textContent = `RiX statement · line ${statement.line}`;

  const source = document.createElement("pre");
  source.className = "cell-source";
  const sourceLines = statement.code.split("\n");
  const isLong = sourceLines.length > 3;
  const compactSource = () => [sourceLines[0], "…", sourceLines.at(-1)].join("\n");
  source.textContent = isLong ? compactSource() : statement.code;

  const value = document.createElement("pre");
  value.className = "cell-result-value";
  value.textContent = statement.content;

  result.append(title, source);
  if (isLong) {
    const sourceToggle = document.createElement("button");
    sourceToggle.className = "cell-source-toggle";
    sourceToggle.type = "button";
    sourceToggle.textContent = "▸ Expand code";
    sourceToggle.setAttribute("aria-expanded", "false");
    sourceToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const expanded = sourceToggle.getAttribute("aria-expanded") === "true";
      source.textContent = expanded ? compactSource() : statement.code;
      sourceToggle.textContent = expanded ? "▸ Expand code" : "▾ Collapse code";
      sourceToggle.setAttribute("aria-expanded", String(!expanded));
    });
    sourceToggle.addEventListener("keydown", (event) => event.stopPropagation());
    result.append(sourceToggle);
  }
  result.append(value);
  result.addEventListener("click", () => jumpToLine(statement.line));
  result.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    jumpToLine(statement.line);
  });
  output.append(result);
}

function executeCell(cell, runtime) {
  const context = cell.options.has("new") ? new Context() : runtime.context;
  context.setEnv("__system_context__", runtime.systemContext);
  context.setEnv("__registry__", runtime.registry);
  context.setEnv("__source__", cell.code);
  context.setEnv("__current_file__", `<notebook cell at line ${cell.line}>`);

  const ast = parse(cell.code);
  const irNodes = lower(ast);
  const sources = splitTopLevelStatements(cell.code);
  const statements = [];

  for (const [index, irNode] of irNodes.entries()) {
    const source = sources[index] || { start: irNode.pos?.[0] || 0, code: "<source unavailable>" };
    const sourceLine = posToLineCol(cell.code, source.start).line;
    const line = cell.codeLine + sourceLine - 1;
    try {
      const value = evaluate(irNode, context, runtime.registry, runtime.systemContext);
      statements.push({ line, code: source.code, content: formatValue(value), kind: "result" });
    } catch (error) {
      statements.push({
        line,
        code: source.code,
        content: error instanceof Error ? error.message : String(error),
        kind: "error",
      });
      break;
    }
  }

  return { statements };
}

function runNotebook() {
  const source = editor.state.doc.toString();
  const cells = extractRixCells(source);
  output.replaceChildren();

  if (cells.length === 0) {
    const placeholder = document.createElement("p");
    placeholder.className = "output-placeholder";
    placeholder.textContent = "No fenced RiX cells found. Add a ```rix block to run it.";
    output.append(placeholder);
    status.textContent = "No RiX cells to run";
    return;
  }

  const runtime = makeNotebookRuntime();
  let succeeded = 0;
  const runs = [];

  for (const cell of cells) {
    try {
      const run = executeCell(cell, runtime);
      runs.push(run);
      for (const statement of run.statements) appendOutput(statement);
      if (run.statements.every((statement) => statement.kind === "result")) succeeded += 1;
    } catch (error) {
      const run = {
        statements: [{
          line: cell.codeLine,
          code: cell.code.trim(),
          content: error instanceof Error ? error.message : String(error),
          kind: "error",
        }],
      };
      runs.push(run);
      appendOutput(run.statements[0]);
    }
  }

  latestRuns = runs;
  renderMarkdown(source);
  status.textContent = `${succeeded} of ${cells.length} RiX cells ran`;
}

function isRunShortcut(event) {
  return (event.metaKey || event.ctrlKey)
    && (event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter");
}

function handleRunShortcut(event) {
  if (!isRunShortcut(event)) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  runNotebook();
  return true;
}

function isPreviewShortcut(event) {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p";
}

function setRightPane(pane) {
  activeRightPane = pane;
  const showPreview = pane === "preview";
  previewPane.hidden = !showPreview;
  outputPane.hidden = showPreview;
  toggleRightPaneButton.textContent = showPreview ? "Show results" : "Show preview";
  toggleRightPaneButton.title = showPreview
    ? "Show RiX results (⌘P or ⌘⇧P)"
    : "Show rendered preview (⌘P or ⌘⇧P)";
  toggleRightPaneButton.setAttribute("aria-pressed", String(showPreview));
}

function toggleRightPane() {
  setRightPane(activeRightPane === "results" ? "preview" : "results");
}

function setStatus(message) {
  status.textContent = message;
  hideError();
}

function showError(message) {
  appNoticeMessage.textContent = message;
  appNotice.hidden = false;
}

function hideError() {
  appNotice.hidden = true;
}

function setDocument(source) {
  loadingDocument = true;
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: source } });
  loadingDocument = false;
  dirty = false;
  updateSaveButton();
  latestRuns = [];
  renderMarkdown(source);
  runNotebook();
}

function updateSaveButton() {
  saveNoteButton.disabled = !projects.isOpen || !dirty;
}

function addDelayedTreeSelection(button, selectAction) {
  button.addEventListener("click", () => {
    cancelDelayedTreeSelection(button);
    const timer = window.setTimeout(() => {
      button.dataset.selectionTimer = "";
      runProjectAction(selectAction);
    }, 225);
    button.dataset.selectionTimer = String(timer);
  });
}

function cancelDelayedTreeSelection(button) {
  if (!button.dataset.selectionTimer) return;
  window.clearTimeout(Number(button.dataset.selectionTimer));
  button.dataset.selectionTimer = "";
}

function enableTreeRename(button, initialValue, renameAction) {
  button.addEventListener("dblclick", () => {
    cancelDelayedTreeSelection(button);
    const input = document.createElement("input");
    input.className = "tree-rename";
    input.value = initialValue;
    let finished = false;
    const finish = (commit) => {
      if (finished) return;
      finished = true;
      if (!commit || !input.value.trim()) {
        refreshProjectControls();
        return;
      }
      runProjectAction(async () => {
        if (dirty) await saveNote();
        await loadNote(await renameAction(input.value.trim()));
      });
    };
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    button.replaceWith(input);
    input.focus();
    input.select();
  });
}

function showFileContextMenu(event, context) {
  event.preventDefault();
  fileContext = context;
  fileContextMenu.hidden = false;
  const width = fileContextMenu.offsetWidth;
  const height = fileContextMenu.offsetHeight;
  fileContextMenu.style.left = `${Math.min(event.clientX, window.innerWidth - width - 8)}px`;
  fileContextMenu.style.top = `${Math.min(event.clientY, window.innerHeight - height - 8)}px`;
}

function hideFileContextMenu() {
  fileContextMenu.hidden = true;
  fileContext = null;
}

function requestConfirmation({ title, message, confirmLabel = "Delete" }) {
  return new Promise((resolve) => {
    confirmDialogTitle.textContent = title;
    confirmDialogBody.textContent = message;
    confirmDialog.querySelector("button[value=confirm]").textContent = confirmLabel;
    confirmDialog.addEventListener("close", () => resolve(confirmDialog.returnValue === "confirm"), { once: true });
    confirmDialog.showModal();
  });
}

async function saveAndCommitCurrentNote() {
  if (!projects.isOpen || !projects.currentNotePath) throw new Error("Open a project note before committing");
  await saveNote();
  await commitProjectNote(projects.currentNotePath, projects.currentNotePath.split("/").at(-1));
}

function updateExportNotebookChoice() {
  const notebookScope = exportScopeSelect.value === "notebook";
  exportNotebookLabel.hidden = !notebookScope;
  exportNotebookSelect.hidden = !notebookScope;
  setQuickExport.disabled = exportScopeSelect.value === "note";
  if (setQuickExport.disabled) setQuickExport.checked = false;
}

function getScopeNotes(scope, notebookPath = projects.currentNotebookPath) {
  if (!projects.isOpen) throw new Error("Open a project before exporting");
  if (scope === "note") return [projects.currentNotePath];
  const notebooks = scope === "project"
    ? [...projects.notebooks.values()]
    : [projects.notebooks.get(notebookPath)];
  return notebooks.flatMap((notebook) => {
    if (!notebook) return [];
    return notebook.notes.map((note) => pathJoin(pathDirectory(notebook.path), note));
  });
}

function staticHtmlDocument(title, source, katexStylesheetPath) {
  const holder = document.createElement("article");
  holder.innerHTML = exportMarkdownRenderer.render(source);
  renderMathInElement(holder, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
      { left: "\\(", right: "\\)", display: false },
      { left: "\\[", right: "\\]", display: true },
    ],
    throwOnError: false,
  });
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(title)}</title><link rel="stylesheet" href="${escapeHtml(katexStylesheetPath)}" /><style>body{max-width:52rem;margin:3rem auto;padding:0 1.25rem;color:#202124;font-family:system-ui,sans-serif;line-height:1.55}pre{overflow:auto;padding:1rem;background:#f4f2ec;border-radius:6px}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}img{max-width:100%;height:auto}blockquote{margin-left:0;padding-left:1rem;border-left:3px solid #9bb8dc;color:#4d5867}</style></head><body>${holder.innerHTML}</body></html>\n`;
}

function katexStylesheetForPage(relativeHtmlPath) {
  const parent = pathDirectory(relativeHtmlPath);
  const up = parent === "." ? [] : parent.split("/").filter(Boolean).map(() => "..");
  return [...up, "assets", "katex", "katex.min.css"].join("/");
}

async function copyKatexAssets(exportRoot) {
  const stylesheetResponse = await fetch(new URL("katex.min.css", KATEX_PUBLIC_ROOT));
  if (!stylesheetResponse.ok) throw new Error("Could not load KaTeX stylesheet for export");
  const stylesheet = await stylesheetResponse.text();
  const assetRoot = pathJoin(exportRoot, "assets/katex");
  await mkdir(pathJoin(assetRoot, "fonts"), { recursive: true });
  await writeTextFile(pathJoin(assetRoot, "katex.min.css"), stylesheet);

  const fontNames = new Set([...stylesheet.matchAll(/url\(fonts\/([^)]*\.woff2)\)/g)].map((match) => match[1]));
  for (const fontName of fontNames) {
    const response = await fetch(new URL(`fonts/${fontName}`, KATEX_PUBLIC_ROOT));
    if (!response.ok) throw new Error(`Could not load KaTeX font ${fontName} for export`);
    await writeFile(pathJoin(assetRoot, "fonts", fontName), new Uint8Array(await response.arrayBuffer()));
  }
}

function markdownImageSources(source) {
  return [...source.matchAll(/!\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)]
    .map((match) => match[1])
    .filter((path) => path && !/^(?:[a-z]+:|\/)/i.test(path));
}

function projectPathForRelativeNote(notePath, source) {
  const resolved = [];
  for (const part of [...pathRelative(projects.project.directory, pathDirectory(notePath)).split("/"), ...source.split("/")]) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return pathJoin(projects.project.directory, ...resolved);
}

async function exportScope({ scope, notebookPath, includeMarkdown, includeHtml, quick = false }) {
  if (!includeMarkdown && !includeHtml) throw new Error("Choose at least one export output");
  if (dirty) await saveNote();
  const destination = await openDialog({
    title: quick ? "Choose a folder for quick export" : "Choose an export destination folder",
    directory: true,
    multiple: false,
    recursive: true,
  });
  if (!destination || Array.isArray(destination)) return;

  const notes = getScopeNotes(scope, notebookPath);
  if (!notes.length) throw new Error("There are no notes to export");
  const scopeName = scope === "project"
    ? projects.project.title
    : scope === "note"
      ? projects.currentNotePath.split("/").at(-1).replace(/\.md$/, "")
      : projects.notebooks.get(notebookPath)?.title || "notebook";
  const exportRoot = pathJoin(destination, `${pathSlug(scopeName)}-export`);
  await mkdir(exportRoot, { recursive: true });
  if (includeHtml) await copyKatexAssets(exportRoot);

  const copiedAssets = new Set();
  for (const notePath of notes) {
    const source = await readTextFile(notePath);
    const relativePath = pathRelative(projects.project.directory, notePath);
    const destinationBase = pathJoin(exportRoot, relativePath.replace(/\.md$/, ""));
    if (includeMarkdown) {
      const markdownPath = pathJoin(exportRoot, relativePath);
      await mkdir(pathDirectory(markdownPath), { recursive: true });
      await writeTextFile(markdownPath, source);
    }
    if (includeHtml) {
      const htmlPath = `${destinationBase}.html`;
      await mkdir(pathDirectory(htmlPath), { recursive: true });
      await writeTextFile(
        htmlPath,
        staticHtmlDocument(
          notePath.split("/").at(-1).replace(/\.md$/, ""),
          source,
          katexStylesheetForPage(relativePath.replace(/\.md$/, ".html")),
        ),
      );
    }
    for (const sourcePath of markdownImageSources(source)) {
      const assetPath = projectPathForRelativeNote(notePath, sourcePath);
      const relativeAssetPath = pathRelative(projects.project.directory, assetPath);
      if (copiedAssets.has(relativeAssetPath) || assetPath === relativeAssetPath) continue;
      copiedAssets.add(relativeAssetPath);
      const assetDestination = pathJoin(exportRoot, relativeAssetPath);
      try {
        await mkdir(pathDirectory(assetDestination), { recursive: true });
        await copyFile(assetPath, assetDestination);
      } catch {
        // A missing or externally referenced asset should not prevent text export.
      }
    }
  }
  setStatus(`Exported ${notes.length} note${notes.length === 1 ? "" : "s"}`);
  messageDialogTitle.textContent = "Export complete";
  messageDialogBody.textContent = `Wrote the selected output to ${exportRoot}.`;
  messageDialog.showModal();
}

function openExportDialog() {
  if (!projects.isOpen) {
    runProjectAction(async () => { throw new Error("Open a project before exporting"); });
    return;
  }
  exportNotebookSelect.replaceChildren();
  for (const notebook of projects.notebookList) {
    const option = document.createElement("option");
    option.value = notebook.path;
    option.textContent = notebook.title;
    option.selected = notebook.path === projects.currentNotebookPath;
    exportNotebookSelect.append(option);
  }
  exportScopeSelect.value = "note";
  exportMarkdown.checked = true;
  exportHtml.checked = true;
  setQuickExport.checked = false;
  updateExportNotebookChoice();
  exportDialog.showModal();
}

function quickExport() {
  if (!projects.isOpen) {
    runProjectAction(async () => { throw new Error("Open a project before exporting"); });
    return;
  }
  runProjectAction(() => exportScope({
    scope: projects.project.quickExportScope,
    notebookPath: projects.currentNotebookPath,
    includeMarkdown: true,
    includeHtml: true,
    quick: true,
  }));
}

async function renameProjectNote(path, currentTitle) {
  const title = await requestName({ title: "Rename note", label: "Note title", value: currentTitle.replace(/\.md$/, "") });
  if (!title) return;
  if (dirty) await saveNote();
  await loadNote(await projects.renameNote(path, title));
}

async function commitProjectNote(path, title) {
  if (dirty && path === projects.currentNotePath) await saveNote();
  const message = await requestName({ title: "Commit note", label: `Commit message for ${title}`, value: `Update ${title.replace(/\.md$/, "")}` });
  if (!message) return;
  const result = await invoke("git_commit_note", {
    projectRoot: projects.project.directory,
    notePath: path,
    message,
  });
  setStatus("Committed note");
  messageDialogTitle.textContent = "Git commit created";
  messageDialogBody.textContent = result;
  messageDialog.showModal();
}

function refreshProjectControls() {
  const open = projects.isOpen;
  updateSaveButton();
  newNotebookButton.disabled = !open;
  newNoteButton.disabled = !open;
  projectSidebar.hidden = !open;
  workspace.classList.toggle("has-project", open);
  if (!open) {
    projectTree.replaceChildren();
    return;
  }

  projectTree.replaceChildren();
  const projectManifest = document.createElement("button");
  projectManifest.type = "button";
  projectManifest.className = "tree-manifest";
  projectManifest.textContent = "project.toml";
  projectManifest.setAttribute("aria-current", String(activeDocument.kind === "toml" && activeDocument.path === projects.project.path));
  addDelayedTreeSelection(projectManifest, () => loadToml(projects.project.path, "Project manifest"));
  projectTree.append(projectManifest);
  collapsedNotebooks.delete(projects.currentNotebookPath);
  for (const notebook of projects.notebookList) {
    const notebookEntry = document.createElement("section");
    notebookEntry.className = "tree-notebook-entry";
    const notebookRow = document.createElement("div");
    notebookRow.className = "tree-notebook-row";
    const expanded = !collapsedNotebooks.has(notebook.path);
    const collapseButton = document.createElement("button");
    collapseButton.type = "button";
    collapseButton.className = "tree-collapse";
    collapseButton.textContent = expanded ? "▾" : "▸";
    collapseButton.title = expanded ? "Collapse notebook" : "Expand notebook";
    collapseButton.setAttribute("aria-label", collapseButton.title);
    collapseButton.setAttribute("aria-expanded", String(expanded));
    collapseButton.addEventListener("click", () => {
      if (collapsedNotebooks.has(notebook.path)) collapsedNotebooks.delete(notebook.path);
      else collapsedNotebooks.add(notebook.path);
      refreshProjectControls();
    });
    const notebookButton = document.createElement("button");
    notebookButton.type = "button";
    notebookButton.className = "tree-notebook";
    notebookButton.textContent = notebook.title;
    notebookButton.setAttribute("aria-current", String(notebook.path === projects.currentNotebookPath));
    addDelayedTreeSelection(notebookButton, async () => {
      if (dirty) await saveNote();
      await loadNote(await projects.selectNotebook(notebook.path));
    });
    enableTreeRename(notebookButton, notebook.title, (title) => projects.renameNotebook(notebook.path, title));
    notebookRow.append(collapseButton, notebookButton);
    notebookEntry.append(notebookRow);

    const manifest = projects.notebooks.get(notebook.path);
    const noteList = document.createElement("div");
    noteList.className = "tree-note-list";
    noteList.hidden = !expanded;
    const notebookManifest = document.createElement("button");
    notebookManifest.type = "button";
    notebookManifest.className = "tree-manifest tree-notebook-manifest";
    notebookManifest.textContent = "notebook.toml";
    notebookManifest.setAttribute("aria-current", String(activeDocument.kind === "toml" && activeDocument.path === notebook.path));
    addDelayedTreeSelection(notebookManifest, () => loadToml(notebook.path, `${notebook.title} manifest`));
    noteList.append(notebookManifest);
    for (const relativePath of manifest.notes) {
      const path = `${notebook.path.slice(0, notebook.path.lastIndexOf("/"))}/${relativePath}`;
      const noteButton = document.createElement("button");
      noteButton.type = "button";
      noteButton.className = "tree-note";
      noteButton.textContent = relativePath;
      noteButton.setAttribute("aria-current", String(path === projects.currentNotePath));
      addDelayedTreeSelection(noteButton, async () => {
        if (dirty) await saveNote();
        await loadNote(await projects.selectNote(path));
      });
      enableTreeRename(noteButton, relativePath.replace(/\.md$/, ""), (title) => projects.renameNote(path, title));
      noteButton.addEventListener("contextmenu", (event) => showFileContextMenu(event, { path, title: relativePath }));
      noteList.append(noteButton);
    }
    notebookEntry.append(noteList);
    projectTree.append(notebookEntry);
  }
  workspaceTitle.textContent = projects.project.title;
}

async function saveNote() {
  if (!projects.isOpen) return;
  if (activeDocument.kind === "toml") {
    await projects.saveManifest(activeDocument.path, editor.state.doc.toString());
  } else {
    await projects.saveCurrentNote(editor.state.doc.toString());
  }
  dirty = false;
  updateSaveButton();
  setStatus(activeDocument.kind === "toml" ? "Saved manifest" : "Saved");
  refreshProjectControls();
}

async function loadNote(note) {
  activeDocument = { kind: "note", path: note.path };
  editorKind.textContent = "Markdown";
  setDocument(note.source);
  refreshProjectControls();
  setStatus(`Opened ${note.path.split("/").at(-1)}`);
  await rememberCurrentProject();
}

async function rememberCurrentProject() {
  if (!projects.isOpen || projects.project.directory === recentProjectPath) return;
  try {
    await invoke("record_recent_project", {
      path: projects.project.directory,
      title: projects.project.title,
    });
    recentProjectPath = projects.project.directory;
  } catch {
    // Project opening remains available even if the operating system cannot persist recents.
  }
}

async function loadToml(path, label) {
  activeDocument = { kind: "toml", path };
  editorKind.textContent = "TOML";
  setDocument(await readTextFile(path));
  refreshProjectControls();
  setStatus(`Opened ${label}`);
}

async function runProjectAction(action) {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showError(message);
  }
}

function requestName({ title, label, value }) {
  return new Promise((resolve) => {
    nameDialogTitle.textContent = title;
    nameDialogLabel.textContent = label;
    nameDialogInput.value = value;
    nameDialog.addEventListener("close", () => {
      resolve(nameDialog.returnValue === "confirm" ? nameDialogInput.value.trim() : null);
    }, { once: true });
    nameDialog.showModal();
    nameDialogInput.focus();
    nameDialogInput.select();
  });
}

document.querySelectorAll(".app-dialog button[value=cancel]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close("cancel"));
});

const editor = new EditorView({
  state: EditorState.create({
    doc: initialDocument,
    extensions: [
      basicSetup,
      markdown(),
      EditorView.domEventHandlers({
        keydown(event) {
          return handleRunShortcut(event);
        },
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        latestRuns = [];
        renderMarkdown(update.state.doc.toString());
        if (!loadingDocument) {
          dirty = true;
          updateSaveButton();
          setStatus(projects.isOpen ? "Edited · ⌘S to save" : "Edited · run notebook to refresh results");
        }
      }),
    ],
  }),
  parent: editorHost,
});

runButton.addEventListener("click", runNotebook);
toggleRightPaneButton.addEventListener("click", toggleRightPane);
newProjectButton.addEventListener("click", () => runProjectAction(async () => {
  const title = await requestName({ title: "New RiX project", label: "Project name", value: "RiX Project" });
  if (!title) return;
  const note = await projects.createProject(title);
  if (note) await loadNote(note);
}));
openProjectButton.addEventListener("click", () => runProjectAction(async () => {
  const note = await projects.chooseAndOpenProject();
  if (note) await loadNote(note);
}));
saveNoteButton.addEventListener("click", () => runProjectAction(saveNote));
newNotebookButton.addEventListener("click", () => runProjectAction(async () => {
  const title = await requestName({ title: "New notebook", label: "Notebook title", value: "Notebook" });
  if (!title) return;
  const note = await projects.createNotebook(title);
  await loadNote(note);
}));
newNoteButton.addEventListener("click", () => runProjectAction(async () => {
  const title = await requestName({ title: "New note", label: "Note title", value: "Untitled note" });
  if (!title) return;
  const note = await projects.createNote(title);
  await loadNote(note);
}));
exportScopeSelect.addEventListener("change", updateExportNotebookChoice);
exportDialog.addEventListener("close", () => {
  if (exportDialog.returnValue !== "confirm") return;
  const scope = exportScopeSelect.value;
  const notebookPath = exportNotebookSelect.value || projects.currentNotebookPath;
  runProjectAction(async () => {
    if (setQuickExport.checked) {
      await projects.setQuickExportScope(scope === "project" ? "project" : "notebook");
    }
    await exportScope({
      scope,
      notebookPath,
      includeMarkdown: exportMarkdown.checked,
      includeHtml: exportHtml.checked,
    });
  });
});
fileContextMenu.addEventListener("click", (event) => {
  const action = event.target.closest("button")?.dataset.fileAction;
  const context = fileContext;
  hideFileContextMenu();
  if (!action || !context) return;
  runProjectAction(async () => {
    if (action === "rename") await renameProjectNote(context.path, context.title);
    if (action === "commit") await commitProjectNote(context.path, context.title);
    if (action === "delete") {
      const confirmed = await requestConfirmation({
        title: "Move note to Trash?",
        message: `Move ${context.title} to the macOS Trash? You can restore it from there.`,
        confirmLabel: "Move to Trash",
      });
      if (!confirmed) return;
      if (dirty && context.path === projects.currentNotePath) dirty = false;
      await invoke("move_note_to_trash", {
        projectRoot: projects.project.directory,
        notePath: context.path,
      });
      const nextNote = await projects.deleteNote(context.path);
      if (nextNote) await loadNote(nextNote);
      else refreshProjectControls();
      setStatus(`Moved ${context.title} to the Trash`);
    }
  });
});
window.addEventListener("click", hideFileContextMenu);
window.addEventListener("resize", hideFileContextMenu);
closeAppNoticeButton.addEventListener("click", hideError);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideFileContextMenu();
});
listen("menu-command", (event) => {
  const commands = {
    "new-project": () => newProjectButton.click(),
    "open-project": () => openProjectButton.click(),
    "save-note": () => saveNoteButton.click(),
    "save-and-commit": () => runProjectAction(saveAndCommitCurrentNote),
    "new-notebook": () => newNotebookButton.click(),
    "new-note": () => newNoteButton.click(),
    "toggle-right-pane": toggleRightPane,
    export: () => openExportDialog(),
    "quick-export": () => quickExport(),
  };
  commands[event.payload]?.();
});
listen("open-recent-project", (event) => {
  runProjectAction(async () => {
    const note = await projects.openProject(event.payload);
    if (note) await loadNote(note);
  });
});
window.addEventListener("keydown", (event) => {
  if (handleRunShortcut(event)) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n" && !event.shiftKey) {
    event.preventDefault();
    newNoteButton.click();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "n") {
    event.preventDefault();
    newNotebookButton.click();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "a") {
    event.preventDefault();
    newProjectButton.click();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
    event.preventDefault();
    openProjectButton.click();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    event.stopImmediatePropagation();
    runProjectAction(event.shiftKey ? saveAndCommitCurrentNote : saveNote);
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e") {
    event.preventDefault();
    if (event.shiftKey) quickExport();
    else openExportDialog();
    return;
  }
  if (!isPreviewShortcut(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  toggleRightPane();
}, { capture: true });
renderMarkdown(initialDocument);
runNotebook();
