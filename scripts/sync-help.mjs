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

- \`flow\` — run in the shared linear context (default).
- \`singleton\` — run in a fresh, isolated context.
- \`refresh\` — begin a fresh context that later ordinary cells inherit.
- \`expensive\` — marks a cell whose recomputation can be deferred by a future cache policy.
- \`set\` — evaluate definitions or effects without document rendering.
- \`out\` — show the selected result only (default).
- \`edu\` — show code and the selected result.

Example:

\`\`\`rix out refresh
radius := 3;
.static({; radius := 4; });
22/7 * radius^2;
\`\`\`

The final ordinary expression is the default output in each pathway. Use \`.out(value)\`, \`.staticOut(value)\`, or \`.liveOut(value)\` to select a different result; no-argument forms suppress that pathway. \`.static({; ... })\` and \`.live({; ... })\` are lazy mode blocks and return \`_\`.

## Inline values

Use \`@{...}\` anywhere outside a fenced code block. It evaluates in the shared document context at that source position:

\`The area is @{22/7 * radius^2}.\`

## Sliders

\`.slider(...)\` is a notebook-host control. It returns an exact RiX number and appears in the Controls region.

\`\`\`rix
x := .slider(1:5, 1/10, 3);
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
