# src/editor/instruments — one file per visual instrument

Each instrument is a `Foo.tsx` def file (`ObjectInstrumentDef` - the schema) plus, for anything but a trivial visual, a sibling `FooVisual.tsx` holding its R3F component. `index.ts` is the registry.

## The def is metadata; the visual is a lazy chunk

`index.ts` imports every def eagerly (resolve, the stores, the picker and the tests all read def metadata synchronously), so whatever a def file imports rides in the editor's initial bundle. The R3F component - the bulk of an instrument, its GLSL, and any instrument-only library - therefore lives in `FooVisual.tsx`, and the def wires it with

```ts
component: lazyInstrument(() => import('./FooVisual').then((m) => m.FooVisual)),
```

(`lazyInstrument.ts`; same for `instancedComponent`). A project downloads only the instruments it uses. Rules that keep it working:

- **The def file never imports the view file statically** - only through that `import()`. The view file MAY import from the def file (PARAMS, exported consts, pure helpers); that direction is fine.
- **Everything other code imports from an instrument stays in the def file** (`resolveActiveX`, exported GLSL, `PALETTES`, row tables) - grep for `instruments/Foo'` before moving anything.
- Render sites wrap the component in `<Suspense fallback={<InstrumentPending />}>` per object (ObjectRenderer, InstancedObjectRenderer). `lazyInstrument` renders synchronously once the chunk is in memory - it does NOT suspend on first render the way `React.lazy` does - so a preloaded instrument mounts exactly like an inline one. Preloads: `preloadProjectInstruments` runs on every ProjectStore change (VisualBeatSync), library cards preload on hover, `InstrumentPreviewCapture` before capturing.
- **Export gates on it**: `runExport` awaits `whenInstrumentsSettled()` (no fetch in flight, no `InstrumentPending` mounted) before frame 0, because a suspended object is an empty object in the capture. Keep `InstrumentPending` as the fallback at any new scene render site.
- Trivial visuals (the scene post-process instruments that render `null`, the two camera rigs) keep `component:` inline - there is nothing to defer. Circle and Triangle share the lazy `BasicShapeVisual.tsx`.
- Tests importing a def file get a `lazyInstrument` reference; nothing calls it under node, and the `import()` never runs at module load.

## PURITY IS LAW (lint-enforced in this directory)

No `useFrame`, `performance.now`, `Date.now`, `Math.random`, clock/delta. Per-frame work goes through `useInstrumentFrame(trackId, cb)` (`core/visual/instrumentFrame.ts`) — cb sees `state.beat`, `state.secPerBeat`, params, energy, notes, canvas size, camera pose, and nothing wall-clock. Randomness via `seededRand(seed)`. **Return `false` from the cb if refs/canvas aren't ready yet** — a silent bail leaves the object stale until the next input change (which may never come while paused).

## Adding an instrument — the checklist

1. New def file exporting the def: `id`, `name`, `kind: 'object'`, `params: ParamDef[]`, `userInterfaceRenderer`, `component` (a `lazyInstrument(() => import('./FooVisual').then((m) => m.FooVisual))` pointing at the sibling `FooVisual.tsx` that holds the R3F component - see above), plus optional `localTransform`, `abilities`, `midiRows`, `fullFrame`, `defaultOnTop`.
2. Register in `index.ts` (`INSTRUMENTS` map).
3. **Add a picker entry in `components/LeftSidebar.tsx` `ALL_OBJECT_INSTRUMENTS`** — the add-track menu is curated and does NOT read the registry; without this the instrument is registered but unreachable.
3b. **Add a track-row mark in `components/timeline/trackGlyphs.tsx`** — a monotone 16px glyph in `currentColor` (the row tints it with the track's color). Separate from the card icon above, which is full-color and can't be tinted. Missing one is not a crash: the row falls back to an anonymous dashed circle.
4. Settings UI, cheapest first: a **`panelSpec`** on the def (a declarative console — accent, knob rows, optional preview component; no registration at all, see `userInterfaceRenderers/console/spec.tsx`, Laser Line is the reference), or `'parameters'` (generic list), or a bespoke renderer — new id in `userInterfaceRenderers/ids.ts` + component + entry in its `index.ts` (see that dir's CLAUDE.md).
5. Preview clip (library hover): `npm run previews:instruments`.

## Testing an instrument: put the pure math in a `*Core.ts`

A colocated test that imports the `.tsx` **crashes with "Cannot access X before
initialization"**: the component imports `core/visual/instrumentFrame`, which
reaches `VisualEngine` and back around to `instruments/index.ts`, which imports
the component again. Only instruments whose file pulls in nothing but types
(BassRipple) can be tested directly. Everything else splits the pure half into a
sibling module with type-only imports — `laserSphereCore.ts`, `waterDropCore.ts`
— and the test imports that. Name the test after the core file, not the
instrument, so the pairing is obvious. (Since the visual moved to `FooVisual.tsx`
a DEF file usually imports nothing but types and `lazyInstrument`, so importing
a def in a test is fine again - it is the VIEW file that still closes the cycle;
never import a `*Visual.tsx` from a test.)

## GPU Stars: immutable seeds, bounded coordinates, explicit picking

`StarsVisual.tsx` resolves note history once per frame; `starsGpu.ts` computes
per-star motion, size, linear-space HSL and alpha in the vertex shader. Keep the
order **wrap → pulse → roll → tumble → wrap**. The default count remains 1,500.

- Long accumulated displacement loses precision in GLSL float32. `updateStarsMotion`
  rebases the position attribute at deterministic 32-unit displacement boundaries,
  always from the immutable seed layout. Ordinary frames update only uniforms;
  rebases/layout changes upload positions. Never integrate a previous GPU frame:
  backward seeks, shifted copies and export must agree with direct seeks.
- `Points.raycast` cannot see vertex displacement. Stars reconstructs positions in
  a separate CPU-only geometry **on picking**, preserves the visible Points as the
  hit object, and bounds the whole wrapped volume for culling. Do not upload the
  picking geometry or put that loop back into playback.
- The fragment shader needs `uOpacity` AND `FORCE_TRANSPARENT_KEY` to preserve the
  placement wrapper's fades and soft dots at full opacity.
- `scripts/perf/stars-gpu.mjs` compiles the production GLSL and compares it with a
  frozen independent legacy CPU fixture. It separates CPU update, draw submission
  and GPU timing. `scripts/perf/stars-gpu-app.mjs` exercises the real editor; see
  `docs/stars-gpu.md` for commands and measurement limits.

## Per-instance opacity on an InstancedMesh

`instanceColor` / `vertexColors` carry RGB only — there is no built-in per-instance
alpha, so one InstancedMesh cannot fade its instances independently (the usual
reason: N note-spawned things of different ages sharing one mesh). **Encode the
fade into the instance colour and blend additively** — ParticleBurst and WaterDrop
both do this. Dimming is fading under additive blending; under normal blending it
would darken toward black instead, so this choice picks the blend mode too.

### Do not reach for `onBeforeCompile`

Patching three's own GLSL to add a per-instance alpha attribute *looks* like the
cleaner answer and cost most of a session. Every failure mode is silent — no
console error, just a plain opaque quad:

- `uv` is **not declared** in the shader unless the material carries a map, so
  `vUv = uv;` fails to compile and the whole patch is dropped. (`position` and
  `normalMatrix` *are* always in the prefix.)
- GLSL `smoothstep(edge0, edge1, x)` is **undefined when edge0 > edge1** and
  returns 1.0 here, so an inverted ramp silently becomes a no-op. Write it
  increasing and subtract from 1.
- MeshBasicMaterial's vertex shader computes no normal varying at all.

A soft round bead is far more robustly had from a baked `CanvasTexture` radial
gradient on a camera-facing quad (`dummy.quaternion.copy(camera.quaternion)`,
camera via `useThree`). It also beats a tessellated sphere on looks: a sphere's
polygon silhouette makes clusters read as marbles, a soft disc has no silhouette
and neighbours merge.

## An always-transparent material must declare FORCE_TRANSPARENT_KEY

The placement wrapper's `applyMaterialOpacity` (core/visual/animatedOpacity.ts)
runs every frame and RESETS `material.transparent` to `opacity < 0.999` — so
`<shaderMaterial transparent>` silently goes opaque whenever the track is at
full fade, and the shader's alpha channel stops blending entirely. On a small
mesh that's a subtle artifact; on a FULL-FRAME plane the opaque quad replaces
every pixel of the frame, so the whole scene behind it (background included)
reads solid black — which looks exactly like a compositing bug and is the
symptom the components guide describes as "a full-frame instrument in the
front pass hides the whole scene". The fix is one prop:
`userData={{ [FORCE_TRANSPARENT_KEY]: true }}` on the material (TextDisplay,
Scribble, FilmCard, PhotoSlot, PolyFx, FlashWall, MidiRoll all carry it). Any
instrument whose material must keep blending at full opacity needs it.

A second, sneakier symptom of the same bug (found on MidiRoll 2026-08-12): the
opaque quad renders each texel's **unpremultiplied rgb at full brightness with
alpha ignored**, so a canvas texture's near-zero-alpha pixels - soft glow
falloff especially - show their premultiply-rounding garbage as BRIGHT
posterized cyan/magenta rings with hard edges. Looks exactly like a broken
bloom shader; over a black scene with black transparent pixels it is invisible,
which is why an instrument can carry the bug for weeks until it first draws
low-alpha color.

## Keep runtime fallbacks and schema defaults in ONE place

`state.params` only carries what the TRACK stored, so `par.x ?? 0.3` runs whenever
a track predates a param. Repeating the number there means the instrument renders
at settings the panel isn't showing — and re-tuning the schema silently changes
nothing. Read the schema instead: `par[key] ?? paramDefault(theInstrument, key)`.

## Def semantics worth knowing (full contracts in `types.ts`)

- Numeric params → `track.params`; `color`/`string` params → `track.stringParams`. **Only plain numeric params are automatable.** `showIf` gates visibility (`'key'` = on when ≥0.5, `'key=2'` pins a select value); hiding is presentation only. `curve: 2` makes a slider quadratic for orders-of-magnitude ranges.
- `localTransform(ctx)` — position/rotation compose down the hierarchy (movers and children see them); **scale is a mesh property**, applied before movers/children, so layouts stay in unscaled units. The canonical `tf*` track transform (`core/transform.ts`) composes as this transform's PARENT — instruments neither declare nor read `tf*`.
- `midiRows` — declare a short, fully-labelled row vocabulary ("Warp forward", "Next word"); the editor shows only these rows in order (first = top). Omit for the full piano roll. See `docs/instrument-note-semantics.md`.
- `abilities` — bespoke MIDI lanes (e.g. Cube's Shatter) rendered as nested sub-rows, expressed inside your component; not attachable to other instruments.
- `seatsWords` — this instrument lays out WORDS, so it accepts `wordFormation` child lanes (`core/visual/wordFormation.ts`). The add-child menu reads the flag rather than naming instrument ids, so a second text instrument opts in with one line. The layout is **presence-driven**, not a Layout mode: a lane that has played a note wins over Center/Scatter/Stack, and before its first note the ordinary layout still runs — so adding a lane is never destructive and an empty one is inert.
- `fullFrame` — screen-filling plane; renderer skips placement + transform/clone chain. `defaultOnTop` — depth-ignored overlay by default (Text).
- **Never read those two flags directly** — go through `isFullFrameTrack(def, params)` / `isOnTopTrack(def, params, track.onTop)` in `types.ts`. Full-frame can also be a per-track MODE via `fullFrameParam: 'someParam'` (Oscilloscope's "Fit to screen"): the track is full-frame while that param is ≥ 0.5, and the on-top pass follows the SAME param, because a screen-pinned overlay that also depth-sorted against scenery would be neither one thing nor the other. ObjectRenderer and VisualScene both resolve through those helpers so they cannot disagree about which pass an object belongs to. Switching an instrument from fixed `fullFrame` to a mode needs a persistence upgrade step that writes the param on existing tracks (see UPGRADES[10]) — otherwise every saved project silently changes look.
- VisualCopy color shifts arrive via `applyColorShiftToInstrumentParams` / `InstrumentCopyContext` — declare color params properly and this is automatic.
- `identityColor` — what the track WEARS in the timeline/piano-roll UI (`utils/trackDisplayColor.ts` resolves; OKLCH recipes re-voice it). Movers/splitters/colorizers have their own counterpart - a required `identityColor` on the definition, from `core/visualCopies/identityColors.ts` - and since 2026-07-31 child lanes no longer inherit their instrument's colour at all. A hex literal = fixed identity; `{ param: 'key' }` = follow that color param's current value. Omit it and an instrument with exactly ONE color param follows it automatically; near-achromatic values (white/black text or bg defaults) fall back to the track's hue-cycle color, so a white-defaulting param is safe to point at. Instruments with multiple color params (or an unrepresentative sole one, e.g. a background) must declare explicitly.

Shared helpers: `shapes.tsx`, `basicShapeCore.ts` and `BasicShapeVisual.tsx` (Circle/Triangle definitions, pulse/color behavior and shared visual), `laserSphereCore.ts`, `particleWordCloud.ts`, `FundamentalGeometry.tsx` (the solid vocabulary — `FundamentalMesh` for the stock material, `FundamentalGeometryShape` when you bring your own; the id list is APPEND-ONLY because tracks store the id string, and `fundamentalGeometry.test.ts` pins the order. Its surface toggles — reflective/refractive/lit/textured — resolve through the pure `fundamentalMaterialSettings` and land via `applyFundamentalSurface`, shared by Cube and its panel preview so they can't drift; flag flips set `needsUpdate` only when a shader feature actually toggles).

## A param that shapes GEOMETRY is built in the frame callback, not declared

**One mounted mesh, not one per option.** Cube used to mount all twelve
fundamental solids and toggle `visible` — twelve materials and eleven dead
scene-graph nodes *per copy* once a splitter multiplies the track. It now mounts
ONE `FundamentalMesh` with no declarative geometry and swaps
`mesh.geometry = buildFundamentalGeometry(id, tube, sides)` whenever the id or
its shaping param moves (cached against the last build; dispose the old one, and
the survivor in a `useEffect` cleanup). `buildFundamentalGeometry` must stay in
step with the JSX `Geometry` switch — same constructors, same args — or the two
render paths tessellate differently.

Cube's TUBE (torus family) and SIDES (prism/cone) change constructor args, and the
component never re-renders on a param edit — `state.params` only reaches the frame
callback. Declaring `<torusGeometry args={...}>` from a param therefore renders the
default forever. The pattern (Cube is the reference): mount the mesh with NO
declarative geometry (`FundamentalMesh` allows omitting `geometry`), and in the
callback compare the param against a cached last-built value, swap
`mesh.geometry` via the shared `build*Geometry` helper only when it moved, dispose
the old one, and dispose the survivors in a `useEffect` cleanup — the imperative
geometry is invisible to r3f's auto-dispose. Don't subscribe to ProjectStore for
this: `s.tracks` only carries the ACTIVE scene, so a previewed-but-inactive scene
would silently render defaults. The camera is an instrument too (`CameraControl`, `CameraOrbit`); full-frame filter instruments: `ColorFilters`, `FilmStock`. Media instruments (`Video`, `Photo`, `PhotoSlot`) delegate time models to `core/video|photo`.

## The Light instrument: scene lights are tracks now

`Light.tsx` / `LightVisual.tsx` (2026-08-29): a scene light as an ordinary object
track - position rides `tf*` (so automation lanes, movers, splitters and groups
all move lights with zero bespoke machinery; a ring splitter mints a ring of
lamps), knobs automate like any params, and `flash` lifts intensity with note
energy. Five TYPE values (point / spot / directional / ambient / area),
**append-only** - they are saved in `track.params`. Facts you cannot see from
the def file:

- **The mounted component holds NO THREE light.** It renders an anchor group
  (plus the optional glowing bulb) and registers `{anchor, desc}` in
  `core/visual/sceneLights.ts`; each render pass (VisualScene's base/front/
  invert per scene, plus every ShaderWrapper offscreen rig) owns a
  `PassLightPool` that mirrors the registry into its own scene per frame. That
  is how one light reaches every pass - the same reason the old hardcoded rig
  was replicated per portal. Fades and mutes reach the light via `desc.on` /
  `desc.intensity`, both written in the frame callback.
- **Every visual scene is SEEDED with a "Lighting" group** wearing the old
  hardcoded rig's exact values (`core/defaultLighting.ts`; persistence
  UPGRADES[17] for old saves; `emptyDocument()` and both scene-creation paths
  for new ones). A scene with NO light tracks still gets the legacy baked
  `lights()` rig in VisualScene - the fallback that keeps hand-built fixtures
  and unseeded documents rendering. Deleting all light tracks therefore
  restores the stock look rather than going black; muting them goes dark.
- **`SceneIdContext`** (`core/visual/sceneContext.ts`, provided by
  ObjectRenderer and InstancedObjectRenderer) is how an instrument learns its
  scene. The Light registers with it; the 3D Shape's Matte finish reads it to
  follow the scene's key light: `posterLightDir(sceneId)` hands back a shared
  per-scene Vector3 that `refreshPosterLightDir` re-aims each frame at the
  first live DIRECTIONAL light track, so poster materials point their
  `uLightDir` uniform at it BY REFERENCE and a moving light re-shades paused
  matte solids without their callbacks re-running. Null context (panels,
  previews) = the frozen historical direction.
- **Shadows stay gated on the scene having a `castsShadows` instrument**
  (VisualScene's `shadowScenes`, passed to `PassLightPool.sync` as
  `allowShadows`) - a directional/spot light's `castShadow` param only takes
  effect then, same economy as the old rig.
- `showIf` grew an OR form for this def: `'type=0|1'` (TrackEditor's
  `showIfSatisfied`).

## Camera instruments own the camera, and only one can

The Canvas ships a plain default camera at `[0, 0, 5]`, fov 55, and there are no
OrbitControls — nothing else writes it per frame. A camera instrument is
therefore the sole author while its track is active, and two camera tracks at
once fight, last-mounted winning. Accepted trade, not a bug to guard against.

Two of them exist because they parameterise the rig differently, and the
parameterisation IS the feature:

- **`CameraControl`** ("Camera") — a position and a rotation, plus an optional
  "look at origin" mode. Free, but aim is something the user maintains.
- **`CameraOrbit`** ("Camera Orbit") — a center, an axis to circle, and a ring;
  position *and* aim are DERIVED from those every frame, so losing the subject is
  not expressible. Notes are hold-to-orbit (travel while held, stay where
  released, chord two rows for a diagonal, hold Return home to ease back), summed
  closed-form over the note history in `cameraOrbitCore.ts` — never accumulated
  per frame, or scrub would disagree with playback.

  **The size knobs are cylindrical, not spherical, and that IS the feature.**
  STANDOFF (how far off the plane, along the axis) and RADIUS (how wide a circle)
  replace a distance/height pair, because standoff is the number a shot holds
  still for a whole lap and a spherical pair hides it. Distance is derived
  (`orbitDistance`), and so is the angle off the ring (`restingElevation`) — so
  the resting pose is described in exactly one place.

  **`ORBIT_AXES` is an ordered, index-saved list** (a track stores the index):
  append, never resequence. Each preset is an axis plus a `reference` direction,
  and `right` is derived by cross product — never write it by hand. The whole
  pose is the canonical pose (pole +Y, angle 0 at +Z) carried into the preset's
  frame, which is what makes sweeping the angle a RIGID rotation about the chosen
  axis: the component along the axis is untouched, so the standoff holds for the
  lap and the travel stays parallel to the plane while the frame rolls. Turntable
  IS the canonical frame, so it must stay byte-identical to the plain spherical
  formula — there is a test pinning exactly that, and it is the regression guard
  for anything done to this code.

  One non-obvious constraint on adding a preset: the frame's up at the pole comes
  out as the NEGATIVE of `reference`, so a preset meant to be used pole-on
  (Face-on, Side, where radius 0 is the money pose) must reference `-Y` to come
  out upright there. Getting this backwards ships an upside-down default.

  **Neither angle is clamped or wrapped, and that is only safe because the rig
  carries its OWN up vector** (`orbitCameraUp`, the elevation tangent) instead of
  borrowing world +Y. With a fixed +Y, ±90° elevation is a singularity: the camera
  sits on its own up axis, `lookAt` has no roll left to choose, and the frame
  snaps around — so the first version parked a degree short of the pole and the
  vertical orbit could not lap. The tangent is perpendicular to the view
  direction by construction, so there is no pole to avoid and crossing overhead
  ROLLS through, coming out the far side upside down. Verify a change here by
  sampling the per-frame quaternion delta across a full vertical lap: it must stay
  at `speed × step` the whole way (a flip shows up as one ~180° spike).

  Consequence for `CameraControl`: it re-asserts `camera.up` to +Y before its own
  `lookAt`, or swapping between the two rigs inherits Camera Orbit's roll.

**Writing the camera is safe against the `useInstrumentFrame` skip.** The camera
pose is part of the per-frame signature, so writing it dirties the next frame's
comparison — but because the write is a pure function of the beat, that frame
computes the same pose and the signature settles. One extra callback, not a loop.

## Scene post-process instruments (ColorFilters, BassRipple, ImpactWarp, Strobe, Crop)

These four render `null` and post-process their scene's render target instead. The pattern: export a pure `resolveActiveX(state)` that reads `activeNotes`/`notes`/`params`/`opacity`/`beat` and returns either the pass's uniforms or `null` for "don't run a pass at all"; `components/visual/VisualScene.tsx` collects the tracks per scene (`postProcessTracksByScene`) and runs the passes. Adding one is: the resolve + the exported GLSL in the instrument file, then a `ShaderMaterial` + a loop + a `dispose()` in VisualScene's compositor. Things you cannot see from one file:

- **Pass order is deliberate**: ripple (BassRipple) → impact (ImpactWarp) → colour (ColorFilters) → Strobe. Both positional passes precede colour, because the grade's own gradients shouldn't be dragged around; Impact after the ripple because a punch is the outermost gesture (a rumbling scene gets punched as one image, rather than the punch being fed into the rumble); Strobe last, because it flashes over the finished look rather than being one more colour in it.
- **Held vs triggered is the axis that separates two warps.** BassRipple reads `activeNotes` and bends for as long as a note lasts; ImpactWarp reads note ONSETS out of the full stream and ignores duration entirely, summing an envelope per hit so a roll compounds. That is also what sorts them into the library's Rumble vs Impulse shelves. A percussive pass wants an instantaneous attack (full displacement on the frame of the onset, no ramp) and a *signed* envelope, so the rebound past zero is free.
- **Displacement offsets are SAMPLING offsets** — the image moves opposite to them. Write each branch so a positive amount moves the picture the way its name says, and say so at the function (`impactWarpOffset` does). Sampling outside the frame is unavoidable once you translate or zoom out, and clamping smears the edge row into a bar of streaks that reads as a rendering fault: mirror instead (`impactWarpWrap`).
- **A channel split is what makes a hit read as a hit**, and it needs no knob: take it as a fixed fraction of whatever displacement the field already asked for and it is exactly as violent as the strike and gone at rest. **Cap it in absolute uv** (`impactWarpSplit`) — past a couple of screen pixels the three channels land on three different objects and anything fine-grained (a dot field, small text) turns to rainbow confetti instead of getting a hot fringe.
- **A style enum may need its own envelope, not just its own shape.** ImpactWarp's Shockwave is amplitude `(1 - phase)` and does not compound, while the other three styles share the rebounding sum — because a wavefront *passing through* the frame weakens as it spreads and gets replaced by the next hit, where a deformed frame springs back. Sharing the deformation envelope killed the ring at a third of its travel, so it was never once seen crossing the frame.
- **`COLOR_FILTER_FRAGMENT`'s `mode` numbering is shared and partitioned**: ColorFilters owns modes **1–9** (one per MIDI row), Strobe owns **10 (blackout)** and **11 (flash)** and reuses 1 for invert. Adding a mode means appending, never renumbering. Strobe's `style` param is its OWN 0/1/2 enum mapped through `STROBE_STYLE_MODES` precisely so a shader renumber can't repaint saved projects — keep new styles on that side of the boundary. BassRipple's `pattern` select (0 noise · 1 twist · 2 waves · 3 weave · 4 bloom, branched inside `bassRippleOffset`) follows the same append-only rule; its FREQUENCY param multiplies the polar patterns' angular symmetry (Twist arms, Bloom petals), rounded to whole harmonics or the atan branch cut tears a seam, and every field keeps full INTENSITY in the same ~0.1–0.2 frame-fraction band so switching patterns never jumps the warp's violence.
- **These act on ONE scene before compositing** — so a filtered scene still slots into a Crop mask or Cut partition normally. Crop is the fifth pass (after Strobe — a matte over the finished look) and the one DUAL-surfaced id: on Main the composition def in `core/directors` composes its bound scene; in a visual scene this registry's def masks the scene it lives in — or, with `targets` routing set (the mover targets picker), masks exactly those instruments via a pass in each target's ShaderWrapper chain (`maskSourceIds` on ObjectListEntry; routed per-resolve in resolve.ts beside the global-mover pass).
- **Rate can be the MIDI vocabulary.** Strobe puts its rates on labelled rows instead of a knob, so speed is *played* (the eighths→sixty-fourths build is the gesture) and the panel keeps only real settings. Its phase comes from the ABSOLUTE beat, not the note start, so several strobes stay locked to each other and off-grid notes still flash on the grid. Past ~1/32 the flash outruns a 60fps frame and reads as a shimmer whose texture depends on frame rate — that is the honest ceiling, not a bug to fix.
- **A row's PITCH is the saved value, so shipped pitches are frozen.** Strobe's straight rows own 68–72 (1/4 … 1/64) and cannot be renumbered: a project stores the pitch, so remapping would silently re-time every existing strobe. Later families were appended *below* that block — triplets at 67–65, frame rows at 64–61 — which keeps pitch monotonically descending down the row list. Extending a row vocabulary means appending new pitches at one end, never resequencing for a tidier order: the same append-only discipline as the shader modes above. A colocated test pins the frozen five.
- **Wall-clock rates must still be derived FROM the beat.** Strobe's `f` rows are a fixed Hz on a *nominal* 60fps grid (`STROBE_REFERENCE_FPS`), resolved by `strobeCycleBeats(row, secPerBeat)` — seconds = beat × secPerBeat, so they stay a pure function of the playhead. Reading a real frame counter or `performance.now` would be the obvious implementation and would break everything the one rule buys: a paused frame would keep flickering, scrub would not match playback, and a 30 or 120fps export would run at the wrong speed. The cost of doing it properly is that it assumes a constant tempo (fine — one BPM per project; a tempo map would need integrating instead). `strobeGate` is deliberately unit-agnostic (`position / cycleLength`) so the runtime can pass beats and the panel preview seconds without a second copy of the phase logic.

## Screen-space set operations between copies (OverlapShape's stencil recipe)

`OverlapShape.tsx` renders XOR/parity between coplanar copies with a five-pass
stencil stack (spec + essay in `overlapShapeCore.ts`, pinned by its test). Facts
that cost time to establish, for the next instrument that wants set operations:

- **Parity and COUNTING are two different recipes, and the instrument ships both**
  (ORDERS, 2026-08-21). Parity inverts one bit; per-depth colours need the actual
  coverage depth, so that recipe INCREMENTS a nibble instead and each fill tests
  `lequal` (GL puts the ref on the LEFT, so `ref <= stencil` is "covered at least this
  deep") and ZEROES the tally as it paints — that zero is what makes one pixel take
  exactly one fill, replacing parity's DONE/BASE bits. Fills run **deepest first**, which
  is the whole implementation of "depth past the last colour holds it": the first
  threshold met owns the pixel. Three consequences worth knowing before touching it:
  **the counted recipe needs no depth-clear pass** (it only runs in colour mode, where
  the depth-1 fill catches everything the deeper ones missed, so there is no
  owned-but-unpainted region — firing the clear there would punch a hole in painted
  depth); **the parity flags moved to the HIGH nibble** so a counted track's tally can
  own the low one, and two tracks running different recipes can cross without reading
  each other's writes as their own (only which fill lands last is then unpredictable);
  and **a count cannot be shifted into spare bits the way a flag can**, because the
  increment carries — that asymmetry is why the flags moved rather than the tally.
- **The depth colours resolve through ONE function** (`overlapShapeDepthColors`), read by
  the fills, the panel's ramp strip and its preview alike — a panel that built its own
  copy of the ramp could promise a colour the stage never paints. The primary mode is a
  GRADIENT: two ends, and `gradientStops` (moved to `utils/oklch.ts` for this, re-exported
  from `gradientColorizer` for its own consumers — importing the definition would drag
  `three` into the instrument's eager bundle) fills the depths between them in OKLCH with
  both endpoints literal. Picking a colour per depth is the second mode. **The ramp spans
  the OVERLAP depths only, never starting at the shape's own colour** — running it from
  the base makes two crossing shapes nearly the colour of one, which is the single thing
  an overlap colour exists to avoid.
- **A pass list that varies with a param is still a MESH list, so mount the union and
  toggle `visible`.** Deriving the passes from ORDERS would mean re-rendering React from
  a param (invariant 4); both recipes hang off one list and `overlapShapePassActive`
  picks per frame. The same switch expresses the two gates inside a recipe — cut-out
  withholding the overlap fill, and a fill deeper than the last colour standing down —
  so "which depths have colours" needs no separate mechanism at all. The instanced path
  resolves the active set ONCE per frame and loops only those meshes, so the idle recipe
  costs nothing per copy.

- **Multi-pass = multiple sibling meshes with consecutive `renderOrder`s**, one
  material each. Because renderOrder interleaves ACROSS objects, the passes
  compose over every occurrence of every track of the instrument — which is
  exactly what makes splitter/mover copies interact. Keep all passes in the
  same render list: leave `transparent` alone and applyMaterialOpacity flips
  the whole stack between lists together on fades, preserving pass order.
- **"Same plane only" is `depthFunc: EqualDepth` against a depth prepass** — a
  colorWrite-false mesh at the first renderOrder. Coplanar surfaces interpolate
  identical depth per pixel, different depths fail Equal and just occlude.
- **Stencil needs a stencil buffer on whatever target the meshes rasterize
  into** — WebGLRenderTarget defaults to `stencilBuffer: false`, and a missing
  buffer FAILS OPEN (every stencil test passes, writes ignored). VisualScene's
  per-scene `target` and ShaderWrapper's `src` now carry one; a new offscreen
  path that renders instrument geometry must too. Order passes so the
  fail-open degrade is sane (OverlapShape draws its overlap fill BEFORE its
  base fill so a stencil-less context shows a plain silhouette).
- The scene loop's `gl.clear(true, true, true)` clears stencil each frame, but
  leave the buffer zeroed behind you anyway (a final Always/Zero cleanup pass)
  so the front pass and other tracks start clean.
- **An even copy count stacked in place is INVISIBLE by design** under parity
  (6 identical copies = even coverage everywhere = full cutout). It looks
  exactly like the instrument not rendering; check the copy transforms before
  suspecting the passes.

## Generated surfaces (a texture that travels with the mesh)

`KaleidoSolid.tsx` is the reference for "the mesh's surface IS the visual". The recipe and its traps:

- **Generate in OBJECT space, not UV space.** A cube's UV seams tear a continuous pattern into six unrelated tiles; object space has no seams, so one field works for the whole `FundamentalGeometry` vocabulary. Pass `position` through from the vertex shader (inject at `#include <begin_vertex>`, the last point where it is still in the solid's own space). Object space is also what makes the pattern *ride along* — it turns and travels with the mesh instead of sliding across it, which a screen-space effect pass cannot do.
- **Inject into a lit material, don't replace it.** `material.onBeforeCompile` on a `MeshPhysicalMaterial`, replacing `vec4 diffuseColor = vec4( diffuse, opacity );` — the scene's real lights, clearcoat and shadows still model the form. Tint `totalEmissiveRadiance` by the same colour so the glow follows the pattern (the `emissive` uniform already carries `emissiveIntensity`). A raw `ShaderMaterial` would mean hand-rolling all lighting.
- **Uniforms**: hold `{value}` objects in a ref and `Object.assign(shader.uniforms, ...)` inside `onBeforeCompile`; mutate `.value` from `useInstrumentFrame`. Never per-frame React state (invariant 4 in the root guide). Share ONE material across the geometry variants so switching shape cannot switch appearance, and dispose it on unmount.
- **On a sphere-mapped field, fold in the surface metric.** A wedge's arc length at polar angle `phi` scales as `sin(phi)`, so ignoring it crowds cells into a smear at the poles. Same reason cells-per-ring must grow with radius: a fixed count per ring thins out to confetti as the ring grows.
- **Export the GLSL** (`KALEIDO_FIELD_GLSL`) so the settings panel's preview runs the very same field — see `userInterfaceRenderers/CLAUDE.md` for that preview harness and its StrictMode trap.

Note-driven state must stay a **pure function of the note stream and the beat** — `barrelTwist()` sums an eased contribution from every note already played rather than accumulating across frames. Per-frame accumulation would make scrubbing disagree with playback and break export. Same reason a per-hit *choice* (which way ImpactWarp's Slam shoves) is indexed off the note's position in the stream rather than stored: `impactShoveDirection(index)` walks the golden angle, so consecutive hits are 137.5° apart and a roll never repeats a direction — which a hash of the note would, and two identical shoves in a row read as the effect having failed to retrigger.

Colocated `*.test.ts` here ARE run by `npm run test:visual` — the glob was widened when `KaleidoSolid.test.ts` landed, which also picked up two earlier instrument tests that had been sitting unrun. All green as of 2026-07-30; no separate command needed.
