import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { autocompletion } from "@codemirror/autocomplete";
import { linter } from "@codemirror/lint";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import MarkdownIt from "markdown-it";
import renderMathInElement from "katex/contrib/auto-render";
import { Integer } from "@ratmath/core";
import {
  formatValue,
  isOutputValue,
  mountOutputWidgets,
  parseAndEvaluate,
  renderOutputHtml,
} from "../../../../rix/src/index.js";
import { rixHighlighting, rixLanguage } from "../../../../rix/src/tools/codemirror/index.js";
import { assertNotebookEngine, createNotebookHost } from "../../../docshell/src/contracts.js";
import { isInRixCell, parseFenceMetadata } from "./rix-engine.js";

export function publicationOutputHtml(run) {
  if (!run?.liveOutput) return "";
  return isOutputValue(run.liveOutput.value)
    ? renderOutputHtml(run.liveOutput.value, formatValue)
    : `<pre>${String(run.liveOutput.content).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</pre>`;
}

/**
 * Browser-only notebook editor, results pane, controls, and Markdown preview.
 * The elements are supplied by the host so this mounts unchanged in a native
 * WebView, a static page, or an application with a different surrounding UI.
 */
export function mountNotebookWeb({ engine, elements, host: callbacks, initialDocument = "" }) {
  engine = assertNotebookEngine(engine);
  const host = createNotebookHost(callbacks);
  const {
    editorHost, preview, output, previewPane, outputPane, sliderControls,
    sliderControlList, runButton, toggleRightPaneButton, status, rightPaneTitle,
  } = elements;
  const renderer = new MarkdownIt({ html: false, linkify: true, typographer: true });
  const defaultFence = renderer.renderer.rules.fence;
  const defaultImage = renderer.renderer.rules.image;
  let currentRun = null;
  let applying = false;
  let rightPane = "results";
  let delayedRun = null;
  let sliderSignature = "";
  const sliderOverrides = new Map();
  let widgetDisposers = [];

  renderer.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index];
    if (token.info.trim().split(/\s+/)[0] !== "rix") return defaultFence(tokens, index, options, env, self);
    const run = env.rixRuns?.[env.rixIndex++] || null;
    const metadata = run?.metadata || parseFenceMetadata(token.info.trim().replace(/^rix(?:\s+|$)/i, ""));
    const code = metadata.showCode ? defaultFence(tokens, index, options, env, self) : "";
    if (!run?.liveOutput || !metadata.showOutput) return code;
    const html = publicationOutputHtml(run);
    return `<div class="rix-preview-cell">${code}<div class="rix-preview-results"><div class="rix-preview-result">${html}</div></div></div>`;
  };
  renderer.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const source = token.attrGet("src");
    if (source) token.attrSet("src", host.resolveAsset(source));
    return defaultImage(tokens, index, options, env, self);
  };

  function renderMath(element) {
    renderMathInElement(element, { delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }, { left: "\\(", right: "\\)", display: false }, { left: "\\[", right: "\\]", display: true }], throwOnError: false });
  }
  function setStatus(text) { if (status) status.textContent = text; host.onStatus(text); }
  function disposeWidgets() {
    for (const dispose of widgetDisposers.splice(0)) dispose();
  }
  function mountWidgets(root, value, runtime, line) {
    const dispose = mountOutputWidgets(root, value, {
      format: formatValue,
      onActivate: ({ address }) => {
        const selection = view.state.selection.main;
        view.dispatch({ changes: { from: selection.from, to: selection.to, insert: address }, selection: { anchor: selection.from + address.length } });
        view.focus();
      },
      evaluateEdit: (editSource, { mode }) => parseAndEvaluate(mode === "formula"
        ? `@{ ${editSource} }`
        : editSource, {
        context: runtime.context,
        registry: runtime.registry,
        systemContext: runtime.systemContext,
        file: `<widget edit at line ${line}>`,
      }),
    });
    widgetDisposers.push(dispose);
  }
  function renderResults(run) {
    disposeWidgets();
    output.replaceChildren();
    if (!run.outputStatements.length) { output.innerHTML = '<p class="output-placeholder">No RiX cells or inline expressions found.</p>'; return; }
    for (const statement of run.outputStatements) {
      const item = document.createElement("section"); item.className = `cell-result cell-result-${statement.kind}`; item.tabIndex = 0;
      const line = document.createElement("span"); line.className = "cell-result-line-number"; line.textContent = `Line ${statement.line}`;
      const source = document.createElement("pre"); source.className = "cell-source"; source.textContent = statement.code.replaceAll("\n", " ↵ ");
      const result = document.createElement(statement.html ? "div" : "pre"); result.className = "cell-result-value";
      if (statement.html) {
        result.innerHTML = statement.html;
        mountWidgets(result, statement.value, run.runtime, statement.line);
        if (result.querySelector(".rix-output-sheet, .rix-output-control-panel, .rix-output-graphic[data-rix-interactive=\"true\"]")) item.removeAttribute("tabindex");
      } else result.textContent = statement.content.replaceAll("\n", " ↵ ");
      item.append(line, source, result);
      item.addEventListener("click", (event) => {
        if (event.target.closest("button, input, select, textarea, [data-rix-drag-target], td[data-rix-address]")) return;
        api.jumpToLine(statement.line);
      });
      output.append(item);
    }
  }
  function renderPreview(run) {
    preview.innerHTML = renderer.render(run.renderedSource, { rixRuns: run.runs, rixIndex: 0 });
    renderMath(preview);
    const roots = [...preview.querySelectorAll(".rix-preview-result")];
    const visibleRuns = run.runs.filter((cellRun) => cellRun?.liveOutput && cellRun.metadata.showOutput);
    for (const [index, cellRun] of visibleRuns.entries()) {
      const root = roots[index];
      if (root) mountWidgets(root, cellRun.liveOutput.value, run.runtime, cellRun.statements.at(-1)?.line || 1);
    }
  }
  function renderSliders(sliders) {
    if (!sliderControls || !sliderControlList) return;
    sliderControls.hidden = sliders.length === 0;
    const signature = sliders.map((slider) => `${slider.id}:${slider.steps}`).join("|");
    if (signature === sliderSignature) {
      for (const [index, slider] of sliders.entries()) {
        const input = sliderControlList.children[index]?.querySelector("input");
        const value = sliderControlList.children[index]?.querySelector("output");
        if (input && document.activeElement !== input) input.value = String(slider.index);
        if (value) value.textContent = slider.value.toString();
      }
      return;
    }
    sliderSignature = signature; sliderControlList.replaceChildren();
    for (const slider of sliders) {
      const label = document.createElement("label"); label.className = "slider-control";
      const heading = document.createElement("span"); heading.className = "slider-control-heading"; heading.textContent = `${slider.name} · Line ${slider.line}`;
      const input = document.createElement("input"); input.type = "range"; input.min = "0"; input.max = String(slider.steps); input.value = String(slider.index);
      const value = document.createElement("output"); value.textContent = slider.value.toString(); value.style.width = `${slider.valueWidth}ch`;
      input.addEventListener("input", () => { sliderOverrides.set(slider.id, Number(input.value)); value.textContent = slider.low.add(slider.step.multiply(new Integer(BigInt(input.value)))).toString(); scheduleRun(80); });
      label.append(heading, input, value); sliderControlList.append(label);
    }
  }
  function run(options = {}) {
    window.clearTimeout(delayedRun);
    try {
      currentRun = engine.executeDocument(view.state.doc.toString(), { ...options, sliderOverrides });
      renderResults(currentRun); renderPreview(currentRun); renderSliders(currentRun.sliders);
      setStatus(`${currentRun.cells.length} RiX cells and ${currentRun.inlineRuns.length} inline expressions ran`); host.onRun(currentRun); return currentRun;
    } catch (error) { host.onError(error); throw error; }
  }
  function scheduleRun(delay = 500) { window.clearTimeout(delayedRun); delayedRun = window.setTimeout(run, delay); }
  function setRightPane(next) {
    rightPane = next;
    if (previewPane) previewPane.hidden = next !== "preview";
    if (outputPane) outputPane.hidden = next === "preview";
    if (rightPaneTitle) rightPaneTitle.textContent = next === "preview" ? "Preview" : "RiX results";
    if (toggleRightPaneButton) toggleRightPaneButton.textContent = next === "preview" ? "Show results" : "Show preview";
  }
  const view = new EditorView({
    state: EditorState.create({ doc: initialDocument, extensions: [
      basicSetup, markdown({ codeLanguages: (info) => /^rix(?:\s|$)/i.test(info) ? rixLanguage : null }), rixHighlighting,
      autocompletion({ override: [(context) => { const source = context.state.doc.toString(); if (!isInRixCell(source, context.pos)) return null; const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/); return { from: word?.from ?? context.pos, options: engine.getCompletions() }; }] }),
      linter((viewState) => engine.validate(viewState.state.doc.toString()), { delay: 350 }),
      EditorView.updateListener.of((update) => { if (!update.docChanged || applying) return; host.onDocumentChange(update.state.doc.toString()); scheduleRun(); }),
    ] }), parent: editorHost,
  });
  const api = {
    get editor() { return view; }, get document() { return view.state.doc.toString(); }, get lastRun() { return currentRun; },
    setDocument(source) { applying = true; view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } }); applying = false; sliderOverrides.clear(); return run(); },
    jumpToLine(line) { const target = view.state.doc.line(Math.min(line, view.state.doc.lines)); view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true }); view.focus(); },
    run, scheduleRun, validate() { return engine.validate(view.state.doc.toString()); }, setRightPane, toggleRightPane() { setRightPane(rightPane === "preview" ? "results" : "preview"); }, destroy() { window.clearTimeout(delayedRun); disposeWidgets(); view.destroy(); },
  };
  runButton?.addEventListener("click", () => run()); toggleRightPaneButton?.addEventListener("click", () => api.toggleRightPane()); setRightPane("results"); run(); return api;
}
