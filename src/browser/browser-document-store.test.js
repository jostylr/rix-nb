import { expect, test } from "bun:test";
import { BrowserDocumentStore } from "./browser-document-store.js";
import { ProjectManager } from "../project.js";

test("browser document store preserves a virtual directory tree", async () => {
  const store = new BrowserDocumentStore([["Notebook/index.md", "# Index"], ["assets/diagram.svg", "<svg />"]]);
  expect(await store.readDirectory("/")).toEqual([{ name: "assets", isDirectory: true }, { name: "Notebook", isDirectory: true }]);
  expect(await store.readText("/Notebook/index.md")).toBe("# Index");
  await store.rename("/Notebook/index.md", "/Notebook/home.md");
  expect(await store.exists("Notebook/home.md")).toBe(true);
});

test("browser document store keeps binary assets intact", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const store = new BrowserDocumentStore([["assets/plot.png", bytes]]);
  bytes[0] = 0;
  expect(await store.readBinary("/assets/plot.png")).toEqual(new Uint8Array([137, 80, 78, 71]));
  await store.rename("/assets", "/figures");
  expect(await store.readBinary("/figures/plot.png")).toEqual(new Uint8Array([137, 80, 78, 71]));
});

test("project manager can open a project rooted in the virtual filesystem", async () => {
  const store = new BrowserDocumentStore([
    ["course/project.toml", 'title = "Course"\nnotebooks = ["Algebra/notebook.toml"]\n'],
    ["course/Algebra/notebook.toml", 'title = "Algebra"\nnotes = ["index.md"]\n'],
    ["course/Algebra/index.md", "# Algebra\n"],
  ]);
  const projects = new ProjectManager(store);
  const note = await projects.openProject("/course");
  expect(projects.project.title).toBe("Course");
  expect(note).toEqual({ path: "/course/Algebra/index.md", source: "# Algebra\n" });
});
