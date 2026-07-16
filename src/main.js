import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import MarkdownIt from "markdown-it";
import renderMathInElement from "katex/contrib/auto-render";
import "katex/dist/katex.min.css";
import { convertFileSrc } from "@tauri-apps/api/core";
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
const projects = new ProjectManager();
let latestRuns = [];
let activeRightPane = "results";
let loadingDocument = false;
let dirty = false;

const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

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
  return (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "p";
}

function setRightPane(pane) {
  activeRightPane = pane;
  const showPreview = pane === "preview";
  previewPane.hidden = !showPreview;
  outputPane.hidden = showPreview;
  toggleRightPaneButton.textContent = showPreview ? "Show results" : "Show preview";
  toggleRightPaneButton.title = showPreview
    ? "Show RiX results (⌘⇧P)"
    : "Show rendered preview (⌘⇧P)";
  toggleRightPaneButton.setAttribute("aria-pressed", String(showPreview));
}

function toggleRightPane() {
  setRightPane(activeRightPane === "results" ? "preview" : "results");
}

function setStatus(message) {
  status.textContent = message;
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

function enableTreeRename(button, initialValue, renameAction) {
  button.addEventListener("dblclick", () => {
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
  for (const notebook of projects.notebookList) {
    const notebookButton = document.createElement("button");
    notebookButton.type = "button";
    notebookButton.className = "tree-notebook";
    notebookButton.textContent = notebook.title;
    notebookButton.setAttribute("aria-current", String(notebook.path === projects.currentNotebookPath));
    notebookButton.addEventListener("click", () => runProjectAction(async () => {
      if (dirty) await saveNote();
      await loadNote(await projects.selectNotebook(notebook.path));
    }));
    enableTreeRename(notebookButton, notebook.title, (title) => projects.renameNotebook(notebook.path, title));
    projectTree.append(notebookButton);

    const manifest = projects.notebooks.get(notebook.path);
    for (const relativePath of manifest.notes) {
      const path = `${notebook.path.slice(0, notebook.path.lastIndexOf("/"))}/${relativePath}`;
      const noteButton = document.createElement("button");
      noteButton.type = "button";
      noteButton.className = "tree-note";
      noteButton.textContent = relativePath;
      noteButton.setAttribute("aria-current", String(path === projects.currentNotePath));
      noteButton.addEventListener("click", () => runProjectAction(async () => {
        if (dirty) await saveNote();
        await loadNote(await projects.selectNote(path));
      }));
      enableTreeRename(noteButton, relativePath.replace(/\.md$/, ""), (title) => projects.renameNote(path, title));
      projectTree.append(noteButton);
    }
  }
  workspaceTitle.textContent = projects.project.title;
}

async function saveNote() {
  if (!projects.isOpen) return;
  await projects.saveCurrentNote(editor.state.doc.toString());
  dirty = false;
  updateSaveButton();
  setStatus("Saved");
}

async function loadNote(note) {
  setDocument(note.source);
  refreshProjectControls();
  setStatus(`Opened ${note.path.split("/").at(-1)}`);
}

async function runProjectAction(action) {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message);
    messageDialogTitle.textContent = "Project error";
    messageDialogBody.textContent = message;
    messageDialog.showModal();
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
window.addEventListener("keydown", (event) => {
  if (handleRunShortcut(event)) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n" && !event.shiftKey) {
    event.preventDefault();
    newProjectButton.click();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "n") {
    event.preventDefault();
    newNotebookButton.click();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "a") {
    event.preventDefault();
    newNoteButton.click();
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
    runProjectAction(saveNote);
    return;
  }
  if (!isPreviewShortcut(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  toggleRightPane();
}, { capture: true });
renderMarkdown(initialDocument);
runNotebook();
