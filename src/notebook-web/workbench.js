import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import MarkdownIt from "markdown-it";
import katex from "katex";
import renderMathInElement from "katex/contrib/auto-render";
import { rixHighlighting, rixLanguage } from "../../../rix/src/tools/codemirror/index.js";
import { assertNotebookEngine, createNotebookHost } from "./contracts.js";

/**
 * Mount the browser-only editor + render surface.
 *
 * Nothing in this module assumes Tauri, a filesystem, project.toml, or a
 * particular server.  Callers can put it in a native WebView, a documentation
 * site, or a hosted editor and supply persistence through the host callbacks.
 */
export function mountNotebookWeb({ engine, editorHost, preview, output, host: callbacks, initialDocument = "" }) {
  engine = assertNotebookEngine(engine);
  const host = createNotebookHost(callbacks);
  const renderer = new MarkdownIt({ html: false, linkify: true, typographer: true });
  let currentRun = null;
  let applying = false;

  function renderMath(element) {
    renderMathInElement(element, {
      delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }, { left: "\\(", right: "\\)", display: false }, { left: "\\[", right: "\\]", display: true }],
      throwOnError: false,
    });
  }

  function renderResults(run) {
    output.replaceChildren();
    for (const statement of run.outputStatements) {
      const item = document.createElement("section");
      item.className = `cell-result cell-result-${statement.kind}`;
      item.innerHTML = `<span class="cell-result-line-number">Line ${statement.line}</span><pre class="cell-source"></pre><pre class="cell-result-value"></pre>`;
      item.querySelector(".cell-source").textContent = statement.code.replaceAll("\n", " ↵ ");
      const value = item.querySelector(".cell-result-value");
      if (statement.html) { const rendered = document.createElement("div"); rendered.className = "cell-result-value"; rendered.innerHTML = statement.html; value.replaceWith(rendered); }
      else value.textContent = statement.content.replaceAll("\n", " ↵ ");
      item.addEventListener("click", () => api.jumpToLine(statement.line));
      output.append(item);
    }
  }

  function renderPreview(run) {
    preview.innerHTML = renderer.render(run.renderedSource);
    renderMath(preview);
  }

  function run(options = {}) {
    try {
      currentRun = engine.executeDocument(view.state.doc.toString(), options);
      renderResults(currentRun);
      renderPreview(currentRun);
      host.onRun(currentRun);
      return currentRun;
    } catch (error) {
      host.onError(error);
      throw error;
    }
  }

  const view = new EditorView({
    state: EditorState.create({
      doc: initialDocument,
      extensions: [
        basicSetup,
        markdown({ codeLanguages: [{ name: "rix", support: rixLanguage }] }),
        rixHighlighting,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || applying) return;
          host.onDocumentChange(update.state.doc.toString());
        }),
      ],
    }),
    parent: editorHost,
  });

  const api = {
    get editor() { return view; },
    get document() { return view.state.doc.toString(); },
    get lastRun() { return currentRun; },
    setDocument(source) {
      applying = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
      applying = false;
      return run();
    },
    jumpToLine(line) {
      const target = view.state.doc.line(Math.min(line, view.state.doc.lines));
      view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
      view.focus();
    },
    run,
    validate() { return engine.validate(view.state.doc.toString()); },
    destroy() { view.destroy(); },
  };
  run();
  return api;
}

export { katex };
