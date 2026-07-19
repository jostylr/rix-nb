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
import { copyFile, mkdir, readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { Integer, Rational, RationalInterval } from "@ratmath/core";
import {
  Context,
  createDefaultRegistry,
  createDefaultSystemContext,
  evaluate,
  formatValue,
  isOutputValue,
  lower,
  parse,
  posToLineCol,
  parseAndEvaluate,
  renderGraphicSvg,
  tokenize,
  renderOutputHtml,
} from "../../rix/src/index.js";
import { rixHighlighting, rixLanguage } from "../../rix/src/tools/codemirror/index.js";
import { ProjectManager } from "./project.js";
import { createNotebookBundledPluginCatalog } from "./bundled-plugin-catalog.js";
import { clonePluginCatalog, configuredPluginIds, createProjectPluginCatalog } from "./plugin-catalog.js";
import { applyProjectTheme } from "./theme.js";
import { gridLatex } from "./output-latex.js";
import "./styles.css";

const editorHost = document.querySelector("#markdown-editor");
const initialDocument = editorHost.textContent.trim();
editorHost.textContent = "";
const preview = document.querySelector("#markdown-preview");
const output = document.querySelector("#rix-output");
const outputPane = document.querySelector("#output-pane");
const mainResizer = document.querySelector("#main-resizer");
const editorPane = document.querySelector(".editor-pane");
const sliderControls = document.querySelector("#slider-controls");
const sliderControlList = document.querySelector("#slider-control-list");
const previewPane = document.querySelector("#preview-pane");
const runButton = document.querySelector("#run-notebook");
const toggleRightPaneButton = document.querySelector("#toggle-right-pane");
const togglePreviewModeButton = document.querySelector("#toggle-preview-mode");
const status = document.querySelector("#document-status");
const workspaceTitle = document.querySelector("#workspace-title");
const workspace = document.querySelector(".workspace");
const editorKind = document.querySelector("#editor-kind");
const newProjectButton = document.querySelector("#new-project");
const openProjectButton = document.querySelector("#open-project");
const toggleSidebarButton = document.querySelector("#toggle-sidebar");
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
const exportNotebookSelect = document.querySelector("#export-notebook");
const exportMarkdown = document.querySelector("#export-markdown");
const exportHtml = document.querySelector("#export-html");
const exportQuarto = document.querySelector("#export-quarto");
const setQuickExport = document.querySelector("#set-quick-export");
const appNotice = document.querySelector("#app-notice");
const appNoticeMessage = document.querySelector("#app-notice-message");
const closeAppNoticeButton = document.querySelector("#close-app-notice");
const projects = new ProjectManager();
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
let helpCatalog = null;
let pluginCatalogTemplate = createNotebookBundledPluginCatalog();
let configuredPlugins = [];
let staticPreviewObjectUrls = [];
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

function releaseStaticPreviewObjectUrls() {
  for (const url of staticPreviewObjectUrls) URL.revokeObjectURL(url);
  staticPreviewObjectUrls = [];
}

function renderMarkdown(source, runs = latestRuns, { preserveStaticPreviewAssets = false } = {}) {
  if (!preserveStaticPreviewAssets) releaseStaticPreviewObjectUrls();
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

function parseFenceMetadata(header) {
  const metadata = {
    raw: header.trim(),
    flags: new Set(),
    execution: "flow",
    role: "out",
    showCode: false,
    showOutput: true,
    unknown: [],
  };
  for (const token of header.trim().split(/\s+/).filter(Boolean)) {
    const normalized = token.toLowerCase();
    if (normalized === "flow") {
      metadata.flags.add("flow");
      metadata.execution = "flow";
    } else if (normalized === "singleton") {
      metadata.flags.add("singleton");
      metadata.execution = "singleton";
    } else if (normalized === "refresh") {
      metadata.flags.add("refresh");
      metadata.execution = "refresh";
    } else if (normalized === "expensive") {
      metadata.flags.add("expensive");
    } else if (normalized === "set") {
      metadata.role = "set";
      metadata.showCode = false;
      metadata.showOutput = false;
    } else if (normalized === "edu") {
      metadata.role = "edu";
      metadata.showCode = true;
      metadata.showOutput = true;
    } else if (normalized === "out") {
      metadata.role = "out";
      metadata.showCode = false;
      metadata.showOutput = true;
    } else {
      metadata.unknown.push(token);
    }
  }
  return metadata;
}

function extractRixCells(source) {
  const cells = [];
  const fencePattern = /^```rix(?:[ \t]+([^\n]*))?[ \t]*\n([\s\S]*?)^```[ \t]*$/gim;
  let match;

  let index = 0;
  while ((match = fencePattern.exec(source)) !== null) {
    const line = source.slice(0, match.index).split("\n").length;
    cells.push({
      index,
      start: match.index,
      end: fencePattern.lastIndex,
      codeStart: source.indexOf("\n", match.index) + 1,
      code: match[2],
      codeLine: line + 1,
      line,
      metadata: parseFenceMetadata(match[1] || ""),
    });
    index += 1;
  }

  return cells;
}

function isInRixCell(source, position) {
  return extractRixCells(source).some((cell) => (
    position >= cell.codeStart && position <= cell.codeStart + cell.code.length
  ));
}

function diagnosticForRixError(error, cell) {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/position (\d+)/);
  const offset = Math.min(Number(match?.[1] ?? cell.code.length), cell.code.length);
  const from = cell.codeStart + offset;
  return {
    from,
    to: Math.min(from + 1, cell.codeStart + cell.code.length),
    severity: "error",
    message,
  };
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

function extractFencedRanges(source) {
  const ranges = [];
  const pattern = /^```[^\n]*\n[\s\S]*?^```[ \t]*$/gim;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    ranges.push({ start: match.index, end: pattern.lastIndex });
  }
  return ranges;
}

function extractInlineExpressions(source) {
  const expressions = [];
  const fences = extractFencedRanges(source);
  let fenceIndex = 0;
  let index = 0;

  while (index < source.length) {
    const fence = fences[fenceIndex];
    if (fence && index >= fence.start) {
      index = fence.end;
      fenceIndex += 1;
      continue;
    }
    if (source[index] !== "@" || source[index + 1] !== "{") {
      index += 1;
      continue;
    }

    let depth = 1;
    let quote = null;
    let escaped = false;
    let cursor = index + 2;
    for (; cursor < source.length && depth > 0; cursor += 1) {
      const character = source[cursor];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
      }
    }
    if (depth !== 0) {
      index += 2;
      continue;
    }
    const end = cursor;
    const expression = source.slice(index + 2, end - 1).trim();
    if (expression) {
      expressions.push({
        start: index,
        end,
        expression,
        line: source.slice(0, index).split("\n").length,
      });
    }
    index = end;
  }
  return expressions;
}

function parseNotebookDocument(source) {
  const cells = extractRixCells(source);
  const inlines = extractInlineExpressions(source);
  const nodes = [
    ...cells.map((cell) => ({ type: "cell", start: cell.start, end: cell.end, value: cell })),
    ...inlines.map((inline) => ({ type: "inline", start: inline.start, end: inline.end, value: inline })),
  ].sort((left, right) => left.start - right.start);
  const content = [];
  let cursor = 0;
  for (const node of nodes) {
    if (node.start > cursor) content.push({ type: "markdown", start: cursor, end: node.start, source: source.slice(cursor, node.start) });
    content.push(node);
    cursor = node.end;
  }
  if (cursor < source.length) content.push({ type: "markdown", start: cursor, end: source.length, source: source.slice(cursor) });
  return { source, cells, inlines, nodes, content };
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

function asRational(value, name) {
  if (value instanceof Rational) return value;
  if (value instanceof Integer) return new Rational(value);
  throw new Error(`${name} must be an exact RiX number`);
}

function asInterval(value) {
  if (value instanceof RationalInterval) return value;
  throw new Error("Slider interval must be a RiX interval such as 1:5");
}

function asPositiveCount(value, name) {
  if (!(value instanceof Integer) || value.value <= 0n) {
    throw new Error(`${name} must be a positive integer`);
  }
  const count = Number(value.value);
  if (!Number.isSafeInteger(count) || count > 10_000) {
    throw new Error(`${name} must be at most 10000`);
  }
  return count;
}

function inferSliderConfig(args) {
  let interval = new RationalInterval(-10, 10);
  let start = null;
  let step = null;
  let steps = null;

  if (args.length === 1 && args[0]?.type === "map") {
    const entries = args[0].entries;
    interval = entries.has("interval") ? asInterval(entries.get("interval")) : interval;
    start = entries.has("start") ? asRational(entries.get("start"), "Slider start") : null;
    if (entries.has("step") && entries.has("steps")) {
      throw new Error("Slider accepts either step or steps, not both");
    }
    if (entries.has("step")) step = asRational(entries.get("step"), "Slider step");
    if (entries.has("steps")) steps = asPositiveCount(entries.get("steps"), "Slider steps");
  } else {
    if (args.length > 3) throw new Error("Slider accepts interval, step-or-steps, and start");
    if (args[0] !== undefined) interval = asInterval(args[0]);
    if (args[1] !== undefined) {
      const second = asRational(args[1], "Slider step-or-steps");
      if (second.numerator === 0n) throw new Error("Slider step-or-steps cannot be zero");
      const isInteger = second.denominator === 1n;
      if (isInteger && second.numerator >= 3n) steps = asPositiveCount(new Integer(second.numerator), "Slider steps");
      else step = second;
    }
    if (args[2] !== undefined) start = asRational(args[2], "Slider start");
  }

  const low = interval.low;
  const high = interval.high;
  const span = high.subtract(low);
  if (span.numerator === 0n) throw new Error("Slider interval endpoints must differ");
  if (step) {
    if (step.numerator < 0n) step = step.negate();
    const tentativeSteps = Math.floor(span.toNumber() / step.toNumber());
    if (!Number.isFinite(tentativeSteps) || tentativeSteps < 1) {
      throw new Error("Slider step must fit inside its interval");
    }
    steps = Math.min(tentativeSteps, 10_000);
  } else {
    steps ??= 20;
    step = span.divide(new Integer(BigInt(steps)));
  }
  start ??= low.add(high).divide(new Integer(2));
  const startIndex = Math.max(0, Math.min(steps, Math.round((start.toNumber() - low.toNumber()) / step.toNumber())));
  return { low, high, step, steps, startIndex };
}

function createNotebookSlider(args, runtime) {
  const config = inferSliderConfig(args);
  const id = `${runtime.currentSourceId}:${runtime.sliderCounter++}`;
  const index = Math.max(0, Math.min(
    config.steps,
    runtime.sliderOverrides.get(id) ?? config.startIndex,
  ));
  const value = config.low.add(config.step.multiply(new Integer(BigInt(index))));
  let valueWidth = 1;
  const widthSamples = Math.min(config.steps, 200);
  for (let sample = 0; sample <= widthSamples; sample += 1) {
    const candidate = Math.round((config.steps * sample) / widthSamples);
    const candidateValue = config.low.add(config.step.multiply(new Integer(BigInt(candidate))));
    valueWidth = Math.max(valueWidth, formatValue(candidateValue).length);
  }
  runtime.sliders.push({ ...config, id, index, value, valueWidth });
  return value;
}

function makeNotebookRuntime(overrides = sliderOverrides, options = {}) {
  const registry = createDefaultRegistry();
  const runtime = {
    registry,
    context: new Context(),
    sliderCounter: 0,
    sliderOverrides: overrides,
    sliders: [],
    currentSourceId: "document",
    currentSliderName: null,
    mode: options.mode === "static" ? "static" : "live",
    currentPublication: null,
  };
  const pluginCatalog = clonePluginCatalog(options.pluginCatalog || pluginCatalogTemplate);
  const systemContext = createDefaultSystemContext({ frozen: false, pluginCatalog });
  systemContext.registerHost("slider", {
    impl(args) {
      return createNotebookSlider(args, runtime);
    },
    doc: "Notebook-only interactive slider control",
  });
  const modeBlock = (mode) => ({
    lazy: true,
    impl(args, context, evaluate) {
      if (args.length > 1) throw new Error(`.${mode} accepts at most one block`);
      if (args.length === 1 && runtime.mode === mode) {
        context.withSharedBody(args[0], () => evaluate(args[0]));
      }
      return null;
    },
    doc: `Evaluate a notebook block only in ${mode} mode`,
  });
  systemContext.registerHost("static", modeBlock("static"));
  systemContext.registerHost("live", modeBlock("live"));
  const outputCommand = (channel) => ({
    lazy: true,
    impl(args, _context, evaluate) {
      if (args.length > 1) throw new Error(`.${channel} accepts zero or one argument`);
      if (!runtime.currentPublication) throw new Error(`.${channel} may only be used while running a notebook cell`);
      const target = channel === "out" ? "out" : channel === "staticout" ? "static" : "live";
      if (target !== "out" && target !== runtime.mode) return null;
      if (runtime.currentPublication[target].declared) throw new Error(`.${channel} may only be used once per cell`);
      runtime.currentPublication[target] = {
        declared: true,
        suppressed: args.length === 0,
        value: args.length === 0 ? null : evaluate(args[0]),
      };
      return null;
    },
    doc: "Choose the notebook publication output for this cell",
  });
  systemContext.registerHost("out", outputCommand("out"));
  systemContext.registerHost("staticOut", outputCommand("staticout"));
  systemContext.registerHost("liveOut", outputCommand("liveout"));
  runtime.loadRixPlugin = ({ source, sourcePath, context, registry, systemContext: pluginSystemContext }) => (
    parseAndEvaluate(source, {
      context,
      registry,
      systemContext: pluginSystemContext,
      file: sourcePath,
    })
  );
  for (const id of options.plugins || configuredPlugins) {
    pluginCatalog.load(id, {
      context: runtime.context,
      registry: runtime.registry,
      systemContext,
      loadRix: runtime.loadRixPlugin,
    });
  }
  systemContext.freeze();
  runtime.systemContext = systemContext;
  return runtime;
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

  const lineNumber = document.createElement("span");
  lineNumber.className = "cell-result-line-number";
  lineNumber.textContent = `line ${statement.line}`;
  const source = document.createElement("pre");
  source.className = "cell-source";
  source.textContent = statement.code.replaceAll("\n", " ↵ ");
  source.title = statement.code;

  const value = document.createElement(statement.html ? "div" : "pre");
  value.className = "cell-result-value";
  if (statement.html) value.innerHTML = statement.html;
  else value.textContent = statement.content.replaceAll("\n", " ↵ ");
  value.title = statement.content;

  result.append(lineNumber, source, value);
  result.addEventListener("click", () => jumpToLine(statement.line));
  result.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    jumpToLine(statement.line);
  });
  output.append(result);
}

function executeCell(cell, runtime) {
  const context = cell.metadata.execution === "singleton"
    ? new Context()
    : cell.metadata.execution === "refresh"
      ? (runtime.context = new Context())
      : runtime.context;
  runtime.currentSourceId = `cell:${cell.line}`;
  context.setEnv("__system_context__", runtime.systemContext);
  context.setEnv("__registry__", runtime.registry);
  context.setEnv("__source__", cell.code);
  context.setEnv("__current_file__", `<notebook cell at line ${cell.line}>`);
  context.setEnv("__plugin_load_rix__", runtime.loadRixPlugin);

  const ast = parse(cell.code);
  const irNodes = lower(ast);
  const sources = splitTopLevelStatements(cell.code);
  const statements = [];
  let implicitOutput = { available: false, value: null };
  runtime.currentPublication = {
    out: { declared: false, suppressed: false, value: null },
    static: { declared: false, suppressed: false, value: null },
    live: { declared: false, suppressed: false, value: null },
  };

  for (const [index, irNode] of irNodes.entries()) {
    const source = sources[index] || { start: irNode.pos?.[0] || 0, code: "<source unavailable>" };
    const sourceLine = posToLineCol(cell.code, source.start).line;
    const line = cell.codeLine + sourceLine - 1;
    try {
      const sliderName = source.code.match(/^\s*([a-z][a-zA-Z0-9_]*)\s*:=\s*\.slider\s*\(/)?.[1] || "slider";
      runtime.currentSliderName = sliderName;
      const sliderStart = runtime.sliders.length;
      const value = evaluate(irNode, context, runtime.registry, runtime.systemContext);
      for (const slider of runtime.sliders.slice(sliderStart)) {
        slider.name = sliderName;
        slider.line = line;
      }
      runtime.currentSliderName = null;
      const hostCommand = irNode.fn === "SYS_CALL" && ["static", "live", "out", "staticout", "liveout"].includes(String(irNode.args?.[0] || ""));
      if (!hostCommand) implicitOutput = { available: true, value };
      const format = (item) => formatValue(item);
      statements.push({
        line,
        code: source.code,
        content: format(value),
        html: isOutputValue(value) ? renderOutputHtml(value, format) : null,
        kind: "result",
        position: cell.start + source.start,
      });
    } catch (error) {
      runtime.currentSliderName = null;
      statements.push({
        line,
        code: source.code,
        content: error instanceof Error ? error.message : String(error),
        kind: "error",
        position: cell.start + source.start,
      });
      break;
    }
  }
  const selected = runtime.mode === "static"
    ? runtime.currentPublication.static.declared ? runtime.currentPublication.static : runtime.currentPublication.out.declared ? runtime.currentPublication.out : implicitOutput
    : runtime.currentPublication.live.declared ? runtime.currentPublication.live : runtime.currentPublication.out.declared ? runtime.currentPublication.out : implicitOutput;
  const publication = selected.available === false || selected.suppressed
    ? null
    : { value: selected.value, content: formatValue(selected.value), kind: "result" };
  runtime.currentPublication = null;
  return {
    statements,
    metadata: cell.metadata,
    staticOutput: runtime.mode === "static" ? publication : null,
    liveOutput: runtime.mode === "live" ? publication : null,
  };
}

function executeInlineExpression(inline, runtime) {
  const context = runtime.context;
  runtime.currentSourceId = `inline:${inline.line}`;
  context.setEnv("__system_context__", runtime.systemContext);
  context.setEnv("__registry__", runtime.registry);
  context.setEnv("__source__", inline.expression);
  context.setEnv("__current_file__", `<inline RiX expression at line ${inline.line}>`);
  context.setEnv("__plugin_load_rix__", runtime.loadRixPlugin);
  let value;
  const ast = parse(inline.expression);
  const irNodes = lower(ast);
  if (irNodes.length === 0) throw new Error("Inline RiX expression is empty");
  const sliderStart = runtime.sliders.length;
  for (const irNode of irNodes) {
    value = evaluate(irNode, context, runtime.registry, runtime.systemContext);
  }
  for (const slider of runtime.sliders.slice(sliderStart)) {
    slider.name = "Slider";
    slider.line = inline.line;
  }
  const content = formatValue(value);
  return {
    start: inline.start,
    end: inline.end,
    replacement: content,
    statement: {
      line: inline.line,
      code: `@{${inline.expression}}`,
      content,
      kind: "result",
      label: "Inline RiX",
      position: inline.start,
    },
  };
}

function replaceInlineExpressions(source, inlineRuns) {
  let cursor = 0;
  let rendered = "";
  for (const run of inlineRuns) {
    rendered += source.slice(cursor, run.start);
    rendered += run.replacement;
    cursor = run.end;
  }
  return rendered + source.slice(cursor);
}

function executeDocument(source, options = {}) {
  const document = parseNotebookDocument(source);
  const { cells, inlines } = document;
  const runtime = makeNotebookRuntime(options.sliderOverrides || sliderOverrides, options);
  const runs = new Array(cells.length);
  const inlineRuns = [];
  const outputStatements = [];

  for (const event of document.nodes) {
    if (event.type === "cell") {
      const cell = event.value;
      try {
        runs[cell.index] = executeCell(cell, runtime);
      } catch (error) {
        runs[cell.index] = {
          metadata: cell.metadata,
          statements: [{
            line: cell.codeLine,
            code: cell.code.trim(),
            content: error instanceof Error ? error.message : String(error),
            kind: "error",
            position: cell.start,
          }],
        };
      }
      outputStatements.push(...runs[cell.index].statements);
      continue;
    }
    const inline = event.value;
    try {
      const inlineRun = executeInlineExpression(inline, runtime);
      inlineRuns.push(inlineRun);
      outputStatements.push(inlineRun.statement);
    } catch (error) {
      const content = error instanceof Error ? error.message : String(error);
      const inlineRun = {
        start: inline.start,
        end: inline.end,
        replacement: `RiX error: ${content}`,
        statement: {
          line: inline.line,
          code: `@{${inline.expression}}`,
          content,
          kind: "error",
          label: "Inline RiX",
          position: inline.start,
        },
      };
      inlineRuns.push(inlineRun);
      outputStatements.push(inlineRun.statement);
    }
  }

  return {
    document,
    cells,
    inlineRuns,
    runs,
    outputStatements: outputStatements.sort((left, right) => left.position - right.position),
    sliders: runtime.sliders,
    renderedSource: replaceInlineExpressions(source, inlineRuns),
    staticRenderedSource: options.mode === "static" ? renderStaticDocument(document, runs, inlineRuns) : null,
  };
}

function escapeMarkdownCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function staticValueText(value) {
  return formatValue(value);
}

function staticOutputMarkdown(value, { graphicReference = null, figureAlt = null } = {}) {
  if (!isOutputValue(value)) return staticValueText(value);
  if (value.kind === "text") return staticValueText(value.value);
  if (value.kind === "paragraph") return value.children.map(staticValueText).join("");
  if (value.kind === "heading") return `${"#".repeat(value.level)} ${staticValueText(value.content)}`;
  if (value.kind === "fragment") {
    return value.children.map((child) => staticOutputMarkdown(child, { graphicReference })).join("\n\n");
  }
  if (value.kind === "table") {
    const headings = value.columns.map((column) => escapeMarkdownCell(column.label));
    const rows = value.rows.map((row) => `| ${row.map((cell) => escapeMarkdownCell(staticValueText(cell))).join(" | ")} |`);
    const table = [`| ${headings.join(" | ")} |`, `| ${headings.map(() => "---").join(" | ")} |`, ...rows].join("\n");
    return [table, value.caption ? `*${value.caption}*` : ""].filter(Boolean).join("\n\n");
  }
  if (value.kind === "grid") {
    return gridLatex(value, formatValue);
  }
  if (value.kind === "graphic") {
    if (!graphicReference) return formatValue(value);
    return `![${figureAlt || "RiX graphic"}](${graphicReference(value)})`;
  }
  if (value.kind === "figure") {
    const content = staticOutputMarkdown(value.content, {
      graphicReference,
      figureAlt: value.alt || value.caption || figureAlt,
    });
    return [content, value.caption ? `*${value.caption}*` : ""].filter(Boolean).join("\n\n");
  }
  if (value.kind === "slide") {
    const heading = value.title ? `## ${value.title}` : "";
    const content = staticOutputMarkdown(value.content, { graphicReference });
    const notes = value.notes ? `<!-- Speaker notes: ${value.notes} -->` : "";
    return ["---", heading, content, notes].filter(Boolean).join("\n\n");
  }
  if (value.kind === "slides") {
    return value.slides.map((slide) => staticOutputMarkdown(slide, { graphicReference })).join("\n\n");
  }
  return formatValue(value);
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

function renderStaticDocument(document, runs, inlineRuns, options = {}) {
  const inlineByStart = new Map(inlineRuns.map((run) => [run.start, run]));
  const graphicReference = options.graphicReference || null;
  return document.content.map((node) => {
    if (node.type === "markdown") return node.source;
    if (node.type === "inline") return inlineByStart.get(node.start)?.replacement || "";
    const run = runs[node.value.index];
    if (options.liveCellIndexes?.has(node.value.index) && options.liveCellPlaceholder) {
      return `\n\n<!-- rix-live-cell:${node.value.index} -->\n\n`;
    }
    const replacement = staticCellReplacement(run, graphicReference);
    return replacement ? `\n\n${replacement}\n\n` : "";
  }).join("");
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
    renderMarkdown(documentRun.renderedSource, documentRun.runs);
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
}

function runNotebook() {
  window.clearTimeout(liveRunTimer);
  const source = editor.state.doc.toString();
  const documentRun = executeDocument(source);
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
  for (const statement of documentRun.outputStatements) appendOutput(statement);
  const succeeded = documentRun.runs.filter((run) => run.statements.every((statement) => statement.kind === "result")).length;
  latestRuns = documentRun.runs;
  renderDocumentPreview(documentRun);
  renderSliderControls(documentRun.sliders);
  setPreviewStale(false);
  status.textContent = `${succeeded} of ${documentRun.cells.length} RiX cells and ${documentRun.inlineRuns.length} inline expressions ran`;
}

function scheduleNotebookRun(delay = 300) {
  window.clearTimeout(liveRunTimer);
  liveRunTimer = window.setTimeout(runNotebook, delay);
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
  runNotebook();
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
  runNotebook();
}

function updateSaveButton() {
  saveNoteButton.disabled = !projects.isOpen || !dirty;
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

function setEditorPaneWidth(width, rememberRatio = true) {
  const { availableWidth } = editorSplitMetrics();
  const minimumEditorWidth = 330;
  const minimumDocumentWidth = 380;
  const maximumEditorWidth = Math.max(minimumEditorWidth, availableWidth - minimumDocumentWidth);
  const resolvedWidth = Math.max(minimumEditorWidth, Math.min(maximumEditorWidth, width));
  workspace.style.setProperty("--editor-pane-width", `${resolvedWidth}px`);
  if (rememberRatio && availableWidth > 0) editorPaneRatio = resolvedWidth / availableWidth;
}

function preserveEditorPaneRatio() {
  if (window.matchMedia("(max-width: 900px)").matches) return;
  const { availableWidth } = editorSplitMetrics();
  if (availableWidth <= 0) return;
  if (editorPaneRatio === null) editorPaneRatio = editorPane.getBoundingClientRect().width / availableWidth;
  setEditorPaneWidth(availableWidth * editorPaneRatio, false);
}

function installMainResizer() {
  let pointerId = null;
  mainResizer.addEventListener("pointerdown", (event) => {
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
  exportQuarto.checked = true;
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
    includeQuarto: true,
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
  if (open && projects.project.directory !== sidebarProjectDirectory) {
    sidebarProjectDirectory = projects.project.directory;
    sidebarCollapsed = false;
  }
  if (!open) sidebarProjectDirectory = null;
  updateSaveButton();
  newNotebookButton.disabled = !open;
  newNoteButton.disabled = !open;
  projectSidebar.hidden = !open || sidebarCollapsed;
  workspace.classList.toggle("has-project", open && !sidebarCollapsed);
  updateSidebarToggle(open);
  window.requestAnimationFrame(preserveEditorPaneRatio);
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
  if (!projects.isOpen) return;
  if (activeDocument.kind === "theme") {
    await projects.saveTheme(editor.state.doc.toString());
    applyProjectTheme(projects.project.theme);
  } else if (activeDocument.kind === "toml") {
    await projects.saveManifest(activeDocument.path, editor.state.doc.toString());
  } else {
    await projects.saveCurrentNote(editor.state.doc.toString());
  }
  if (activeDocument.kind === "toml") await refreshPluginCatalog();
  dirty = false;
  updateSaveButton();
  setStatus(activeDocument.kind === "note" ? "Saved" : "Saved configuration");
  refreshProjectControls();
}

async function refreshPluginCatalog() {
  if (!projects.isOpen) {
    pluginCatalogTemplate = createNotebookBundledPluginCatalog();
    configuredPlugins = [];
    return;
  }
  pluginCatalogTemplate = await createProjectPluginCatalog(projects.project.directory);
  configuredPlugins = configuredPluginIds(projects.project, projects.currentNotebook);
}

async function loadNote(note) {
  activeDocument = { kind: "note", path: note.path };
  applyProjectTheme(projects.project.theme);
  editorKind.textContent = "Markdown";
  await refreshPluginCatalog();
  setDocument(note.source);
  refreshProjectControls();
  setStatus(`Opened ${note.path.split("/").at(-1)}`);
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

runButton.addEventListener("click", runNotebook);
toggleRightPaneButton.addEventListener("click", toggleRightPane);
togglePreviewModeButton.addEventListener("click", togglePreviewMode);
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
  if (!projects.isOpen) return;
  sidebarCollapsed = !sidebarCollapsed;
  refreshProjectControls();
});
installMainResizer();
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
    "open-notebook-help": () => openHelp("notebook"),
    "open-rix-reference": () => openHelp("rix"),
    "open-rix-tutorials": () => openHelp("tutorials"),
    export: () => openExportDialog(),
    "quick-export": () => quickExport(),
  };
  commands[event.payload]?.();
});
listen("open-recent-project", (event) => {
  runProjectAction(async () => {
    const note = await projects.openProject(event.payload.path, event.payload.last_note_path);
    if (note) await loadNote(note);
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
