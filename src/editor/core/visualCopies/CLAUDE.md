# core/visualCopies — movers & splitters (the VisualCopy pipeline)

One instrument track produces ONE opaque visual output; an ordered chain of movers and splitters says how many times it renders and how each copy is transformed/adjusted. **This module is deliberately isolated**: no imports of instruments, stores, React, ObjectState, StateVector, or project-track types.

## The contract (`types.ts`)

`VisualCopy = { transform: Matrix4, opacity, colorShift {hue, saturation, lightness, tint, tintAmount, tintPerceptual?} }` — closed and small ON PURPOSE. Do not add instrument data, MIDI notes, splitter ancestry, or metadata channels.

- `transform` applies on top of existing placement: `final = placement * transform`.
- **Composition convention**: DEFAULT is LOCAL (`previous * delta`) — each chain entry re-frames the ones below it, so the accumulated transform IS the copy's reference frame. Frame-independent (chain-root) motion opts out by PRE-multiplying (`delta * previous`). Every definition must document which it uses.
- `colorShift`'s hue/saturation/lightness match `Color.offsetHSL` units (hue = normalized turn) and are RELATIVE. `tint` (a '#rrggbb' or null) + `tintAmount` are the ABSOLUTE channel — "flash this gold" can't be said relatively, because a mover never sees the object's own color. Both are applied in `core/visual/instrumentColor.ts`, which is the only place that knows the source: tint mixes first, HSL rides on top. A tint REPLACES rather than accumulates — the last chain entry to set one owns the color. All of it retargets instrument-declared color *params*, never final materials.
- **`tintPerceptual` picks how that mix WALKS** — optional, default false (a straight channel lerp, what every pre-existing definition and save expects). It matters at partial `tintAmount`, where a note colorizer lives: three's `Color.lerp` runs in LINEAR light, so a quarter-strength flash from a dark object toward a bright color is already most of the way up in *perceived* brightness (measured, `#2c3760`→`#ffd166` at t=0.25: L 0.587 linear vs 0.481 perceptual). The object therefore blows out well before it arrives at the color — which is what "the flash just goes white" actually is. OKLab's L is perceived lightness, so a quarter of the way looks a quarter of the way. Set by the Colorizer's MIX param; `utils/oklch.ts`'s `mixOklabLinearRgb` does it in place on three's linear values, no hex round trip.
- **The rest of that whiteness is NOT the mix and cannot be fixed from here.** `components/visual/VisualScene.tsx` composites `scene + bloom * 0.9` with `luminanceThreshold: 1.15` — a literal add that saturates all three channels, so past the clip point every picked color converges on the same white core with a colored halo. On top of it an instrument's own material adds white specular (Cube: `clearcoat 0.9`, `envMapIntensity 1.25`). Verified end to end: at INTENSITY 1 the Colorizer delivers `#ffd166` to the Cube's albedo *exactly*, and the cube still renders as a near-white face ringed in gold. The contract is deliberate — instruments keep ownership of emissive, lighting and HDR — so "my flash looks white at high intensity on an emissive instrument" is an instrument/bloom question, not a colorizer one.
- New fields go INSIDE `colorShift`, not beside it: every definition already spreads `{ ...visualCopy.colorShift }`, so they propagate through the whole library for free. A sibling field means editing ~15 files. **And every new field must also be `put()` into `core/visual/instrumentFrame.ts`'s signature buffer**, or editing it while paused changes nothing on screen (the frame is skipped as unchanged) and you will chase a phantom bug.
- Context gives `{ beat, index, count }` where index/count describe the COMPLETE output of the previous step, so movers can react to upstream splitter multiplicity. It also carries `formation` — the whole array of copies the step is about to transform, for movers whose treatment of one copy depends on how the others are arranged (Conveyor's belt period). Passed by reference with a stable identity per step, so measuring it is O(n) per frame, not O(n²); the copies are immutable, as everywhere else.
- **`bypassAt` is the one escape from a copy into another DEVICE.** An entry that
  implements it contributes nothing itself; it answers "the device I am nested under is
  switched off at this beat". Only `bypass` does — see the section below.
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
    lightness alone render IDENTICALLY. Place new colours by hue, as far from the
    neighbours as the wheel allows — but crowding is permitted: the 11° floor and
    its test were dropped 2026-08-15 when the wheel passed arithmetic capacity.
  - **Chroma is a cliff at 0.02, not a slope.** At or below it the re-voicing leaves a
    colour grey; anything above is resurrected to FULL chroma. A tasteful slate at
    0.035 comes back a saturated blue — which is how All Movers first shipped, looking
    exactly like Tunnel.
  - A definition with a bespoke panel must have the panel IMPORT its constant rather
    than re-declare the hex. Keeping those two in sync is the whole point of the file.
  - **The wheel is past capacity, and that is now allowed.** Every window between the
    immovable panel accents is packed (Contour and Symmetry share 62°), so a new
    definition takes the least-crowded hue it can find rather than rebalancing a
    stretch or being blocked. The grey road (chroma ≤ 0.02, Bypass/All Movers) remains
    open for definitions that can live without a hue.
  - `identityColor` may instead be `{ param }`, following one of the definition's own
    color params live. Only the **Colorizer** does: its subject IS a colour the user
    picked, so its device row, notes and panel all move together. Hue ~86° (its
    palette default) is therefore left unclaimed in `identityColors.ts`. A param that
    resolves near-achromatic falls through to the lane's own cycle colour.
- `bypass.ts` — the `parentGate` device: notes switch the device it is nested under OFF (or, flipped, on). Not a chain entry — see its own section below.
- **Demoting a superseded definition is `legacy: true` on the def, not an id list in a picker** (All Movers, Motion). Both pickers read the flag and treat it differently on purpose: the LIBRARY files it into its shelf's Extras folder (`LEGACY_MOVER_IDS` in `LeftSidebar.tsx`, derived from the registry), while the track context menu's "Add mover / colorizer / splitter track" lists drop it entirely — a right-click menu is one flat list per kind, with no Extras drawer to hide a back-catalog entry in, so it would sit right beside the definition that replaced it. Never delete the definition: saved projects still resolve its id.
- `resolveVisualCopies.ts` — evaluates a track's chain into `VisualCopy[]`; `identityVisualCopy.ts` — the 1-copy default.
- `copyTargets.ts` — **which of the incoming copies a chain row acts on** (the
  inspector's Targets tab). The whole vocabulary is a slice count plus which slices
  are on, cut by one of two rules that read only `index`/`count`: `every` interleaves
  (`index % slices`), `runs` takes contiguous stretches. Four things are load-bearing:
  - **An untargeted copy is RETURNED UNCHANGED, never hidden or dropped.** A targeted
    splitter fans out the copies it owns and everything else passes through 1:1, so
    copy count stays a pure function of settings. `gatedMoverOrSplitter` also gates
    `structuralVariants`, so the structural probe sizes the mounted pool against what
    the gate actually produces rather than against the ungated splitter.
  - **Reading only index/count is what makes it beat-independent for free.** A gate
    that measured POSITIONS (radius, angle, an axis) would break the copy-count
    contract the moment a mover above animated one copy across a boundary — that is
    why the shipped rules are index-only, and why shape-based cutting is a later slot
    beside them rather than a fourth rule bolted on.
  - **`warpBeat` is deliberately NOT gated.** A time remap reaches the whole object by
    contract, so a Freeze with copy targeting still freezes everything.
  - Neutral targeting is stored as **absence** (`normalizeCopyTargets` collapses "all
    slices on" to `undefined`), so an untouched device grows no field and every save
    written before the feature resolves identically. The gate wraps in
    `resolveMoverOrSplitterTrack` (resolve.ts) around the WHOLE entry, children
    included — a targeted splitter must not still spin its untargeted copies.
    `CopyTargetSelection` here is mirrored structurally by `CopyTargets` in
    editor/types.ts (the document must not depend on the engine); resolve.ts passes one
    to the other, so a drift is a type error there.
- `moverFrame.ts` — **frames**: a mover nested under another MOVER moves it (Impact Scatter's blast center can drift) rather than becoming a second chain entry. It works by handing the parent a `placementTransform` pre-multiplied by the frame's inverse, so a world-placed mover reads its own field as moved — no contract change, and the returned transform needs no fixing up. Frames nest, and only movers that actually read `placementTransform` respond; a pure relative displacement (Burst, Motion, the rotations) has no location to move, so a frame under one is a no-op.
- `splitterSize.ts` — **the shared SIZE knob** every layout splitter wears (`radial`,
  `grid`, `line`, `symmetry`, `polyhedron`, `parametricPattern`, `tunnel`): ONE exported
  `SPLITTER_SIZE_PARAM` the definitions reference by identity, so the knob cannot drift
  apart across seven files, plus `splitterSize()` (clamp) and `applySplitterSize()`
  (post-multiply). Two rules make it independent of the layout, and both are the point of
  the knob: it composes **AFTER** the slot's offset (`slot · S`), so it scales each copy
  about its OWN center and the position column is untouched — spacing stays spacing,
  radius stays radius; and it is a **multiplier on the object's own size**, never an
  absolute, so 1 is neutral and an absent key merges to 1 — the seven definitions gained
  it with no persistence upgrade, and `splitterSize.test.ts` pins that (it also fails if a
  new definition hand-rolls its own `size` instead of using the shared param). Pre-multiplying
  instead would scale each copy's POSITION too and the whole formation would breathe — the
  same trap impactPulse's LOCAL rule documents. Line's per-step `growth` multiplies on top
  (`size · growth^i`); the two depth splitters keep their own bespoke `size` (Duplicate
  Trail's far-end, Approach's arrival size) because those measure APPARENT size and divide
  the camera's shrink out. Tunnel's size is deliberately NOT divided by the placement scale
  the way its offsets are — the offsets are world measurements, the size is a ratio.
- `splitterChildChain.ts` — a mover nested under a SPLITTER means something else: it moves the splitter's **copies in the splitter's reference frame**, treating the splitter's origin as the origin the motion happens about. A rotation child orbits the whole formation about the splitter's center, where the same rotation as a chain sibling below the splitter spins each copy in place — the child's delta lands BETWEEN the incoming frame and the slots (`prev · delta_i · slot_i`), which no chain position can express. **The motion is INTERNAL — it never re-frames the chain below.** Each copy's `transform` stays the splitter's unmoved output (its reference frame); the child's contribution rides separately (`applyFramed`/`FramedVisualCopy` in types.ts, carried per copy by the `resolveVisualCopies` kernel and folded in only on the final transforms). So a second grid below duplicates a SPINNING sub-grid — the spin repeats inside every duplicate — rather than laying its cells out in a spinning frame, which would read as the whole compound orbiting one origin (the bug that motivated the split). The child chain runs on the splitter's own slots expressed in the splitter's frame — real per-copy positions, with the splitter's multiplicity as `{index, count}` and the slot set as `formation` — so position-reading children aim per copy (Symmetric Motion's Out blooms a grid outward; a world-placed field measures per slot), and `getPriorVisualCopyCount` counts the parent splitter itself, so a Visibility child's MIDI rows address the slots. **What a child's transform contributes is anchored by its declared `composition`** (optional on `MoverOrSplitter`): `'chainRoot'` deltas (Symmetric Motion pre-multiplies on the frame's fixed axes) are taken as-is; `'local'` deltas (the default) are re-anchored about the splitter's origin (`t⁻¹·out·t`), which is what makes a rotation child orbit the formation instead of spinning each copy in place. A chain-root definition that doesn't declare itself still behaves under translation splitters (grids), where the two anchorings coincide — but declare it. Opacity/colorShift compose as normal chain entries would and apply immediately; a splitter child fans the formation out about the parent's origin (n·m, input-major); a child's `warpBeat` still reaches the object. A splitter's own spatial tf\* AUTOMATION lanes join this child chain as count-neutral delta entries at their child position (`weaveSplitterTfLanes` in core/visual/resolve.ts) — an automated x/y/z/rotation/size lane moves the formation exactly like a mover child would.
- **`mover` — THE motion mover (2026-08 consolidation).** One definition covering the
  whole (translate | rotate | orbit) × (burst | constant | oscillate) matrix via two
  select params, replacing six retired siblings (`burst`, `rotateBurst`, `orbitBurst`,
  `constantRotate`, `constantOrbit`, `translationOscillator` — persistence UPGRADES[12]
  rewrites old saves, renaming `speedX/Y/Z`/`speed` → `angleX/Y/Z`/`angle` for the two
  constant movers and retargeting their automation/envelope lanes). All cells share the
  frozen 60-65 (+66 Return) pitches, so notes survive both the upgrade AND mode
  switches; `midiRows` narrows to the active cell's rows. Every inherited cell
  delegates to the SAME evaluators the old defs used (`burstOffset`, motion's
  drift/snap, rotationMovers' constant spin) and `mover.test.ts` pins matrix-exact
  parity per cell — if you touch a shared evaluator, that test is the tripwire. The
  three new cells: translate-constant (Motion Drift semantics: note-gated, NO
  baseline, because positional drift diverges), rotate/orbit-oscillate (the
  oscillator's wave applied to angles). Orbit cells PRE-multiply (the pivot is a fixed
  point in the frame above); translate/rotate stay LOCAL. The retired definition
  objects remain exported (unregistered, no identityColor) for All Movers' banks and
  the parity tests.
- Individual movers/splitters: `rotationMovers`, `translationOscillator`, `burst*` (all retired into `mover`, see above), `radialMotion` (three nested rings that all turn passively; MIDI only MULTIPLIES — see below), `radial` in library.ts (the ring splitter — see the polar options below), `line` in library.ts (N copies marching along one axis aimed by two angles — default aim −Z, straight back; ANGLE swings about +Y, TILT lifts toward +Y, no plane select; the BASE copy is the object itself, unmoved and at the SIZE knob's scale, and GROWTH is a per-step size ratio anchored there — size · growth^index — so the original's placement is never disturbed; the aim rotation is identity at default so untouched copies stay unrotated, and a non-zero aim re-frames copies with the axis; scale composes after the translation so spacing stays spacing; MIDI is the shared slot mute map), `visibility`, `grid` (three dimensions — columns/rows/depth — each independently linear or wrapped into a ring; linear offsets sum in WORLD axes while circular steps nest LOCALLY in dimension order, which is what makes circular columns + circular depth a true torus and any circular pair with the outer radius at 0 a sphere — the axis pairings and composition rules are documented at the definition in library.ts and are load-bearing; SIZE is the shared knob and applies last, so growing the cells never disturbs the lattice; its MIDI lane is a SPACING value lane — Radial's radius grammar via the shared `valueLane.ts`, but thinned to 9 detent rows over 0–4 in 0.5 steps with the bottom row exactly 0, and only the LINEAR offsets scale, ring radii keep their knobs; the per-cell mute map retired 2026-08, old mute notes at 96+ fall out of span and no-op), `polyhedron`, `symmetry` (mirror lines through the object's own center — N evenly spaced lines make the slot set the dihedral group D_N, so "mirror", "quad" and "kaleidoscope" are just N = 1, 2, more), `symmetricMotion` (the motion counterpart: each copy's direction is read off its OWN chain-frame position — outward/inward/turn about the center, or apart/together across an axis — so one note moves any formation symmetrically; deltas PRE-multiply because directions live on the chain frame's fixed axes, inward travel clamps at the symmetry element, and two segmented modes × three time shapes replace what would otherwise be dozens of rows), `symmetricRotation` (the ROTATIONAL counterpart — see below), `tunnel`, `approach`, `parametricPattern`, `waveTerrain`, `contour` (passive, beat-free z = f(x, y) relief along the camera's depth axis — one `shape` family so far, the cone; same world-Z conjugation as Wave Terrain), `forceFieldPush`, `colorizer` (note → envelope-shaped flash toward an absolute color; a PALETTE of five color slots, one MIDI row each, plus the rainbow row), `gradientColorizer` (passive two-stop OKLCH ramp across copies, by world position or copy index; no MIDI), `cosinePalette` (IQ's `a + b·cos(2π(c·t + d))` palette per copy: t from a MAP select — X/Y/Radial/Spherical/Depth/Copy index — SCROLL is the master phase knob built to be automated, and the one Kick row shoves phase by velocity with a closed-form exponential ease-back; PERIODIC on purpose where Gradient clamps, CYCLES detented to half-turns so closed formations tile seamlessly), `risoDuotone` (a two-ink PRINT: the same MAP vocabulary becomes a tone ramp, the ramp becomes per-ink coverage, and an ordered 8×8 Bayer screen thresholds coverage into a per-copy yes/no — so only FOUR colors can come out, paper / A / B / the multiply OVERPRINT, precomputed once per resolve. The single INK knob is why it needs no others: at 0 the two coverages are exact complements, above 0 they overlap into the overprint band, below 0 the paper shows through. Two screen reads are offset within the matrix so the inks don't land on the same copies — a press turns the second screen instead. A tie hands ink A the copy, or an odd copy run's exact-0.5 middle prints bare in an otherwise clean split. Passive; TONE is the automation target), `hueRotate` (the one colorizer that does NOT answer "what colour is this copy": it ADDS a relative turn to `colorShift.hue`, so the instrument's own palette and shading survive the recolour — see below), `duplicateTrail` (note → copies peeling off the object and receding), `consolidatedMover`, `meteorImpact`, `impactPulse` (note → a percussive SIZE punch; see below), `freeze` (the only `warpBeat` definition: hold-time / reverse-time rows), `conveyor` (held note = belt running, six directions; loops the formation either as a tiled BELT or as a GROUP that dissolves through the turn), `splitterMidi` (MIDI gating), `waypoints` (a position sequencer: N laid-out positions - line/grid/ring/custom, CENTERED on the object's home - one MIDI row each meaning "travel here", curve rows LATCHING how subsequent moves travel; Snap/Flow/Pop are true cubic-beziers (Newton-solved: expo-out 0.16,1,0.3,1 / the iOS-sheet curve / back-out overshoot), Glide/Spring are analytic damped-spring physics that carry the arriving velocity across retargets - the whole path precomputes at resolve as closed-form segments, so apply() is a segment lookup; bespoke panel with a draggable field pad in WaypointsUserInterface.tsx), `motionBasis`/`motion` (shared math; Motion's wrap folds each copy's OWN chained position into the box — one copy at a time, with an edge fade — so the fold displacement pre-multiplies while everything else stays LOCAL. The user-set basis can be degenerate, so never `invert()` a basis matrix without a determinant guard), `burstEasings`.

**`radial` — the ring, and the four polar options on top of it.** N slots about a
plane, SIZE scaling each copy about its own center AFTER the translation so radius
stays radius. Its lane is a VALUE lane, not a mute map (2026-08) — a note's pitch names
a radius via the automation 36–84 encoding and the radius swells 0→r→0 between onsets on
the cycle default's closed form 4u(1−u), resting at the RADIUS knob outside the span;
retired mute pitches 122–127 fall out of span and no-op, so old saves degrade to their
knob. That whole grammar (gates, swell, detent-able rows) lives in `valueLane.ts`,
shared with Grid's spacing lane — a third value lane starts there. The polar options (2026-08-14) each default to neutral, so an untouched save is
matrix-identical to the plain ring and none of them needed a persistence upgrade —
`radial.test.ts` pins that against a settings object with none of the keys:

- **SWEEP is the arc, and whether it's CLOSED is derived, never a knob.** A whole
  number of turns divides `i/count` (the seam would otherwise carry two copies on top
  of each other); any other arc is open and puts a copy on each END, `i/(count−1)`,
  which is what makes 180° read as a half-ring rather than a gap-toothed one. That one
  rule (`radialSweepFraction`) is why fans, arcs and multi-turn windings need no extra
  input. Sweep 0 is legal — every copy at angle 0, a straight column under RISE.
- **GROWTH is a per-copy ratio on the RADIUS**, gated behind the SHAPE select
  (circular | spiral): a stored growth is inert until the mode asks for it, which is
  what makes the segmented control worth its space rather than being a second neutral
  knob. Ratio, anchored at copy 0, so it can't cross zero — Line's GROWTH convention,
  but Line's is a ratio on the SIZE and this one is on the radius. It rides on the
  MIDI-sampled radius, not the knob, so a spiral keeps its proportions while the lane
  swells it.
- **RISE is per copy too** (Line's spacing grammar), along the ring's own axis — and it
  joins the SAME translation as the radius, because the slot rotation is about that
  axis and therefore leaves the axial component alone. Sweep > 360 + rise = helix; add
  spiral growth and it's a cone or a vortex.
- **FACING is not just cosmetic: it picks the frame every mover BELOW inherits.**
  Outward (the default, and the only pre-2026-08-14 behavior) hands each copy its
  rotated axes, so a +X burst blooms the ring. Upright cancels the slot rotation, so
  the copies keep the object's own orientation AND a burst sends them all the same way.
  Along path is a quarter turn on, aiming each copy down the tangent. The fix rides
  INSIDE the slot (after the translation), so it re-aims without moving anything.
- **RINGS (2026-08-21) repeats the whole slot set outward**, with three
  INDEPENDENT per-ring amounts — SPACING (radius), RING SIZE (the copies), RING
  DEPTH (along the axis) — all anchored at ring 0, so ring 0 IS the single ring that
  was there before and `rings: 1` makes every one of them inert. That is what let it
  ship with no persistence upgrade even though SPACING's default is 1 rather than 0
  (`radial.test.ts` pins a keyless save as matrix-identical). **SPACING is ADDITIVE
  where the spiral's GROWTH is a ratio**, and that is not an inconsistency: growth
  walks a radius that is already there, while ring spacing has to work from the
  DEFAULT radius of 0, where every ratio collapses to one point. It clamps at the
  center rather than passing through — a negative radius re-emerges on the far side
  and reads as a flipped ring, not one that ran out of room. RING SIZE is a ratio on
  the shared SIZE knob, floored at that knob's own minimum so a long shrinking stack
  can't reach a degenerate scale; RING DEPTH joins RISE's translation, for RISE's
  reason. Copies come out **RING-MAJOR** (ring 0's whole slot set, then ring 1's), so
  a ring is a contiguous run of indices and copy targeting's `runs` rule addresses one
  directly. The lane still samples ONE radius: the ring offsets ride on top of it, so
  a swelling lane moves the whole stack and keeps its spacing.

**`physics` — a VALUE lane joined by mechanics instead of by an easing curve.**
Pitch names a scalar through the automation 36–84 encoding (as Radial's radius
rows do); the mover integrates a law of motion between onsets and solves its
INITIAL CONDITIONS so the trajectory intercepts the next value at the next
onset. Four things carry it:

- **The matrix is (Gravity | Spring | Drag) × (Arrive | Apex | Impulse).**
  Arrive passes exactly through every value; Apex makes the value the
  trajectory's EXTREMUM (under Gravity that is the bouncing ball — fall,
  bounce, crest on the beat); Impulse injects energy sized by the value (under
  Gravity, exactly enough to peak there) and lets the law free-run. Drag has no
  extremum, so its Apex cell is a critically damped arrival — stated in the
  file, not an oversight.
- **TUNE is the tension the mover exists to expose, and it cannot be dodged.**
  An interval is fully constrained by its two endpoint values, so a second-order
  law cannot both arrive on time AND keep velocity continuous. `strike` fixes
  the field constant and solves the LAUNCH VELOCITY (velocity jumps at every
  onset — that discontinuity is the hit you see); `smooth` carries velocity
  through and solves the FIELD CONSTANT per interval instead (C¹, at the price
  of gravity that breathes). Both ship because both are musically right, and
  `physicsInterp.test.ts` pins each one's signature — fixed vs varying `a`
  across the poly pieces.
- **A solve that can't be met CLAMPS and misses, it never fakes.** Apex/strike
  over a drop steeper than `2|Δy|/dt²` is asking fixed gravity for a fall it
  cannot make; the bounce clamps to the interval edge and the crest is missed.
  That is what `smooth` (which solves gravity) is for. Every ill-conditioned
  solve degrades to the plain thrown parabola rather than letting a NaN reach a
  matrix.
- **Everything precomputes into analytic PIECES** (parabola / damped spring /
  exponential / hold) — bounces are pieces too, so a bounce chain is a run of
  parabolas found by closed-form floor crossings and `apply()` is a binary
  search plus one evaluation, never an integration. The spring closed form is
  exposed as a LINEAR BASIS (`springBasis` → P,Q,R,S) precisely so each "solve
  the initial conditions" is a 1×1 or 2×2 solve rather than a search; only
  drag/smooth needs a bisection, and it falls back to strike when the arrival is
  outside the band a first-order pull can reach. A nearly elastic lane is capped
  (`MAX_PIECES`) and always TERMINATES ON A HOLD — a parabola left as the last
  piece keeps falling for the rest of the timeline and drags the object out of
  frame.

Value 0.5 (pitch 60) is home, so an empty lane is a no-op and `AMOUNT` spans the
channel `target` picks (world units for X/Y/Z, degrees for the rotations,
octaves for Size — an exponent, per impactPulse's rule). LOCAL composition, like
Waypoints. Note duration and velocity are ignored: a value is a destination.

**`symmetricRotation` — rotation about ONE axis, aimed by each copy's position.**
Symmetric Motion gives a copy a direction to travel; this one gives it a rotation
AXIS and a share of the angle, so a formation turns as a symmetric body. Three
channels, which are the three rotations a point around an axis can have:
**twist** about the axis itself, **fold** about the circle's TANGENT (`t = r̂ × A`,
so +90° closes a ring onto the axis — the "toward/away from the axis" one), and
**roll** about the copy's own outward radial. Four things carry the design:

- **FALLOFF is why one definition covers so much.** The same channel angle can be
  applied uniformly, scaled by SIGNED distance along the axis (the classic twist
  deformer — the sign reversal across the center is what makes a wall wring into a
  helix rather than turn rigidly), by distance FROM the axis (a swirl), or INTO it
  (`1 − r/span`, clamped — a vortex core that dies at SPAN). CURVE bends the ramp
  and preserves the sign, so a curved twist still reverses across center.
- **ANCHOR is the difference between moving a formation and re-orienting it.** On
  the axis LINE a fold folds the whole ring up like an umbrella; on each copy's OWN
  center the same fold is petals turning to face in or out, positions untouched.
  It is a genuine no-op for ROLL — the copy sits on that rotation's own axis — and
  that is stated in the code, not an oversight.
- **The time shapes are the Mover's, not new ones.** Burst / Constant / Oscillate
  delegate to `evaluateBurstOffset`, `evaluateConstantRotationAngles` and the
  Mover's `evaluateOscillationAmounts` on the SAME frozen pitches (60/61 twist,
  62/63 fold, 64/65 roll, 66 Return), so the notes feel identical across the two
  movers and a time shape has one place to be fixed. The fourth mode, **Amount**,
  declares NO rows at all: the angle knobs are the value, and an automation lane on
  them is how it moves. The default FALLOFF is **Along axis** (changed 2026-08-15):
  the original Uniform default made the out-of-box behaviour a rigid whole-formation
  turn — indistinguishable from a plain rotate mover, reported as "it moves
  everything as a whole" — while the library card advertises the graded helix. The
  lone-object legibility Uniform was protecting is carried by the bespoke panel's
  live wall preview instead (`SymmetricRotationMoverUserInterface.tsx`, cornflower
  accent — see the 2026-08-15 blue-stretch shuffle in `identityColors.ts`).
- **PRE-multiplied, declared `composition: 'chainRoot'`.** Axis, radial and tangent
  are measured on the chain frame the formation was built in; let a copy's own
  rotated frame re-aim them and a mirrored pair twists the same way in world space,
  which is exactly the symmetry the mover exists to keep. Consequence, as with
  Symmetric Motion: it reads no `placementTransform`, so a mover FRAME under it is
  a no-op. The three channels compose twist · fold · roll, each aimed from the
  copy's INCOMING position rather than the partly-rotated result.

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
- **Spin rates are QUANTIZED to beat divisions at the UI, not in storage.** The panel's
  spin knobs are stepped over `RADIAL_MOTION_SPIN_DETENTS` (one full turn per 2/4/8/16/32
  beats, either direction, or 0), but the stored unit stays °/beat so old saves,
  automation lanes and the ×0.5/×2/×−1 MIDI multipliers keep working — halving or
  doubling a power-of-two division is still one. An off-grid legacy value (the old
  18°/beat default) renders at its nearest detent with an honest °-readout until touched.

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
off-screen. Tunnel's speed has two clocks (`speedMode`): Free reads the `speed` knob in
units/beat; Beat-synced converts `syncRingsPerBeat` through the CURRENT ring spacing
(`depth / rings`) so "1" lands a ring on every beat however the corridor is
proportioned — `tunnelBaseSpeed` is the one place that conversion lives, and the stored
rate stays continuous (panel steps it over `TUNNEL_SYNC_DETENTS`, same contract as
Radial Motion's spin rates). Its `orientation` default is **Face center** (1) as of
2026-08 — a save that never touched the param picks up the new default. They differ in what sells the depth: Tunnel renders every copy at full size
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

## Hue Rotate, and the perceptual hue circle

`hueRotate` is the RELATIVE colorizer: every other one sets an absolute `tint`
and therefore flattens the object to one colour, while this one adds turns to
`colorShift.hue` and never learns what colour it is turning. Consequences:

- **It composes rather than replaces.** Two of them sum; one under a
  Gradient/Cosine/Riso turns the colour that colorizer just chose (tint mixes
  first in `instrumentColor.ts`, HSL offsets ride on top). Nothing it does can
  clobber a colour another entry owns, which is what makes it the safe device
  to automate. ROTATE is that target — measured in TURNS, so a 0→1 lane comes
  back exactly where it started; nothing is clamped, because a wheel has no ends.
- **SPREAD is what keeps it a colorizer and not a global filter**: the shared
  MAP vocabulary (X/Y/Radial/Spherical/Depth/Copy index) scales each copy's turn,
  so a formation fans across the wheel. It defaults to **Copy index**, not the
  Cosine Palette's Radial, because a ring's copies all share a radius and a
  radial default would make the library's commonest formation look inert.
- **It cannot colour a grey object** — there is no hue in an achromatic colour
  to turn. That is the device's boundary, not a bug; reach for a palette
  colorizer when the source has nothing to rotate.
- **`colorShift.huePerceptual` picks the circle**, and defaults to OKLCH for new
  saves. HSL's hue circle is a construction on the RGB cube: its yellows are far
  lighter than its blues, so an HSL sweep PULSES in brightness twice a turn and
  flattens the lit form each time it passes yellow (measured: L drifts >0.1 over
  a sweep of a mid blue, versus <0.02 in OKLCH — `hueRotate.test.ts` pins both
  arms, including the HSL one, so a three.js change that "fixes" offsetHSL is
  caught rather than silently making the flag pointless). The maths is
  `rotateHueOklabLinearRgb` in `utils/oklch.ts`, in place on three's linear
  values with no hex round trip; chroma is HELD and the gamut clamp absorbs the
  overshoot, because clipping desaturates while a chroma walk would shift hue.
  Saturation/lightness stay HSL offsets — they were dialled against that scale.
  Per this file's rule the field went into `colorShift` (not beside it) AND into
  `instrumentFrame.ts`'s signature buffer, or flipping the mode while paused
  would change nothing on screen.

Three colorizers now declare the same MAP constants by value (`COSINE_MAP_*`,
`RISO_MAP_*`, `HUE_MAP_*` — identical numbers on purpose, since two devices
asking "where does this copy sit" must not answer differently). A FOURTH should
extract them into a shared module rather than copy them again.

## `bypass` — the device that acts on a DEVICE

Nested under a mover/splitter/colorizer, its notes switch that parent off: while a note
is held the parent evaluates to identity and everything else in the chain keeps running.
Its MODE segment flips the polarity, so the parent can instead be off at rest and on for
the length of each note — which is the half that makes it more than a mute, since a muted
device is off for the whole timeline. Five things carry it:

- **It is not a chain entry, and every walk over a track's chain children has to agree
  about that.** `core/visual/resolve.ts`'s `isChainEntryTrack` is the one predicate
  (`definition.parentGate`); `resolveMoverOrSplitterTrack` lifts the lane out, resolves it
  to its `bypassAt`, and wraps the finished parent in `bypassGated` — OUTSIDE the frame /
  child chain / copy-targeting wrappers, because "this device is off" has to mean all
  three. Three other places re-walk `childIds` counting entries to line automation lanes
  up with the already-resolved chain (`weaveSplitterTfLanes`, `weaveTfAutomationLanes`),
  so a filter that disagreed by one track would weave every lane into the wrong slot; that
  is why they share the predicate rather than each testing for a definition.
- **Under a MOVER it is not part of the frame; under a SPLITTER not part of the child
  chain.** Left in either it would resolve as an ordinary identity entry and gate nothing —
  which looks exactly like the feature not working. `bypassRuntime.test.ts` pins both the
  chain length and the gating, so the two halves can't drift apart.
- **A bypassed SPLITTER varies the copy count with the beat**, which the invariant below
  forbids for a definition's own settings. The sanctioned way out is the automated mover's:
  `bypassGated` publishes the UNGATED entry as `structuralVariants[0]`, so the probe sizes
  the pool at full fan-out and bypassed frames are padded with hidden copies. Without it a
  splitter that happens to be bypassed at beat 0 — the beat the probe samples — mounts a
  pool of one and overflows on every later frame.
- **The gate is binary, and that is a design decision, not a missing knob.** A chain
  entry's contribution is a matrix and "half a mover" is not a well-defined interpolation
  of one; a splitter's is a copy count, which is worse. A fade already has homes: automate
  the parent's params, or use Visibility when what you want is the object dimming.
- **`apply` gates on `context.beat`, `warpBeat` on the real playhead beat** — each is
  gating what its own arm is asked about, which is what makes bypassing a Freeze
  un-freeze the object rather than nothing.

It is `kind: 'mover'` for storage and chrome, but `parentGate` keeps it out of the library
shelf and out of the "add mover track" lists on objects and groups (where it would gate
nothing); the mover/splitter context menu offers it under "Switch this device with".

## `switcher` — a RACK of anything, with one MIDI lane over it

A `switcher` TRACK (not a definition — `editor/types.ts`'s TrackType, like `group`) gives
each of its children a row and says which of them are running.

**A row may be anything, and the lane does not know which is which** — that genericity is
the point, and it costs one branch: a DEVICE row splices chain entries (gated by
`switchGated`), an OBJECT or GROUP row gates its objects' visibility instead
(`ResolvedObject.liveAt` → `blackedOut`), and a nested SWITCHER row contributes its own
span gated as one. So a MIXED rack works, and switching a cube for a grid of spheres is
the same gesture as switching one mover for another. `switcherChildTracks` is the one
place that says what may be a row; `chainEntryCount` sums (objects contribute 0).

Two things about the object arm that are not obvious:

- **A switcher resolves to a `ResolvedGroup` placement node as well.** Not a convenience:
  `computeAtBeat` composes an object's world from `worldMatrices.get(obj.parentId)`, so a
  rack standing between an object and its group would otherwise have no matrix under its
  id and the object would silently lose the group's transform. It also makes a rack
  movable as one, exactly like a group — hence `tf*` on the timeline strip.
- **Gating is visibility, never structure.** Every member stays mounted and the object
  list is unchanged; only `blackedOut` (and therefore `energy`) flips. Several racks above
  one object compose by AND, so an inner rack cannot re-enable what an outer one switched
  off. A rack therefore does NOT save the cost of what it hides.

Five things carry the device arm:

- **Gate mode with every row held is bit-identical to those devices being plain chain
  siblings.** That is the design, not a nice property of it: exclusivity, latching and the
  empty lane are all restrictions on WHICH SUBSET runs, and none of them changes how the
  running entries compose. `switcherRuntime.test.ts`'s first test asserts exactly that and
  is the tripwire for every ordering, splice-position and gate-wrapper bug at once.
- **Splicing, not delegating.** One entry running a sub-chain internally would be called
  PER COPY by the kernel, so its inner entries would see `index`/`count`/`formation`
  describing a private fan-out instead of the real formation — every position-reading
  device (Symmetric Motion, a world-placed field, Conveyor's belt period) would measure the
  wrong thing. Splicing also lets each child keep its own `composition` declaration, which
  a folded-together entry could not express for a mixed set. A NESTED switcher is one row
  of the outer lane that owns several entries; the outer gate switches the whole span.
- **The four modes** (`params.mode`, append-only) are Gate / Toggle / Solo / Latch — a
  voices × notes matrix where every cell is real. Solo and Latch are
  `directors/sceneSwitcher.ts`'s two modes lifted verbatim, newest-onset-wins included, so
  the two switchers cannot disagree about what a chord means. Toggle's parity does NOT
  self-correct (one inserted note flips that device for the rest of the timeline); the
  panel says so, and that is the reason it says so.
- **An empty lane runs everything**, so wrapping devices changes nothing until you play it
  — the `scene` def's non-destructive convention. Not a special case: it is the full subset.
- **The copy ceiling depends on the MODE, and the variant publication has to follow.**
  Gate/Toggle can run everything at once, so the ceiling is the PRODUCT of the children's
  fan-outs and every entry publishes its ungated self at `structuralVariants[0]`.
  Solo/Latch run at most one, so the ceiling is the MAX: entry *i* publishes a variants
  array that is pass-through everywhere except rank *i*, and rank *r* then probes "only
  child *r* running". Exclusivity therefore SAVES the pool rather than costing it. Get the
  Gate direction wrong and a rack whose beat-0 subset is small mounts a pool for it and
  overflows on every later frame — bypass's bug, one rack over.

Mute/solo among the children are AUTHORING overrides that beat the lane: such a device
keeps its slot in the span (so pitches and rows never shift) but is gated permanently off
and publishes no variants, so it adds nothing to the ceiling either.

## Invariants

- **Copy COUNT never depends on the beat** (fixed at resolve; MIDI gates opacity). VisualEngine warns if violated. Count may still be DERIVED from settings rather than asked for — Duplicate sizes its trail from speed × density so it doesn't need a length knob. AUTOMATED settings are the sanctioned exception: an automated entry carries `structuralVariants` (the def resolved at each lane's min/max reach), `structuralCopyCount` sizes the mounted pool to the maximum, and frames asking for less are padded with hidden copies — so a definition may return fewer copies than its structural max under automation, but never more, and never fewer because of the BEAT itself. Sound while count is monotonic in each param (true of every shipped def).
- **A copy directly behind a convex object is invisible unless it covers more screen**, and perspective shrinks faster than any sane world-scale value grows (a 6× copy 50 units back reads at half size). Depth-axis splitters therefore measure size in APPARENT terms and divide the shrink out — see `duplicateTrail`; the camera sits at z = 5 (`TUNNEL_CAMERA_Z`).
- Everything evaluated per frame must remain a pure function of `(beat, settings, context)` — same purity rule as instruments.
- **A negative-determinant transform is safe to return** — Symmetry's reflections are real mirrors (det −1), not 180° turns. `Matrix4.decompose` negates one scale axis for them, and `WebGLRenderer` checks `matrixWorld.determinant() < 0` per mesh to flip the winding, so ObjectRenderer's decompose-into-a-group path lights and culls reflected copies correctly with no special casing. Verified in-scene: the mirrored copies reach the renderer at det −1. Anything that `invert()`s a chained transform still works (det −1 is invertible); only a DEGENERATE matrix needs the determinant guard Motion's basis needs.

- **A per-copy wrap is only safe at the FORMATION's own period.** Folding each copy into a box of the mover's own choosing (Conveyor's first version, and Motion's `boundX/Y/Z` on `codex/motion-wrap-fix`) tears any formation apart: a copy reaches the face while its neighbours are mid-frame and teleports a box-width away from its own row, so a Grid stops being a Grid the moment the mover is added. The only per-copy fold that preserves an arrangement is by one lattice period — extent + spacing, measured from `context.formation` (`latticeAlong` in conveyor.ts) — because that maps the lattice exactly onto itself. When there is no lattice (one copy, or uneven spacing), fall back to displacing the whole formation identically and dissolve through the turn; never guess a period. Either way, wrap ONLY the axes with travel: folding a still axis silently rearranges what a splitter built there.
- A per-copy wrap PRE-multiplies its delta — the fold is measured along fixed axes, so a rotation above the mover must not turn it.
- **Hiding a teleport with a fade means tying the fade to SPEED, not to the box.** A fade band expressed as a fraction of the span is crossed in two frames by a fast belt, so the copy is still ~40% visible when it jumps (measured: 0.376 at speed 3). Derive the band from `speed × fadeBeats` and the dissolve always lasts the same number of beats.

- Chain ORDER matters for world-placed movers, because they read the live chained position: a Motion **above** an Impact Scatter drifts the object away from the blast, weakening and delaying the hit; **below** it, the blast stays full strength and the drift rides on top. Put the drift in the Scatter's frame instead to move the blast WITH it.

## The Colorizer's palette

Five flash rows (one per color slot) + the rainbow row. Two things constrain the pitches and are easy to get wrong:

- **Slot 1 keeps pitch 60 and the un-suffixed `color` key**, so every project saved before the palette existed keeps its notes and its color with no migration. The rainbow already owned 61, so slots 2-5 take **62-65** — the pitches are deliberately non-contiguous.
- **Row ORDER is not pitch order.** `generateInstrumentRows` renders rows in the order `midiRows()` returns them (it does not sort), so the five colors are listed together with the rainbow underneath. Rows carry their own live `color`, which is why `midiRows` takes settings: the piano roll IS the palette, and repainting a slot repaints its notes.

Overlap rules differ by axis, and both matter: notes on ONE row take the loudest (two flashes at once are still one flash), while notes on DIFFERENT rows **blend** — each row's color weighted by its own gain, averaged in OKLab — with the overall strength still the loudest row's, never the sum. Hue is averaged as a Cartesian a/b pair, never as an angle (350° and 10° average to 180°, the opposite color). The single-sounding-slot case short-circuits and returns the user's hex verbatim, so the common path does no color math at all; `colorizerPalette()` pre-parses the five slots once per resolve rather than per copy per frame.

`identityColor` on a definition (same contract as an instrument's) makes the chain entry WEAR that color in the UI — device row, timeline block, drag ghost. Chain entries otherwise inherit their instrument's color so a lane family reads as one voice; the Colorizer opts out via `{ param: 'color' }` because it HAS a color the user picked. Resolved in `utils/trackDisplayColor.ts`, and it still loses to the achromatic guard.

Adding one: new file with a definition + entry in `library.ts` + (optional) bespoke settings UI in `userInterfaceRenderers/bespokeRegistries.ts` keyed by the definition id; the generic param list is the fallback. A splitter that LAYS COPIES OUT in space should also spread `SPLITTER_SIZE_PARAM` into its params and post-multiply `applySplitterSize` onto each slot — `splitterSize.test.ts` will name it if it hand-rolls a `size` of its own.
