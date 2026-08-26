# Automatic semantic points of interest

Desmos automatically exposes roots, intersections, and extrema, while GeoGebra
provides corresponding commands. These examples currently declare some marks
explicitly; the priority is to derive the same records automatically with
honest exactness and work metadata.

## 1. Three exact roots of a cubic

```rix out
.Plugin.Load("plot");
.plot.Polynomial([1,0,-1,0],[-2,2],{=
  title="Three exact roots",
  marks=[
    {= point=[-1,0],label="exact root -1" },
    {= point=[0,0],label="exact root 0" },
    {= point=[1,0],label="exact root 1" }
  ]
});
```

## 2. Roots and extremum of a quadratic

The future event plan should distinguish the exact roots from the exact
stationary minimum and offer all three through selection, text, and audio.

```rix out
.plot.Polynomial([1,-4,3],[0,4],{=
  title="Roots and vertex",
  marks=[
    {= point=[1,0],label="exact root" },
    {= point=[2,-1],label="exact minimum" },
    {= point=[3,0],label="exact root" }
  ]
});
```

## 3. Pairwise curve intersections

Inspired by Desmos's selectable intersection points. Both curves share one
retained plot, while the two exact intersections are explicit acceptance data.

```rix out
.plot.Polynomial([1,0,0],[-3,3],{=
  title="Parabola and line",
  label="x squared",
  series=[{= coefficients=[2,3],label="2x + 3",stroke="#d97706" }],
  marks=[
    {= point=[-1,1],label="exact intersection" },
    {= point=[3,9],label="exact intersection" }
  ]
});
```

## 4. Removable discontinuity without a false root claim

The sampled trace approaches `(1,2)` but evaluation at `x=1` is unresolved.
The future POI is a hole/discontinuity candidate, never an exact plotted point.

```rix out
.plot.Function(x -> (x^2-1)/(x-1),[-3,3],{=
  samples=48,
  title="A removable discontinuity",
  discontinuityThreshold=2,
  marks=[{= point=[1,2],label="excluded location; candidate hole" }]
});
```

## 5. Certified existence separated from displayed location

An IVT sign change can prove that the circle boundary exists on an edge. The
marching-squares segment is still only a sampled display location.

```rix out
.plot.Implicit((x,y)->x^2+y^2-1,[-2,2],[-2,2],{=
  grid=[8,8],refineDepth=2,refinementBudget=2048,
  certifyIntervals=1,continuity=:continuous,title="Certified circle existence"
});
```
