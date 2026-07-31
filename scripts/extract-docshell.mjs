import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const notebookRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docshellRoot = path.join(notebookRoot, "docshell");
const outputRoot = path.join(notebookRoot, ".docshell-build");
const manifest = JSON.parse(await readFile(path.join(notebookRoot, "docshell.manifest.json"), "utf8"));

if (manifest.formatVersion !== 1) throw new Error(`Unsupported DocShell manifest version: ${manifest.formatVersion}`);

async function readWebviewMarkup(name) {
  const relativePath = manifest.webview?.[name];
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) {
    throw new Error(`DocShell webview.${name} must be a repository-relative path`);
  }
  const source = await readFile(path.join(notebookRoot, relativePath), "utf8");
  const body = source.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1];
  if (body === undefined) throw new Error(`${relativePath} must contain a body element`);
  return body.replace(/\s*<script\b[^>]*>[\s\S]*?<\/script>\s*/gi, "\n").trim();
}

const values = {
  "product.name": manifest.product?.name,
  "product.browserName": manifest.product?.browserName,
  "entrypoint.native": `../../${manifest.entrypoints?.native}`,
  "entrypoint.browser": `../../${manifest.entrypoints?.browser}`,
  "webview.nativeMarkup": await readWebviewMarkup("nativeMarkup"),
  "webview.browserMarkup": await readWebviewMarkup("browserMarkup"),
  "files.browserAccept": [...manifest.files.primaryExtensions, ...manifest.files.archiveExtensions]
    .map((extension) => `.${String(extension).replace(/^\./, "")}`)
    .join(","),
};

function render(source, templateName) {
  let rendered = source;
  for (let pass = 0; pass < 3 && /\{\{[^}]+\}\}/.test(rendered); pass += 1) {
    rendered = rendered.replace(/\{\{([a-zA-Z0-9.]+)\}\}/g, (match, key) => {
      if (!values[key]) throw new Error(`Unknown or empty DocShell template token ${match} in ${templateName}`);
      return values[key];
    });
  }
  const unresolved = rendered.match(/\{\{[^}]+\}\}/);
  if (unresolved) throw new Error(`Unresolved DocShell template token ${unresolved[0]} in ${templateName}`);
  return rendered;
}

await rm(outputRoot, { recursive: true, force: true });
for (const host of ["native", "browser"]) {
  const templatePath = path.join(docshellRoot, "shells", host, "index.html");
  const outputDirectory = path.join(outputRoot, host);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    path.join(outputDirectory, "index.html"),
    render(await readFile(templatePath, "utf8"), `${host}/index.html`),
  );
}

console.log("Extracted DocShell hosts into .docshell-build/.");
