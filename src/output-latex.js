import { Integer, Rational } from "@ratmath/core";

function escapeLatexText(value) {
  return String(value)
    .replaceAll("\\", "\\textbackslash{}")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("#", "\\#")
    .replaceAll("$", "\\$")
    .replaceAll("%", "\\%")
    .replaceAll("&", "\\&")
    .replaceAll("_", "\\_")
    .replaceAll("^", "\\textasciicircum{}")
    .replaceAll("~", "\\textasciitilde{}");
}

function valueLatex(value, formatValue) {
  if (value === null || value === undefined) return "";
  if (value instanceof Integer) return value.value.toString();
  if (value instanceof Rational) {
    if (value.denominator === 1n) return value.numerator.toString();
    const negative = value.numerator < 0n ? "-" : "";
    const numerator = (value.numerator < 0n ? -value.numerator : value.numerator).toString();
    return `${negative}\\frac{${numerator}}{${value.denominator}}`;
  }
  if (typeof value === "string") return `\\text{${escapeLatexText(value)}}`;
  if (value?.type === "string") return `\\text{${escapeLatexText(value.value)}}`;
  return `\\text{${escapeLatexText(formatValue(value))}}`;
}

function gridHasRule(grid, kind, value) {
  const field = kind === "vertical" ? "afterColumn" : "aboveRow";
  return grid.rules.some((rule) => {
    const entries = rule?.type === "map" ? rule.entries : null;
    const ruleKind = entries?.get("kind")?.value ?? rule?.kind;
    const ruleValue = entries?.get(field) ?? rule?.[field];
    const numericValue = ruleValue instanceof Integer
      ? Number(ruleValue.value)
      : ruleValue instanceof Rational && ruleValue.denominator === 1n
        ? Number(ruleValue.numerator)
        : Number(ruleValue);
    return ruleKind === kind && numericValue === value;
  });
}

export function gridLatex(grid, formatValue) {
  const columns = grid.columns.map((_column, index) => `r${gridHasRule(grid, "vertical", index + 1) ? "|" : ""}`).join("");
  const lines = [];
  for (const [index, row] of grid.rows.entries()) {
    if (gridHasRule(grid, "horizontal", index + 1)) lines.push("\\hline");
    lines.push(row.map((cell) => valueLatex(cell, formatValue)).join(" & ") + (index < grid.rows.length - 1 ? " \\\\" : ""));
  }
  return `$$\n\\begin{array}{${columns}}\n${lines.join("\n")}\n\\end{array}\n$$`;
}
