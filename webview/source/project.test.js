import { expect, test } from "bun:test";
import { BrowserDocumentStore } from "../../docshell/src/browser/browser-document-store.js";
import { ProjectManager } from "./project.js";

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
