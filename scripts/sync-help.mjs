import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const notebookRoot = path.resolve(here, "..");
const ratmathRoot = path.resolve(notebookRoot, "..");
const outputRoot = path.join(notebookRoot, "public", "help");
const rixDocs = path.join(ratmathRoot, "rix", "docs");

const notebookReference = `# RiX Notebook reference

## RiX fences

RiX cells are ordinary fenced Markdown blocks:

\`\`\`rix
x := 3;
x^2;
\`\`\`

Fence metadata follows \`rix\` on the opening fence. Metadata is space-separated.

- \`new\` — run this cell in a fresh, isolated context.
- \`refresh\` — begin a fresh context that later ordinary cells inherit.
- \`live\` — marks a cell intended for future interactive HTML export.
- \`show-code\` / \`hide-code\` — control whether code appears in the live preview.
- \`show-output\` / \`hide-output\` — control whether cell output appears in the live preview.
- \`show\` / \`hide\` — concise aliases that show or hide both code and output.
- \`static:{expression}\` — evaluates an expression for the Static preview and static exports.

Example:

\`\`\`rix refresh hide-code show-output
radius := 3;
22/7 * radius^2;
\`\`\`

Use **Show static** in the Preview toolbar to see only static replacements. Cells without a \`static:{...}\` directive do not appear in that mode.

## Inline values

Use \`@{...}\` anywhere outside a fenced code block. It evaluates in the shared document context at that source position:

\`The area is @{22/7 * radius^2}.\`

## Sliders

\`.Slider(...)\` and \`@_Slider(...)\` are notebook-only controls. They return exact RiX numbers and appear in the Controls region.

\`\`\`rix
x := .Slider(1:5, 1/10, 3);
y := x^2;
\`\`\`

The positional form is \`(interval, step-or-steps, start)\`. A positive integer second argument of 3 or greater means a number of steps; other nonzero exact values are steps. The map form accepts \`interval\`, \`step\` or \`steps\`, and \`start\`.
`;

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await cp(rixDocs, path.join(outputRoot, "reference-site"), { recursive: true });
await writeFile(path.join(outputRoot, "notebook-reference.md"), notebookReference);

await writeFile(path.join(outputRoot, "index.json"), JSON.stringify({
  notebook: [{ id: "notebook-reference", title: "RiX Notebook reference", path: "notebook-reference.md" }],
  references: [{ id: "rix-reference-site", title: "RiX language reference", htmlPath: "reference-site/index.html" }],
  tutorials: [{ id: "rix-tutorial-site", title: "RiX tutorials", url: "https://rix.ratmath.com/tutorial/" }],
}, null, 2));

console.log("Bundled the RiX Quarto documentation site and RiX Notebook reference.");
