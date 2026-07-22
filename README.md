# RiX Notebook

RiX Notebook is a native macOS authoring environment for Markdown-first,
executable mathematical documents. The native Tauri application manages the
window and, later, projects and files; the bundled web application provides the
editing and document-rendering experience.

## Architecture boundaries

The app now has an explicit reusable browser core rather than treating the
Tauri entry point as the notebook implementation:

```text
native shell (menus, windows, Git, dialogs)
                 │
         Tauri DocumentStore
                 │
notebook-web (CodeMirror / Markdown / KaTeX surface)
                 │
      NotebookEngine (RiX adapter today)
```

`src/notebook-web/` contains no Tauri imports. Its RiX adapter parses the
Markdown document model, runs the linear runtime, supplies inline values and
sliders, and creates static publication output. `src/tauri-document-store.js`
is the desktop adapter for the deliberately small storage contract; the project
schema manager consumes that contract rather than Tauri APIs. This makes a
hosted or documentation-site editor an adapter exercise rather than a fork of
the notebook runtime. See [the web-core guide](src/notebook-web/README.md).

### Browser single-file prototype

The browser host is now usable without Tauri. It opens a single Markdown file,
uses the shared editor/RiX runtime, and saves by downloading the edited file.
Optional local recovery copies are stored only in the browser through IndexedDB;
they are clearly opt-in, can be removed from **Recent**, and should not be
treated as durable storage.

```sh
cd rix-nb
bun run dev:browser
```

Open the printed local URL. ZIP projects and the virtual project sidebar
are intentionally the next phase, after adding the browser ZIP dependency.
`bun run dev:web` is an alias for this browser host. Use `bun run dev` for the
native Tauri app; `dev:tauri-webview` is only for inspecting its frontend in a
plain browser and cannot open files because it has no Tauri bridge.

## Current milestone: Hello Markdown

This initial application opens a native macOS window with a CodeMirror 6
Markdown editor, a live HTML preview, and a first RiX execution loop. The
application runs fenced `rix` blocks and `@{expression}` inline values in
document order; normal `rix flow` blocks share a notebook context and a `rix singleton` block
starts with a fresh isolated one. A `rix refresh` block starts a fresh context
which becomes the context for subsequent ordinary blocks. Results update live
after a short pause while typing.

RiX results are the default right-hand pane. Each top-level RiX statement is
shown with its source line, and selecting a result returns the editor to that
line. Use the Preview button, `Cmd-P`, or `Cmd-Shift-P` to swap that pane for
the rendered Markdown preview, which includes the current RiX statement results.

### Notebook controls

RiX Notebook adds a notebook-host `.slider(...)` function; it is not a general
RiX runtime feature. A slider returns an exact RiX number and appears in the results pane.
Moving it re-evaluates the document in source order.

```rix
x := .slider(1:5, 1/10, 3);
area := x^2;
```

The positional form is `(interval, step-or-steps, start)`. A positive integer
second value of 3 or greater means a number of steps; other nonzero exact values
are step sizes. The map form is `.slider({= interval=1:5, step=1/10, start=3})`
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

### Plugins

The notebook has two deliberately separate plugin locations.

- **Bundled, trusted plugins** live in
  `rix-nb/src/bundled-plugin-catalog.js`. Their JavaScript is imported there,
  so it becomes part of the signed/application build. They are exposed in the
  catalog but still load only when named in a configuration file or requested
  with `.Plugin.Load("plugin-id")`.
- **Project-local plugins** live under `Project/plugins/` (subfolders are
  allowed). On opening a note, the desktop app scans only files named
  `*.plugin.rix` and `*.plugin.rix.js`, reads their leading `/** YAML **/`
  manifest, and adds them to the catalog. A project `.plugin.rix` can be
  loaded. A project `.plugin.rix.js` is discoverable but cannot execute: adding
  JavaScript execution requires an explicit bundled-app approval above.

Enable known plugins for every notebook in a project with `project.toml`, or
only for one notebook with its `notebook.toml`:

```toml
plugins = ["float", "my-rix-plugin"]
```

The installed approximate-math plugin supplies `.float(x)`,
`.float.Interval(x)`, and the other approximate operations. It is bundled with
the app but disabled by default; put `"float"` in either list or run
`.Plugin.Load("float")` in RiX.

The preview renders `$inline$`, `$$display$$`, `\\(inline\\)`, and
`\\[display\\]` mathematics with KaTeX. Relative Markdown image paths resolve
from the active note and are served through Tauri's asset protocol, so normal
SVG project assets display in the native preview.

## Static export

Use **Export** (`Cmd-E`) to export the current note, a notebook, or the entire
project as rendered Markdown, standalone static HTML, and/or a Quarto project.
The final ordinary expression in an `out` cell is its default publication
output. Use lazy `.static({; ... })` and `.live({; ... })` blocks to run
mode-specific code in document order; each returns `_` and is not itself an
output. `.out(value)`, `.staticOut(value)`, and `.liveOut(value)` explicitly
choose an output for both pathways or one pathway respectively. Calling an
output command with no argument suppresses that pathway's implicit output:

````markdown
```rix out
root := .slider(0:3, 1, 2);
.static({; root := 1; });
report := .Table(["root"], [[root]]);
```
````

This example uses the slider interactively in live mode and pins `root` to 1
only for the static pathway. Fence roles are `set` (invisible), `out` (results
only, the default), and `edu` (code and results); execution modes are `flow`
(default), `singleton`, `refresh`, and `expensive`.

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

Any `out` or `edu` cell with a live publication output becomes an interactive
widget in standalone HTML and Quarto HTML / Reveal.js targets. The browser bundle is copied to
`assets/rix-live/` only when an export contains a live cell. Cells share a
page-level RiX context, and notebook sliders recompute the live results in
source order.

````markdown
```rix out
parameter := .slider(0:3, 1, 1);
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
