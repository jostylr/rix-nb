export const DEFAULT_PROJECT_THEME = Object.freeze({
  markdown: Object.freeze({
    text: "#252827",
    heading: "#1f3558",
    link: "#145da0",
    inline_code_background: "#ece9e1",
    code_block_background: "#f1efe9",
    code_block_border: "#dfdbd1",
    quote_text: "#625f58",
    quote_border: "#a8bedb",
  }),
  rix: Object.freeze({
    number: "#b4235d",
    string: "#08776d",
    embedded_string: "#006c9c",
    regex: "#0b7285",
    comment: "#64736d",
    identifier: "#145da0",
    special_identifier: "#6d28a8",
    system_identifier: "#8a1c65",
    self: "#b45309",
    operator: "#b54708",
    punctuation: "#7b4b16",
  }),
});

const SECTION_NAMES = ["markdown", "rix"];
const COLOR_PATTERN = /^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z][a-zA-Z0-9_-]*|var\(--[a-zA-Z0-9_-]+\))$/;

function cloneDefaults() {
  return Object.fromEntries(SECTION_NAMES.map((section) => [section, { ...DEFAULT_PROJECT_THEME[section] }]));
}

function tomlString(value) {
  return JSON.stringify(value);
}

export function projectThemeToml(theme = DEFAULT_PROJECT_THEME) {
  const section = (name) => Object.entries(theme[name])
    .map(([key, value]) => `${key} = ${tomlString(value)}`)
    .join("\n");
  return `# Project presentation colors. Use CSS hex colors, named colors, or var(--custom-color).\n# Omit this file to use RiX Notebook's built-in palette.\nformat_version = 1\n\n[markdown]\n${section("markdown")}\n\n[rix]\n${section("rix")}\n`;
}

export function parseProjectTheme(source) {
  const theme = cloneDefaults();
  let section = null;
  for (const [index, line] of source.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const header = trimmed.match(/^\[([a-z_]+)\]$/);
    if (header) {
      if (!SECTION_NAMES.includes(header[1])) throw new Error(`Unknown style.toml section '${header[1]}' on line ${index + 1}`);
      section = header[1];
      continue;
    }
    if (trimmed.startsWith("format_version")) continue;
    const entry = trimmed.match(/^([a-z_]+)\s*=\s*("(?:\\.|[^"])*")\s*$/);
    if (!entry || !section) throw new Error(`Expected a color assignment in style.toml on line ${index + 1}`);
    const [_, key, rawValue] = entry;
    if (!(key in theme[section])) throw new Error(`Unknown ${section} style '${key}' on line ${index + 1}`);
    const value = JSON.parse(rawValue);
    if (!COLOR_PATTERN.test(value)) throw new Error(`Invalid color '${value}' on line ${index + 1}`);
    theme[section][key] = value;
  }
  return theme;
}

export function applyProjectTheme(theme = DEFAULT_PROJECT_THEME, root = globalThis.document?.documentElement) {
  if (!root) return;
  for (const section of SECTION_NAMES) {
    for (const [key, value] of Object.entries(theme[section])) {
      root.style.setProperty(`--${section}-${key.replaceAll("_", "-")}`, value);
    }
  }
}
