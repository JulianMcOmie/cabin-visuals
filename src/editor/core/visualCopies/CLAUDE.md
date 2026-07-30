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
- Individual movers/splitters: `rotationMovers`, `translationOscillator`, `burst*`, `radialMotion`, `visibility`, `grid`, `polyhedron`, `tunnel`, `approach`, `parametricPattern`, `waveTerrain`, `forceFieldPush`, `hueColorizer`, `consolidatedMover`, `meteorImpact`, `splitterMidi` (MIDI gating), `motionBasis`/`motion` (shared math), `burstEasings`.

**`tunnel` vs `approach`** — both stream copies down the camera axis and recycle with a
`mod`, and both must keep their near end BEHIND the camera (z = 5) so the recycle is
off-screen. They differ in what sells the depth: Tunnel renders every copy at full size
and fades opacity (a corridor you travel through); Approach grows each copy from scale
ZERO to its arrival size (an object flying at you, or receding away from you). Both
divide offsets by the placement scale to stay world-metric — see the war-story comment
in `tunnel.ts` about a half-size instrument dragging the near end in front of the lens.

Approach's NOTES mode carries a timing contract worth knowing before you touch it: a
flight is centred on its note so the copy sits at the object's NORMAL placement
(axial 0, `approachHomeProgress`) exactly ON the onset — it leads in from the distance
BEFORE the note and carries on past the lens after. The note is the impact, not the
launch, so `approachNoteFlights` deliberately admits notes with `beat < note.beat`.

Its slots are a **voice allocator** (`allocateApproachFlights`), computed once per
resolve because it is beat-independent. Two rules there are load-bearing, and both cost
a round of "it's still capped by Density" to find:

1. **A slot is released when its copy passes the LENS, not at the end of the run.** The
   stretch from the camera plane to the near end is travelled behind the viewer; holding
   a slot across it spends the budget on invisible copies. This is most of the apparent
   shortfall between Density and how many copies you actually see.
2. **Allocation is first-fit over genuinely free slots**, never round-robin over note
   index. Round-robin is optimal only for a perfectly even stream; on uneven phrasing it
   collides notes onto a busy slot while others sit idle.

Worse than either: ranking live flights by recency and keeping the newest `density`.
That culls the OLDEST flight — the one furthest along, about to reach the camera — so a
dense phrase delivers nothing until its final few notes. General trap for any
note-driven splitter with a fixed slot budget: **evict the newborn, never the one about
to land.** With those two rules Density means exactly "copies on screen at once", and a
phrase is only truncated when that many really are in frame together.

## Invariants

- **Copy COUNT never depends on the beat** (fixed at resolve; MIDI gates opacity). VisualEngine warns if violated.
- Everything evaluated per frame must remain a pure function of `(beat, settings, context)` — same purity rule as instruments.

Adding one: new file with a definition + entry in `library.ts` + (optional) bespoke settings UI in `userInterfaceRenderers/bespokeRegistries.ts` keyed by the definition id; the generic param list is the fallback.
