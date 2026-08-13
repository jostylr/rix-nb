import { expect, test } from "bun:test";
import { createWidgetSession, formatValue, parseAndEvaluate } from "../../../../rix/src/index.js";
import { createNotebookBundledPluginCatalog } from "../bundled-plugin-catalog.js";
import { createRixNotebookEngine, parseFenceMetadata } from "./rix-engine.js";
import { publicationOutputHtml } from "./workbench.js";

function engine() {
  return createRixNotebookEngine({ pluginCatalog: createNotebookBundledPluginCatalog() });
}

test("RiX engine evaluates cells and inline values in document order", () => {
  const run = engine().executeDocument("```rix\nx := 3;\nx^2;\n```\n\nThe value is @{x}.");
  expect(run.outputStatements.map((statement) => statement.content)).toEqual(["3", "9", "3"]);
  expect(run.renderedSource).toContain("The value is 3.");
});

test("RiX engine honors static-only publication code", () => {
  const run = engine().executeDocument("```rix\nx := 2;\n.static({; x := 5; });\nx;\n```", { mode: "static" });
  expect(run.runs[0].staticOutput.content).toBe("5");
  expect(run.staticRenderedSource).toContain("5");
});

test("the bundled browser starter evaluates its exact slider without split core identities", () => {
  const source = "```rix\nradius := .slider(1:5, 1/10, 3);\narea := 22/7 * radius^2;\narea;\n```\n\nThe current area is @{area}.";
  const run = engine().executeDocument(source);
  expect(run.outputStatements.map(({ kind }) => kind)).not.toContain("error");
  expect(run.sliders).toHaveLength(1);
  expect(run.renderedSource).toContain("The current area is 28..2/7.");
});

test("explicit structured publication output renders from the selected value", () => {
  const run = engine().executeDocument("```rix\n.out(.Table([\"x\"], [[1]]));\n```");
  expect(run.runs[0].liveOutput.value.kind).toBe("table");
  expect(publicationOutputHtml(run.runs[0])).toContain("<table");
});

test("fence metadata stays a UI-independent document concern", () => {
  expect(parseFenceMetadata("singleton edu")).toMatchObject({ execution: "singleton", role: "edu", showCode: true });
});

test("a bundled tutorial plugin can be preloaded and explicitly loaded again", () => {
  const source = "```rix\n.Plugin.Load(\"draw\");\n.draw.Circle([10, 10], 4);\n```";
  const run = engine().executeDocument(source, { plugins: ["draw"] });
  expect(run.outputStatements.at(-1)?.kind).toBe("result");
  expect(run.outputStatements.at(-1)?.content).toContain("circle");
});

test("bundled Phase 1 plugins execute through the notebook host", () => {
  const source = `\`\`\`rix
.Plugin.Load("float");
.float.Round(.float(1 / 3), 2);
.Plugin.Load("draw");
.draw.Circle([10, 10], 4);
.Plugin.Load("plot");
.plot.Polynomial([1, 0, -1], [-2, 2]);
.Plugin.Load("data");
rows := .data.Relation(["name", "value"], [["half", 1/2]]);
.Plugin.Load("csv");
.csv.Render(rows).Get("content");
.Plugin.Load("document");
.document.Report("Notebook report", [.Heading(2, "Result", "result")]);
.Plugin.Load("geometry");
a := .geometry.Point(0,0);
b := .geometry.Point(4,0);
.geometry.Draw([a,b,.geometry.Circle(a,b)], {= view=[-1,-1,5,5], size=[240,240] });
.Plugin.Load("terminal-ascii");
.terminalAscii.Render(.Table(["name", "value"], [["half", 1/2]])).Get("content");
.Plugin.Load("algebra");
p := .algebra.Polynomial([1,-6,11,-6]);
.algebra.Grid(.algebra.SyntheticDivide(p,2));
\`\`\``;
  const run = engine().executeDocument(source);
  expect(run.outputStatements.map(({ kind }) => kind)).not.toContain("error");
  expect(run.outputStatements[1]?.content).toBe("33/100");
  expect(run.outputStatements[3]?.content).toContain("circle");
  expect(run.outputStatements[5]?.content).toContain("Graphic");
  expect(run.runs[0]?.statements[5]?.html).toContain("<svg");
  expect(run.outputStatements[9]?.content).toBe("name,value\nhalf,1/2\n");
  expect(run.outputStatements[11]?.html).toContain('id="result"');
  expect(run.outputStatements[15]?.html).toContain("<svg");
  expect(run.outputStatements[17]?.content).toContain("+------+");
  expect(run.outputStatements[20]?.html).toContain("rix-output-grid");
});

test("the notebook preserves address-aware Sheet output", () => {
  const source = "```rix\n.Sheet({:2x3: 1, 2, 3; 4, 5, 6});\n```";
  const run = engine().executeDocument(source);
  const statement = run.outputStatements[0];

  expect(statement.kind).toBe("result");
  expect(statement.html).toContain("rix-output-sheet");
  expect(statement.html).toContain('data-rix-display-address="C2"');
  expect(statement.html).toContain('data-rix-address="grid[2,3]"');
});

test("the notebook exposes live Sheet values to a host-owned WidgetSession", () => {
  const source = "```rix\nmatrix := {:1x2: 1, 2}.WithScalarDomain(:Rational);\n.Sheet(.Bind(matrix));\n```";
  const run = engine().executeDocument(source);
  const statement = run.outputStatements.at(-1);
  const widget = createWidgetSession(statement.value);
  const editedValue = parseAndEvaluate("5 / 2", {
    context: run.runtime.context,
    registry: run.runtime.registry,
    systemContext: run.runtime.systemContext,
  });

  widget.dispatch({ type: "sheet:set", index: [1, 2], value: editedValue });
  expect(formatValue(run.runtime.context.get("matrix").data[1])).toBe("2..1/2");
  expect(formatValue(widget.current().cells[0][1].value)).toBe("2..1/2");
  expect(widget.snapshot().editable).toBe(false);
  widget.dispose();
});

test("the notebook preserves interactive Graphic targets for the shared widget protocol", () => {
  const source = `\`\`\`rix
$$point := {: 30,40};
.Graphics.Graphic([160,100], [
  .Graphics.DragPoint($$point, 7, {= fill="#7c3aed" })
]);
\`\`\``;
  const run = engine().executeDocument(source);
  const statement = run.outputStatements.at(-1);
  const handle = statement.value.children[0];
  const widget = createWidgetSession(statement.value);

  expect(statement.html).toContain('data-rix-interactive="true"');
  expect(statement.html).toContain(`data-rix-drag-target="${handle.targetId}"`);
  widget.dispatch({
    type: "graphic:position",
    targetId: handle.targetId,
    position: [80, 60],
  });
  expect(formatValue(run.runtime.context.get("point").peek())).toBe("( 80, 60 )");
  widget.dispose();
});

test("the notebook preserves interactive Shaped-plane controls", () => {
  const source = `\`\`\`rix
cube := {:2x3x2: 1, 2, 3; 4, 5, 6 ;; 7, 8, 9; 10, 11, 12};
.Sheet(cube, {=
  axes=["region", "measure", "scenario"],
  axisLabels=[
    ["North", "South"],
    ["Revenue", "Cost", "Margin"],
    ["Actual", "Forecast"]
  ],
  slice=[_, _, 2],
  address="cube"
});
\`\`\``;
  const run = engine().executeDocument(source);
  const statement = run.outputStatements.at(-1);

  expect(statement.html).toContain('data-rix-sheet-axis="3"');
  expect(statement.html).toContain('data-rix-plane-key="3:1"');
  expect(statement.html).toContain('data-rix-plane-key="3:2"');
  expect(statement.html).toContain('data-rix-address="cube[1,3,2]"');
  expect(statement.html).toContain('<option value="2" selected>Forecast · 2</option>');
  expect(statement.html).toContain('data-rix-coordinate-label="North / Margin / Forecast"');
});

test("implemented plugin tutorial cells execute unchanged in the notebook", async () => {
  for (const [id, directory = id] of [
    ["float"], ["numerics"], ["oracle"], ["algebra"], ["draw"], ["geometry"], ["plot"],
    ["terminal-ascii", "render-terminal-ascii"],
  ]) {
    const source = await Bun.file(new URL(`../../../../rix/plugins/${directory}/tutorial.md`, import.meta.url)).text();
    const run = engine().executeDocument(source);
    expect(run.outputStatements.length, id).toBeGreaterThan(0);
    expect(run.outputStatements.map(({ kind }) => kind), id).not.toContain("error");
  }
});
