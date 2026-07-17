import { open } from "@tauri-apps/plugin-dialog";
import { exists, mkdir, readTextFile, rename, writeTextFile } from "@tauri-apps/plugin-fs";

const PROJECT_FILE = "project.toml";
const NOTEBOOK_FILE = "notebook.toml";

function joinPath(...parts) {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

function dirname(path) {
  return path.slice(0, path.lastIndexOf("/")) || ".";
}

function slug(value, fallback) {
  const result = value.trim().replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return result || fallback;
}

function tomlString(value) {
  return JSON.stringify(value);
}

function projectToml(title, notebooks, quickExportScope = "notebook") {
  return `format_version = 1\ntitle = ${tomlString(title)}\nquick_export_scope = ${tomlString(quickExportScope)}\nnotebooks = [${notebooks.map(tomlString).join(", ")}]\n`;
}

function notebookToml(title, notes) {
  return `format_version = 1\ntitle = ${tomlString(title)}\nnotes = [${notes.map(tomlString).join(", ")}]\n`;
}

function readTomlString(source, key) {
  const match = source.match(new RegExp(`^\\s*${key}\\s*=\\s*("(?:\\\\.|[^\"])*")\\s*$`, "m"));
  if (!match) return null;
  return JSON.parse(match[1]);
}

function readTomlStringArray(source, key) {
  const match = source.match(new RegExp(`^\\s*${key}\\s*=\\s*(\\[[^\\n]*\\])\\s*$`, "m"));
  if (!match) return null;
  const value = JSON.parse(match[1]);
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${key} must be an array of strings`);
  }
  return value;
}

const STARTER_NOTE = `# Welcome to RiX Notebook

This note is ordinary Markdown with inline mathematics: $a^2 + b^2 = c^2$.

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

The diagram below is an ordinary project SVG asset.

![A right triangle](../assets/right-triangle.svg)

## Images in project notes

Put images in the project's \`assets/\` folder, then reference them with a
Markdown path relative to this note. Since this note is in \`Notebook/\`, the
image above uses:

\`![A right triangle](../assets/right-triangle.svg)\`

PNG and JPEG files work the same way. SVG is especially useful for diagrams
because it stays sharp when resized.

\`\`\`rix
radius := 3;
area := 22/7 * radius^2;
area;
\`\`\`

The computed area is @{area}.

## Interactive RiX value

Move the control in the results pane to update this document live. The slider
is notebook-only: the value it returns is an ordinary exact RiX number.

\`\`\`rix
x := .Slider(1:5, 1/10, 3);
y := x^2;
y;
\`\`\`

For a named form, use \`.Slider({= interval=1:5, step=1/10, start=3})\`.
`;

const STARTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 250" role="img" aria-label="Right triangle diagram">
  <rect width="420" height="250" fill="#fffefa"/>
  <path d="M70 205H350L70 45Z" fill="#e8eff8" stroke="#1f3558" stroke-width="4"/>
  <path d="M70 177H98V205" fill="none" stroke="#1f3558" stroke-width="4"/>
  <text x="195" y="230" font-family="Georgia, serif" font-size="24" fill="#1f3558">a</text>
  <text x="42" y="130" font-family="Georgia, serif" font-size="24" fill="#1f3558">b</text>
  <text x="225" y="112" font-family="Georgia, serif" font-size="24" fill="#1f3558">c</text>
</svg>`;

function parseProject(source) {
  const notebooks = readTomlStringArray(source, "notebooks");
  if (!notebooks) throw new Error("project.toml must contain a notebooks array");
  const quickExportScope = readTomlString(source, "quick_export_scope") || "notebook";
  if (!["notebook", "project"].includes(quickExportScope)) {
    throw new Error("quick_export_scope must be notebook or project");
  }
  return { title: readTomlString(source, "title") || "Untitled Project", notebooks, quickExportScope };
}

function parseNotebook(source) {
  const notes = readTomlStringArray(source, "notes");
  if (!notes) throw new Error("notebook.toml must contain a notes array");
  return { title: readTomlString(source, "title") || "Untitled Notebook", notes };
}

export class ProjectManager {
  constructor() {
    this.project = null;
    this.notebooks = new Map();
    this.currentNotebookPath = null;
    this.currentNotePath = null;
  }

  get isOpen() {
    return this.project !== null;
  }

  get notebookList() {
    return [...this.notebooks.entries()].map(([path, notebook]) => ({ path, title: notebook.title }));
  }

  get currentNotebook() {
    return this.notebooks.get(this.currentNotebookPath) || null;
  }

  async chooseAndOpenProject() {
    const path = await open({ title: "Open RiX project", directory: true, multiple: false, recursive: true });
    if (!path || Array.isArray(path)) return null;
    return this.openProject(path);
  }

  async openProject(directory, lastNotePath = null) {
    const projectPath = joinPath(directory, PROJECT_FILE);
    this.project = { directory, path: projectPath, ...parseProject(await readTextFile(projectPath)) };
    this.notebooks.clear();
    for (const relativePath of this.project.notebooks) {
      const path = joinPath(directory, relativePath);
      this.notebooks.set(path, { path, relativePath, ...parseNotebook(await readTextFile(path)) });
    }
    if (this.notebooks.size === 0) throw new Error("Project contains no notebooks");
    if (lastNotePath) {
      const notebook = [...this.notebooks.values()].find((candidate) => (
        candidate.notes.some((note) => joinPath(dirname(candidate.path), note) === lastNotePath)
      ));
      if (notebook) {
        this.currentNotebookPath = notebook.path;
        return this.selectNote(lastNotePath);
      }
    }
    const firstNotebook = this.notebookList[0];
    return this.selectNotebook(firstNotebook.path);
  }

  async createProject(name) {
    const parent = await open({ title: "Choose a folder for the new RiX project", directory: true, multiple: false, recursive: true });
    if (!parent || Array.isArray(parent)) return null;
    const directory = joinPath(parent, slug(name, "rix-project"));
    if (await exists(joinPath(directory, PROJECT_FILE))) {
      throw new Error(`A RiX project already exists at ${directory}`);
    }
    const notebookDirectory = joinPath(directory, "Notebook");
    await mkdir(notebookDirectory, { recursive: true });
    await mkdir(joinPath(directory, "assets"), { recursive: true });
    await writeTextFile(joinPath(directory, PROJECT_FILE), projectToml(name, ["Notebook/notebook.toml"]));
    await writeTextFile(joinPath(notebookDirectory, NOTEBOOK_FILE), notebookToml("Notebook", ["index.md"]));
    await writeTextFile(joinPath(notebookDirectory, "index.md"), STARTER_NOTE);
    await writeTextFile(joinPath(directory, "assets/right-triangle.svg"), STARTER_SVG);
    return this.openProject(directory);
  }

  async selectNotebook(path) {
    this.currentNotebookPath = path;
    const notebook = this.currentNotebook;
    if (!notebook || notebook.notes.length === 0) throw new Error("Notebook contains no notes");
    return this.selectNote(joinPath(dirname(path), notebook.notes[0]));
  }

  async selectNote(path) {
    const notebook = [...this.notebooks.values()].find((candidate) => (
      candidate.notes.some((note) => joinPath(dirname(candidate.path), note) === path)
    ));
    if (!notebook) throw new Error("Note does not belong to this project");
    this.currentNotebookPath = notebook.path;
    this.currentNotePath = path;
    return { path, source: await readTextFile(path) };
  }

  async saveCurrentNote(source) {
    if (!this.currentNotePath) throw new Error("Open a project note before saving");
    await writeTextFile(this.currentNotePath, source);
  }

  async saveManifest(path, source) {
    if (!this.project) throw new Error("Open a project first");
    if (path === this.project.path) {
      const parsed = parseProject(source);
      const notebooks = new Map();
      for (const relativePath of parsed.notebooks) {
        const notebookPath = joinPath(this.project.directory, relativePath);
        notebooks.set(notebookPath, {
          path: notebookPath,
          relativePath,
          ...parseNotebook(await readTextFile(notebookPath)),
        });
      }
      await writeTextFile(path, source);
      this.project = { ...this.project, ...parsed };
      this.notebooks = notebooks;
      return;
    }
    const current = this.notebooks.get(path);
    if (!current) throw new Error("Notebook manifest does not belong to this project");
    const parsed = parseNotebook(source);
    await writeTextFile(path, source);
    this.notebooks.set(path, { ...current, ...parsed });
  }

  async createNotebook(title) {
    if (!this.project) throw new Error("Create or open a project first");
    const folder = slug(title, "notebook");
    const relativePath = `${folder}/${NOTEBOOK_FILE}`;
    const path = joinPath(this.project.directory, relativePath);
    if (await exists(path)) throw new Error(`A notebook already exists at ${path}`);
    await mkdir(dirname(path), { recursive: true });
    await writeTextFile(path, notebookToml(title, ["index.md"]));
    await writeTextFile(joinPath(dirname(path), "index.md"), `# ${title}\n`);
    this.project.notebooks.push(relativePath);
    await writeTextFile(this.project.path, projectToml(this.project.title, this.project.notebooks, this.project.quickExportScope));
    this.notebooks.set(path, { path, relativePath, title, notes: ["index.md"] });
    return this.selectNotebook(path);
  }

  async createNote(title) {
    const notebook = this.currentNotebook;
    if (!notebook) throw new Error("Select a notebook first");
    const filename = `${slug(title, "note")}.md`;
    const path = joinPath(dirname(notebook.path), filename);
    if (await exists(path)) throw new Error(`A note already exists at ${path}`);
    await writeTextFile(path, `# ${title}\n`);
    notebook.notes.push(filename);
    await writeTextFile(notebook.path, notebookToml(notebook.title, notebook.notes));
    return this.selectNote(path);
  }

  async renameNote(path, title) {
    const notebook = [...this.notebooks.values()].find((candidate) => path.startsWith(`${dirname(candidate.path)}/`));
    if (!notebook) throw new Error("Note does not belong to this project");
    const oldName = path.slice(path.lastIndexOf("/") + 1);
    const newName = `${slug(title, "note")}.md`;
    const newPath = joinPath(dirname(path), newName);
    if (newPath !== path && await exists(newPath)) throw new Error(`A note already exists at ${newPath}`);
    if (newPath !== path) await rename(path, newPath);
    notebook.notes = notebook.notes.map((note) => note === oldName ? newName : note);
    await writeTextFile(notebook.path, notebookToml(notebook.title, notebook.notes));
    if (this.currentNotePath === path) this.currentNotePath = newPath;
    return this.selectNote(newPath);
  }

  async renameNotebook(path, title) {
    const notebook = this.notebooks.get(path);
    if (!notebook) throw new Error("Notebook does not belong to this project");
    notebook.title = title;
    await writeTextFile(notebook.path, notebookToml(notebook.title, notebook.notes));
    return this.selectNotebook(path);
  }

  async setQuickExportScope(scope) {
    if (!this.project) throw new Error("Open a project first");
    if (!["notebook", "project"].includes(scope)) throw new Error("Quick export can target a notebook or project");
    this.project.quickExportScope = scope;
    await writeTextFile(
      this.project.path,
      projectToml(this.project.title, this.project.notebooks, this.project.quickExportScope),
    );
  }

  async deleteNote(path) {
    const notebook = [...this.notebooks.values()].find((candidate) => (
      path.startsWith(`${dirname(candidate.path)}/`) && candidate.notes.includes(path.split("/").at(-1))
    ));
    if (!notebook) throw new Error("Note does not belong to this project");
    if (notebook.notes.length === 1) {
      throw new Error("A notebook must contain at least one note");
    }

    const filename = path.split("/").at(-1);
    const remainingNotes = notebook.notes.filter((note) => note !== filename);
    notebook.notes = remainingNotes;
    await writeTextFile(notebook.path, notebookToml(notebook.title, remainingNotes));
    if (this.currentNotePath === path) {
      return this.selectNote(joinPath(dirname(notebook.path), remainingNotes[0]));
    }
    return null;
  }
}
