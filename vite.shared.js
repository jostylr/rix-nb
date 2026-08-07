export function notebookManualChunks(id) {
  const path = id.replaceAll("\\", "/");
  if (path.includes("/node_modules/katex/")) return "katex";
  if (path.includes("/node_modules/@lezer/")) return "editor-parser";
  if (path.includes("/node_modules/@codemirror/state/") || path.includes("/node_modules/@codemirror/view/")) return "editor-core";
  if (path.includes("/node_modules/@codemirror/language/") || path.includes("/node_modules/@codemirror/lang-markdown/")) return "editor-features";
  if (path.includes("/node_modules/@codemirror/") || path.includes("/node_modules/codemirror/")) return "editor-features";
  if (path.includes("/node_modules/markdown-it/") || path.includes("/node_modules/linkify-it/") || path.includes("/node_modules/mdurl/") || path.includes("/node_modules/entities/")) return "markdown";
  if (path.includes("/node_modules/fflate/")) return "archive";
  if (path.includes("/packages/core/")) return "exact-core";
  if (path.includes("/rix/src/parser/")) return "rix-parser";
  if (path.includes("/rix/src/runtime/") || path.includes("/rix/src/eval/")) return "rix-runtime";
  return undefined;
}
