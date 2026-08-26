# RiX graphics priorities project

Open this directory in RiX Notebook, or open a ZIP of the directory in the
browser notebook. It contains five notebooks with five executable RiX studies
for each active graphics priority. The examples are original RiX constructions
inspired by public feature examples; they do not reproduce another product's
source.

The project is also an acceptance corpus:

1. **Visual geometry authoring** — constructions that the selection-driven
   toolbar should be able to create without editing source.
2. **Automatic points of interest** — stable exact, certified, and sampled
   records with independent label-density controls.
3. **Dense performance** — bounded stress scenes for render switching, spatial
   indexing, workers, and GPU picking.
4. **Advanced 3D** — exact geometric clipping plus retained analogues for future
   implicit surfaces, volumes, richer materials, and higher-dimensional projection.
5. **Semantic animation** — Timeline scenes and manifests for matching, camera,
   paths, construction steps, formulas, captions, and media-export requirements.

## Host relationship

- **RiX Web** is the calculator/tutorial and reactive-widget host. It mounts
  `Graphic`, `Scene3D`, and `Timeline` values with the richest current browser
  interaction, but it does not yet open notebook project directories.
- **RiX Notebook** is the project owner for this corpus. Native mode opens the
  directory directly; browser mode opens a ZIP-backed virtual project. Both use
  the same notebook engine and shared RiX output-widget protocol.
- **RiXCel** is a separate exact FormulaSheet application with its own sparse
  `.rixcel` event-log document. It shares the RiX evaluator and sheet widget
  protocol, but is not a notebook-project loader. Notebook examples can display
  `.Sheet` values; importing an entire `.rixcel` document will need an explicit
  asset/embedding adapter.

## Reference families

- GeoGebra's linked graphing, geometry, CAS, and 3D views:
  <https://help.geogebra.org/hc/en-us/articles/8379325433629-Calculator-Suite>
- Desmos graph points of interest and audio navigation:
  <https://help.desmos.com/hc/en-us/articles/4406040715149>
- Desmos geometry transformations:
  <https://help.desmos.com/hc/en-us/articles/15364983456909-Transformations-Desmos-Geometry>
- Desmos parametric surfaces and 3D inequalities:
  <https://help.desmos.com/hc/en-us/articles/19736835727885-Extending-from-2D-to-3D>
- JSXGraph's geometry, plotting, 3D, vector-field, and animation catalog:
  <https://jsxgraph.org/docs/>
- JSXGraph gliders and browser animation:
  <https://jsxgraph.org/docs/symbols/Glider.html>
- Manim's transformation and animation families:
  <https://docs.manim.community/en/stable/reference_index/animations.html>
- Manim 3D scenes and camera movement:
  <https://docs.manim.community/en/stable/reference/manim.scene.three_d_scene.ThreeDScene.html>

The specific influence for each study is described beside its executable cell.
