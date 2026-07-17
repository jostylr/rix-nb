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

## Proposed next slices

1. Add project/note file operations and `project.toml` / `notebook.toml` parsing.
2. Add a dedicated RiX CodeMirror language package, completion, and diagnostics.
3. Upgrade the result panel to show source-span-aware, per-statement output.
4. Build the shared document model and static Markdown/HTML export.

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
