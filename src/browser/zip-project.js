import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { BrowserDocumentStore } from "./browser-document-store.js";

const TEXT_FILE = /\.(?:md|markdown|toml|txt|json|ya?ml|csv|tsv|svg|html?|css|js|mjs|qmd)$/i;

function safeZipPath(path) {
  const cleaned = String(path).replaceAll("\\", "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.endsWith("/") || cleaned.split("/").includes("..")) return null;
  return cleaned;
}

export function openZipProject(bytes) {
  const archive = unzipSync(bytes);
  const entries = [];
  for (const [path, value] of Object.entries(archive)) {
    const safe = safeZipPath(path); if (!safe) continue;
    entries.push([safe, TEXT_FILE.test(safe) ? strFromU8(value) : value]);
  }
  if (!entries.length) throw new Error("The ZIP file contains no usable files");
  return new BrowserDocumentStore(entries);
}

export function createZipProject(store) {
  const entries = Object.fromEntries(store.entries().map(([path, value]) => [
    path.replace(/^\//, ""), typeof value === "string" ? strToU8(value) : value,
  ]));
  return zipSync(entries, { level: 6 });
}

export function findProjectRoot(store) {
  const project = store.entries().map(([path]) => path).find((path) => path === "/project.toml" || path.endsWith("/project.toml"));
  if (!project) return null;
  return project.slice(0, -"/project.toml".length) || "/";
}
