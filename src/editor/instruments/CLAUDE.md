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

Shared helpers: `shapes.tsx` (circle/triangle), `specInstrument.tsx` (spec-driven rendering), `laserSphereCore.ts`, `particleWordCloud.ts`. Camera is an instrument too (`CameraControl`); full-frame filter instruments: `ColorFilters`, `FilmStock`. Media instruments (`Video`, `Photo`, `PhotoSlot`) delegate time models to `core/video|photo`.

## Scene post-process instruments (ColorFilters, BassRipple, Strobe)

These three render `null` and post-process their scene's render target instead. The pattern: export a pure `resolveActiveX(state)` that reads `activeNotes`/`params`/`opacity`/`beat` and returns either the pass's uniforms or `null` for "don't run a pass at all"; `components/visual/VisualScene.tsx` collects the tracks per scene (`postProcessTracksByScene`) and runs the passes. Things you cannot see from one file:

- **Pass order is deliberate**: warp (BassRipple) → colour (ColorFilters) → Strobe. Position before colour, because the grade's own gradients shouldn't be dragged around; Strobe last, because it flashes over the finished look rather than being one more colour in it.
- **`COLOR_FILTER_FRAGMENT`'s `mode` numbering is shared and partitioned**: ColorFilters owns modes **1–9** (one per MIDI row), Strobe owns **10 (blackout)** and **11 (flash)** and reuses 1 for invert. Adding a mode means appending, never renumbering. Strobe's `style` param is its OWN 0/1/2 enum mapped through `STROBE_STYLE_MODES` precisely so a shader renumber can't repaint saved projects — keep new styles on that side of the boundary.
- **These are instruments, not directors**, because they act on ONE scene before compositing — so a filtered scene still slots into a Crop mask or Cut partition normally.
- **Rate can be the MIDI vocabulary.** Strobe puts its five rates on labelled rows instead of a knob, so speed is *played* (the eighths→sixty-fourths build is the gesture) and the panel keeps only real settings. Its phase comes from the ABSOLUTE beat, not the note start, so several strobes stay locked to each other and off-grid notes still flash on the grid. Past ~1/32 the flash outruns a 60fps frame and reads as a shimmer whose texture depends on frame rate — that is the honest ceiling, not a bug to fix.
