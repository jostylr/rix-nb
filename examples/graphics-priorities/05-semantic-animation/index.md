# Semantic animation and media production

Manim supplies the main transformation and camera references; Desmos sliders,
actions, and tickers and JSXGraph glider animation supply the interactive
references. Every RiX frame below keeps an exact state and stable identities.
Path, construction, and formula tracks retain semantic intent independently of
the pixels; `.Timeline.Manifest(timeline)` materializes their active value and
source keyframe for every frame.

## 1. Move one semantic point along an exact path

```rix out
MoveFrame(x,origin) -> .Graphics.Graphic([420,160],[
  .Graphics.Path([[30,80],[390,80]],{= stroke="#cbd5e1",width=2,hitId="axis" }),
  .Graphics.Circle([210+60*x,80],10,{= fill="#7c3aed",hitId="moving-point" }),
  .Graphics.Text([20,25],@"exact x = @{x}",{= size=14,hitId="state-label" })
]);
.Timeline.Sequence({=
  title="Exact point motion",frameDurations=[1/3,1/3,1/3,1/3,1/3],
  tracks=[
    .Timeline.Track({=
      id="captions",kind="caption",
      keyframes=[{= frame=1,value="begin at negative two"},{= frame=3,value="cross the origin"},{= frame=5,value="finish at positive two"}]
    }),
    .Timeline.Track({=
      id="moving-point-path",kind="path",target="moving-point",interpolation="linear",
      keyframes=[{= frame=1,value=[-2,0]},{= frame=3,value=[0,0]},{= frame=5,value=[2,0]}]
    })
  ],
  transition={= mode=:crossfade,duration=1/6,properties=[:opacity,:position] },
  entries=[{: MoveFrame,[-2,-1,0,1,2]}]
});
```

## 2. Let a secant approach a tangent

The exact state is the secant separation `h`; a future semantic transform can
match the line and two marked points while narrating the limiting relation.

```rix out
.Plugin.Load("plot");
SecantFrame(h,origin) -> .plot.Polynomial([1,0,0],[-1,3],{=
  title=@"secant separation h = @{h}",label="y = x squared",
  series=[{= coefficients=[2+h,-1-h],label="secant",stroke="#d97706" }],
  marks=[{= point=[1,1],label="fixed point" },{= point=[1+h,(1+h)^2],label="approaching point" }]
});
.Timeline.Sequence({=
  title="Secant to tangent",duration=3,
  markers=[{= frame=1,label="wide secant" },{= frame=5,label="near tangent" }],
  entries=[{: SecantFrame,[2,1,1/2,1/4,1/8]}]
});
```

## 3. Reveal a construction step by step

```rix out
.Plugin.Load("geometry");
ConstructionFrame(step,origin) -> {;
  a:=.geometry.Point(0,0); b:=.geometry.Point(6,0); c:=.geometry.Point(2,4);
  base:=.geometry.Line(a,b); bisector:=.geometry.PerpendicularBisector(a,b);
  circle:=.geometry.Circumcircle(a,b,c);
  objects := step==1 ?: [a,b,c]
    ?_ step==2 ?: [a,b,c,base]
    ?_ step==3 ?: [a,b,c,base,bisector]
    ?_ [a,b,c,base,bisector,circle];
  .geometry.Draw(objects,{= view=[-1,-2,7,6],size=[620,460] })
};
.Timeline.Sequence({=
  title="Circumcircle construction",frameDurations=[1/2,1/2,1/2,1],
  markers=[{= frame=1,label="points" },{= frame=4,label="circumcircle" }],
  tracks=[.Timeline.Track({=
    id="construction-steps",kind="construction",
    keyframes=[
      {= frame=1,value={= step="place three points"} },
      {= frame=2,value={= step="draw the base"} },
      {= frame=3,value={= step="construct the perpendicular bisector"} },
      {= frame=4,value={= step="construct the circumcircle"} }
    ]
  })],
  entries=[{: ConstructionFrame,[1,2,3,4]}]
});
```

## 4. Match style changes without changing mathematical identity

```rix out
StyleFrame(state,origin) -> .Graphics.Graphic([360,220],[
  .Graphics.Circle([180,110],state[:radius],{=
    fill=state[:fill],stroke="#1e293b",width=3,opacity=state[:opacity],hitId="semantic-circle"
  }),
  .Graphics.Text([180,25],state[:label],{= anchor=:middle,size=15,hitId="semantic-label" })
]);
states := [
  {= radius=25,fill="#bfdbfe",opacity=1/2,label="small" },
  {= radius=55,fill="#ddd6fe",opacity=3/4,label="medium" },
  {= radius=85,fill="#fecdd3",opacity=1,label="large" }
];
.Timeline.Sequence({=
  title="Declared-safe presentation transform",duration=2,
  tracks=[.Timeline.Track({=
    id="formula",kind="formula",target="semantic-label",
    keyframes=[{= frame=1,value="r = 25"},{= frame=2,value="r = 55"},{= frame=3,value="r = 85"}]
  })],
  transition={= mode=:crossfade,duration=1/4,properties=[:opacity,:fill,:stroke,:position] },
  entries=[{: StyleFrame,states}]
});
```

## 5. Animate an exact orbit-camera track

Each frame is a deterministic Scene3D snapshot. The typed camera track also
retains its exact key cameras independently, so a capable host can avoid
materializing redundant presentation state.

```rix out
.Plugin.Load("scene3d");
mesh := .scene3d.Mesh(
  [[-1,-1,0],[1,-1,0],[0,1,0],[0,0,2]],
  [[1,2,3],[1,2,4],[2,3,4],[3,1,4]],
  {= id="tetrahedron",color="#2563eb" }
);
OrbitFrame(turn,origin) -> {;
  scene:=.scene3d.Scene([mesh],{=
    camera=.scene3d.OrbitCamera([0,0,1/2],{= radius=5,height=2,turn=turn })
  });
  .scene3d.Snapshot(scene,{= size=[520,360],mode="lit" })[:value]
};
.Timeline.Sequence({=
  title="Exact Cayley camera orbit",duration=3,
  tracks=[.Timeline.Track({=
    id="orbit-camera",kind="camera",interpolation="linear",
    keyframes=[
      {= frame=1,value=.scene3d.OrbitCamera([0,0,1/2],{= radius=5,height=2,turn=-1 }) },
      {= frame=3,value=.scene3d.OrbitCamera([0,0,1/2],{= radius=5,height=2,turn=0 }) },
      {= frame=5,value=.scene3d.OrbitCamera([0,0,1/2],{= radius=5,height=2,turn=1 }) }
    ]
  })],
  entries=[{: OrbitFrame,[-1,-1/2,0,1/2,1]}]
});
```
