import { describe, expect, test } from "bun:test";
import { DEFAULT_PROJECT_THEME, parseProjectTheme, projectThemeToml } from "./theme.js";

describe("project theme configuration", () => {
  test("the generated style.toml round-trips the default palette", () => {
    expect(parseProjectTheme(projectThemeToml())).toEqual(DEFAULT_PROJECT_THEME);
  });

  test("an incomplete configuration inherits the defaults", () => {
    expect(parseProjectTheme("[rix]\nnumber = \"#ff006e\"\n")).toEqual({
      markdown: { ...DEFAULT_PROJECT_THEME.markdown },
      rix: { ...DEFAULT_PROJECT_THEME.rix, number: "#ff006e" },
    });
  });

  test("unknown entries and invalid values are rejected before saving", () => {
    expect(() => parseProjectTheme("[rix]\nunknown = \"#ffffff\"\n")).toThrow("Unknown rix style");
    expect(() => parseProjectTheme("[markdown]\ntext = \"rgb(1, 2, 3)\"\n")).toThrow("Invalid color");
  });
});
