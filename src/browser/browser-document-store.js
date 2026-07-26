import { assertDocumentStore } from "../notebook-web/contracts.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function mimeType(path) {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return {
    svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", pdf: "application/pdf",
  }[extension] || "application/octet-stream";
}

function normalizePath(path) {
  const parts = String(path).replaceAll("\\", "/").split("/").filter(Boolean);
  if (parts.includes("..")) throw new Error(`Virtual paths cannot leave the project: ${path}`);
  return `/${parts.filter((part) => part !== ".").join("/")}`;
}

function cloneBytes(value) {
  return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
}

/**
 * Browser-side DocumentStore. Text is retained as text for editing; all other
 * ZIP entries remain bytes so images, figures, and arbitrary project assets
 * round-trip without alteration.
 */
export class BrowserDocumentStore {
  constructor(entries = []) {
    this.files = new Map();
    this.assetUrls = new Map();
    for (const [path, value] of entries) this.set(path, value);
  }

  normalize(path) { return normalizePath(path); }
  set(path, value) {
    const normalized = this.normalize(path);
    this.revokeAssetUrl(normalized);
    this.files.set(normalized, typeof value === "string" ? value : cloneBytes(value));
  }
  async readText(path) {
    const value = this.files.get(this.normalize(path));
    if (typeof value === "string") return value;
    if (value instanceof Uint8Array) return decoder.decode(value);
    throw new Error(`No text file at ${path}`);
  }
  async readBinary(path) {
    const value = this.files.get(this.normalize(path));
    if (typeof value === "string") return encoder.encode(value);
    if (value instanceof Uint8Array) return cloneBytes(value);
    throw new Error(`No file at ${path}`);
  }
  async writeText(path, source) { this.set(path, String(source)); }
  async writeBinary(path, bytes) { this.set(path, bytes); }
  async exists(path) { return this.files.has(this.normalize(path)); }
  async readDirectory(path = "/") {
    const root = this.normalize(path).replace(/\/$/, "");
    const prefix = root === "/" ? "/" : `${root}/`;
    const children = new Map();
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const remainder = file.slice(prefix.length);
      const [name, ...rest] = remainder.split("/");
      if (!name) continue;
      children.set(name, { name, isDirectory: rest.length > 0 });
    }
    return [...children.values()].sort((left, right) => left.name.localeCompare(right.name));
  }
  async mkdir() { /* Directories are implicit in virtual file paths. */ }
  async rename(path, nextPath) {
    const from = this.normalize(path); const to = this.normalize(nextPath);
    const affected = [...this.files.entries()].filter(([candidate]) => candidate === from || candidate.startsWith(`${from}/`));
    if (!affected.length) throw new Error(`No file at ${path}`);
    for (const [candidate, value] of affected) {
      this.files.delete(candidate); this.revokeAssetUrl(candidate);
      this.files.set(`${to}${candidate.slice(from.length)}`, value);
    }
  }
  async delete(path) {
    const normalized = this.normalize(path);
    for (const candidate of [...this.files.keys()]) {
      if (candidate === normalized || candidate.startsWith(`${normalized}/`)) {
        this.files.delete(candidate); this.revokeAssetUrl(candidate);
      }
    }
  }
  entries() {
    return [...this.files.entries()].map(([path, value]) => [path, typeof value === "string" ? value : cloneBytes(value)]);
  }
  assetUrl(path) {
    const normalized = this.normalize(path); const value = this.files.get(normalized);
    if (value === undefined) return null;
    const cached = this.assetUrls.get(normalized); if (cached) return cached;
    const url = URL.createObjectURL(new Blob([typeof value === "string" ? encoder.encode(value) : value], { type: mimeType(normalized) }));
    this.assetUrls.set(normalized, url); return url;
  }
  revokeAssetUrl(path) {
    const url = this.assetUrls.get(path);
    if (url) URL.revokeObjectURL(url);
    this.assetUrls.delete(path);
  }
  dispose() { for (const path of this.assetUrls.keys()) this.revokeAssetUrl(path); }
}

export function createSingleFileStore(name, source) {
  return assertDocumentStore(new BrowserDocumentStore([[name, source]]));
}
