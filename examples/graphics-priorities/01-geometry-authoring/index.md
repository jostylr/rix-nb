# Visual geometry authoring

These studies combine GeoGebra-style construction workflows, Desmos's compact
transformation tools, and JSXGraph's dependency-driven objects. Each result is
already representable by the exact kernel; the priority is making it reachable
from the RiX Web toolbar.

## 1. Construct a line and circle from selected points

This is the direct acceptance case for Point, Line, and Circle tools.

```rix out
.Plugin.Load("geometry");
g0 := .geometry.ConstructionGraph([]);
g1 := .geometry.AddPoint(g0,.geometry.Point(-2,0),{= id=:a });
g2 := .geometry.AddPoint(g1,.geometry.Point(2,0),{= id=:b });
$$authorGraph := .geometry.AddPoint(g2,.geometry.Point(0,3),{= id=:c });
PointTool1() -> .Graphics.Action({=
  id="geometry-author-point",target=$$authorGraph,
  action=(current,position)->.geometry.AddPoint(current,.geometry.Point(position[1],position[2])),
  coordinateSystem={= view=[-5,-4,5,5],size=[640,480] },
  children=[.Graphics.Rectangle([0,0],[640,480],{= fill="transparent" })]
});
LineTool1() -> .Graphics.Action({=
  id="geometry-author-line",target=$$authorGraph,
  action=(current,ids)->.geometry.AddLine(current,ids[1],ids[2]),children=[]
});
CircleTool1() -> .Graphics.Action({=
  id="geometry-author-circle",target=$$authorGraph,
  action=(current,ids)->.geometry.AddCircle(current,ids[1],ids[2]),children=[]
});
UndoTool1() -> .Graphics.Action({= id="geometry-author-undo",target=$$authorGraph,action=current->.geometry.Undo(current),children=[] });
RedoTool1() -> .Graphics.Action({= id="geometry-author-redo",target=$$authorGraph,action=current->.geometry.Redo(current),children=[] });
$$authorView := .geometry.AuthoringWorkbench($authorGraph,[
  PointTool1(),LineTool1(),CircleTool1(),UndoTool1(),RedoTool1()
],{= view=[-5,-4,5,5],size=[640,480] });
$authorView;
```

## 2. Reveal the dependent centers of a triangle

Inspired by standard GeoGebra triangle-center constructions. The UI should
expose every dependency and preserve the exact constructions while points move.

```rix out
a2 := .geometry.Point(0,0); b2 := .geometry.Point(6,0); c2 := .geometry.Point(2,4);
center2 := .geometry.Centroid(a2,b2,c2);
orthocenter2 := .geometry.Orthocenter(a2,b2,c2);
circumcircle2 := .geometry.Circumcircle(a2,b2,c2);
.geometry.Draw([
  .geometry.Polygon([a2,b2,c2]),circumcircle2,center2,orthocenter2,a2,b2,c2
],{= view=[-1,-2,7,6],size=[640,500] });
```

## 3. Apply and compose transformations

Inspired by Desmos Geometry's reusable translate and rotate tools.

```rix out
origin3 := .geometry.Point(0,0);
triangle3 := .geometry.Polygon([
  .geometry.Point(0,0),.geometry.Point(3,0),.geometry.Point(1,2)
]);
shifted3 := .geometry.Transform(triangle3,.geometry.Translate(4,1));
turned3 := .geometry.Transform(shifted3,.geometry.RotateQuarterTurns(origin3,1));
.geometry.Draw([triangle3,shifted3,turned3],{= view=[-7,-1,8,7],size=[700,420] });
```

## 4. Inspect certified line–conic intersections

This is the intersection-tool case: creation, result multiplicity, proof data,
and the visible points must remain one semantic object.

```rix out
ellipse4 := .geometry.Ellipse(.geometry.Point(0,0),[3,2]);
line4 := .geometry.Line(.geometry.Point(-5,1),.geometry.Point(5,1));
crossing4 := .geometry.Intersect(line4,ellipse4);
.geometry.Draw([ellipse4,line4,crossing4],{= view=[-5,-3,5,3],size=[700,420] });
```

## 5. Keep a degenerate construction repairable

Parallel lines deliberately produce an unresolved intersection node. A visual
tool must keep it in the dependency tree and offer repair suggestions instead
of silently deleting it.

```rix out
q0 := .geometry.ConstructionGraph([]);
q1 := .geometry.AddPoint(q0,.geometry.Point(-3,0),{= id=:a });
q2 := .geometry.AddPoint(q1,.geometry.Point(3,0),{= id=:b });
q3 := .geometry.AddPoint(q2,.geometry.Point(-3,2),{= id=:c });
q4 := .geometry.AddPoint(q3,.geometry.Point(3,2),{= id=:d });
q5 := .geometry.AddLine(q4,:a,:b,{= id=:lower });
q6 := .geometry.AddLine(q5,:c,:d,{= id=:upper });
q7 := .geometry.AddIntersection(q6,:lower,:upper,{= id=:parallelMeet });
.geometry.Workbench(q7,{= view=[-5,-2,5,4],size=[640,420] });
```
