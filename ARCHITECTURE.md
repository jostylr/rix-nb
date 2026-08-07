# RiX Notebook host review

RiX Notebook has two host-specific workbenches around one RiX notebook engine,
document model, and output-widget protocol. Their differences are intentional
host capabilities rather than separate language implementations.

| Capability | Native Tauri host | Browser host | Boundary |
| --- | --- | --- | --- |
| Open/save ordinary files | Native dialogs and filesystem grants | File picker or download | DocShell storage adapter |
| Project directory | Direct folder access | ZIP-backed virtual directory | DocShell storage adapter |
| Recent documents | Native menu and app-data JSON | Opt-in IndexedDB recovery list | DocShell host service |
| Window geometry and system menus | Yes | Browser-owned | DocShell native shell |
| Drag-and-drop | OS open/menu flow | Markdown or ZIP drop | DocShell browser shell |
| Git commit and Trash | Native commands | Not available | Optional native host capability |
| Plugin directory grants and approvals | Native settings | Bundled plugins only | Native host capability consumed by the RiX webview |
| Export destination | Chosen filesystem directory; full live/static assets | Downloaded static export/ZIP | RiX webview/export service with host storage |
| RiX evaluation and widgets | Shared engine and widget protocol | Shared engine and widget protocol | `webview/source/notebook-web/rix-engine.js` and RiX output tools |
| Editor, preview, and theme | Native feature workbench | Compact portable workbench | Host-specific consumers under `webview/source/` |

The browser does not need emulations for Git, Trash, native window state, or
arbitrary directory/plugin grants. A future host can advertise those optional
capabilities through its adapter. The portable editor contract remains the
small `NotebookEngine`, `NotebookHost`, and `DocumentStore` interfaces.

## Repository boundary

```text
rix-nb/
├── docshell/                 reusable installed submodule
│   ├── native/               Tauri host implementation
│   ├── shells/               native and browser HTML hosts
│   ├── src/                  contracts and storage/file services
│   └── styles/               public shell tokens and browser chrome
├── docshell.manifest.json    RiX Notebook's host configuration
├── scripts/
│   └── extract-docshell.mjs  creates ignored build inputs
├── webview/
│   ├── shells/               RiX-specific native/browser body markup
│   └── source/               RiX-specific editor, project, export, and styles
└── src-tauri/                RiX packaging config, icons, and thin Rust entry
```

`src-tauri/src/lib.rs` is deliberately a thin forwarding module. The HTML
inputs are likewise generated from DocShell templates. The Tauri package
identity/icons and RiX workbenches remain in the application repository, while
the reusable host is installed from its separate repository at `docshell/`.
