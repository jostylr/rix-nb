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
