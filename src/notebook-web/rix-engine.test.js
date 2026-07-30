import { expect, test } from "bun:test";
import { createNotebookBundledPluginCatalog } from "../bundled-plugin-catalog.js";
import { createRixNotebookEngine, parseFenceMetadata } from "./rix-engine.js";

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
\`\`\``;
  const run = engine().executeDocument(source);
  expect(run.outputStatements.map(({ kind }) => kind)).not.toContain("error");
  expect(run.outputStatements[1]?.content).toBe("33/100");
  expect(run.outputStatements[3]?.content).toContain("circle");
  expect(run.outputStatements[5]?.content).toContain("Graphic");
  expect(run.runs[0]?.statements[5]?.html).toContain("<svg");
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

test("implemented plugin tutorial cells execute unchanged in the notebook", async () => {
  for (const id of ["float", "draw", "plot"]) {
    const source = await Bun.file(new URL(`../../../rix/plugins/${id}/tutorial.md`, import.meta.url)).text();
    const run = engine().executeDocument(source);
    expect(run.outputStatements.length, id).toBeGreaterThan(0);
    expect(run.outputStatements.map(({ kind }) => kind), id).not.toContain("error");
  }
});
