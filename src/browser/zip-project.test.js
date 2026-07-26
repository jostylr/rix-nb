import { expect, test } from "bun:test";
import { BrowserDocumentStore } from "./browser-document-store.js";
import { createZipProject, findProjectRoot, openZipProject } from "./zip-project.js";

test("ZIP projects round-trip text, binary assets, and a nested project root", async () => {
  const original = new BrowserDocumentStore([
    ["course/project.toml", 'title = "Course"\nnotebooks = ["Notebook/notebook.toml"]\n'],
    ["course/Notebook/notebook.toml", 'title = "Notebook"\nnotes = ["index.md"]\n'],
    ["course/Notebook/index.md", "# Welcome\n"],
    ["course/assets/figure.png", new Uint8Array([137, 80, 78, 71])],
  ]);
  const reopened = openZipProject(createZipProject(original));
  expect(findProjectRoot(reopened)).toBe("/course");
  expect(await reopened.readText("/course/Notebook/index.md")).toBe("# Welcome\n");
  expect(await reopened.readBinary("/course/assets/figure.png")).toEqual(new Uint8Array([137, 80, 78, 71]));
});
