# Quadratic slides

This note demonstrates an export-only RiX slide deck. Its Quarto export uses
Reveal.js automatically; static Markdown and HTML retain the slide sections in
reading order.

```rix out
values := .Table(["x", "f(x)"], [[0, 1], [1, 0], [2, 1]]);
.Plugin.Load("plot");
curve := .plot.Polynomial([1, -2, 1], [-2, 4]);
deck := .Slides([
  .Slide(.Fragment([
    .Heading(1, "The polynomial"),
    .Paragraph("f(x) = (x - 1)^2 has an exact minimum at x = 1.")
  ]), "A quadratic in three views"),
  .Slide(.Figure(values, "Selected exact values", "tbl-slide-values"), "Values"),
  .Slide(.Figure(curve, "The graph of the quadratic", "fig-slide-curve"), "Graph")
], "A quadratic in three views");
```
