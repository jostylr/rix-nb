# Dense graphics and Scene3D performance

JSXGraph and Desmos demonstrate responsive dense browser scenes; these bounded
studies establish RiX workloads for renderer switching, spatial indexes,
worker cancellation, incremental updates, and GPU picking. RiX Web now publishes
`rix.graphics.density-policy@1` thresholds and builds a bounded reusable
screen-space bucket index with explicit construction/query work records;
the worker, incremental-update, and GPU-picking targets remain future work.

## 1. A high-sample algebraic curve

```rix out
.Plugin.Load("plot");
.plot.Function(x -> x^9-6*x^7+9*x^5-x^3,[-2,2],{=
  samples=801,title="Dense exact algebraic sampling",preferencesKey="dense-algebraic"
});
```

## 2. Four hundred retained scatter marks

```rix out
scatterData := [];
{@ i=0;i<400;{; @scatterData ~= @scatterData.Push([i/20-10,((i%37)-18)/6]); };i+=1 };
.plot.Scatter(scatterData,{= title="400 exact scatter marks",size=[700,420] });
```

## 3. A dense vector field

```rix out
.plot.VectorField((x,y)->[-y,x],[-4,4],[-3,3],{=
  grid=[24,18],vectorScale=3/4,title="432 retained vectors"
});
```

## 4. Multi-level adaptive contours

```rix out
.plot.Contour((x,y)->x^2-y^2,[-3,3],[-3,3],{=
  levels=[-1,0,1],grid=[4,3],refineDepth=1,
  refinementBudget=240,continuity=:continuous,labelContours=1,
  title="Cached adaptive contour family"
});
```

## 5. A pickable exact 3D point cloud

This scene is deliberately large enough to exercise the CPU picker today and
become a GPU color-buffer picking fixture later.

```rix out
.Plugin.Load("scene3d");
cloudPoints := [];
{@ i=0;i<625;{;
  row := i//25; column := i%25;
  x := (column-12)/4; y := (row-12)/4;
  @cloudPoints ~= @cloudPoints.Push([x,y,(x^2-y^2)/12]);
};i+=1 };
denseCloud := .scene3d.PointCloud(cloudPoints,{= id="dense-cloud",label="625 exact points",radius=1/30,color="#7c3aed" });
.scene3d.Scene([.scene3d.Axes({= length=3,id="axes" }),denseCloud],{=
  camera=.scene3d.OrbitCamera([0,0,0],{= radius=8,height=4,turn=1/3 })
});
```
