# src/editor/instruments — one file per visual instrument

Each file exports an `ObjectInstrumentDef` (schema) colocated with its R3F component. `index.ts` is the registry.

## PURITY IS LAW (lint-enforced in this directory)

No `useFrame`, `performance.now`, `Date.now`, `Math.random`, clock/delta. Per-frame work goes through `useInstrumentFrame(trackId, cb)` (`core/visual/instrumentFrame.ts`) — cb sees `state.beat`, `state.secPerBeat`, params, energy, notes, canvas size, camera pose, and nothing wall-clock. Randomness via `seededRand(seed)`. **Return `false` from the cb if refs/canvas aren't ready yet** — a silent bail leaves the object stale until the next input change (which may never come while paused).

## Adding an instrument — the checklist

1. New file exporting the def: `id`, `name`, `kind: 'object'`, `params: ParamDef[]`, `userInterfaceRenderer`, `component: FC<{trackId}>`, plus optional `localTransform`, `abilities`, `midiRows`, `fullFrame`, `defaultOnTop`.
2. Register in `index.ts` (`INSTRUMENTS` map).
3. **Add a picker entry in `components/LeftSidebar.tsx` `ALL_OBJECT_INSTRUMENTS`** — the add-track menu is curated and does NOT read the registry; without this the instrument is registered but unreachable.
4. Settings UI: `'parameters'` (generic list) or a bespoke renderer — new id in `userInterfaceRenderers/ids.ts` + component + entry in its `index.ts` (see that dir's CLAUDE.md).
5. Preview clip (library hover): `npm run previews:instruments`.

## Testing an instrument: put the pure math in a `*Core.ts`

A colocated test that imports the `.tsx` **crashes with "Cannot access X before
initialization"**: the component imports `core/visual/instrumentFrame`, which
reaches `VisualEngine` and back around to `instruments/index.ts`, which imports
the component again. Only instruments whose file pulls in nothing but types
(BassRipple) can be tested directly. Everything else splits the pure half into a
sibling module with type-only imports — `laserSphereCore.ts`, `waterDropCore.ts`
— and the test imports that. Name the test after the core file, not the
instrument, so the pairing is obvious.

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
- `fullFrame` — screen-filling plane; renderer skips placement + transform/clone chain. `defaultOnTop` — depth-ignored overlay by default (Text).
- **Never read those two flags directly** — go through `isFullFrameTrack(def, params)` / `isOnTopTrack(def, params, track.onTop)` in `types.ts`. Full-frame can also be a per-track MODE via `fullFrameParam: 'someParam'` (Oscilloscope's "Fit to screen"): the track is full-frame while that param is ≥ 0.5, and the on-top pass follows the SAME param, because a screen-pinned overlay that also depth-sorted against scenery would be neither one thing nor the other. ObjectRenderer and VisualScene both resolve through those helpers so they cannot disagree about which pass an object belongs to. Switching an instrument from fixed `fullFrame` to a mode needs a persistence upgrade step that writes the param on existing tracks (see UPGRADES[10]) — otherwise every saved project silently changes look.
- VisualCopy color shifts arrive via `applyColorShiftToInstrumentParams` / `InstrumentCopyContext` — declare color params properly and this is automatic.
- `identityColor` — what the track WEARS in the timeline/piano-roll UI (`utils/trackDisplayColor.ts` resolves; OKLCH recipes re-voice it). A hex literal = fixed identity; `{ param: 'key' }` = follow that color param's current value. Omit it and an instrument with exactly ONE color param follows it automatically; near-achromatic values (white/black text or bg defaults) fall back to the track's hue-cycle color, so a white-defaulting param is safe to point at. Instruments with multiple color params (or an unrepresentative sole one, e.g. a background) must declare explicitly.

Shared helpers: `shapes.tsx` (circle/triangle), `specInstrument.tsx` (spec-driven rendering), `laserSphereCore.ts`, `particleWordCloud.ts`, `FundamentalGeometry.tsx` (the six solids — `FundamentalMesh` for the stock material, `FundamentalGeometryShape` when you bring your own). Camera is an instrument too (`CameraControl`); full-frame filter instruments: `ColorFilters`, `FilmStock`. Media instruments (`Video`, `Photo`, `PhotoSlot`) delegate time models to `core/video|photo`.

## Scene post-process instruments (ColorFilters, BassRipple, Strobe)

These three render `null` and post-process their scene's render target instead. The pattern: export a pure `resolveActiveX(state)` that reads `activeNotes`/`params`/`opacity`/`beat` and returns either the pass's uniforms or `null` for "don't run a pass at all"; `components/visual/VisualScene.tsx` collects the tracks per scene (`postProcessTracksByScene`) and runs the passes. Things you cannot see from one file:

- **Pass order is deliberate**: warp (BassRipple) → colour (ColorFilters) → Strobe. Position before colour, because the grade's own gradients shouldn't be dragged around; Strobe last, because it flashes over the finished look rather than being one more colour in it.
- **`COLOR_FILTER_FRAGMENT`'s `mode` numbering is shared and partitioned**: ColorFilters owns modes **1–9** (one per MIDI row), Strobe owns **10 (blackout)** and **11 (flash)** and reuses 1 for invert. Adding a mode means appending, never renumbering. Strobe's `style` param is its OWN 0/1/2 enum mapped through `STROBE_STYLE_MODES` precisely so a shader renumber can't repaint saved projects — keep new styles on that side of the boundary.
- **These are instruments, not directors**, because they act on ONE scene before compositing — so a filtered scene still slots into a Crop mask or Cut partition normally.
- **Rate can be the MIDI vocabulary.** Strobe puts its rates on labelled rows instead of a knob, so speed is *played* (the eighths→sixty-fourths build is the gesture) and the panel keeps only real settings. Its phase comes from the ABSOLUTE beat, not the note start, so several strobes stay locked to each other and off-grid notes still flash on the grid. Past ~1/32 the flash outruns a 60fps frame and reads as a shimmer whose texture depends on frame rate — that is the honest ceiling, not a bug to fix.
- **A row's PITCH is the saved value, so shipped pitches are frozen.** Strobe's straight rows own 68–72 (1/4 … 1/64) and cannot be renumbered: a project stores the pitch, so remapping would silently re-time every existing strobe. Later families were appended *below* that block — triplets at 67–65, frame rows at 64–61 — which keeps pitch monotonically descending down the row list. Extending a row vocabulary means appending new pitches at one end, never resequencing for a tidier order: the same append-only discipline as the shader modes above. A colocated test pins the frozen five.
- **Wall-clock rates must still be derived FROM the beat.** Strobe's `f` rows are a fixed Hz on a *nominal* 60fps grid (`STROBE_REFERENCE_FPS`), resolved by `strobeCycleBeats(row, secPerBeat)` — seconds = beat × secPerBeat, so they stay a pure function of the playhead. Reading a real frame counter or `performance.now` would be the obvious implementation and would break everything the one rule buys: a paused frame would keep flickering, scrub would not match playback, and a 30 or 120fps export would run at the wrong speed. The cost of doing it properly is that it assumes a constant tempo (fine — one BPM per project; a tempo map would need integrating instead). `strobeGate` is deliberately unit-agnostic (`position / cycleLength`) so the runtime can pass beats and the panel preview seconds without a second copy of the phase logic.

## Generated surfaces (a texture that travels with the mesh)

`KaleidoSolid.tsx` is the reference for "the mesh's surface IS the visual". The recipe and its traps:

- **Generate in OBJECT space, not UV space.** A cube's UV seams tear a continuous pattern into six unrelated tiles; object space has no seams, so one field works for the whole `FundamentalGeometry` vocabulary. Pass `position` through from the vertex shader (inject at `#include <begin_vertex>`, the last point where it is still in the solid's own space). Object space is also what makes the pattern *ride along* — it turns and travels with the mesh instead of sliding across it, which a screen-space effect pass cannot do.
- **Inject into a lit material, don't replace it.** `material.onBeforeCompile` on a `MeshPhysicalMaterial`, replacing `vec4 diffuseColor = vec4( diffuse, opacity );` — the scene's real lights, clearcoat and shadows still model the form. Tint `totalEmissiveRadiance` by the same colour so the glow follows the pattern (the `emissive` uniform already carries `emissiveIntensity`). A raw `ShaderMaterial` would mean hand-rolling all lighting.
- **Uniforms**: hold `{value}` objects in a ref and `Object.assign(shader.uniforms, ...)` inside `onBeforeCompile`; mutate `.value` from `useInstrumentFrame`. Never per-frame React state (invariant 4 in the root guide). Share ONE material across the geometry variants so switching shape cannot switch appearance, and dispose it on unmount.
- **On a sphere-mapped field, fold in the surface metric.** A wedge's arc length at polar angle `phi` scales as `sin(phi)`, so ignoring it crowds cells into a smear at the poles. Same reason cells-per-ring must grow with radius: a fixed count per ring thins out to confetti as the ring grows.
- **Export the GLSL** (`KALEIDO_FIELD_GLSL`) so the settings panel's preview runs the very same field — see `userInterfaceRenderers/CLAUDE.md` for that preview harness and its StrictMode trap.

Note-driven state must stay a **pure function of the note stream and the beat** — `barrelTwist()` sums an eased contribution from every note already played rather than accumulating across frames. Per-frame accumulation would make scrubbing disagree with playback and break export.

Colocated `*.test.ts` here ARE run by `npm run test:visual` — the glob was widened when `KaleidoSolid.test.ts` landed, which also picked up two earlier instrument tests that had been sitting unrun.
