import { expect, test } from "bun:test";
import { BrowserDocumentStore } from "./browser-document-store.js";

test("browser document store preserves a virtual directory tree", async () => {
  const store = new BrowserDocumentStore([["Notebook/index.md", "# Index"], ["assets/diagram.svg", "<svg />"]]);
  expect(await store.readDirectory("/")).toEqual([{ name: "assets", isDirectory: true }, { name: "Notebook", isDirectory: true }]);
  expect(await store.readText("/Notebook/index.md")).toBe("# Index");
  await store.rename("/Notebook/index.md", "/Notebook/home.md");
  expect(await store.exists("Notebook/home.md")).toBe(true);
});
