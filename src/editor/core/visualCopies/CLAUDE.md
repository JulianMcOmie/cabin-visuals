# core/visualCopies — movers & splitters (the VisualCopy pipeline)

One instrument track produces ONE opaque visual output; an ordered chain of movers and splitters says how many times it renders and how each copy is transformed/adjusted. **This module is deliberately isolated**: no imports of instruments, stores, React, ObjectState, StateVector, or project-track types.

## The contract (`types.ts`)

`VisualCopy = { transform: Matrix4, opacity, colorShift {hue, saturation, lightness} }` — closed and small ON PURPOSE. Do not add instrument data, MIDI notes, splitter ancestry, or metadata channels.

- `transform` applies on top of existing placement: `final = placement * transform`.
- **Composition convention**: DEFAULT is LOCAL (`previous * delta`) — each chain entry re-frames the ones below it, so the accumulated transform IS the copy's reference frame. Frame-independent (chain-root) motion opts out by PRE-multiplying (`delta * previous`). Every definition must document which it uses.
- `colorShift` matches `Color.offsetHSL` units (hue = normalized turn). It offsets instrument-declared color *params*, never tints final materials.
- Context gives `{ beat, index, count }` where index/count describe the COMPLETE output of the previous step, so movers can react to upstream splitter multiplicity.

## Structure

- `definitions.ts` — `MoverOrSplitterDefinition` shape (id, params, evaluate) + settings merging.
- `library.ts` — the list of shipped definitions; `registry.ts` — id → def. **Registry ownership routes migration**: ids found here go through the VisualCopy chain; unknown ids fall back to the legacy mover path. New ids must not collide with legacy mover ids. Registry never imports the legacy registry.
- `resolveVisualCopies.ts` — evaluates a track's chain into `VisualCopy[]`; `identityVisualCopy.ts` — the 1-copy default.
- Individual movers/splitters: `rotationMovers`, `translationOscillator`, `burst*`, `radialMotion`, `visibility`, `grid`, `polyhedron`, `tunnel`, `parametricPattern`, `waveTerrain`, `forceFieldPush`, `hueColorizer`, `consolidatedMover`, `meteorImpact`, `splitterMidi` (MIDI gating), `motionBasis`/`motion` (shared math), `burstEasings`.

## Invariants

- **Copy COUNT never depends on the beat** (fixed at resolve; MIDI gates opacity). VisualEngine warns if violated.
- Everything evaluated per frame must remain a pure function of `(beat, settings, context)` — same purity rule as instruments.

Adding one: new file with a definition + entry in `library.ts` + (optional) bespoke settings UI in `userInterfaceRenderers/bespokeRegistries.ts` keyed by the definition id; the generic param list is the fallback.
