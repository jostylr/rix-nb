/**
 * Plugins intentionally shipped in the RiX Notebook application.
 *
 * These imports are static so Vite includes their trusted JavaScript in the
 * application bundle. Project plugins are added separately by
 * plugin-catalog.js and do not receive this approval merely by being found.
 */
import { PluginCatalog } from "../../rix/src/index.js";
import { installBrowserApproxMathPlugin } from "../../rix/examples/approx-math/approx-math-browser-plugin.js";

const approxMathMetadata = {
  id: "approx-math-js",
  description: "JavaScript IEEE-754 Float conversion and optional approximate math.",
  kind: "host",
  mount: "float",
  exports: ["Float", "Interval", "Round", "Floor", "Ceiling", "Abs", "Sqrt", "Sin", "Cos", "Tan", "Log", "Exp"],
  groups: ["ApproximateMath", "Float"],
  permissions: [],
  defaultEnabled: false,
};

export function createNotebookBundledPluginCatalog() {
  const catalog = new PluginCatalog();
  catalog.addMetadata(approxMathMetadata, {
    sourcePath: "bundled:approx-math-js",
    kind: "host",
  });
  catalog.registerInstaller("approx-math-js", installBrowserApproxMathPlugin);
  return catalog;
}
