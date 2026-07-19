import { Integer, Rational, RationalInterval } from "@ratmath/core";
import renderMathInElement from "katex/contrib/auto-render";
import {
  Context,
  createDefaultRegistry,
  createDefaultSystemContext,
  evaluate,
  formatValue,
  isOutputValue,
  lower,
  parse,
  parseAndEvaluate,
  renderOutputHtml,
} from "../../rix/src/index.js";
import { gridLatex } from "./output-latex.js";
import { createNotebookBundledPluginCatalog } from "./bundled-plugin-catalog.js";

const payloadElement = document.querySelector("#rix-live-document");
const sourceCellElements = [...document.querySelectorAll("[data-rix-source-cell]")];

if (payloadElement || sourceCellElements.length) {
  const payload = payloadElement ? JSON.parse(payloadElement.textContent) : null;
  const controls = document.querySelector("#rix-live-controls");
  const sliderOverrides = new Map();

  installStyles();
  document.documentElement.classList.add("rix-live-ready");
  hideRuntimeSources();
  run();

  function hideRuntimeSources() {
    for (const sourceCell of sourceCellElements) {
      sourceCell.hidden = true;
      sourceCell.style.setProperty("display", "none", "important");
    }
  }

  function extractCells(source) {
    const pattern = /^```rix(?:[ \t]+([^\n]*))?[ \t]*\n([\s\S]*?)^```[ \t]*$/gim;
    const cells = [];
    let match;
    let index = 0;
    while ((match = pattern.exec(source)) !== null) {
      cells.push({ index, code: match[2], metadata: parseMetadata(match[1] || "") });
      index += 1;
    }
    return cells;
  }

  function extractSourceCells(elements) {
    return elements.map((element, position) => ({
      index: Number(element.dataset.rixCell ?? position),
      code: (element.matches("code") ? element : element.querySelector("code"))?.textContent || "",
      metadata: parseMetadata(element.dataset.rixHeader || ""),
    })).sort((left, right) => left.index - right.index);
  }

  function parseMetadata(header) {
    const tokens = header.trim().split(/\s+/).filter(Boolean).map((token) => token.toLowerCase());
    const role = tokens.includes("set") ? "set" : tokens.includes("edu") ? "edu" : "out";
    return {
      role,
      execution: tokens.includes("singleton") ? "singleton" : tokens.includes("refresh") ? "refresh" : "flow",
      showCode: role === "edu",
      showOutput: role !== "set",
    };
  }

  function asRational(value, label) {
    if (value instanceof Rational) return value;
    if (value instanceof Integer) return new Rational(value);
    throw new Error(`${label} must be an exact RiX number`);
  }

  function inferSlider(args) {
    let interval = new RationalInterval(-10, 10);
    let start = null;
    let step = null;
    let steps = null;
    if (args.length === 1 && args[0]?.type === "map") {
      const entries = args[0].entries;
      interval = entries.get("interval") || interval;
      start = entries.has("start") ? asRational(entries.get("start"), "Slider start") : null;
      if (entries.has("step") && entries.has("steps")) throw new Error("Slider accepts either step or steps, not both");
      if (entries.has("step")) step = asRational(entries.get("step"), "Slider step");
      if (entries.has("steps")) steps = Number(asRational(entries.get("steps"), "Slider steps").numerator);
    } else {
      if (args.length > 3) throw new Error("Slider accepts interval, step-or-steps, and start");
      if (args[0] !== undefined) interval = args[0];
      if (!(interval instanceof RationalInterval)) throw new Error("Slider interval must be a RiX interval such as 1:5");
      if (args[1] !== undefined) {
        const second = asRational(args[1], "Slider step-or-steps");
        if (second.numerator === 0n) throw new Error("Slider step-or-steps cannot be zero");
        if (second.denominator === 1n && second.numerator >= 3n) steps = Number(second.numerator);
        else step = second;
      }
      if (args[2] !== undefined) start = asRational(args[2], "Slider start");
    }
    if (!Number.isSafeInteger(steps) && steps !== null) throw new Error("Slider steps must be a safe integer");
    const low = interval.low;
    const high = interval.high;
    const span = high.subtract(low);
    if (step) {
      if (step.numerator < 0n) step = step.negate();
      steps = Math.floor(span.toNumber() / step.toNumber());
    } else {
      steps ??= 20;
      step = span.divide(new Integer(BigInt(steps)));
    }
    if (!Number.isFinite(steps) || steps < 1 || steps > 10000) throw new Error("Slider must have between 1 and 10000 steps");
    start ??= low.add(high).divide(new Integer(2));
    const startIndex = Math.max(0, Math.min(steps, Math.round((start.toNumber() - low.toNumber()) / step.toNumber())));
    return { low, step, steps, startIndex };
  }

  function makeRuntime(sliders) {
    const registry = createDefaultRegistry();
    const pluginCatalog = createNotebookBundledPluginCatalog();
    const runtime = {
      registry,
      context: new Context(),
      systemContext: null,
      currentCell: 0,
      sliderCount: 0,
      currentSliderName: null,
      currentPublication: null,
    };
    const systemContext = createDefaultSystemContext({ frozen: false, pluginCatalog });
    systemContext.registerHost("slider", {
      impl(args) {
        const config = inferSlider(args);
        const id = `${runtime.currentCell}:${runtime.sliderCount++}`;
        const index = Math.max(0, Math.min(config.steps, sliderOverrides.get(id) ?? config.startIndex));
        const value = config.low.add(config.step.multiply(new Integer(BigInt(index))));
        sliders.push({ ...config, id, index, value, name: runtime.currentSliderName || "Parameter" });
        return value;
      },
      doc: "RiX Notebook live slider",
    });
    const modeBlock = (mode) => ({
      lazy: true,
      impl(args, context, evaluate) {
        if (args.length > 1) throw new Error(`.${mode} accepts at most one block`);
        if (args.length === 1 && mode === "live") context.withSharedBody(args[0], () => evaluate(args[0]));
        return null;
      },
    });
    systemContext.registerHost("static", modeBlock("static"));
    systemContext.registerHost("live", modeBlock("live"));
    const outputCommand = (channel) => ({
      lazy: true,
      impl(args, _context, evaluate) {
        if (args.length > 1) throw new Error(`.${channel} accepts zero or one argument`);
        if (!runtime.currentPublication) throw new Error(`.${channel} may only be used while running a notebook cell`);
        const target = channel === "out" ? "out" : channel === "staticout" ? "static" : "live";
        if (target !== "out" && target !== "live") return null;
        if (runtime.currentPublication[target].declared) throw new Error(`.${channel} may only be used once per cell`);
        runtime.currentPublication[target] = { declared: true, suppressed: args.length === 0, value: args.length === 0 ? null : evaluate(args[0]) };
        return null;
      },
    });
    systemContext.registerHost("out", outputCommand("out"));
    systemContext.registerHost("staticOut", outputCommand("staticout"));
    systemContext.registerHost("liveOut", outputCommand("liveout"));
    runtime.loadRixPlugin = ({ source, sourcePath, context, registry: pluginRegistry, systemContext: pluginSystemContext }) => (
      parseAndEvaluate(source, {
        context,
        registry: pluginRegistry,
        systemContext: pluginSystemContext,
        file: sourcePath,
      })
    );
    systemContext.freeze();
    runtime.systemContext = systemContext;
    return runtime;
  }

  function executeCell(cell, runtime) {
    const context = cell.metadata.execution === "singleton"
      ? new Context()
      : cell.metadata.execution === "refresh" ? (runtime.context = new Context()) : runtime.context;
    context.setEnv("__system_context__", runtime.systemContext);
    context.setEnv("__registry__", runtime.registry);
    context.setEnv("__source__", cell.code);
    context.setEnv("__plugin_load_rix__", runtime.loadRixPlugin);
    runtime.currentCell = cell.index;
    const results = [];
    let implicitOutput = { available: false, value: null };
    runtime.currentPublication = {
      out: { declared: false, suppressed: false, value: null },
      static: { declared: false, suppressed: false, value: null },
      live: { declared: false, suppressed: false, value: null },
    };
    for (const node of lower(parse(cell.code))) {
      try {
        runtime.currentSliderName = sourceNameForNode(cell.code, results.length);
        const value = evaluate(node, context, runtime.registry, runtime.systemContext);
        results.push({ value, error: null });
        const hostCommand = node.fn === "SYS_CALL" && ["static", "live", "out", "staticout", "liveout"].includes(String(node.args?.[0] || ""));
        if (!hostCommand) implicitOutput = { available: true, value };
        runtime.currentSliderName = null;
      } catch (error) {
        runtime.currentSliderName = null;
        results.push({ value: null, error: error instanceof Error ? error.message : String(error) });
        break;
      }
    }
    const selected = runtime.currentPublication.live.declared
      ? runtime.currentPublication.live
      : runtime.currentPublication.out.declared ? runtime.currentPublication.out : implicitOutput;
    const liveResult = selected.available === false || selected.suppressed
      ? null
      : { value: selected.value, error: null };
    runtime.currentPublication = null;
    return { results, liveResult };
  }

  function sourceNameForNode(source, index) {
    const statements = source.split(/;\s*(?:\n|$)/).filter(Boolean);
    return statements[index]?.match(/^\s*([a-z][a-zA-Z0-9_]*)\s*:=\s*\.slider\s*\(/)?.[1] || "Parameter";
  }

  function run() {
    const cells = payload ? extractCells(payload.source) : extractSourceCells(sourceCellElements);
    const sliders = [];
    const runtime = makeRuntime(sliders);
    for (const cell of cells) {
      const result = executeCell(cell, runtime);
      if (cell.metadata.role !== "set" && document.querySelector(`[data-rix-live-cell="${cell.index}"]`)) renderWidget(cell, result);
    }
    renderControls(sliders);
  }

  function renderWidget(cell, execution) {
    const widget = document.querySelector(`[data-rix-live-cell="${cell.index}"]`);
    if (!widget) return;
    const showCode = widget.dataset.rixShowCode === undefined
      ? cell.metadata.showCode
      : widget.dataset.rixShowCode === "true";
    const code = showCode ? `<details class="rix-live-source"><summary>RiX code</summary><pre><code>${escapeLiveHtml(cell.code)}</code></pre></details>` : "";
    const result = execution.liveResult;
    let output = "";
    if (cell.metadata.showOutput && result) {
      output = result.error
        ? `<pre class="rix-live-error">${escapeLiveHtml(result.error)}</pre>`
        : `<div class="rix-live-output">${renderLiveValue(result.value)}</div>`;
    }
    widget.innerHTML = `${code}${output}`;
    renderMathInElement(widget, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
        { left: "\\[", right: "\\]", display: true },
      ],
      throwOnError: false,
    });
    normalizeLiveTables(widget);
  }

  function normalizeLiveTables(widget) {
    for (const table of widget.querySelectorAll("table.rix-output-table")) {
      table.style.setProperty("display", "inline-table", "important");
      table.style.setProperty("width", "auto", "important");
      table.style.setProperty("max-width", "100%", "important");
      table.style.setProperty("table-layout", "auto", "important");
      for (const cell of table.querySelectorAll("th, td")) cell.style.setProperty("width", "auto", "important");
    }
  }

  function renderLiveValue(value) {
    if (!isOutputValue(value)) return `<pre>${escapeLiveHtml(formatValue(value))}</pre>`;
    if (value.kind === "grid") return `<div class="rix-live-math-grid">${gridLatex(value, formatValue)}</div>`;
    if (value.kind === "fragment") return value.children.map(renderLiveValue).join("");
    if (value.kind === "figure") {
      return `<figure>${renderLiveValue(value.content)}${value.caption ? `<figcaption>${escapeLiveHtml(value.caption)}</figcaption>` : ""}</figure>`;
    }
    if (value.kind === "slide") return `<section class="rix-live-slide">${value.title ? `<h2>${escapeLiveHtml(value.title)}</h2>` : ""}${renderLiveValue(value.content)}</section>`;
    if (value.kind === "slides") return value.slides.map(renderLiveValue).join("");
    return renderOutputHtml(value, formatValue);
  }

  function renderControls(sliders) {
    if (!controls) return;
    controls.replaceChildren();
    controls.hidden = sliders.length === 0;
    for (const slider of sliders) {
      const label = document.createElement("label");
      label.className = "rix-live-slider";
      const name = document.createElement("span");
      name.textContent = slider.name;
      const input = document.createElement("input");
      input.type = "range";
      input.min = "0";
      input.max = String(slider.steps);
      input.value = String(slider.index);
      const value = document.createElement("output");
      value.textContent = formatValue(slider.value);
      input.addEventListener("input", () => {
        sliderOverrides.set(slider.id, Number(input.value));
        run();
      });
      label.append(name, input, value);
      controls.append(label);
    }
  }

  function escapeLiveHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  function installStyles() {
    if (document.querySelector("#rix-live-styles")) return;
    const style = document.createElement("style");
    style.id = "rix-live-styles";
    style.textContent = ".rix-live-ready .rix-static,.rix-live-ready .rix-runtime-source,.rix-live-ready [data-rix-source-cell]{display:none}.rix-live-controls{display:grid;gap:.55rem;margin:1rem 0;padding:.8rem;background:#f4f7fb;border:1px solid #cbd9e9;border-radius:6px}.rix-live-slider{display:grid;grid-template-columns:auto minmax(8rem,1fr) auto;align-items:center;gap:.65rem;font:14px system-ui,sans-serif}.rix-live-slider input{accent-color:#35557b}.rix-live-widget{margin:1rem 0}.rix-live-source summary{cursor:pointer;color:#35557b}.rix-live-source pre,.rix-live-output pre,.rix-live-error{overflow:auto;padding:.8rem;background:#f4f2ec;border-radius:5px}.rix-live-math-grid{overflow:auto;margin:1rem 0}.rix-live-error{color:#8a2520;background:#fbe9e7}.rix-live-output table{border-collapse:collapse}.rix-live-output .rix-output-table{display:inline-table!important;width:auto!important;max-width:100%;table-layout:auto}.rix-live-output th,.rix-live-output td{width:auto!important;padding:.3rem .5rem;border:1px solid #cfd8e5}.rix-live-output th{background:#edf3fa}.rix-live-output svg{display:block;max-width:100%;height:auto}";
    document.head.append(style);
  }
}
