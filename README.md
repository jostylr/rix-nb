# RiX Notebook

RiX Notebook is a native macOS authoring environment for Markdown-first,
executable mathematical documents. The native Tauri application manages the
window and, later, projects and files; the bundled web application provides the
editing and document-rendering experience.

## Current milestone: Hello Markdown

This initial application opens a native macOS window with a CodeMirror 6
Markdown editor, a live HTML preview, and a first RiX execution loop. The
application runs fenced `rix` blocks and `@{expression}` inline values in
document order; normal blocks share a notebook context and a `rix new` block
starts with a fresh isolated one. A `rix refresh` block starts a fresh context
which becomes the context for subsequent ordinary blocks. Results update live
after a short pause while typing.

RiX results are the default right-hand pane. Each top-level RiX statement is
shown with its source line, and selecting a result returns the editor to that
line. Use the Preview button, `Cmd-P`, or `Cmd-Shift-P` to swap that pane for
the rendered Markdown preview, which includes the current RiX statement results.

### Notebook controls

RiX Notebook adds a notebook-only `Slider` system function. Both `.Slider(...)`
and `@_Slider(...)` work in notebook cells; neither is a general RiX runtime
feature. A slider returns an exact RiX number and appears in the results pane.
Moving it re-evaluates the document in source order.

```rix
x := .Slider(1:5, 1/10, 3);
area := x^2;
```

The positional form is `(interval, step-or-steps, start)`. A positive integer
second value of 3 or greater means a number of steps; other nonzero exact values
are step sizes. The map form is `.Slider({= interval=1:5, step=1/10, start=3})`
or `steps` instead of `step`. Omit arguments for `-10:10`, 20 steps, and a
midpoint start. RiX currently writes `1/10` rather than a leading decimal `.1`.

## Project files

Use **New project** to choose a parent folder and create this portable layout:

```text
Project/
  project.toml
  Notebook/
    notebook.toml
    index.md
  assets/
    right-triangle.svg
```

`project.toml` contains an ordered list of notebook manifests; each
`notebook.toml` contains an ordered list of note paths. The project bar creates,
selects, opens, and saves those files. `Cmd-S` saves the active note.

The preview renders `$inline$`, `$$display$$`, `\\(inline\\)`, and
`\\[display\\]` mathematics with KaTeX. Relative Markdown image paths resolve
from the active note and are served through Tauri's asset protocol, so normal
SVG project assets display in the native preview.

## Static export

Use **Export** (`Cmd-E`) to export the current note, a notebook, or the entire
project as rendered Markdown, standalone static HTML, and/or a Quarto project.
For a `rix` fence, `static:{expression}` evaluates the expression after that
cell has run and inserts its value into every static target. A directive can
also pin named notebook sliders for deterministic export:

````markdown
```rix hide static:{report}
report := .Figure(.Plot.Polynomial([1, -2, 1], [-2, 4]), "A quadratic");
```

```rix hide static:{root=1; output=report}
root := .Slider(0:3, 1, 2);
report := .Table(["root"], [[root]]);
```
````

Within a directive, semicolon-separated `name=value` entries are static
slider values and the final bare expression (or `output=...`) is the rendered
value. Parameters apply to the note's static run, so a later static directive
can intentionally refine an earlier value for the same slider.

Each selected target gets its own root: `markdown/`, `html/`, or `quarto/`.
Structured RiX outputs remain structured during export: text, headings,
fragments, and tables become Markdown; graphics become SVG files under that
target's `assets/rix/`; figures reference those assets; mathematical grids are
rendered as display LaTeX arrays, including their horizontal and vertical
rules. The Quarto output is an ordinary project with a `_quarto.yml` and static
`.qmd` pages. A `.Slides(...)` result makes its page a Reveal.js Quarto page.

`examples/export-showcase/` is an openable project that exercises reports,
tables, plots, figures, synthetic division, and slides. Quarto is only needed
to render the generated project, not to create it. With Quarto installed:

```sh
cd chosen-export-folder/quarto
quarto render
```

### Live HTML and Quarto pages

Add `live` to a RiX fence to make it an interactive widget in the standalone
HTML and Quarto HTML / Reveal.js targets. `live:{expression}` is the explicit
form when the live result should be a named object rather than the cell's last
value. The browser bundle is copied to
`assets/rix-live/` only when an export contains a live cell. Cells share a
page-level RiX context, and notebook sliders recompute the live results in
source order.

````markdown
```rix hide-code live:{report} static:{parameter=1; report}
parameter := .Slider(0:3, 1, 1);
report := .Table(["x", "x²"], [[parameter, parameter^2]]);
```
````

Quarto pages contain both `::: {.rix-static}` and `::: {.rix-live}` sections
for each live cell. The static section remains usable without JavaScript; once
the RiX browser runtime starts, it shows the live section and hides that
fallback. The first live export intentionally ships a compact report widget—
controls, result, and optional source disclosure rather than a full notebook
editor. For a live Quarto page, RiX fences are also woven into the `.qmd` as
ordered `.rix-runtime-source` code blocks. The shared `assets/rix-live/`
harness discovers those blocks and evaluates them as one page-level context,
so the live source remains inspectable and editable in the exported project.
It uses a browser-native module rather than requiring an Observable runtime,
so it works equally in ordinary Quarto HTML pages and Reveal.js. Live grids,
including synthetic division, are rendered by KaTeX from the same LaTeX-array
serializer used by static exports.

## Development setup

The project uses Bun for JavaScript tooling and Tauri 2 for the native macOS
shell. Install these prerequisites once:

1. Xcode Command Line Tools: `xcode-select --install`
2. A stable Rust toolchain, normally with [rustup](https://rustup.rs/)
3. Bun 1.2 or newer

Then, after reviewing `package.json`, install the JavaScript dependencies:

```sh
cd rix-nb
bun install
```

The first native build also downloads Rust crates, so it needs network access.
Start the development app with:

```sh
bun run dev
```

Build an unsigned local macOS application with:

```sh
bun run build
```

`bun run dev` is a development command only: it starts Vite's local hot-reload
web server and launches Tauri against it. A packaged RiX Notebook application
contains the prebuilt WebView assets and does not require Bun or Node to run.

Tauri writes development and build artifacts below `src-tauri/target/`; they are
intentionally ignored. A distributable app for other Macs will eventually need
Apple signing and notarization, but neither is required for local development.

## Next slices

1. Add named export profiles to `project.toml` and `notebook.toml`.
2. Preserve figure labels/cross-references and add PNG output where a target needs it.
3. Add a dedicated RiX CodeMirror language package, completion, and diagnostics.
4. Package live RiX cells for optional interactive HTML export.

## Design notes

Notebook note references provide document ordering, not source-level inclusion.
If notes later expose reusable definitions, that should use an explicit,
module-like RiX import with named exports and namespaces. That keeps execution
state local to a notebook while making reusable mathematical libraries clear.

Execution results should be live by default. A later per-notebook or per-note
setting can opt into persisting a result cache for soft export/review without
making generated output canonical source.

RiX is bundled into the WebView directly from the sibling `rix` source tree.
The first notebook runtime deliberately does not support RiX filesystem/script
imports; project-aware module imports will be introduced through a constrained
notebook module resolver rather than Node APIs.

The next project-management slice adds Tauri's dialog and filesystem plugins.
These are used only after a user selects a project folder; the application does
not receive a blanket home-directory filesystem scope.
