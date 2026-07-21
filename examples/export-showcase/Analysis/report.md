# A quadratic report

This ordinary Markdown note is the source of the report. It has normal KaTeX,
such as $f(x) = x^2 - 2x + 1 = (x - 1)^2$, and computed prose.

```rix out
root := .slider(0:3, 1, 2);
.static({; root := 1; });
.Plugin.Load("plot");
values := .Table(["x", "f(x)"], [[0, root^2], [1, (1-root)^2], [2, (2-root)^2], [3, (3-root)^2]], {= caption = "Selected exact values" });
division := .Algebra.SyntheticDivision(root, [1, -2*root, root^2]);
curve := .plot.Polynomial([1, -2*root, root^2], [-2, 4], {= size = [640, 360], stroke = "#2d6ca2" });
report := .Fragment([
  .Heading(2, "Computed results"),
  .Paragraph("Move the parameter to change the exact vertex."),
  .Figure(values, "Selected values of the quadratic", "tbl-quadratic-values"),
  .Figure(curve, "Plot of the quadratic", "fig-quadratic-plot", "An upward-opening parabola"),
  .Figure(division, @"Synthetic division by x - @{root}", "tbl-synthetic-division")
]);
```

The final `report` expression is the default output for both pathways. The
preceding `.static({; root := 1; })` runs only during static export, so printed
output is pinned at `root = 1`, while HTML and Quarto HTML retain an interactive
slider. Tables remain Markdown tables, the static plot is saved as SVG under
`assets/rix`, and the synthetic-division layout is retained as a presentation
block.
