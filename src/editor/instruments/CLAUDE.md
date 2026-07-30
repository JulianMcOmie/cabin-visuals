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

## Def semantics worth knowing (full contracts in `types.ts`)

- Numeric params → `track.params`; `color`/`string` params → `track.stringParams`. **Only plain numeric params are automatable.** `showIf` gates visibility (`'key'` = on when ≥0.5, `'key=2'` pins a select value); hiding is presentation only. `curve: 2` makes a slider quadratic for orders-of-magnitude ranges.
- `localTransform(ctx)` — position/rotation compose down the hierarchy (movers and children see them); **scale is a mesh property**, applied before movers/children, so layouts stay in unscaled units. The canonical `tf*` track transform (`core/transform.ts`) composes as this transform's PARENT — instruments neither declare nor read `tf*`.
- `midiRows` — declare a short, fully-labelled row vocabulary ("Warp forward", "Next word"); the editor shows only these rows in order (first = top). Omit for the full piano roll. See `docs/instrument-note-semantics.md`.
- `abilities` — bespoke MIDI lanes (e.g. Cube's Shatter) rendered as nested sub-rows, expressed inside your component; not attachable to other instruments.
- `fullFrame` — screen-filling plane; renderer skips placement + transform/clone chain. `defaultOnTop` — depth-ignored overlay by default (Text).
- VisualCopy color shifts arrive via `applyColorShiftToInstrumentParams` / `InstrumentCopyContext` — declare color params properly and this is automatic.
- `identityColor` — what the track WEARS in the timeline/piano-roll UI (`utils/trackDisplayColor.ts` resolves; OKLCH recipes re-voice it). A hex literal = fixed identity; `{ param: 'key' }` = follow that color param's current value. Omit it and an instrument with exactly ONE color param follows it automatically; near-achromatic values (white/black text or bg defaults) fall back to the track's hue-cycle color, so a white-defaulting param is safe to point at. Instruments with multiple color params (or an unrepresentative sole one, e.g. a background) must declare explicitly.

## Generated surfaces (a texture that travels with the mesh)

`KaleidoSolid.tsx` is the reference for "the mesh's surface IS the visual". The recipe and its traps:

- **Generate in OBJECT space, not UV space.** A cube's UV seams tear a continuous pattern into six unrelated tiles; object space has no seams, so one field works for the whole `FundamentalGeometry` vocabulary. Pass `position` through from the vertex shader (inject at `#include <begin_vertex>`, the last point where it is still in the solid's own space). Object space is also what makes the pattern *ride along* — it turns and travels with the mesh instead of sliding across it, which a screen-space effect pass cannot do.
- **Inject into a lit material, don't replace it.** `material.onBeforeCompile` on a `MeshPhysicalMaterial`, replacing `vec4 diffuseColor = vec4( diffuse, opacity );` — the scene's real lights, clearcoat and shadows still model the form. Tint `totalEmissiveRadiance` by the same colour so the glow follows the pattern (the `emissive` uniform already carries `emissiveIntensity`). A raw `ShaderMaterial` would mean hand-rolling all lighting.
- **Uniforms**: hold `{value}` objects in a ref and `Object.assign(shader.uniforms, ...)` inside `onBeforeCompile`; mutate `.value` from `useInstrumentFrame`. Never per-frame React state (invariant 4 in the root guide). Share ONE material across the geometry variants so switching shape cannot switch appearance, and dispose it on unmount.
- **On a sphere-mapped field, fold in the surface metric.** A wedge's arc length at polar angle `phi` scales as `sin(phi)`, so ignoring it crowds cells into a smear at the poles. Same reason cells-per-ring must grow with radius: a fixed count per ring thins out to confetti as the ring grows.
- **Export the GLSL** (`KALEIDO_FIELD_GLSL`) so the settings panel's preview runs the very same field — see `userInterfaceRenderers/CLAUDE.md` for that preview harness and its StrictMode trap.

Note-driven state must stay a **pure function of the note stream and the beat** — `barrelTwist()` sums an eased contribution from every note already played rather than accumulating across frames. Per-frame accumulation would make scrubbing disagree with playback and break export.

Colocated `*.test.ts` here ARE run by `npm run test:visual` — the glob was widened when `KaleidoSolid.test.ts` landed, which also picked up two earlier instrument tests that had been sitting unrun.

Shared helpers: `shapes.tsx` (circle/triangle), `specInstrument.tsx` (spec-driven rendering), `laserSphereCore.ts`, `particleWordCloud.ts`, `FundamentalGeometry.tsx` (the six solids — `FundamentalMesh` for the stock material, `FundamentalGeometryShape` when you bring your own). Camera is an instrument too (`CameraControl`); full-frame filter instruments: `ColorFilters`, `FilmStock`. Media instruments (`Video`, `Photo`, `PhotoSlot`) delegate time models to `core/video|photo`.
