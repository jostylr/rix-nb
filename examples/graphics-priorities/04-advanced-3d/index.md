# Advanced 3D mathematical visualization

Desmos, GeoGebra, JSXGraph, and Manim provide complementary surface, solid,
camera, and material examples. These RiX analogues exercise what is implemented
and make the missing implicit-surface, volume, texture, and shadow policies
concrete. Exact clip planes now filter points, cut segments, and split and
retriangulate crossing meshes during retained realization. Advanced material
descriptors remain available to capable hosts; the portable flat executor
reports the shading features it cannot realize.

## 1. Adaptive saddle surface

```rix out
.Plugin.Load("scene3d");
surface := .scene3d.ParametricSurface(
  (u,v)->{; x:=2*u-1; y:=2*v-1; [x,y,x^2-y^2] },0:1,0:1,
  {= tolerance=1/32,maxDepth=5,maxCells=2048,id="saddle",label="adaptive saddle",color="#0f766e" }
);
.scene3d.Scene([.scene3d.Axes({= length=2,id="axes" }),surface],{=
  camera=.scene3d.OrbitCamera([0,0,0],{= radius=5,height=2,turn=1/3 })
});
```

## 2. A bounded paraboloid patch

This is the current parametric counterpart of a future implicit surface. Its
sampling record exposes the refinement limit rather than hiding tessellation.

```rix out
surface2 := .scene3d.ParametricSurface(
  (u,v)->{; x:=4*u-2; y:=4*v-2; [x,y,(x^2+y^2)/4] },0:1,0:1,
  {= tolerance=1/24,maxDepth=5,maxCells=4096,id="paraboloid",label="paraboloid patch",color="#2563eb" }
);
.scene3d.Scene([surface2],{=
  camera=.scene3d.PerspectiveCamera([5,5,4],[0,0,1])
});
```

## 3. Clipped mesh with explicit material and lights

The material retains roughness, metallic, and emissive intent. The clip plane
is attached to every affected primitive, whose exact realized coordinates are
already clipped before an SVG or WebGL projection consumes them.

```rix out
mesh3 := .scene3d.Mesh(
  [[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0],[0,0,2]],
  [[1,2,5],[2,3,5],[3,4,5],[4,1,5],[1,4,3],[1,3,2]],
  {= id="pyramid",label="pyramid mesh",material=.scene3d.Material({=
       color="#d97706",roughness=1/3,metallic=2/3,emissive="#110000"
     }) }
);
clip3 := .scene3d.ClipPlane([1,0,0],0);
.scene3d.Scene([.scene3d.Clip([mesh3],[clip3])],{=
  camera=.scene3d.PerspectiveCamera([4,4,3],[0,0,1]),
  lights=[.scene3d.AmbientLight("#ffffff",1/4),.scene3d.DirectionalLight([1,1,-2],{= intensity=3/4 })]
});
```

## 4. Exact samples standing in for a volume

The lattice is not mislabeled as a continuous volume. It is a retained point
sample that sets a concrete target for volume transfer functions and slicing.

```rix out
volumePoints := [];
{@ i=0;i<729;{;
  @volumePoints ~= @volumePoints.Push([
    (i%9-4)/2,
    ((i//9)%9-4)/2,
    (i//81-4)/2
  ]);
};i+=1 };
volumeCloud := .scene3d.PointCloud(volumePoints,{= id="volume-samples",label="729 exact volume samples",radius=1/24,color="#be123c",opacity=1/3 });
.scene3d.Scene([volumeCloud],{= camera=.scene3d.OrbitCamera([0,0,0],{= radius=7,height=3,turn=1/4 }) });
```

## 5. Explicit 4D-to-3D projection

Inspired by higher-dimensional Manim scenes, but with the projection provenance
retained. RiX refuses to present the original 4D object as if it were 3D.

```rix out
.Plugin.Load("nd");
cube4 := .nd.Hypercube(4,2);
projection := .nd.CoordinateProjection(4,[1,2,3]);
projected := .nd.Project(cube4,projection);
.nd.ToScene3D(projected,{= style={= color="#7c3aed",width=2 } });
```
