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
  parseAndEvaluate,
  posToLineCol,
  renderOutputHtml,
  tokenize,
} from "../../../rix/src/index.js";
import { clonePluginCatalog } from "../plugin-catalog.js";
import { gridLatex } from "../output-latex.js";
import { assertNotebookEngine } from "./contracts.js";

/** Parse portable fence directives; this is intentionally independent of UI. */
export function parseFenceMetadata(header = "") {
  const metadata = { raw: header.trim(), flags: new Set(), execution: "flow", role: "out", showCode: false, showOutput: true, unknown: [] };
  for (const token of header.trim().split(/\s+/).filter(Boolean)) {
    const normalized = token.toLowerCase();
    if (["flow", "singleton", "refresh"].includes(normalized)) {
      metadata.flags.add(normalized);
      metadata.execution = normalized;
    } else if (normalized === "expensive") metadata.flags.add(normalized);
    else if (normalized === "set") Object.assign(metadata, { role: "set", showCode: false, showOutput: false });
    else if (normalized === "edu") Object.assign(metadata, { role: "edu", showCode: true, showOutput: true });
    else if (normalized === "out") Object.assign(metadata, { role: "out", showCode: false, showOutput: true });
    else metadata.unknown.push(token);
  }
  return metadata;
}

export function extractRixCells(source) {
  const cells = [];
  const fencePattern = /^```rix(?:[ \t]+([^\n]*))?[ \t]*\n([\s\S]*?)^```[ \t]*$/gim;
  let match;
  while ((match = fencePattern.exec(source)) !== null) {
    const line = source.slice(0, match.index).split("\n").length;
    cells.push({ index: cells.length, start: match.index, end: fencePattern.lastIndex, codeStart: source.indexOf("\n", match.index) + 1, code: match[2], codeLine: line + 1, line, metadata: parseFenceMetadata(match[1] || "") });
  }
  return cells;
}

export function isInRixCell(source, position) {
  return extractRixCells(source).some((cell) => position >= cell.codeStart && position <= cell.codeStart + cell.code.length);
}

export function diagnosticForRixError(error, cell) {
  const message = error instanceof Error ? error.message : String(error);
  const offset = Math.min(Number(message.match(/position (\d+)/)?.[1] ?? cell.code.length), cell.code.length);
  const from = cell.codeStart + offset;
  return { from, to: Math.min(from + 1, cell.codeStart + cell.code.length), severity: "error", message };
}

function extractFencedRanges(source) {
  const ranges = [];
  const pattern = /^```[^\n]*\n[\s\S]*?^```[ \t]*$/gim;
  let match;
  while ((match = pattern.exec(source)) !== null) ranges.push({ start: match.index, end: pattern.lastIndex });
  return ranges;
}

export function extractInlineExpressions(source) {
  const expressions = [];
  const fences = extractFencedRanges(source);
  let fenceIndex = 0;
  for (let index = 0; index < source.length;) {
    const fence = fences[fenceIndex];
    if (fence && index >= fence.start) { index = fence.end; fenceIndex += 1; continue; }
    if (source[index] !== "@" || source[index + 1] !== "{") { index += 1; continue; }
    let depth = 1; let quote = null; let escaped = false; let cursor = index + 2;
    for (; cursor < source.length && depth > 0; cursor += 1) {
      const character = source[cursor];
      if (quote) { if (escaped) escaped = false; else if (character === "\\") escaped = true; else if (character === quote) quote = null; continue; }
      if (character === '"' || character === "'") quote = character;
      else if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
    }
    if (depth !== 0) { index += 2; continue; }
    const expression = source.slice(index + 2, cursor - 1).trim();
    if (expression) expressions.push({ start: index, end: cursor, expression, line: source.slice(0, index).split("\n").length });
    index = cursor;
  }
  return expressions;
}

export function parseNotebookDocument(source) {
  const cells = extractRixCells(source);
  const inlines = extractInlineExpressions(source);
  const nodes = [...cells.map((value) => ({ type: "cell", start: value.start, end: value.end, value })), ...inlines.map((value) => ({ type: "inline", start: value.start, end: value.end, value }))].sort((left, right) => left.start - right.start);
  const content = [];
  let cursor = 0;
  for (const node of nodes) {
    if (node.start > cursor) content.push({ type: "markdown", start: cursor, end: node.start, source: source.slice(cursor, node.start) });
    content.push(node); cursor = node.end;
  }
  if (cursor < source.length) content.push({ type: "markdown", start: cursor, end: source.length, source: source.slice(cursor) });
  return { source, cells, inlines, nodes, content };
}

function splitTopLevelStatements(source) {
  const statements = []; let start = null; let depth = 0;
  const openers = new Set(["(", "[", "{", "{!", "{=", "{?", "{;", "{|", "{:", "{..", "{@", "{#", "{$", "{^", "{>"]);
  for (const token of tokenize(source)) {
    if (token.type === "End") break;
    if (start === null) start = token.pos[1] ?? token.pos[0];
    if (openers.has(token.value)) depth += 1;
    if ([")", "]", "}"].includes(token.value)) depth = Math.max(0, depth - 1);
    if (token.value === ";" && depth === 0) { statements.push({ start, code: source.slice(start, token.pos[2]).trim() }); start = null; }
  }
  if (start !== null) statements.push({ start, code: source.slice(start).trim() });
  return statements.filter((statement) => statement.code.length > 0);
}

function asRational(value, name) {
  if (value instanceof Rational) return value;
  if (value instanceof Integer) return new Rational(value);
  throw new Error(`${name} must be an exact RiX number`);
}
function asInterval(value) { if (value instanceof RationalInterval) return value; throw new Error("Slider interval must be a RiX interval such as 1:5"); }
function asPositiveCount(value, name) {
  if (!(value instanceof Integer) || value.value <= 0n) throw new Error(`${name} must be a positive integer`);
  const count = Number(value.value);
  if (!Number.isSafeInteger(count) || count > 10_000) throw new Error(`${name} must be at most 10000`);
  return count;
}
function inferSliderConfig(args) {
  let interval = new RationalInterval(-10, 10); let start = null; let step = null; let steps = null;
  if (args.length === 1 && args[0]?.type === "map") {
    const entries = args[0].entries;
    interval = entries.has("interval") ? asInterval(entries.get("interval")) : interval;
    start = entries.has("start") ? asRational(entries.get("start"), "Slider start") : null;
    if (entries.has("step") && entries.has("steps")) throw new Error("Slider accepts either step or steps, not both");
    if (entries.has("step")) step = asRational(entries.get("step"), "Slider step");
    if (entries.has("steps")) steps = asPositiveCount(entries.get("steps"), "Slider steps");
  } else {
    if (args.length > 3) throw new Error("Slider accepts interval, step-or-steps, and start");
    if (args[0] !== undefined) interval = asInterval(args[0]);
    if (args[1] !== undefined) { const second = asRational(args[1], "Slider step-or-steps"); if (second.numerator === 0n) throw new Error("Slider step-or-steps cannot be zero"); if (second.denominator === 1n && second.numerator >= 3n) steps = asPositiveCount(new Integer(second.numerator), "Slider steps"); else step = second; }
    if (args[2] !== undefined) start = asRational(args[2], "Slider start");
  }
  const low = interval.low; const high = interval.high; const span = high.subtract(low);
  if (span.numerator === 0n) throw new Error("Slider interval endpoints must differ");
  if (step) { if (step.numerator < 0n) step = step.negate(); const proposed = Math.floor(span.toNumber() / step.toNumber()); if (!Number.isFinite(proposed) || proposed < 1) throw new Error("Slider step must fit inside its interval"); steps = Math.min(proposed, 10_000); }
  else { steps ??= 20; step = span.divide(new Integer(BigInt(steps))); }
  start ??= low.add(high).divide(new Integer(2));
  return { low, high, step, steps, startIndex: Math.max(0, Math.min(steps, Math.round((start.toNumber() - low.toNumber()) / step.toNumber()))) };
}

function createNotebookSlider(args, runtime) {
  const config = inferSliderConfig(args); const id = `${runtime.currentSourceId}:${runtime.sliderCounter++}`;
  const index = Math.max(0, Math.min(config.steps, runtime.sliderOverrides.get(id) ?? config.startIndex));
  const value = config.low.add(config.step.multiply(new Integer(BigInt(index)))); let valueWidth = 1;
  for (let sample = 0; sample <= Math.min(config.steps, 200); sample += 1) {
    const candidate = Math.round((config.steps * sample) / Math.min(config.steps, 200));
    valueWidth = Math.max(valueWidth, formatValue(config.low.add(config.step.multiply(new Integer(BigInt(candidate))))).length);
  }
  runtime.sliders.push({ ...config, id, index, value, valueWidth }); return value;
}

function makeNotebookRuntime(engine, overrides, options) {
  const registry = createDefaultRegistry();
  const runtime = { registry, context: new Context(), sliderCounter: 0, sliderOverrides: overrides, sliders: [], currentSourceId: "document", mode: options.mode === "static" ? "static" : "live", currentPublication: null };
  const pluginCatalog = clonePluginCatalog(options.pluginCatalog || engine.pluginCatalog);
  const systemContext = createDefaultSystemContext({ frozen: false, pluginCatalog });
  systemContext.registerHost("slider", { impl(args) { return createNotebookSlider(args, runtime); }, doc: "Notebook-only interactive slider control" });
  for (const mode of ["static", "live"]) systemContext.registerHost(mode, { lazy: true, impl(args, context, run) { if (args.length > 1) throw new Error(`.${mode} accepts at most one block`); if (args.length === 1 && runtime.mode === mode) context.withSharedBody(args[0], () => run(args[0])); return null; }, doc: `Evaluate a notebook block only in ${mode} mode` });
  for (const channel of ["out", "staticout", "liveout"]) systemContext.registerHost(channel === "staticout" ? "staticOut" : channel === "liveout" ? "liveOut" : "out", { lazy: true, impl(args, _context, run) { if (args.length > 1) throw new Error(`.${channel} accepts zero or one argument`); if (!runtime.currentPublication) throw new Error(`.${channel} may only be used while running a notebook cell`); const target = channel === "out" ? "out" : channel === "staticout" ? "static" : "live"; if (target !== "out" && target !== runtime.mode) return null; if (runtime.currentPublication[target].declared) throw new Error(`.${channel} may only be used once per cell`); runtime.currentPublication[target] = { declared: true, suppressed: args.length === 0, value: args.length === 0 ? null : run(args[0]) }; return null; }, doc: "Choose the notebook publication output for this cell" });
  runtime.loadRixPlugin = ({ source, sourcePath, context, registry, systemContext: pluginSystemContext }) => parseAndEvaluate(source, { context, registry, systemContext: pluginSystemContext, file: sourcePath });
  for (const id of options.plugins || engine.plugins) pluginCatalog.load(id, { context: runtime.context, registry: runtime.registry, systemContext, loadRix: runtime.loadRixPlugin });
  systemContext.freeze(); runtime.systemContext = systemContext; return runtime;
}

function executeCell(cell, runtime) {
  const context = cell.metadata.execution === "singleton" ? new Context() : cell.metadata.execution === "refresh" ? (runtime.context = new Context()) : runtime.context;
  runtime.currentSourceId = `cell:${cell.line}`;
  for (const [key, value] of Object.entries({ __system_context__: runtime.systemContext, __registry__: runtime.registry, __source__: cell.code, __current_file__: `<notebook cell at line ${cell.line}>`, __plugin_load_rix__: runtime.loadRixPlugin })) context.setEnv(key, value);
  const irNodes = lower(parse(cell.code)); const sources = splitTopLevelStatements(cell.code); const statements = []; let implicitOutput = { available: false, value: null };
  runtime.currentPublication = { out: { declared: false }, static: { declared: false }, live: { declared: false } };
  for (const [index, irNode] of irNodes.entries()) {
    const source = sources[index] || { start: irNode.pos?.[0] || 0, code: "<source unavailable>" }; const line = cell.codeLine + posToLineCol(cell.code, source.start).line - 1;
    try {
      const sliderStart = runtime.sliders.length; const value = evaluate(irNode, context, runtime.registry, runtime.systemContext);
      const sliderName = source.code.match(/^\s*([a-z][a-zA-Z0-9_]*)\s*:=\s*\.slider\s*\(/)?.[1] || "slider";
      for (const slider of runtime.sliders.slice(sliderStart)) Object.assign(slider, { name: sliderName, line });
      const hostCommand = irNode.fn === "SYS_CALL" && ["static", "live", "out", "staticout", "liveout"].includes(String(irNode.args?.[0] || ""));
      if (!hostCommand) implicitOutput = { available: true, value };
      statements.push({ line, code: source.code, content: formatValue(value), html: isOutputValue(value) ? renderOutputHtml(value, formatValue) : null, kind: "result", position: cell.start + source.start });
    } catch (error) { statements.push({ line, code: source.code, content: error instanceof Error ? error.message : String(error), kind: "error", position: cell.start + source.start }); break; }
  }
  const channel = runtime.mode === "static" ? "static" : "live";
  const selected = runtime.currentPublication[channel].declared ? runtime.currentPublication[channel] : runtime.currentPublication.out.declared ? runtime.currentPublication.out : implicitOutput;
  const publication = selected.available === false || selected.suppressed ? null : { value: selected.value, content: formatValue(selected.value), kind: "result" };
  runtime.currentPublication = null; return { statements, metadata: cell.metadata, staticOutput: runtime.mode === "static" ? publication : null, liveOutput: runtime.mode === "live" ? publication : null };
}

function executeInlineExpression(inline, runtime) {
  const context = runtime.context; runtime.currentSourceId = `inline:${inline.line}`;
  for (const [key, value] of Object.entries({ __system_context__: runtime.systemContext, __registry__: runtime.registry, __source__: inline.expression, __current_file__: `<inline RiX expression at line ${inline.line}>`, __plugin_load_rix__: runtime.loadRixPlugin })) context.setEnv(key, value);
  const irNodes = lower(parse(inline.expression)); if (!irNodes.length) throw new Error("Inline RiX expression is empty"); let value; const sliderStart = runtime.sliders.length;
  for (const node of irNodes) value = evaluate(node, context, runtime.registry, runtime.systemContext);
  for (const slider of runtime.sliders.slice(sliderStart)) Object.assign(slider, { name: "Slider", line: inline.line });
  const content = formatValue(value); return { start: inline.start, end: inline.end, replacement: content, statement: { line: inline.line, code: `@{${inline.expression}}`, content, kind: "result", label: "Inline RiX", position: inline.start } };
}

function replaceInlineExpressions(source, runs) { let cursor = 0; let rendered = ""; for (const run of runs) { rendered += source.slice(cursor, run.start) + run.replacement; cursor = run.end; } return rendered + source.slice(cursor); }

function escapeMarkdownCell(value) { return String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>"); }
export function staticOutputMarkdown(value, { graphicReference = null, figureAlt = null } = {}) {
  if (!isOutputValue(value)) return formatValue(value);
  if (value.kind === "text") return formatValue(value.value);
  if (value.kind === "paragraph") return value.children.map(formatValue).join("");
  if (value.kind === "heading") return `${"#".repeat(value.level)} ${formatValue(value.content)}`;
  if (value.kind === "fragment") return value.children.map((child) => staticOutputMarkdown(child, { graphicReference })).join("\n\n");
  if (value.kind === "table") { const headings = value.columns.map((column) => escapeMarkdownCell(column.label)); const rows = value.rows.map((row) => `| ${row.map((cell) => escapeMarkdownCell(formatValue(cell))).join(" | ")} |`); return [[`| ${headings.join(" | ")} |`, `| ${headings.map(() => "---").join(" | ")} |`, ...rows].join("\n"), value.caption ? `*${value.caption}*` : ""].filter(Boolean).join("\n\n"); }
  if (value.kind === "grid") return gridLatex(value, formatValue);
  if (value.kind === "graphic") return graphicReference ? `![${figureAlt || "RiX graphic"}](${graphicReference(value)})` : formatValue(value);
  if (value.kind === "figure") return [staticOutputMarkdown(value.content, { graphicReference, figureAlt: value.alt || value.caption || figureAlt }), value.caption ? `*${value.caption}*` : ""].filter(Boolean).join("\n\n");
  if (value.kind === "slide") return ["---", value.title ? `## ${value.title}` : "", staticOutputMarkdown(value.content, { graphicReference }), value.notes ? `<!-- Speaker notes: ${value.notes} -->` : ""].filter(Boolean).join("\n\n");
  if (value.kind === "slides") return value.slides.map((slide) => staticOutputMarkdown(slide, { graphicReference })).join("\n\n");
  return formatValue(value);
}
function staticCellReplacement(run, graphicReference) { if (run?.metadata.role === "set" || !run?.staticOutput) return ""; if (run.staticOutput.kind === "error") return `> **RiX export error:** ${run.staticOutput.content}`; return staticOutputMarkdown(run.staticOutput.value, { graphicReference }); }
export function renderStaticDocument(document, runs, inlineRuns, options = {}) {
  const inlineByStart = new Map(inlineRuns.map((run) => [run.start, run]));
  return document.content.map((node) => { if (node.type === "markdown") return node.source; if (node.type === "inline") return inlineByStart.get(node.start)?.replacement || ""; if (options.liveCellIndexes?.has(node.value.index) && options.liveCellPlaceholder) return `\n\n<!-- rix-live-cell:${node.value.index} -->\n\n`; const replacement = staticCellReplacement(runs[node.value.index], options.graphicReference || null); return replacement ? `\n\n${replacement}\n\n` : ""; }).join("");
}

export function createRixNotebookEngine(configuration = {}) {
  const engine = {
    pluginCatalog: configuration.pluginCatalog,
    plugins: configuration.plugins || [],
    configure(next = {}) { if (next.pluginCatalog) this.pluginCatalog = next.pluginCatalog; if (next.plugins) this.plugins = next.plugins; return this; },
    parseDocument: parseNotebookDocument,
    validate(source) { const diagnostics = []; for (const cell of extractRixCells(source)) try { lower(parse(cell.code)); } catch (error) { diagnostics.push(diagnosticForRixError(error, cell)); } return diagnostics; },
    getCompletions() { const context = createDefaultSystemContext({ pluginCatalog: this.pluginCatalog }); return context.getAllNames().map((name) => ({ label: name, type: "function", detail: `.${name}`, info: context.get(name)?.doc || "RiX system capability" })); },
    executeDocument(source, options = {}) {
      const document = parseNotebookDocument(source); const runtime = makeNotebookRuntime(this, options.sliderOverrides || new Map(), options); const runs = new Array(document.cells.length); const inlineRuns = []; const outputStatements = [];
      for (const event of document.nodes) if (event.type === "cell") { const cell = event.value; try { runs[cell.index] = executeCell(cell, runtime); } catch (error) { runs[cell.index] = { metadata: cell.metadata, statements: [{ line: cell.codeLine, code: cell.code.trim(), content: error instanceof Error ? error.message : String(error), kind: "error", position: cell.start }] }; } outputStatements.push(...runs[cell.index].statements); } else { try { const run = executeInlineExpression(event.value, runtime); inlineRuns.push(run); outputStatements.push(run.statement); } catch (error) { const content = error instanceof Error ? error.message : String(error); const run = { start: event.value.start, end: event.value.end, replacement: `RiX error: ${content}`, statement: { line: event.value.line, code: `@{${event.value.expression}}`, content, kind: "error", label: "Inline RiX", position: event.value.start } }; inlineRuns.push(run); outputStatements.push(run.statement); } }
      return { document, cells: document.cells, inlineRuns, runs, outputStatements: outputStatements.sort((left, right) => left.position - right.position), sliders: runtime.sliders, renderedSource: replaceInlineExpressions(source, inlineRuns), staticRenderedSource: options.mode === "static" ? renderStaticDocument(document, runs, inlineRuns) : null };
    },
  };
  return assertNotebookEngine(engine);
}
