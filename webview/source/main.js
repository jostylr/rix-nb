import { EditorState } from "@codemirror/state";
import { EditorView, hoverTooltip } from "@codemirror/view";
import { autocompletion } from "@codemirror/autocomplete";
import { linter } from "@codemirror/lint";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import MarkdownIt from "markdown-it";
import katex from "katex";
import renderMathInElement from "katex/contrib/auto-render";
import "katex/dist/katex.min.css";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { copyFile, exists, mkdir, readDir, readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { Integer } from "@ratmath/core";
import {
  createDefaultSystemContext,
  enhanceSheetViews,
  formatValue,
  isOutputValue,
  lower,
  mountOutputWidgets,
  parse,
  parseAndEvaluate,
  renderGraphicSvg,
  renderOutputHtml,
} from "../../../rix/src/index.js";
import { rixHighlighting, rixLanguage } from "../../../rix/src/tools/codemirror/index.js";
import docshellManifest from "../../docshell.manifest.json" with { type: "json" };
import { createFilePolicy } from "../../docshell/src/file-policy.js";
import { createTauriDocumentStore } from "../../docshell/src/tauri-document-store.js";
import { ProjectManager } from "./project.js";
import { createNotebookBundledPluginCatalog } from "./bundled-plugin-catalog.js";
import {
  configuredPluginDirectories,
  configuredPluginIds,
  createProjectPluginCatalog,
  pluginTutorialIdFromPath,
  requestedPluginIds,
} from "./plugin-catalog.js";
import { applyProjectTheme, DEFAULT_PROJECT_THEME } from "./theme.js";
import {
  createRixNotebookEngine,
  diagnosticForRixError,
  extractRixCells,
  isInRixCell,
  parseFenceMetadata,
  renderStaticDocument,
  staticOutputMarkdown,
} from "./notebook-web/rix-engine.js";
import "../../docshell/styles/tokens.css";
import "./styles.css";

const filePolicy = createFilePolicy(docshellManifest.files);

const editorHost = document.querySelector("#markdown-editor");
const initialDocument = editorHost.textContent.trim();
editorHost.textContent = "";
const preview = document.querySelector("#markdown-preview");
const output = document.querySelector("#rix-output");
const outputPane = document.querySelector("#output-pane");
const mainResizer = document.querySelector("#main-resizer");
const editorPane = document.querySelector(".editor-pane");
const collapseDocumentPaneButton = document.querySelector("#collapse-document-pane");
const collapseEditorPaneButton = document.querySelector("#collapse-editor-pane");
const centerPanesButton = document.querySelector("#center-panes");
const sliderControls = document.querySelector("#slider-controls");
const sliderControlList = document.querySelector("#slider-control-list");
const previewPane = document.querySelector("#preview-pane");
const runButton = document.querySelector("#run-notebook");
const reloadPluginsButton = document.querySelector("#reload-plugins");
const toggleRightPaneButton = document.querySelector("#toggle-right-pane");
const togglePreviewModeButton = document.querySelector("#toggle-preview-mode");
const rightPaneTitle = document.querySelector("#right-pane-title");
const status = document.querySelector("#document-status");
const workspaceTitle = document.querySelector("#workspace-title");
const workspace = document.querySelector(".workspace");
const editorKind = document.querySelector("#editor-kind");
const newProjectButton = document.querySelector("#new-project");
const openProjectButton = document.querySelector("#open-project");
const openRecentButton = document.querySelector("#open-recent");
const openRecentMenu = document.querySelector("#open-recent-menu");
const toggleSidebarButton = document.querySelector("#toggle-sidebar");
const saveNoteButton = document.querySelector("#save-note");
const exportNotebookButton = document.querySelector("#export-notebook");
const newNotebookButton = document.querySelector("#new-notebook");
const newFolderButton = document.querySelector("#new-folder");
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
const helpDialog = document.querySelector("#help-dialog");
const closeHelpButton = document.querySelector("#close-help");
const maximizeHelpButton = document.querySelector("#maximize-help");
const helpTopic = document.querySelector("#help-topic");
const helpContent = document.querySelector("#help-content");
const helpExternalLink = document.querySelector("#help-external-link");
const fileContextMenu = document.querySelector("#file-context-menu");
const exportDialog = document.querySelector("#export-dialog");
const exportScopeSelect = document.querySelector("#export-scope");
const exportNotebookLabel = document.querySelector("#export-notebook-label");
const exportNotebookSelect = document.querySelector("#export-notebook-select");
const exportMarkdown = document.querySelector("#export-markdown");
const exportHtml = document.querySelector("#export-html");
const exportQuarto = document.querySelector("#export-quarto");
const setQuickExport = document.querySelector("#set-quick-export");
const appNotice = document.querySelector("#app-notice");
const appNoticeMessage = document.querySelector("#app-notice-message");
const closeAppNoticeButton = document.querySelector("#close-app-notice");
const pluginSettingsDialog = document.querySelector("#plugin-settings-dialog");
const pluginDirectoryList = document.querySelector("#plugin-directory-list");
const addPluginDirectoryButton = document.querySelector("#add-plugin-directory");
const allowJavaScriptPluginsInput = document.querySelector("#allow-javascript-plugins");
const autoLoadPluginsInput = document.querySelector("#auto-load-plugins");
const javaScriptPluginDialog = document.querySelector("#javascript-plugin-dialog");
const javaScriptPluginMessage = document.querySelector("#javascript-plugin-message");
// Native shell owns Tauri.  The notebook engine and project schema only see
// their explicit adapters, which also lets the web workbench run elsewhere.
const documentStore = createTauriDocumentStore();
const projects = new ProjectManager(documentStore);
let latestRuns = [];
let activeRightPane = "results";
let previewMode = "live";
let loadingDocument = false;
let dirty = false;
let fileContext = null;
let activeDocument = { kind: "note", path: null };
const collapsedNotebooks = new Set();
let recentProjectKey = null;
let liveRunTimer = null;
let renderedSliderSignature = "";
let sidebarCollapsed = false;
let sidebarProjectDirectory = null;
let editorPaneRatio = null;
let paneLayout = "both";
let folderWorkspace = null;
let helpCatalog = null;
let pluginCatalogTemplate = createNotebookBundledPluginCatalog();
let configuredPlugins = [];
let tutorialPluginId = null;
let pluginSettings = {
  pluginDirectories: [],
  allowJavascriptPlugins: false,
  autoLoadPlugins: [],
  approvedJavascriptPlugins: [],
};
let editingPluginSettings = null;
const rixEngine = createRixNotebookEngine({ pluginCatalog: pluginCatalogTemplate, plugins: configuredPlugins });
let staticPreviewObjectUrls = [];
let outputWidgetDisposers = [];
let previewWidgetDisposers = [];
const sliderOverrides = new Map();

const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

const exportMarkdownRenderer = new MarkdownIt({ html: false, linkify: true, typographer: true });
const KATEX_PUBLIC_ROOT = new URL(`${import.meta.env.BASE_URL}katex/`, window.location.origin);
const LIVE_RUNTIME_PUBLIC_ROOT = new URL(`${import.meta.env.BASE_URL}rix-live/`, window.location.origin);
const HELP_PUBLIC_ROOT = new URL(`${import.meta.env.BASE_URL}help/`, window.location.origin);

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
  const metadata = run?.metadata || parseFenceMetadata(token.info.trim().replace(/^rix(?:\s+|$)/i, ""));
  const renderedCode = metadata.showCode ? code : "";
  if (!run || !run.liveOutput || !metadata.showOutput) {
    return renderedCode ? `<div class="rix-preview-cell">${renderedCode}</div>` : "";
  }
  const result = run.liveOutput;
  const html = isOutputValue(result.value) ? renderOutputHtml(result.value, formatValue) : `<pre>${escapeHtml(result.content)}</pre>`;
  return `<div class="rix-preview-cell">${renderedCode}<div class="rix-preview-results"><div class="rix-preview-result">${html}</div></div></div>`;
};

function resolveProjectAsset(source) {
  const notePath = ["file", "folder-file"].includes(activeDocument.kind) ? activeDocument.path : projects.currentNotePath;
  if (!notePath || /^(?:[a-z]+:|\/)/i.test(source)) return source;
  const pieces = [...notePath.split("/").slice(0, -1), ...source.split("/")];
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
  const notePath = ["file", "folder-file"].includes(activeDocument.kind) ? activeDocument.path : projects.currentNotePath;
  if (!source || !notePath || /^(?:[a-z]+:|\/)/i.test(source)) {
    return defaultImageRenderer(tokens, index, options, env, self);
  }
  token.attrSet("src", convertFileSrc(resolveProjectAsset(source)));
  const rendered = defaultImageRenderer(tokens, index, options, env, self);
  token.attrSet("src", source);
  return rendered;
};

function releaseStaticPreviewObjectUrls() {
  for (const url of staticPreviewObjectUrls) URL.revokeObjectURL(url);
  staticPreviewObjectUrls = [];
}

function disposeWidgetMounts(disposers) {
  for (const dispose of disposers.splice(0)) dispose();
}

function widgetEvaluation(source, runtime, line, mode) {
  return parseAndEvaluate(mode === "formula" ? `@{ ${source} }` : source, {
    context: runtime.context,
    registry: runtime.registry,
    systemContext: runtime.systemContext,
    file: `<widget edit at line ${line}>`,
  });
}

function mountNotebookWidgets(root, value, runtime, line, disposers) {
  disposers.push(mountOutputWidgets(root, value, {
    format: formatValue,
    onActivate: insertSheetAddress,
    evaluateEdit: (source, { mode }) => widgetEvaluation(source, runtime, line, mode),
  }));
}

function renderMarkdown(source, runs = latestRuns, { preserveStaticPreviewAssets = false, runtime = null } = {}) {
  if (!preserveStaticPreviewAssets) releaseStaticPreviewObjectUrls();
  disposeWidgetMounts(previewWidgetDisposers);
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
  if (runtime) {
    const roots = [...preview.querySelectorAll(".rix-preview-result")];
    const visibleRuns = runs.filter((run) => run?.liveOutput && run.metadata.showOutput);
    for (const [index, run] of visibleRuns.entries()) {
      const root = roots[index];
      if (root) mountNotebookWidgets(root, run.liveOutput.value, runtime, run.statements.at(-1)?.line || 1, previewWidgetDisposers);
    }
  } else {
    enhanceSheetViews(preview, { onActivate: insertSheetAddress });
  }
}

function setPreviewStale(stale) {
  previewPane.classList.toggle("is-stale", stale);
}

function stripMarkdownFrontmatter(source) {
  return source.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

async function loadHelpCatalog() {
  if (helpCatalog) return helpCatalog;
  const response = await fetch(new URL("index.json", HELP_PUBLIC_ROOT));
  if (!response.ok) throw new Error("The bundled help files are unavailable. Run bun run sync:help.");
  helpCatalog = await response.json();
  const groups = [
    ["RiX Notebook", helpCatalog.notebook],
    ["RiX documentation", helpCatalog.references],
    ["RiX tutorials", helpCatalog.tutorials],
  ];
  helpTopic.replaceChildren();
  for (const [label, entries] of groups) {
    const group = document.createElement("optgroup");
    group.label = label;
    for (const entry of entries) {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entry.title;
      option.dataset.helpPath = entry.path;
      group.append(option);
    }
    helpTopic.append(group);
  }
  return helpCatalog;
}

async function showHelpTopic(id) {
  const catalog = await loadHelpCatalog();
  const entries = [...catalog.notebook, ...catalog.references, ...catalog.tutorials];
  const entry = entries.find((candidate) => candidate.id === id) || entries[0];
  helpTopic.value = entry.id;
  helpContent.textContent = "Loading…";
  helpContent.classList.toggle("help-content-tutorial", Boolean(entry.htmlPath || entry.url));
  helpExternalLink.hidden = !entry.url;
  if (entry.url) helpExternalLink.href = entry.url;
  if (entry.htmlPath || entry.url) {
    const tutorial = document.createElement("iframe");
    tutorial.className = "tutorial-frame";
    tutorial.title = entry.title;
    tutorial.src = entry.url || new URL(entry.htmlPath, HELP_PUBLIC_ROOT).toString();
    helpContent.replaceChildren(tutorial);
    return;
  }
  const response = await fetch(new URL(entry.path, HELP_PUBLIC_ROOT));
  if (!response.ok) throw new Error(`Could not load ${entry.title}`);
  helpContent.innerHTML = markdownRenderer.render(stripMarkdownFrontmatter(await response.text()), { rixRuns: [], rixCellIndex: 0 });
  renderMathInElement(helpContent, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
      { left: "\\(", right: "\\)", display: false },
      { left: "\\[", right: "\\]", display: true },
    ],
    throwOnError: false,
  });
}

async function openHelp(section = "notebook") {
  try {
    const catalog = await loadHelpCatalog();
    const firstTopic = section === "tutorials"
      ? catalog.tutorials[0]?.id
      : section === "rix"
        ? catalog.references[0]?.id
        : catalog.notebook[0]?.id;
    if (!helpDialog.open) helpDialog.showModal();
    await showHelpTopic(firstTopic);
  } catch (error) {
    helpContent.textContent = error instanceof Error ? error.message : String(error);
    if (!helpDialog.open) helpDialog.showModal();
  }
}

// The runtime parser is deliberately used here instead of the editor grammar:
// this catches only syntax/lowering errors and never evaluates notebook code.
const rixNotebookLinter = linter((view) => {
  if (activeDocument.kind !== "note") return [];
  const diagnostics = [];
  for (const cell of extractRixCells(view.state.doc.toString())) {
    try {
      lower(parse(cell.code));
    } catch (error) {
      diagnostics.push(diagnosticForRixError(error, cell));
    }
  }
  return diagnostics;
}, { delay: 350 });

const notebookSystemContext = createDefaultSystemContext({
  pluginCatalog: createNotebookBundledPluginCatalog(),
});
const systemCompletions = notebookSystemContext.getAllNames().map((name) => ({
  label: name,
  type: "function",
  detail: `.${name}`,
  info: notebookSystemContext.get(name)?.doc || "RiX system capability",
}));

const rixSyntaxCompletions = [
  { label: ":=", type: "operator", detail: "assignment", info: "Assign a value to a lowercase identifier." },
  { label: "??", type: "operator", detail: "conditional", info: "Start a RiX conditional expression." },
  { label: "?:", type: "operator", detail: "otherwise", info: "Separate the fallback branch of a conditional." },
  { label: "{=", type: "keyword", detail: "map", info: "Start a map container." },
  { label: "{?", type: "keyword", detail: "case", info: "Start a case container." },
  { label: "{;", type: "keyword", detail: "block", info: "Start a block container." },
  { label: "{|", type: "keyword", detail: "set", info: "Start a set container." },
  { label: "{:", type: "keyword", detail: "tuple", info: "Start a tuple container." },
  { label: "{@", type: "keyword", detail: "loop", info: "Start a loop container." },
];

function rixCompletionSource(context) {
  const source = context.state.doc.toString();
  if (!isInRixCell(source, context.pos)) return null;
  const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
  const wordStart = word?.from ?? context.pos;
  const systemMember = source[wordStart - 1] === ".";
  if (systemMember) {
    if (!word && !context.explicit) return null;
    return { from: wordStart, options: systemCompletions };
  }
  if (!word && !context.explicit) return null;
  return { from: wordStart, options: rixSyntaxCompletions };
}

const RIX_HOVER_HELP = new Map([
  [":=", "Assign a value. RiX assignment targets lowercase identifiers."],
  ["??", "Conditional operator. Use `condition ?? yes ?: no`."],
  ["?:", "Fallback branch of a RiX conditional."],
  ["{=", "Map container. Example: `{= radius=3}`."],
  ["{?", "Case container."],
  ["{;", "Block container."],
  ["{|", "Set container."],
  ["{:", "Tuple container."],
  ["{@", "Loop container."],
]);

function rixHoverTooltip(view, position) {
  const source = view.state.doc.toString();
  if (!isInRixCell(source, position)) return null;
  const before = source.slice(0, position + 1);
  const match = before.match(/(?:\.[A-Za-z_][A-Za-z0-9_]*|:=|\?\?|\?:|\{[=\?;|:@])$/);
  if (!match) return null;
  const token = match[0];
  const capability = token.startsWith(".") ? notebookSystemContext.get(token.slice(1).toUpperCase()) : null;
  const message = capability?.doc || RIX_HOVER_HELP.get(token);
  if (!message) return null;
  return {
    pos: position + 1 - token.length,
    end: position + 1,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "rix-editor-tooltip";
      dom.textContent = message;
      return { dom };
    },
  };
}

function jumpToLine(line) {
  const target = editor.state.doc.line(Math.min(line, editor.state.doc.lines));
  editor.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
  editor.focus();
}

function insertSheetAddress({ address }) {
  const selection = editor.state.selection.main;
  editor.dispatch({
    changes: { from: selection.from, to: selection.to, insert: address },
    selection: { anchor: selection.from + address.length },
    scrollIntoView: true,
  });
  editor.focus();
}

function appendOutput(statement, runtime) {
  const result = document.createElement("section");
  result.className = `cell-result cell-result-${statement.kind}`;
  result.tabIndex = 0;
  result.setAttribute("role", "button");
  result.setAttribute("aria-label", `Jump to RiX statement on line ${statement.line}`);

  const lineNumber = document.createElement("span");
  lineNumber.className = "cell-result-line-number";
  lineNumber.textContent = `line ${statement.line}`;
  const source = document.createElement("pre");
  source.className = "cell-source";
  source.textContent = statement.code.replaceAll("\n", " ↵ ");
  source.title = statement.code;

  const value = document.createElement(statement.html ? "div" : "pre");
  value.className = "cell-result-value";
  if (statement.html) {
    value.innerHTML = statement.html;
    mountNotebookWidgets(value, statement.value, runtime, statement.line, outputWidgetDisposers);
    if (value.querySelector(".rix-output-sheet, .rix-output-control-panel, .rix-output-graphic[data-rix-interactive=\"true\"]")) {
      result.removeAttribute("tabindex");
      result.setAttribute("role", "group");
      result.setAttribute("aria-label", `Interactive RiX result on line ${statement.line}`);
    }
  }
  else value.textContent = statement.content.replaceAll("\n", " ↵ ");
  value.title = statement.content;

  result.append(lineNumber, source, value);
  result.addEventListener("click", (event) => {
    if (event.target.closest("button, input, select, textarea, [data-rix-drag-target], td[data-rix-address]")) return;
    jumpToLine(statement.line);
  });
  result.addEventListener("keydown", (event) => {
    if (event.target !== result) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    jumpToLine(statement.line);
  });
  output.append(result);
}

function executeDocument(source, options = {}) {
  return rixEngine.executeDocument(source, {
    ...options,
    sliderOverrides: options.sliderOverrides || sliderOverrides,
    pluginCatalog: options.pluginCatalog || pluginCatalogTemplate,
    plugins: options.plugins || configuredPlugins,
  });
}

function staticPreviewGraphicUrl(graphic) {
  const url = URL.createObjectURL(new Blob([renderGraphicSvg(graphic)], { type: "image/svg+xml" }));
  staticPreviewObjectUrls.push(url);
  return url;
}

function staticCellReplacement(run, graphicReference) {
  if (run?.metadata.role === "set") return "";
  if (!run?.staticOutput) return "";
  if (run.staticOutput.kind === "error") return `> **RiX export error:** ${run.staticOutput.content}`;
  return staticOutputMarkdown(run.staticOutput.value, { graphicReference });
}

function quartoRuntimeSourceMarkup(cell) {
  const header = escapeHtml(cell.metadata.raw);
  return `\n\n::: {.content-hidden when-format="pdf"}\n\`\`\`{.rix .rix-runtime-source data-rix-source-cell="true" data-rix-cell="${cell.index}" data-rix-header="${header}" style="display: none"}\n${cell.code.trimEnd()}\n\`\`\`\n:::\n\n`;
}

function renderQuartoDocumentContent(document, runs, inlineRuns, options = {}) {
  const inlineByStart = new Map(inlineRuns.map((run) => [run.start, run]));
  const graphicReference = options.graphicReference || null;
  const includeRuntimeSource = options.includeRuntimeSource === true;
  return document.content.map((node) => {
    if (node.type === "markdown") return node.source;
    if (node.type === "inline") return inlineByStart.get(node.start)?.replacement || "";
    const run = runs[node.value.index];
    const staticContent = staticCellReplacement(run, graphicReference);
    const runtimeSource = includeRuntimeSource ? quartoRuntimeSourceMarkup(node.value) : "";
    if (!options.liveCellIndexes?.has(node.value.index)) return `${runtimeSource}${staticContent ? `\n\n${staticContent}\n\n` : ""}`;
    return `${runtimeSource}\n\n::: {.rix-static}\n${staticContent}\n:::\n\n::: {.rix-live}\n${liveWidgetMarkup(node.value.index, node.value.metadata.showCode)}\n:::\n\n`;
  }).join("");
}

function renderSliderControls(sliders) {
  sliderControls.hidden = sliders.length === 0;
  if (sliders.length === 0) {
    renderedSliderSignature = "";
    sliderControlList.replaceChildren();
    return;
  }

  const signature = sliders.map((slider) => [
    slider.id,
    slider.low.toString(),
    slider.high.toString(),
    slider.step.toString(),
    slider.steps,
    slider.startIndex,
  ].join(":")).join("|");

  if (signature === renderedSliderSignature) {
    for (const [index, slider] of sliders.entries()) {
      const control = sliderControlList.children[index];
      const input = control.querySelector("input");
      const value = control.querySelector("output");
      if (document.activeElement !== input) input.value = String(slider.index);
      value.textContent = formatValue(slider.value);
    }
    return;
  }

  renderedSliderSignature = signature;
  sliderControlList.replaceChildren();
  for (const slider of sliders) {
    const control = document.createElement("label");
    control.className = "slider-control";
    const heading = document.createElement("span");
    heading.className = "slider-control-heading";
    const sliderName = document.createElement("span");
    sliderName.textContent = `${slider.name} · `;
    const lineNumber = document.createElement("span");
    lineNumber.className = "slider-line-number";
    lineNumber.textContent = `Line ${slider.line}`;
    heading.append(sliderName, lineNumber);
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = String(slider.steps);
    input.step = "1";
    input.value = String(slider.index);
    const value = document.createElement("output");
    value.textContent = formatValue(slider.value);
    value.style.width = `${slider.valueWidth}ch`;
    input.addEventListener("pointerdown", () => {
      window.requestAnimationFrame(() => input.focus());
    });
    input.addEventListener("click", () => input.focus());
    input.addEventListener("input", () => {
      sliderOverrides.set(slider.id, Number(input.value));
      const nextValue = slider.low.add(slider.step.multiply(new Integer(BigInt(input.value))));
      value.textContent = formatValue(nextValue);
      scheduleNotebookRun(180);
    });
    input.addEventListener("change", runNotebook);
    control.append(heading, input, value);
    sliderControlList.append(control);
  }
}

function renderDocumentPreview(documentRun) {
  if (previewMode === "live") {
    renderMarkdown(documentRun.renderedSource, documentRun.runs, { runtime: documentRun.runtime });
    return;
  }
  const staticRun = executeDocument(documentRun.document.source, { mode: "static", sliderOverrides: new Map() });
  releaseStaticPreviewObjectUrls();
  const staticSource = renderStaticDocument(
    staticRun.document,
    staticRun.runs,
    staticRun.inlineRuns,
    { graphicReference: staticPreviewGraphicUrl },
  );
  renderStaticPreview(staticSource);
}

function renderStaticPreview(source) {
  const mathFragments = [];
  const markdownSource = source.replace(
    /\$\$\s*\n?(\\begin\{array\}[\s\S]*?\\end\{array\})\s*\n?\$\$/g,
    (_match, expression) => {
      const token = `RIXSTATICMATH${mathFragments.length}TOKEN`;
      mathFragments.push({ token, expression });
      return token;
    },
  );
  renderMarkdown(markdownSource, [], { preserveStaticPreviewAssets: true });
  for (const { token, expression } of mathFragments) {
    preview.innerHTML = preview.innerHTML.replace(
      token,
      katex.renderToString(expression, { displayMode: true, throwOnError: false }),
    );
  }
  enhanceSheetViews(preview, { onActivate: insertSheetAddress });
}

async function runNotebook() {
  window.clearTimeout(liveRunTimer);
  const source = editor.state.doc.toString();
  await prepareJavaScriptPlugins(source);
  const documentRun = executeDocument(source);
  disposeWidgetMounts(outputWidgetDisposers);
  output.replaceChildren();

  if (documentRun.cells.length === 0 && documentRun.inlineRuns.length === 0) {
    latestRuns = [];
    renderDocumentPreview(documentRun);
    renderSliderControls([]);
    const placeholder = document.createElement("p");
    placeholder.className = "output-placeholder";
    placeholder.textContent = "No RiX cells or inline expressions found.";
    output.append(placeholder);
    status.textContent = "No RiX content to run";
    setPreviewStale(false);
    return;
  }
  for (const statement of documentRun.outputStatements) appendOutput(statement, documentRun.runtime);
  const succeeded = documentRun.runs.filter((run) => run.statements.every((statement) => statement.kind === "result")).length;
  latestRuns = documentRun.runs;
  renderDocumentPreview(documentRun);
  renderSliderControls(documentRun.sliders);
  setPreviewStale(false);
  status.textContent = `${succeeded} of ${documentRun.cells.length} RiX cells and ${documentRun.inlineRuns.length} inline expressions ran`;
}

function scheduleNotebookRun(delay = 300) {
  window.clearTimeout(liveRunTimer);
  liveRunTimer = window.setTimeout(() => { runNotebook().catch(showError); }, delay);
}

function isRunShortcut(event) {
  return (event.metaKey || event.ctrlKey)
    && (event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter");
}

function handleRunShortcut(event) {
  if (!isRunShortcut(event)) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  runNotebook().catch(showError);
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
  rightPaneTitle.textContent = showPreview ? "Preview" : "RiX results";
  togglePreviewModeButton.hidden = !showPreview;
  updatePreviewModeControl();
  toggleRightPaneButton.textContent = showPreview ? "Show results" : "Show preview";
  toggleRightPaneButton.title = showPreview
    ? "Show RiX results (⌘P or ⌘⇧P)"
    : "Show rendered preview (⌘P or ⌘⇧P)";
  toggleRightPaneButton.setAttribute("aria-pressed", String(showPreview));
}

function toggleRightPane() {
  setRightPane(activeRightPane === "results" ? "preview" : "results");
}

function updatePreviewModeControl() {
  const isStatic = previewMode === "static";
  togglePreviewModeButton.title = isStatic
    ? "Switch to live notebook preview"
    : "Switch to static export preview";
  togglePreviewModeButton.setAttribute(
    "aria-label",
    isStatic
      ? "Static export preview mode; switch to live notebook preview"
      : "Live preview mode; switch to static export preview",
  );
  togglePreviewModeButton.setAttribute("aria-pressed", String(isStatic));
}

function togglePreviewMode() {
  previewMode = previewMode === "live" ? "static" : "live";
  updatePreviewModeControl();
  runNotebook().catch(showError);
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
  setPreviewStale(false);
  runNotebook().catch(showError);
}

function updateSaveButton() {
  saveNoteButton.disabled = !(projects.isOpen || ["file", "folder-file"].includes(activeDocument.kind)) || !dirty;
}

function updateSidebarToggle(open) {
  toggleSidebarButton.hidden = !open;
  toggleSidebarButton.setAttribute("aria-pressed", String(!sidebarCollapsed));
  toggleSidebarButton.setAttribute("aria-label", sidebarCollapsed ? "Show project sidebar" : "Hide project sidebar");
  toggleSidebarButton.title = sidebarCollapsed ? "Show project sidebar" : "Hide project sidebar";
}

function editorSplitMetrics() {
  const sidebarWidth = projectSidebar.hidden ? 0 : projectSidebar.getBoundingClientRect().width;
  const dividerWidth = mainResizer.getBoundingClientRect().width;
  const availableWidth = workspace.getBoundingClientRect().width - sidebarWidth - dividerWidth;
  return { availableWidth, sidebarWidth };
}

function setPaneLayout(layout) {
  paneLayout = layout;
  workspace.classList.toggle("editor-collapsed", layout === "editor");
  workspace.classList.toggle("document-collapsed", layout === "document");
  collapseEditorPaneButton.disabled = layout === "editor";
  collapseDocumentPaneButton.disabled = layout === "document";
  centerPanesButton.title = layout === "both"
    ? "Center panes; drag to resize (⌘⌥\\)"
    : "Restore both panes at an even split (⌘⌥\\)";
  centerPanesButton.setAttribute("aria-label", centerPanesButton.title);
  if (layout === "both") window.requestAnimationFrame(preserveEditorPaneRatio);
}

function centerPanes() {
  setPaneLayout("both");
  const { availableWidth } = editorSplitMetrics();
  if (availableWidth > 0) setEditorPaneWidth(availableWidth / 2);
}

function collapseDocumentPane() {
  setPaneLayout("document");
}

function collapseEditorPane() {
  setPaneLayout("editor");
}

function setEditorPaneWidth(width, rememberRatio = true) {
  if (paneLayout !== "both") setPaneLayout("both");
  const { availableWidth } = editorSplitMetrics();
  const minimumEditorWidth = 330;
  const minimumDocumentWidth = 380;
  const maximumEditorWidth = Math.max(minimumEditorWidth, availableWidth - minimumDocumentWidth);
  const resolvedWidth = Math.max(minimumEditorWidth, Math.min(maximumEditorWidth, width));
  workspace.style.setProperty("--editor-pane-width", `${resolvedWidth}px`);
  if (rememberRatio && availableWidth > 0) editorPaneRatio = resolvedWidth / availableWidth;
}

function preserveEditorPaneRatio() {
  if (paneLayout !== "both" || window.matchMedia("(max-width: 900px)").matches) return;
  const { availableWidth } = editorSplitMetrics();
  if (availableWidth <= 0) return;
  if (editorPaneRatio === null) editorPaneRatio = editorPane.getBoundingClientRect().width / availableWidth;
  setEditorPaneWidth(availableWidth * editorPaneRatio, false);
}

function installMainResizer() {
  let pointerId = null;
  mainResizer.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".divider-control")) return;
    if (window.matchMedia("(max-width: 900px)").matches) return;
    pointerId = event.pointerId;
    mainResizer.setPointerCapture(pointerId);
    document.body.classList.add("is-resizing");
    setEditorPaneWidth(event.clientX - workspace.getBoundingClientRect().left - (projectSidebar.hidden ? 0 : projectSidebar.getBoundingClientRect().width));
  });
  mainResizer.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    setEditorPaneWidth(event.clientX - workspace.getBoundingClientRect().left - (projectSidebar.hidden ? 0 : projectSidebar.getBoundingClientRect().width));
  });
  const stopResize = (event) => {
    if (event.pointerId !== pointerId) return;
    if (mainResizer.hasPointerCapture(pointerId)) mainResizer.releasePointerCapture(pointerId);
    pointerId = null;
    document.body.classList.remove("is-resizing");
  };
  mainResizer.addEventListener("pointerup", stopResize);
  mainResizer.addEventListener("pointercancel", stopResize);
  mainResizer.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const editorWidth = editorPane.getBoundingClientRect().width;
    setEditorPaneWidth(editorWidth + (event.key === "ArrowLeft" ? -20 : 20));
  });

  let controlPointerId = null;
  let controlStartX = 0;
  let controlMoved = false;
  centerPanesButton.addEventListener("pointerdown", (event) => {
    if (window.matchMedia("(max-width: 900px)").matches) return;
    event.preventDefault();
    event.stopPropagation();
    controlPointerId = event.pointerId;
    controlStartX = event.clientX;
    controlMoved = false;
    centerPanesButton.setPointerCapture(controlPointerId);
    setPaneLayout("both");
    document.body.classList.add("is-resizing");
  });
  centerPanesButton.addEventListener("pointermove", (event) => {
    if (event.pointerId !== controlPointerId) return;
    if (Math.abs(event.clientX - controlStartX) > 3) controlMoved = true;
    if (!controlMoved) return;
    setEditorPaneWidth(event.clientX - workspace.getBoundingClientRect().left - (projectSidebar.hidden ? 0 : projectSidebar.getBoundingClientRect().width));
  });
  const stopControlResize = (event) => {
    if (event.pointerId !== controlPointerId) return;
    if (centerPanesButton.hasPointerCapture(controlPointerId)) centerPanesButton.releasePointerCapture(controlPointerId);
    const moved = controlMoved;
    controlPointerId = null;
    document.body.classList.remove("is-resizing");
    if (!moved) centerPanes();
  };
  centerPanesButton.addEventListener("pointerup", stopControlResize);
  centerPanesButton.addEventListener("pointercancel", stopControlResize);
  centerPanesButton.addEventListener("click", (event) => {
    if (event.detail === 0) centerPanes();
  });
  window.addEventListener("resize", () => window.requestAnimationFrame(preserveEditorPaneRatio));
  window.requestAnimationFrame(preserveEditorPaneRatio);
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
  fileContextMenu.querySelector('[data-file-action="rename"]').hidden = Boolean(context.folder);
  fileContextMenu.querySelector('[data-file-action="delete"]').hidden = Boolean(context.folder);
  fileContextMenu.querySelector("hr").hidden = Boolean(context.folder);
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
  if (folderWorkspace && activeDocument.kind === "folder-file") {
    await saveNote();
    await commitFolderFile(activeDocument.path, activeDocument.path.split("/").at(-1));
    return;
  }
  if (!projects.isOpen || !projects.currentNotePath) throw new Error("Open a project or folder note before committing");
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

function liveWidgetMarkup(index, showCode = null) {
  const codeAttribute = showCode === null ? "" : ` data-rix-show-code="${showCode ? "true" : "false"}"`;
  return `<div class="rix-live-widget" data-rix-live-cell="${index}"${codeAttribute}></div>`;
}

function liveDocumentMarkup(source, runtimePath) {
  const payload = JSON.stringify({ source }).replaceAll("<", "\\u003c");
  return `<section id="rix-live-controls" class="rix-live-controls" hidden></section><script id="rix-live-document" type="application/json">${payload}</script><script type="module" src="${escapeHtml(runtimePath)}"></script>`;
}

function liveRuntimeMarkup(runtimePath, katexStylesheetPath) {
  return `<section id="rix-live-controls" class="rix-live-controls" hidden></section><link rel="stylesheet" href="${escapeHtml(katexStylesheetPath)}" /><script type="module" src="${escapeHtml(runtimePath)}"></script>`;
}

function injectLiveWidgets(source) {
  return source.replaceAll(/<!--\s*rix-live-cell:(\d+)\s*-->/g, (_match, index) => liveWidgetMarkup(index));
}

function liveRuntimePathForPage(relativePagePath) {
  return relativePathBetween(relativePagePath, "assets/rix-live/rix-live.js");
}

function staticHtmlDocument(title, staticSource, katexStylesheetPath, liveSource = null, liveRuntimePath = null) {
  const holder = document.createElement("article");
  holder.innerHTML = exportMarkdownRenderer.render(staticSource);
  if (liveSource) holder.innerHTML = injectLiveWidgets(holder.innerHTML);
  renderMathInElement(holder, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
      { left: "\\(", right: "\\)", display: false },
      { left: "\\[", right: "\\]", display: true },
    ],
    throwOnError: false,
  });
  const liveMarkup = liveSource && liveRuntimePath ? liveDocumentMarkup(liveSource, liveRuntimePath) : "";
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(title)}</title><link rel="stylesheet" href="${escapeHtml(katexStylesheetPath)}" /><style>body{max-width:52rem;margin:3rem auto;padding:0 1.25rem;color:#202124;font-family:system-ui,sans-serif;line-height:1.55}pre{overflow:auto;padding:1rem;background:#f4f2ec;border-radius:6px}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}img{max-width:100%;height:auto}table{border-collapse:collapse;margin:1rem 0}th,td{padding:.35rem .55rem;border:1px solid #cfd8e5;text-align:left}th{background:#edf3fa}figcaption{color:#657080}blockquote{margin-left:0;padding-left:1rem;border-left:3px solid #9bb8dc;color:#4d5867}</style></head><body>${liveMarkup}${holder.innerHTML}</body></html>\n`;
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

async function copyLiveRuntimeAssets(exportRoot) {
  const response = await fetch(new URL("rix-live.js", LIVE_RUNTIME_PUBLIC_ROOT));
  if (!response.ok) throw new Error("Could not load the RiX live-export runtime. Run bun run build:live-runtime.");
  const assetPath = pathJoin(exportRoot, "assets", "rix-live", "rix-live.js");
  await mkdir(pathDirectory(assetPath), { recursive: true });
  await writeFile(assetPath, new Uint8Array(await response.arrayBuffer()));
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

function relativePathBetween(fromFile, target) {
  const from = pathDirectory(fromFile).split("/").filter((part) => part && part !== ".");
  const to = target.split("/").filter(Boolean);
  while (from.length && to.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return [...from.map(() => ".."), ...to].join("/") || ".";
}

function visitOutputValue(value, callback) {
  if (!isOutputValue(value)) return;
  callback(value);
  if (value.kind === "fragment") value.children.forEach((child) => visitOutputValue(child, callback));
  if (value.kind === "figure" || value.kind === "slide") visitOutputValue(value.content, callback);
  if (value.kind === "slides") value.slides.forEach((slide) => visitOutputValue(slide, callback));
}

function staticDocumentHasSlides(documentRun) {
  return documentRun.runs.some((run) => {
    let hasSlides = false;
    visitOutputValue(run?.staticOutput?.value, (value) => { if (value.kind === "slides") hasSlides = true; });
    return hasSlides;
  });
}

async function materializeStaticGraphics(documentRun, relativeNotePath, exportRoot) {
  const references = new Map();
  let index = 0;
  for (const run of documentRun.runs) {
    visitOutputValue(run?.staticOutput?.value, (value) => {
      if (value.kind !== "graphic" || references.has(value)) return;
      index += 1;
      references.set(value, pathJoin("assets", "rix", `${pathSlug(relativeNotePath.replace(/\.md$/, ""))}-figure-${index}.svg`));
    });
  }
  for (const [graphic, assetPath] of references) {
    const destination = pathJoin(exportRoot, assetPath);
    await mkdir(pathDirectory(destination), { recursive: true });
    await writeTextFile(destination, renderGraphicSvg(graphic));
  }
  return new Map([...references].map(([graphic, assetPath]) => [graphic, relativePathBetween(relativeNotePath, assetPath)]));
}

function quartoDocument(title, source, isSlideDeck, liveRuntimePath = null, katexStylesheetPath = null) {
  const liveMarkup = liveRuntimePath && katexStylesheetPath ? liveRuntimeMarkup(liveRuntimePath, katexStylesheetPath) : "";
  const content = liveMarkup ? `${liveMarkup}\n\n${source}` : source;
  return `---\ntitle: ${JSON.stringify(title)}\nformat: ${isSlideDeck ? "revealjs" : "html"}\ntoc: ${isSlideDeck ? "false" : "true"}\n---\n\n${content}`;
}

function quartoProjectYaml(title, pages) {
  const nav = pages.map(({ path, title: pageTitle }) => `      - href: ${JSON.stringify(path)}\n        text: ${JSON.stringify(pageTitle)}`).join("\n");
  return `project:\n  type: website\n  output-dir: _site\n\nwebsite:\n  title: ${JSON.stringify(title)}\n  navbar:\n    left:\n${nav || "      []"}\n\nformat:\n  html:\n    toc: true\n`;
}

async function exportScope({ scope, notebookPath, includeMarkdown, includeHtml, includeQuarto, quick = false }) {
  if (!includeMarkdown && !includeHtml && !includeQuarto) throw new Error("Choose at least one export output");
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
  const outputRoots = {
    markdown: includeMarkdown ? pathJoin(exportRoot, "markdown") : null,
    html: includeHtml ? pathJoin(exportRoot, "html") : null,
    quarto: includeQuarto ? pathJoin(exportRoot, "quarto") : null,
  };
  for (const root of Object.values(outputRoots)) {
    if (root) await mkdir(root, { recursive: true });
  }
  if (outputRoots.html) await copyKatexAssets(outputRoots.html);
  if (outputRoots.quarto) await copyKatexAssets(outputRoots.quarto);

  const copiedAssets = new Set();
  const quartoPages = [];
  const liveTargets = new Set();
  for (const notePath of notes) {
    const source = await readTextFile(notePath);
    const staticDocumentRun = executeDocument(source, {
      mode: "static",
      sliderOverrides: new Map(),
    });
    const liveDocumentRun = executeDocument(source, { mode: "live", sliderOverrides: new Map() });
    const relativePath = pathRelative(projects.project.directory, notePath);
    const liveCellIndexes = new Set(liveDocumentRun.runs.flatMap((run, index) => (
      run?.metadata.role !== "set" && run?.liveOutput ? [index] : []
    )));
    const hasLiveCells = liveCellIndexes.size > 0;
    const staticSources = new Map();
    for (const [target, root] of Object.entries(outputRoots)) {
      if (!root) continue;
      const graphicReferences = await materializeStaticGraphics(staticDocumentRun, relativePath, root);
      staticSources.set(target, renderStaticDocument(
        staticDocumentRun.document, staticDocumentRun.runs, staticDocumentRun.inlineRuns,
        {
          graphicReference: (graphic) => graphicReferences.get(graphic) || formatValue(graphic),
          liveCellPlaceholder: hasLiveCells && target === "html",
          liveCellIndexes,
        },
      ));
      if (target === "quarto") {
        staticSources.set(target, renderQuartoDocumentContent(
          staticDocumentRun.document,
          staticDocumentRun.runs,
          staticDocumentRun.inlineRuns,
          {
            graphicReference: (graphic) => graphicReferences.get(graphic) || formatValue(graphic),
            includeRuntimeSource: hasLiveCells,
            liveCellIndexes,
          },
        ));
      }
      if (hasLiveCells && target !== "markdown") liveTargets.add(target);
    }
    if (outputRoots.markdown) {
      const markdownPath = pathJoin(outputRoots.markdown, relativePath);
      await mkdir(pathDirectory(markdownPath), { recursive: true });
      await writeTextFile(markdownPath, staticSources.get("markdown"));
    }
    if (outputRoots.html) {
      const htmlPath = pathJoin(outputRoots.html, relativePath.replace(/\.md$/, ".html"));
      await mkdir(pathDirectory(htmlPath), { recursive: true });
      await writeTextFile(
        htmlPath,
        staticHtmlDocument(
          notePath.split("/").at(-1).replace(/\.md$/, ""),
          staticSources.get("html"),
          katexStylesheetForPage(relativePath.replace(/\.md$/, ".html")),
          hasLiveCells ? source : null,
          hasLiveCells ? liveRuntimePathForPage(relativePath.replace(/\.md$/, ".html")) : null,
        ),
      );
    }
    if (outputRoots.quarto) {
      const quartoPath = relativePath.replace(/\.md$/, ".qmd");
      const fullQuartoPath = pathJoin(outputRoots.quarto, quartoPath);
      await mkdir(pathDirectory(fullQuartoPath), { recursive: true });
      await writeTextFile(
        fullQuartoPath,
        quartoDocument(
          notePath.split("/").at(-1).replace(/\.md$/, ""),
          staticSources.get("quarto"),
          staticDocumentHasSlides(staticDocumentRun),
          hasLiveCells ? liveRuntimePathForPage(relativePath.replace(/\.md$/, ".qmd")) : null,
          hasLiveCells ? katexStylesheetForPage(relativePath.replace(/\.md$/, ".qmd")) : null,
        ),
      );
      quartoPages.push({ path: quartoPath, title: notePath.split("/").at(-1).replace(/\.md$/, "") });
    }
    for (const sourcePath of markdownImageSources(source)) {
      const assetPath = projectPathForRelativeNote(notePath, sourcePath);
      const relativeAssetPath = pathRelative(projects.project.directory, assetPath);
      if (assetPath === relativeAssetPath) continue;
      for (const root of Object.values(outputRoots)) {
        if (!root) continue;
        const copyKey = `${root}:${relativeAssetPath}`;
        if (copiedAssets.has(copyKey)) continue;
        copiedAssets.add(copyKey);
        const assetDestination = pathJoin(root, relativeAssetPath);
        try {
          await mkdir(pathDirectory(assetDestination), { recursive: true });
          await copyFile(assetPath, assetDestination);
        } catch {
          // A missing or externally referenced asset should not prevent text export.
        }
      }
    }
  }
  if (outputRoots.quarto) await writeTextFile(pathJoin(outputRoots.quarto, "_quarto.yml"), quartoProjectYaml(scopeName, quartoPages));
  for (const target of liveTargets) await copyLiveRuntimeAssets(outputRoots[target]);
  setStatus(`Exported ${notes.length} note${notes.length === 1 ? "" : "s"}`);
  messageDialogTitle.textContent = "Export complete";
  messageDialogBody.textContent = `Wrote the selected output to ${exportRoot}.`;
  messageDialog.showModal();
}

function openExportDialog() {
  if (!projects.isOpen) {
    if (["file", "folder-file"].includes(activeDocument.kind)) {
      runProjectAction(exportOpenDocument);
      return;
    }
    runProjectAction(async () => { throw new Error("Open a Markdown note or project before exporting"); });
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
  exportQuarto.checked = true;
  setQuickExport.checked = false;
  updateExportNotebookChoice();
  exportDialog.showModal();
}

function quickExport() {
  if (!projects.isOpen) {
    if (["file", "folder-file"].includes(activeDocument.kind)) {
      runProjectAction(exportOpenDocument);
      return;
    }
    runProjectAction(async () => { throw new Error("Open a Markdown note or project before exporting"); });
    return;
  }
  runProjectAction(() => exportScope({
    scope: projects.project.quickExportScope,
    notebookPath: projects.currentNotebookPath,
    includeMarkdown: true,
    includeHtml: true,
    includeQuarto: true,
    quick: true,
  }));
}

async function exportOpenDocument() {
  const notePath = activeDocument.path;
  if (!notePath) throw new Error("Open a Markdown note before exporting");
  const destination = await openDialog({ title: "Choose a folder for the note export", directory: true, multiple: false, recursive: true });
  if (!destination || Array.isArray(destination)) return;
  const name = notePath.split("/").at(-1).replace(/\.(?:md|markdown|mdown|mkdn)$/i, "") || "note";
  const exportRoot = pathJoin(destination, `${pathSlug(name)}-export`);
  const outputRoots = {
    markdown: pathJoin(exportRoot, "markdown"),
    html: pathJoin(exportRoot, "html"),
    quarto: pathJoin(exportRoot, "quarto"),
  };
  for (const root of Object.values(outputRoots)) await mkdir(root, { recursive: true });
  await copyKatexAssets(outputRoots.html);
  await copyKatexAssets(outputRoots.quarto);
  const source = editor.state.doc.toString();
  const documentRun = executeDocument(source, { mode: "static", sliderOverrides: new Map() });
  const staticSources = new Map();
  for (const [target, root] of Object.entries(outputRoots)) {
    const graphicReferences = await materializeStaticGraphics(documentRun, `${name}.md`, root);
    staticSources.set(target, renderStaticDocument(documentRun.document, documentRun.runs, documentRun.inlineRuns, {
      graphicReference: (graphic) => graphicReferences.get(graphic) || formatValue(graphic),
    }));
  }
  await writeTextFile(pathJoin(outputRoots.markdown, `${name}.md`), staticSources.get("markdown"));
  await writeTextFile(
    pathJoin(outputRoots.html, `${name}.html`),
    staticHtmlDocument(name, staticSources.get("html"), katexStylesheetForPage(`${name}.html`)),
  );
  await writeTextFile(pathJoin(outputRoots.quarto, `${name}.qmd`), staticSources.get("quarto"));
  await writeTextFile(pathJoin(outputRoots.quarto, "_quarto.yml"), quartoProjectYaml(name, [{ path: `${name}.qmd`, title: name }]));
  setStatus("Exported current note");
  messageDialogTitle.textContent = "Export complete";
  messageDialogBody.textContent = `Wrote the current note to ${exportRoot}.`;
  messageDialog.showModal();
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

async function commitFolderFile(path, title) {
  if (!folderWorkspace) throw new Error("Open a folder file before committing");
  if (dirty && activeDocument.path === path) await saveNote();
  const message = await requestName({ title: "Commit file", label: `Commit message for ${title}`, value: `Update ${title.replace(/\.[^.]+$/, "")}` });
  if (!message) return;
  const result = await invoke("git_commit_note", {
    projectRoot: folderWorkspace.directory,
    notePath: path,
    message,
  });
  setStatus("Committed file");
  messageDialogTitle.textContent = "Git commit created";
  messageDialogBody.textContent = result;
  messageDialog.showModal();
}

function refreshProjectControls() {
  const open = projects.isOpen;
  const folderOpen = folderWorkspace !== null;
  const workspaceDirectory = open ? projects.project.directory : folderWorkspace?.directory || null;
  if (workspaceDirectory && workspaceDirectory !== sidebarProjectDirectory) {
    sidebarProjectDirectory = workspaceDirectory;
    sidebarCollapsed = false;
  }
  if (!workspaceDirectory) sidebarProjectDirectory = null;
  updateSaveButton();
  newNotebookButton.disabled = !open;
  newFolderButton.hidden = !folderOpen;
  newFolderButton.disabled = !folderOpen;
  newNoteButton.disabled = !(open || folderOpen);
  newNoteButton.title = folderOpen ? "New Markdown file (⌘N)" : "New note (⌘N)";
  newNoteButton.setAttribute("aria-label", folderOpen ? "New Markdown file" : "New note");
  projectSidebar.hidden = !(open || folderOpen) || sidebarCollapsed;
  workspace.classList.toggle("has-project", (open || folderOpen) && !sidebarCollapsed);
  updateSidebarToggle(open || folderOpen);
  window.requestAnimationFrame(preserveEditorPaneRatio);
  if (folderOpen) {
    projectTree.replaceChildren();
    for (const file of folderWorkspace.files) {
      const fileButton = document.createElement("button");
      fileButton.type = "button";
      fileButton.className = file.path.toLowerCase().endsWith(".toml") ? "tree-manifest" : "tree-note";
      fileButton.textContent = file.relativePath;
      fileButton.setAttribute("aria-current", String(activeDocument.kind === "folder-file" && activeDocument.path === file.path));
      addDelayedTreeSelection(fileButton, () => loadFolderFile(file.path));
      fileButton.addEventListener("contextmenu", (event) => showFileContextMenu(event, { path: file.path, title: file.relativePath, folder: true }));
      projectTree.append(fileButton);
    }
    if (!folderWorkspace.files.length) {
      const empty = document.createElement("p");
      empty.className = "output-placeholder";
      empty.textContent = "No Markdown or TOML files";
      projectTree.append(empty);
    }
    workspaceTitle.textContent = folderWorkspace.directory.split("/").at(-1) || "Folder";
    return;
  }
  if (!open) {
    projectTree.replaceChildren();
    workspaceTitle.textContent = activeDocument.kind === "file"
      ? activeDocument.path.split("/").at(-1)
      : "Scratch note";
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
  const themeManifest = document.createElement("button");
  themeManifest.type = "button";
  themeManifest.className = "tree-manifest";
  themeManifest.textContent = projects.project.themeExists ? "style.toml" : "style.toml (defaults)";
  themeManifest.setAttribute("aria-current", String(activeDocument.kind === "theme"));
  addDelayedTreeSelection(themeManifest, loadTheme);
  projectTree.append(themeManifest);
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
  if (!projects.isOpen && !["file", "folder-file"].includes(activeDocument.kind)) return;
  if (["file", "folder-file"].includes(activeDocument.kind)) {
    await writeTextFile(activeDocument.path, editor.state.doc.toString());
  } else if (activeDocument.kind === "theme") {
    await projects.saveTheme(editor.state.doc.toString());
    applyProjectTheme(projects.project.theme);
  } else if (activeDocument.kind === "toml") {
    await projects.saveManifest(activeDocument.path, editor.state.doc.toString());
  } else {
    await projects.saveCurrentNote(editor.state.doc.toString());
  }
  if (activeDocument.kind === "toml" || tutorialPluginId) await refreshPluginCatalog();
  dirty = false;
  updateSaveButton();
  setStatus(["note", "file", "folder-file"].includes(activeDocument.kind) ? "Saved" : "Saved configuration");
  refreshProjectControls();
}

async function refreshPluginCatalog() {
  tutorialPluginId = pluginTutorialIdFromPath(activeDocument.path);
  if (!projects.isOpen) {
    pluginCatalogTemplate = createNotebookBundledPluginCatalog();
    configuredPlugins = configuredPluginIds(null, null, [
      ...pluginSettings.autoLoadPlugins,
      ...(tutorialPluginId && pluginCatalogTemplate.info(tutorialPluginId) ? [tutorialPluginId] : []),
    ]);
    rixEngine.configure({ pluginCatalog: pluginCatalogTemplate, plugins: configuredPlugins });
    reloadPluginsButton.hidden = !(tutorialPluginId || folderWorkspace);
    return;
  }
  const pluginDirectories = configuredPluginDirectories(projects.project, projects.currentNotebook, pluginSettings);
  pluginCatalogTemplate = await createProjectPluginCatalog(pluginDirectories);
  const tutorialPlugins = tutorialPluginId && pluginCatalogTemplate.info(tutorialPluginId)
    ? [tutorialPluginId]
    : [];
  configuredPlugins = configuredPluginIds(projects.project, projects.currentNotebook, [
    ...pluginSettings.autoLoadPlugins,
    ...tutorialPlugins,
  ]);
  rixEngine.configure({ pluginCatalog: pluginCatalogTemplate, plugins: configuredPlugins });
  reloadPluginsButton.hidden = false;
}

function renderPluginDirectories() {
  const settings = editingPluginSettings || pluginSettings;
  pluginDirectoryList.replaceChildren();
  if (!settings.pluginDirectories.length) {
    const empty = document.createElement("p");
    empty.className = "dialog-hint";
    empty.textContent = "No app-wide directories. Project and notebook plugin_dirs still apply.";
    pluginDirectoryList.append(empty);
    return;
  }
  for (const directory of settings.pluginDirectories) {
    const row = document.createElement("div");
    row.className = "plugin-directory-row";
    const path = document.createElement("code");
    path.textContent = directory;
    path.title = directory;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary-button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      settings.pluginDirectories = settings.pluginDirectories.filter((candidate) => candidate !== directory);
      renderPluginDirectories();
    });
    row.append(path, remove);
    pluginDirectoryList.append(row);
  }
}

async function openPluginSettings() {
  pluginSettings = await invoke("get_plugin_settings");
  editingPluginSettings = structuredClone(pluginSettings);
  renderPluginDirectories();
  allowJavaScriptPluginsInput.checked = editingPluginSettings.allowJavascriptPlugins;
  autoLoadPluginsInput.value = editingPluginSettings.autoLoadPlugins.join(", ");
  pluginSettingsDialog.addEventListener("close", () => {
    if (pluginSettingsDialog.returnValue !== "confirm") {
      editingPluginSettings = null;
      return;
    }
    runProjectAction(async () => {
      editingPluginSettings.allowJavascriptPlugins = allowJavaScriptPluginsInput.checked;
      editingPluginSettings.autoLoadPlugins = [...new Set(autoLoadPluginsInput.value.split(",").map((id) => id.trim()).filter(Boolean))];
      pluginSettings = editingPluginSettings;
      editingPluginSettings = null;
      await invoke("save_plugin_settings", { settings: pluginSettings });
      await refreshPluginCatalog();
      await runNotebook();
      setStatus("Plugin settings saved");
    });
  }, { once: true });
  pluginSettingsDialog.showModal();
}

function confirmJavaScriptPlugin(metadata) {
  return new Promise((resolve) => {
    javaScriptPluginMessage.textContent = `${metadata.id}: ${metadata.description}\n\n${metadata.sourcePath}`;
    javaScriptPluginDialog.addEventListener("close", () => {
      resolve(["once", "always"].includes(javaScriptPluginDialog.returnValue) ? javaScriptPluginDialog.returnValue : null);
    }, { once: true });
    javaScriptPluginDialog.showModal();
  });
}

async function prepareJavaScriptPlugins(source) {
  const requested = requestedPluginIds(source, configuredPlugins);
  let settingsChanged = false;
  for (const id of requested) {
    const metadata = pluginCatalogTemplate.info(id);
    if (!metadata || metadata.kind !== "host" || pluginCatalogTemplate.installers.has(id)) continue;
    const approved = pluginSettings.allowJavascriptPlugins || pluginSettings.approvedJavascriptPlugins.includes(metadata.sourcePath);
    if (!approved) {
      const decision = await confirmJavaScriptPlugin(metadata);
      if (!decision) throw new Error(`JavaScript plugin '${id}' was not loaded`);
      if (decision === "always") {
        pluginSettings.approvedJavascriptPlugins = [...new Set([...pluginSettings.approvedJavascriptPlugins, metadata.sourcePath])];
        settingsChanged = true;
      }
    }
    let module;
    try {
      module = await import(/* @vite-ignore */ convertFileSrc(metadata.sourcePath));
    } catch (error) {
      throw new Error(`Could not import JavaScript plugin '${id}' from ${metadata.sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const installer = module.install || module.default;
    if (typeof installer !== "function") {
      throw new Error(`JavaScript plugin '${id}' must export an install function`);
    }
    pluginCatalogTemplate.registerInstaller(id, installer);
  }
  if (settingsChanged) await invoke("save_plugin_settings", { settings: pluginSettings });
}

async function reloadPluginsAndRun() {
  setStatus("Reloading plugins…");
  await refreshPluginCatalog();
  await runNotebook();
  const suffix = tutorialPluginId
    ? pluginCatalogTemplate.info(tutorialPluginId)
      ? ` · ${tutorialPluginId} enabled`
      : ` · ${tutorialPluginId} is not implemented in this build`
    : "";
  setStatus(`Plugins reloaded${suffix}`);
}

function openedDocumentStatus(filename) {
  if (!tutorialPluginId) return `Opened ${filename}`;
  return pluginCatalogTemplate.info(tutorialPluginId)
    ? `Opened ${filename} · ${tutorialPluginId} enabled for live tutorial editing`
    : `Opened ${filename} · ${tutorialPluginId} is proposed or unavailable`;
}

function pathDirectoryForFile(path) {
  return path.slice(0, path.lastIndexOf("/")) || ".";
}

async function loadStandaloneMarkdown(path) {
  if (dirty) await saveNote();
  projects.close();
  folderWorkspace = null;
  recentProjectKey = null;
  activeDocument = { kind: "file", path };
  applyProjectTheme(DEFAULT_PROJECT_THEME);
  editorKind.textContent = "Markdown";
  await refreshPluginCatalog();
  setDocument(await readTextFile(path));
  refreshProjectControls();
  setStatus(openedDocumentStatus(path.split("/").at(-1)));
  try {
    await invoke("record_recent_file", { path, title: path.split("/").at(-1) });
  } catch {
    // The file remains open if the operating system cannot persist recents.
  }
}

async function openMarkdownFile() {
  const openExtensions = [...new Set([...filePolicy.primaryExtensions, ...filePolicy.manifestNames.map((name) => filePolicy.extensionOf(name))])];
  const path = await openDialog({
    title: "Open Markdown file or project manifest",
    multiple: false,
    filters: [{ name: "Document or project manifest", extensions: openExtensions }],
  });
  if (!path || Array.isArray(path)) return;
  if (path.split("/").at(-1) === "project.toml") {
    if (dirty) await saveNote();
    const note = await projects.openProject(pathDirectoryForFile(path));
    if (note) await loadNote(note);
    return;
  }
  await loadStandaloneMarkdown(path);
}

async function openProjectFolder() {
  if (dirty) await saveNote();
  const directory = await openDialog({ title: "Open project or Markdown folder", directory: true, multiple: false, recursive: true });
  if (!directory || Array.isArray(directory)) return;
  await invoke("grant_project_access", { path: directory });
  if (await exists(pathJoin(directory, "project.toml"))) {
    const note = await projects.openProject(directory);
    if (note) await loadNote(note);
    return;
  }
  await loadFolderWorkspace(directory);
}

function isFolderDocument(path) {
  return filePolicy.isPrimary(path) || filePolicy.isManifest(path);
}

async function listFolderDocuments(directory, prefix = "") {
  const entries = await readDir(directory);
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = pathJoin(directory, entry.name);
    const relativePath = pathJoin(prefix, entry.name);
    if (entry.isDirectory) files.push(...await listFolderDocuments(path, relativePath));
    else if (entry.isFile && isFolderDocument(entry.name)) files.push({ path, relativePath });
  }
  return files;
}

async function loadFolderWorkspace(directory) {
  projects.close();
  recentProjectKey = null;
  folderWorkspace = { directory, files: (await listFolderDocuments(directory)).sort((left, right) => left.relativePath.localeCompare(right.relativePath)) };
  applyProjectTheme(DEFAULT_PROJECT_THEME);
  await refreshPluginCatalog();
  const initialFile = folderWorkspace.files.find((file) => filePolicy.isPrimary(file.path)) || folderWorkspace.files[0];
  if (initialFile) {
    await loadFolderFile(initialFile.path);
    return;
  }
  activeDocument = { kind: "folder", path: null };
  editorKind.textContent = "Markdown";
  setDocument("# Empty folder\n\nNo Markdown or TOML files were found in this folder.\n");
  refreshProjectControls();
  setStatus("Opened folder");
}

async function refreshFolderWorkspace() {
  if (!folderWorkspace) return;
  folderWorkspace.files = (await listFolderDocuments(folderWorkspace.directory))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  refreshProjectControls();
}

function folderCreationDirectory() {
  if (activeDocument.kind === "folder-file" && activeDocument.path.startsWith(`${folderWorkspace.directory}/`)) {
    return pathDirectoryForFile(activeDocument.path);
  }
  return folderWorkspace.directory;
}

async function createFolderMarkdownFile() {
  if (!folderWorkspace) throw new Error("Open a folder before creating a Markdown file");
  const title = await requestName({ title: "New Markdown file", label: "File name", value: "Untitled note" });
  if (!title) return;
  const filename = filePolicy.isPrimary(title) ? title : `${title}.${filePolicy.primaryExtensions[0]}`;
  const path = pathJoin(folderCreationDirectory(), filename);
  if (await exists(path)) throw new Error(`A file already exists at ${path}`);
  await writeTextFile(path, `# ${filename.replace(/\.[^.]+$/, "")}\n`);
  await refreshFolderWorkspace();
  await loadFolderFile(path);
}

async function createFolderDirectory() {
  if (!folderWorkspace) throw new Error("Open a folder before creating a subfolder");
  const title = await requestName({ title: "New folder", label: "Folder name", value: "Folder" });
  if (!title) return;
  if (/[\\/]/.test(title)) throw new Error("Folder names cannot contain a slash");
  const path = pathJoin(folderCreationDirectory(), title);
  if (await exists(path)) throw new Error(`A folder or file already exists at ${path}`);
  await mkdir(path, { recursive: true });
  await refreshFolderWorkspace();
  setStatus(`Created ${title}`);
}

async function loadFolderFile(path) {
  if (!folderWorkspace?.files.some((file) => file.path === path)) throw new Error("The selected file is outside the open folder");
  if (dirty) await saveNote();
  activeDocument = { kind: "folder-file", path };
  editorKind.textContent = path.toLowerCase().endsWith(".toml") ? "TOML" : "Markdown";
  await refreshPluginCatalog();
  setDocument(await readTextFile(path));
  refreshProjectControls();
  setStatus(openedDocumentStatus(path.split("/").at(-1)));
}

function closeOpenRecentMenu() {
  openRecentMenu.hidden = true;
  openRecentButton.setAttribute("aria-expanded", "false");
}

async function openRecentDocument(recent) {
  closeOpenRecentMenu();
  if (dirty) await saveNote();
  if (recent.kind === "file") {
    await loadStandaloneMarkdown(recent.path);
    return;
  }
  const note = await projects.openProject(recent.path, recent.last_note_path ?? null);
  if (note) await loadNote(note);
}

async function showOpenRecentMenu() {
  openRecentMenu.replaceChildren();
  const folderItem = document.createElement("button");
  folderItem.type = "button";
  folderItem.textContent = "Open project folder…";
  folderItem.addEventListener("click", () => runProjectAction(openProjectFolder));
  openRecentMenu.append(folderItem);
  const fileItem = document.createElement("button");
  fileItem.type = "button";
  fileItem.textContent = "Open Markdown file…";
  fileItem.addEventListener("click", () => runProjectAction(openMarkdownFile));
  openRecentMenu.append(fileItem);
  let recents = [];
  try {
    recents = await invoke("get_recent_documents");
  } catch {
    // The manual open commands remain available if recent-document storage fails.
  }
  if (recents.length) {
    const separator = document.createElement("hr");
    separator.className = "open-recent-separator";
    openRecentMenu.append(separator);
    for (const recent of recents) {
      const item = document.createElement("button");
      item.type = "button";
      item.textContent = recent.title;
      item.title = recent.path;
      item.addEventListener("click", () => runProjectAction(() => openRecentDocument(recent)));
      openRecentMenu.append(item);
    }
  } else {
    const empty = document.createElement("span");
    empty.className = "open-recent-empty";
    empty.textContent = "No recent documents";
    openRecentMenu.append(empty);
  }
  openRecentMenu.hidden = false;
  openRecentButton.setAttribute("aria-expanded", "true");
}

async function loadNote(note) {
  folderWorkspace = null;
  activeDocument = { kind: "note", path: note.path };
  applyProjectTheme(projects.project.theme);
  editorKind.textContent = "Markdown";
  await refreshPluginCatalog();
  setDocument(note.source);
  refreshProjectControls();
  setStatus(openedDocumentStatus(note.path.split("/").at(-1)));
  await rememberCurrentProject();
}

async function rememberCurrentProject() {
  if (!projects.isOpen || !projects.currentNotePath) return;
  const key = `${projects.project.directory}\u0000${projects.currentNotePath}`;
  if (key === recentProjectKey) return;
  try {
    await invoke("record_recent_project", {
      path: projects.project.directory,
      title: projects.project.title,
      lastNotePath: projects.currentNotePath,
    });
    recentProjectKey = key;
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

async function loadTheme() {
  activeDocument = { kind: "theme", path: projects.project.stylePath };
  editorKind.textContent = "TOML";
  setDocument(await projects.themeSource());
  refreshProjectControls();
  setStatus(projects.project.themeExists ? "Opened style.toml" : "Opened default style.toml; save to create it");
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
      rixHighlighting,
      autocompletion({ override: [rixCompletionSource] }),
      rixNotebookLinter,
      hoverTooltip(rixHoverTooltip),
      markdown({
        codeLanguages: (info) => /^rix(?:\s|$)/i.test(info) ? rixLanguage : null,
      }),
      EditorView.domEventHandlers({
        keydown(event) {
          return handleRunShortcut(event);
        },
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        if (!loadingDocument) {
          setPreviewStale(true);
          dirty = true;
          updateSaveButton();
          setStatus("Edited · preview and results updating");
          scheduleNotebookRun(1000);
        }
      }),
    ],
  }),
  parent: editorHost,
});

runButton.addEventListener("click", () => runNotebook().catch(showError));
reloadPluginsButton.addEventListener("click", () => runProjectAction(reloadPluginsAndRun));
addPluginDirectoryButton.addEventListener("click", () => runProjectAction(async () => {
  const directory = await openDialog({ directory: true, multiple: false, title: "Add plugin directory" });
  if (!directory || Array.isArray(directory)) return;
  const settings = editingPluginSettings || pluginSettings;
  if (!settings.pluginDirectories.includes(directory)) settings.pluginDirectories.push(directory);
  renderPluginDirectories();
}));
toggleRightPaneButton.addEventListener("click", toggleRightPane);
togglePreviewModeButton.addEventListener("click", togglePreviewMode);
collapseDocumentPaneButton.addEventListener("click", collapseDocumentPane);
collapseEditorPaneButton.addEventListener("click", collapseEditorPane);
closeHelpButton.addEventListener("click", () => helpDialog.close());
maximizeHelpButton.addEventListener("click", () => {
  const expanded = helpDialog.classList.toggle("is-maximized");
  maximizeHelpButton.textContent = expanded ? "Restore" : "Expand";
  maximizeHelpButton.title = expanded ? "Restore help window" : "Expand help to the window";
  maximizeHelpButton.setAttribute("aria-pressed", String(expanded));
});
helpTopic.addEventListener("change", () => {
  showHelpTopic(helpTopic.value).catch((error) => {
    helpContent.textContent = error instanceof Error ? error.message : String(error);
  });
});
toggleSidebarButton.addEventListener("click", () => {
  if (!projects.isOpen && !folderWorkspace) return;
  sidebarCollapsed = !sidebarCollapsed;
  refreshProjectControls();
});
installMainResizer();
setPaneLayout("both");
newProjectButton.addEventListener("click", () => runProjectAction(async () => {
  const title = await requestName({ title: "New RiX project", label: "Project name", value: "RiX Project" });
  if (!title) return;
  const note = await projects.createProject(title);
  if (note) await loadNote(note);
}));
openProjectButton.addEventListener("click", () => runProjectAction(async () => {
  await openMarkdownFile();
}));
openRecentButton.addEventListener("click", (event) => {
  event.stopPropagation();
  if (openRecentMenu.hidden) showOpenRecentMenu().catch(showError);
  else closeOpenRecentMenu();
});
saveNoteButton.addEventListener("click", () => runProjectAction(saveNote));
exportNotebookButton.addEventListener("click", () => openExportDialog());
newNotebookButton.addEventListener("click", () => runProjectAction(async () => {
  const title = await requestName({ title: "New notebook", label: "Notebook title", value: "Notebook" });
  if (!title) return;
  const note = await projects.createNotebook(title);
  await loadNote(note);
}));
newFolderButton.addEventListener("click", () => runProjectAction(createFolderDirectory));
newNoteButton.addEventListener("click", () => runProjectAction(async () => {
  if (folderWorkspace) {
    await createFolderMarkdownFile();
    return;
  }
  const title = await requestName({ title: "New note", label: "Note title", value: "Untitled note" });
  if (!title) return;
  const note = await projects.createNote(title);
  await loadNote(note);
}));
exportScopeSelect.addEventListener("change", updateExportNotebookChoice);
exportDialog.querySelector("button[value=cancel]").addEventListener("click", () => exportDialog.close("cancel"));
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
      includeQuarto: exportQuarto.checked,
    });
  });
});
fileContextMenu.addEventListener("click", (event) => {
  const action = event.target.closest("button")?.dataset.fileAction;
  const context = fileContext;
  hideFileContextMenu();
  if (!action || !context) return;
  runProjectAction(async () => {
    if (context.folder && action === "commit") {
      await commitFolderFile(context.path, context.title);
      return;
    }
    if (context.folder) throw new Error("Rename and Trash are currently available for project notes only");
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
window.addEventListener("click", (event) => {
  hideFileContextMenu();
  if (!event.target.closest(".open-control-group")) closeOpenRecentMenu();
});
window.addEventListener("resize", () => {
  hideFileContextMenu();
  closeOpenRecentMenu();
});
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
    "open-plugin-settings": () => runProjectAction(openPluginSettings),
    "open-notebook-help": () => openHelp("notebook"),
    "open-rix-reference": () => openHelp("rix"),
    "open-rix-tutorials": () => openHelp("tutorials"),
    export: () => openExportDialog(),
    "quick-export": () => quickExport(),
  };
  commands[event.payload]?.();
});
listen("open-recent-document", (event) => {
  runProjectAction(async () => {
    await openRecentDocument(event.payload);
  });
});
window.addEventListener("keydown", (event) => {
  if (handleRunShortcut(event)) return;
  if ((event.metaKey || event.ctrlKey) && (event.key === "?" || (event.shiftKey && (event.key === "/" || event.code === "Slash")))) {
    event.preventDefault();
    openHelp("notebook");
    return;
  }
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
  if ((event.metaKey || event.ctrlKey) && event.altKey && event.key === "ArrowRight") {
    event.preventDefault();
    collapseDocumentPane();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.altKey && event.key === "ArrowLeft") {
    event.preventDefault();
    collapseEditorPane();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.altKey && event.key === "\\") {
    event.preventDefault();
    centerPanes();
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
async function initializeNotebook() {
  try {
    pluginSettings = await invoke("get_plugin_settings");
  } catch {
    // The browser-only development host has no native preference store.
  }
  await refreshPluginCatalog();
  renderMarkdown(initialDocument);
  await runNotebook();
}

initializeNotebook().catch(showError);
