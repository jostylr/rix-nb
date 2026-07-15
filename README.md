# RiX Notebook

RiX Notebook is a native macOS authoring environment for Markdown-first,
executable mathematical documents. The native Tauri application manages the
window and, later, projects and files; the bundled web application provides the
editing and document-rendering experience.

## Current milestone: Hello Markdown

This initial application opens a native macOS window with a Markdown editor and
a live HTML preview. It intentionally has no filesystem access or RiX execution
yet. It proves the native-shell/WebView boundary before we add CodeMirror,
project manifests, and notebook execution.

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

Tauri writes development and build artifacts below `src-tauri/target/`; they are
intentionally ignored. A distributable app for other Macs will eventually need
Apple signing and notarization, but neither is required for local development.

## Proposed next slices

1. Replace the textarea with CodeMirror 6 and add project/note file operations.
2. Add `project.toml` and `notebook.toml` parsing plus ordered note navigation.
3. Bundle RiX for in-WebView execution and add the per-statement output panel.
4. Build the shared document model and static Markdown/HTML export.

## Design notes

Notebook note references provide document ordering, not source-level inclusion.
If notes later expose reusable definitions, that should use an explicit,
module-like RiX import with named exports and namespaces. That keeps execution
state local to a notebook while making reusable mathematical libraries clear.

Execution results should be live by default. A later per-notebook or per-note
setting can opt into persisting a result cache for soft export/review without
making generated output canonical source.
