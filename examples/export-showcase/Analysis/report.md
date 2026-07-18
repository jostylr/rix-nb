# A quadratic report

This ordinary Markdown note is the source of the report. It has normal KaTeX,
such as $f(x) = x^2 - 2x + 1 = (x - 1)^2$, and computed prose.

```rix hide static:{report}
f := (x) -> x^2 - 2*x + 1;
values := .Table(["x", "f(x)"], [[-1, 4], [0, 1], [1, 0], [2, 1], [3, 4]], {= caption = "Selected exact values" });
division := .Algebra.SyntheticDivision(1, [1, -2, 1]);
curve := .Plot.Polynomial([1, -2, 1], [-2, 4], {= size = [640, 360], stroke = "#2d6ca2" });
report := .Fragment([
  .Heading(2, "Computed results"),
  .Paragraph("The exact vertex is (1, 0)."),
  .Figure(values, "Selected values of the quadratic", "tbl-quadratic-values"),
  .Figure(curve, "Plot of the quadratic", "fig-quadratic-plot", "An upward-opening parabola"),
  .Figure(division, "Synthetic division by x - 1", "tbl-synthetic-division")
]);
```

The report object is omitted from the authored page, but `static:{report}`
places its structured result here when exporting. Tables remain Markdown tables,
the plot is saved as SVG under `assets/rix`, and the synthetic-division layout
is retained as a presentation block.
