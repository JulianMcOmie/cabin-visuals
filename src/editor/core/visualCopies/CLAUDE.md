# core/visualCopies — movers & splitters (the VisualCopy pipeline)

One instrument track produces ONE opaque visual output; an ordered chain of movers and splitters says how many times it renders and how each copy is transformed/adjusted. **This module is deliberately isolated**: no imports of instruments, stores, React, ObjectState, StateVector, or project-track types.

## The contract (`types.ts`)

`VisualCopy = { transform: Matrix4, opacity, colorShift {hue, saturation, lightness, tint, tintAmount} }` — closed and small ON PURPOSE. Do not add instrument data, MIDI notes, splitter ancestry, or metadata channels.

- `transform` applies on top of existing placement: `final = placement * transform`.
- **Composition convention**: DEFAULT is LOCAL (`previous * delta`) — each chain entry re-frames the ones below it, so the accumulated transform IS the copy's reference frame. Frame-independent (chain-root) motion opts out by PRE-multiplying (`delta * previous`). Every definition must document which it uses.
- `colorShift`'s hue/saturation/lightness match `Color.offsetHSL` units (hue = normalized turn) and are RELATIVE. `tint` (a '#rrggbb' or null) + `tintAmount` are the ABSOLUTE channel — "flash this gold" can't be said relatively, because a mover never sees the object's own color. Both are applied in `core/visual/instrumentColor.ts`, which is the only place that knows the source: tint mixes first, HSL rides on top. A tint REPLACES rather than accumulates — the last chain entry to set one owns the color. All of it retargets instrument-declared color *params*, never final materials.
- New fields go INSIDE `colorShift`, not beside it: every definition already spreads `{ ...visualCopy.colorShift }`, so they propagate through the whole library for free. A sibling field means editing ~15 files.
- Context gives `{ beat, index, count }` where index/count describe the COMPLETE output of the previous step, so movers can react to upstream splitter multiplicity.

## Structure

- `definitions.ts` — `MoverOrSplitterDefinition` shape (id, params, evaluate) + settings merging. Numeric params come from the track's `inputValues`; **color/string params come from the shared `stringParams` field** (same split instruments use, so automation/envelope paths never meet a string). `mergeDefinitionSettings(def, inputValues, stringParams)` folds both.
- `library.ts` — the list of shipped definitions; `registry.ts` — id → def. **Registry ownership routes migration**: ids found here go through the VisualCopy chain; unknown ids fall back to the legacy mover path. New ids must not collide with legacy mover ids. Registry never imports the legacy registry.
- `resolveVisualCopies.ts` — evaluates a track's chain into `VisualCopy[]`; `identityVisualCopy.ts` — the 1-copy default.
- Individual movers/splitters: `rotationMovers`, `translationOscillator`, `burst*`, `radialMotion`, `visibility`, `grid`, `polyhedron`, `tunnel`, `parametricPattern`, `waveTerrain`, `forceFieldPush`, `colorizer` (note → envelope-shaped flash toward an absolute color), `duplicateTrail` (note → copies peeling off the object and receding), `consolidatedMover`, `meteorImpact`, `splitterMidi` (MIDI gating), `motionBasis`/`motion` (shared math), `burstEasings`.

## Invariants

- **Copy COUNT never depends on the beat** (fixed at resolve; MIDI gates opacity). VisualEngine warns if violated. Count may still be DERIVED from settings rather than asked for — Duplicate sizes its trail from speed × density so it doesn't need a length knob.
- **A copy directly behind a convex object is invisible unless it covers more screen**, and perspective shrinks faster than any sane world-scale value grows (a 6× copy 50 units back reads at half size). Depth-axis splitters therefore measure size in APPARENT terms and divide the shrink out — see `duplicateTrail`; the camera sits at z = 5 (`TUNNEL_CAMERA_Z`).
- Everything evaluated per frame must remain a pure function of `(beat, settings, context)` — same purity rule as instruments.

Adding one: new file with a definition + entry in `library.ts` + (optional) bespoke settings UI in `userInterfaceRenderers/bespokeRegistries.ts` keyed by the definition id; the generic param list is the fallback.
