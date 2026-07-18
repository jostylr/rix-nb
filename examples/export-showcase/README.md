# RiX static export showcase

Open this folder as a project in RiX Notebook, then use **Export** (`⌘E`) with
all three static targets selected:

- rendered Markdown;
- standalone static HTML with KaTeX assets;
- an ordinary Quarto project.

`Analysis/report.md` exercises a structured report with a table, portable SVG
plot, and synthetic division. `Analysis/slides.md` exercises a slide deck; its
exported `.qmd` selects Quarto's `revealjs` format. Generated SVG files are
written under `assets/rix/` in the chosen export folder.
