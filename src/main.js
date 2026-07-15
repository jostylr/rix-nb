import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import MarkdownIt from "markdown-it";
import {
  Context,
  createDefaultRegistry,
  createDefaultSystemContext,
  formatValue,
  parseAndEvaluate,
} from "../../rix/src/index.js";
import "./styles.css";

const editorHost = document.querySelector("#markdown-editor");
const initialDocument = editorHost.textContent.trim();
editorHost.textContent = "";
const preview = document.querySelector("#markdown-preview");
const output = document.querySelector("#rix-output");
const runButton = document.querySelector("#run-notebook");
const status = document.querySelector("#document-status");

const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

function renderMarkdown(source) {
  preview.innerHTML = markdownRenderer.render(source);
}

function extractRixCells(source) {
  const cells = [];
  const fencePattern = /^```rix(?:[ \t]+([^\n]*))?[ \t]*\n([\s\S]*?)^```[ \t]*$/gim;
  let match;

  while ((match = fencePattern.exec(source)) !== null) {
    const line = source.slice(0, match.index).split("\n").length;
    cells.push({
      code: match[2].trim(),
      line,
      options: new Set((match[1] || "").trim().split(/\s+/).filter(Boolean)),
    });
  }

  return cells;
}

function makeNotebookRuntime() {
  const registry = createDefaultRegistry();
  const systemContext = createDefaultSystemContext();
  return { registry, systemContext, context: new Context() };
}

function appendOutput(cell, content, kind = "result") {
  const result = document.createElement("section");
  result.className = `cell-result cell-result-${kind}`;

  const title = document.createElement("p");
  title.className = "cell-result-title";
  title.textContent = `RiX cell · line ${cell.line}`;

  const value = document.createElement("pre");
  value.className = "cell-result-value";
  value.textContent = content;

  result.append(title, value);
  output.append(result);
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

  for (const cell of cells) {
    const context = cell.options.has("new") ? new Context() : runtime.context;
    try {
      const value = parseAndEvaluate(cell.code, {
        context,
        registry: runtime.registry,
        systemContext: runtime.systemContext,
        file: `<notebook cell at line ${cell.line}>`,
      });
      appendOutput(cell, formatValue(value), "result");
      succeeded += 1;
    } catch (error) {
      appendOutput(cell, error instanceof Error ? error.message : String(error), "error");
    }
  }

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
        renderMarkdown(update.state.doc.toString());
        status.textContent = "Edited · run notebook to refresh results";
      }),
    ],
  }),
  parent: editorHost,
});

runButton.addEventListener("click", runNotebook);
window.addEventListener("keydown", handleRunShortcut, { capture: true });
renderMarkdown(initialDocument);
runNotebook();
