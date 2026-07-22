import { assertDocumentStore } from "../notebook-web/contracts.js";

/** A small in-memory DocumentStore for browser uploads and future ZIP projects. */
export class BrowserDocumentStore {
  constructor(entries = []) {
    this.files = new Map(entries.map(([path, value]) => [this.normalize(path), value]));
  }

  normalize(path) { return `/${String(path).replace(/^\/+/, "").replace(/\/+/g, "/")}`; }
  async readText(path) {
    const value = this.files.get(this.normalize(path));
    if (typeof value !== "string") throw new Error(`No text file at ${path}`);
    return value;
  }
  async writeText(path, source) { this.files.set(this.normalize(path), String(source)); }
  async exists(path) { return this.files.has(this.normalize(path)); }
  async readDirectory(path = "/") {
    const root = this.normalize(path).replace(/\/$/, "");
    const children = new Map();
    for (const file of this.files.keys()) {
      if (!file.startsWith(`${root}/`)) continue;
      const part = file.slice(root.length + 1).split("/")[0];
      children.set(part, { name: part, isDirectory: file.slice(root.length + 1).includes("/") });
    }
    return [...children.values()].sort((left, right) => left.name.localeCompare(right.name));
  }
  async mkdir() { /* Directories are represented by file paths. */ }
  async rename(path, nextPath) { const value = this.files.get(this.normalize(path)); if (value === undefined) throw new Error(`No file at ${path}`); this.files.delete(this.normalize(path)); this.files.set(this.normalize(nextPath), value); }
  async delete(path) { this.files.delete(this.normalize(path)); }
}

export function createSingleFileStore(name, source) {
  const store = new BrowserDocumentStore([[name, source]]);
  return assertDocumentStore(store);
}
