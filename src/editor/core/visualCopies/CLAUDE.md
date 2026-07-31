# core/visualCopies — movers & splitters (the VisualCopy pipeline)

One instrument track produces ONE opaque visual output; an ordered chain of movers and splitters says how many times it renders and how each copy is transformed/adjusted. **This module is deliberately isolated**: no imports of instruments, stores, React, ObjectState, StateVector, or project-track types.

## The contract (`types.ts`)

`VisualCopy = { transform: Matrix4, opacity, colorShift {hue, saturation, lightness, tint, tintAmount} }` — closed and small ON PURPOSE. Do not add instrument data, MIDI notes, splitter ancestry, or metadata channels.

- `transform` applies on top of existing placement: `final = placement * transform`.
- **Composition convention**: DEFAULT is LOCAL (`previous * delta`) — each chain entry re-frames the ones below it, so the accumulated transform IS the copy's reference frame. Frame-independent (chain-root) motion opts out by PRE-multiplying (`delta * previous`). Every definition must document which it uses.
- `colorShift`'s hue/saturation/lightness match `Color.offsetHSL` units (hue = normalized turn) and are RELATIVE. `tint` (a '#rrggbb' or null) + `tintAmount` are the ABSOLUTE channel — "flash this gold" can't be said relatively, because a mover never sees the object's own color. Both are applied in `core/visual/instrumentColor.ts`, which is the only place that knows the source: tint mixes first, HSL rides on top. A tint REPLACES rather than accumulates — the last chain entry to set one owns the color. All of it retargets instrument-declared color *params*, never final materials.
- New fields go INSIDE `colorShift`, not beside it: every definition already spreads `{ ...visualCopy.colorShift }`, so they propagate through the whole library for free. A sibling field means editing ~15 files.
- Context gives `{ beat, index, count }` where index/count describe the COMPLETE output of the previous step, so movers can react to upstream splitter multiplicity. It also carries `formation` — the whole array of copies the step is about to transform, for movers whose treatment of one copy depends on how the others are arranged (Conveyor's belt period). Passed by reference with a stable identity per step, so measuring it is O(n) per frame, not O(n²); the copies are immutable, as everywhere else.
- **`warpBeat` is the one escape from space into time.** `apply` can only restate the copy it is handed — it cannot un-compute the instrument animation, automation or upstream motion already baked in below it, so freeze/reverse cannot be a transform. An entry may instead implement optional `warpBeat(realBeat) → beat`, and `computeAtBeat` evaluates that object's ENTIRE state at the result (energy, automation, envelopes, localTransform, activeNotes, `state.beat`, and the whole chain). Object-wide, not a chain partition: the entry's position in the chain is irrelevant. Multiple entries compose by SUMMING deltas against the real beat (`warpChainBeat` in `resolveVisualCopies.ts`) — feeding one the other's output would make it read its own notes at the wrong times. Subtree scope comes free from a top-level mover's `targets` routing.

## Structure

- `definitions.ts` — `MoverOrSplitterDefinition` shape (id, params, evaluate) + settings merging. Numeric params come from the track's `inputValues`; **color/string params come from the shared `stringParams` field** (same split instruments use, so automation/envelope paths never meet a string). `mergeDefinitionSettings(def, inputValues, stringParams)` folds both.
- `library.ts` — the list of shipped definitions; `registry.ts` — id → def. **Registry ownership routes migration**: ids found here go through the VisualCopy chain; unknown ids fall back to the legacy mover path. New ids must not collide with legacy mover ids. Registry never imports the legacy registry.
- `identityColors.ts` — the colour every definition WEARS: its timeline blocks, its
  piano-roll rows and notes, and its settings panel's accent. **Every shipped
  definition declares one** (`identityColor` on the def), and as of 2026-07-31 lanes
  no longer inherit their object instrument's colour — see `utils/trackDisplayColor.ts`.
  Three things bite here:
  - **Only the HUE survives.** `utils/midiEditorPalette.ts` re-voices a track colour
    through OKLCH at a fixed lightness and chroma, so two definitions separated by
    lightness alone render IDENTICALLY. Place new colours by hue, ≥11° from every
    neighbour; `identityColors.test.ts` enforces that and will name the pair.
  - **Chroma is a cliff at 0.02, not a slope.** At or below it the re-voicing leaves a
    colour grey; anything above is resurrected to FULL chroma. A tasteful slate at
    0.035 comes back a saturated blue — which is how All Movers first shipped, looking
    exactly like Tunnel.
  - A definition with a bespoke panel must have the panel IMPORT its constant rather
    than re-declare the hex. Keeping those two in sync is the whole point of the file.
- `resolveVisualCopies.ts` — evaluates a track's chain into `VisualCopy[]`; `identityVisualCopy.ts` — the 1-copy default.
- `moverFrame.ts` — **frames**: a mover nested under another mover MOVES it (Impact Scatter's blast center can drift) rather than becoming a second chain entry. It works by handing the parent a `placementTransform` pre-multiplied by the frame's inverse, so a world-placed mover reads its own field as moved — no contract change, and the returned transform needs no fixing up. Frames nest, and only movers that actually read `placementTransform` respond; a pure relative displacement (Burst, Motion, the rotations) has no location to move, so a frame under one is a no-op.
- Individual movers/splitters: `rotationMovers`, `translationOscillator`, `burst*`, `radialMotion` (three nested rings that all turn passively; MIDI only MULTIPLIES — see below), `visibility`, `grid`, `polyhedron`, `tunnel`, `approach`, `parametricPattern`, `waveTerrain`, `forceFieldPush`, `colorizer` (note → envelope-shaped flash toward an absolute color), `gradientColorizer` (passive two-stop OKLCH ramp across copies, by world position or copy index; no MIDI), `duplicateTrail` (note → copies peeling off the object and receding), `consolidatedMover`, `meteorImpact`, `impactPulse` (note → a percussive SIZE punch; see below), `freeze` (the only `warpBeat` definition: hold-time / reverse-time rows), `conveyor` (held note = belt running, six directions; loops the formation either as a tiled BELT or as a GROUP that dissolves through the turn), `splitterMidi` (MIDI gating), `motionBasis`/`motion` (shared math; Motion's wrap folds each copy's OWN chained position into the box — one copy at a time, with an edge fade — so the fold displacement pre-multiplies while everything else stays LOCAL. The user-set basis can be degenerate, so never `invert()` a basis matrix without a determinant guard), `burstEasings`.

**`radialMotion` — passive by default, MIDI as a MULTIPLIER.** Three nested depths
(`copies0/1/2` = 8/4/2, `radius0/1/2`, and per-axis `spinX/Y/Z 0/1/2` in °/beat), each
resolved as `spin · Rz(seat) · Tx(radius)` and composed LOCAL, so a depth's rotation
carries everything nested below it. Two things about the MIDI vocabulary are the whole
design and are easy to undo by accident:

- **The rows scale the knobs; they do not replace them.** Radius rows latch ×0/×0.5/×1/×2
  and spin rows latch ×−1/×0/×0.5/×1/×2, both with a resting value of ×1. That is why the
  arrangement sits at its set radii and turns on its own with an empty lane — the panel
  says what the piece looks like, MIDI bends it. Rows that set absolute values (what the
  old layer-based version did) make the knobs meaningless the moment one note exists.
- **Spin integrates the shared MULTIPLIER into "spin beats", not each axis separately.**
  `evaluateRadialMotionSpinBeats` returns a phase the three axis rates are multiplied by,
  so freezing a tumbling ring stops all three axes at the pose they were in. Integrating
  per axis lets them drift apart and a freeze becomes a lurch.

Its bank in `consolidatedMover.ts` is still 69 pitches wide for 27 rows. Do not reclaim
the slack: the bank sizes are what fix every module below it, so shrinking it silently
retunes every existing project's All Movers lane.

**Scale movers (`impactPulse`) carry two rules the translation movers never hit:**

1. **Size must be an EXPONENT, not a summand.** `scale = (1 + HIT)^pulse` makes a
   swell and its mirror-image squash exact reciprocals, and nothing can cross zero.
   Adding the signed pulse instead is asymmetric (+0.5 grows by half, −0.5 shrinks by
   half — twice as violent), and a large enough squash drives the scale negative,
   inverting the object's winding.
2. **LOCAL composition is load-bearing here, not merely the default.** Post-multiplying
   (`previous * scale`) scales about the copy's OWN origin in its OWN axes, so a
   splitter above it makes every copy pulse in place. PRE-multiplying would scale each
   copy's POSITION too and the whole formation would breathe toward the world origin.
   The same convention hands anisotropic squash-and-stretch its axis for free: local Y
   is each copy's own up, so a rotated copy stretches along its own.

`impactPulse` is also the one note-driven entry that **deliberately ignores note
duration**. Everything else here gates on the written note (Visibility's sustain,
Colorizer's wash, Conveyor's belt); a snare's amplitude envelope has no sustain, so
this one peaks on the onset frame and decays, and a 16th and a whole note hit
identically. Follow it for any other percussion-shaped mover — and say so in the file,
because it contradicts the module's normal reading of a note.

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

- **Copy COUNT never depends on the beat** (fixed at resolve; MIDI gates opacity). VisualEngine warns if violated. Count may still be DERIVED from settings rather than asked for — Duplicate sizes its trail from speed × density so it doesn't need a length knob.
- **A copy directly behind a convex object is invisible unless it covers more screen**, and perspective shrinks faster than any sane world-scale value grows (a 6× copy 50 units back reads at half size). Depth-axis splitters therefore measure size in APPARENT terms and divide the shrink out — see `duplicateTrail`; the camera sits at z = 5 (`TUNNEL_CAMERA_Z`).
- Everything evaluated per frame must remain a pure function of `(beat, settings, context)` — same purity rule as instruments.

- **A per-copy wrap is only safe at the FORMATION's own period.** Folding each copy into a box of the mover's own choosing (Conveyor's first version, and Motion's `boundX/Y/Z` on `codex/motion-wrap-fix`) tears any formation apart: a copy reaches the face while its neighbours are mid-frame and teleports a box-width away from its own row, so a Grid stops being a Grid the moment the mover is added. The only per-copy fold that preserves an arrangement is by one lattice period — extent + spacing, measured from `context.formation` (`latticeAlong` in conveyor.ts) — because that maps the lattice exactly onto itself. When there is no lattice (one copy, or uneven spacing), fall back to displacing the whole formation identically and dissolve through the turn; never guess a period. Either way, wrap ONLY the axes with travel: folding a still axis silently rearranges what a splitter built there.
- A per-copy wrap PRE-multiplies its delta — the fold is measured along fixed axes, so a rotation above the mover must not turn it.
- **Hiding a teleport with a fade means tying the fade to SPEED, not to the box.** A fade band expressed as a fraction of the span is crossed in two frames by a fast belt, so the copy is still ~40% visible when it jumps (measured: 0.376 at speed 3). Derive the band from `speed × fadeBeats` and the dissolve always lasts the same number of beats.

- Chain ORDER matters for world-placed movers, because they read the live chained position: a Motion **above** an Impact Scatter drifts the object away from the blast, weakening and delaying the hit; **below** it, the blast stays full strength and the drift rides on top. Put the drift in the Scatter's frame instead to move the blast WITH it.

Adding one: new file with a definition + entry in `library.ts` + (optional) bespoke settings UI in `userInterfaceRenderers/bespokeRegistries.ts` keyed by the definition id; the generic param list is the fallback.
