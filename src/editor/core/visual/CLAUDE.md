# core/visual — the visual engine

The pipeline: **resolve** (document → graph, on edits) → **computeAtBeat** (graph → per-object state, per frame) → renderers read state imperatively.

## VisualEngine.ts — module singleton, deliberately NOT a store

Per-frame state must never trigger React re-renders; renderers pull it from `useFrame` via `getObjectState(trackId)` / `getVisualCopy(trackId, index)`. The ONLY React-visible signal is the structural object list (`subscribeObjects`/`getObjectList`), republished on resolve — one `ObjectListEntry` per VisualCopy occurrence, so `VisualScene` reconciles mounts only when structure changes, never per frame.

- One `ResolvedGraph` per scene; `setProject` reuses a scene's graph when its inputs are referentially unchanged (`graphInputs` map). Below that, `resolveProject` reuses **per-track** resolutions (WeakMap keyed on the object track's ref, validated against its subtree refs + tempo — see the cache block in resolve.ts): a one-note edit re-resolves one track, not the scene (~0.1ms vs ~3ms at 30 dense tracks, and the gap widens with project size). Cached entries are never emitted directly — each resolve emits a shallow copy with its own chain array and scratchBase, so global-mover appends and the solo pool stay per-resolve. `resolveReuse.test.ts` pins the invalidation rules; anything NEW a per-object resolver reads must land in `resolveDeps` or edits to it won't re-resolve. Dev builds trace each debounced resolve: `performance.getEntriesByName('cabin:setProject')`.
- `computeAtBeat(beat)`: samples automation lanes in whatever mode each is in (one call to `sampleAutomationLane`), evaluates envelopes (`adsr.ts`) and note energy (`energy.ts`), composes world matrices down the track hierarchy (`stateVector.ts`: pos + axis-angle rot + logScale + opacity), applies the canonical `tf*` transform as parent of the instrument's `localTransform`, then refreshes VisualCopy values.
- **Copy-count contract**: the number of VisualCopies is fixed at resolve; MIDI gates opacity, never slot count. Hidden copies stay mounted at opacity 0. The fixed count is the chain's MAXIMUM reach, not a beat-0 sample: automating a count-shaped mover param (Radial Motion's `copies0/1/2`) legitimately varies the per-beat count, so the resolver attaches min/max-reach resolutions to automated entries (`structuralVariants` on `MoverOrSplitter`, sized by `automationLaneValueBounds`) and `structuralCopyCount` probes the pool against them. Frames below the max are silently padded with hidden copies; only OVERFLOWING the pool warns (a beat-varying def, or one non-monotonic in an automated param).
- **Per-object beat remap**: before anything else, each object's chain is asked for a time warp (`warpChainBeat`; only Freeze answers today). Everything after reads `objBeat`, not the playhead `beat` — that's what makes a frozen object a genuine still frame rather than one that keeps animating. The warp is a pure function of the real beat, so the purity rule holds; note `resolve.ts`'s automation memo forwards `warpBeat` UNmemoized on purpose (it's asked for the real beat while `apply` is asked for the warped one, so sharing the cache would thrash it every frame).

## resolve.ts

Flattens each scene's track forest depth-first (cycle-guarded), expands looped blocks' notes (`noteFlatten.ts`), gathers child lanes per object: `automation` (in one of its four modes, below), `envelope` (ADSR), `ability`, effect-automation (`fx:<instanceId>:<key>` targets, parsed by `effects/automation.ts`), and the track's mover/splitter chain. `ProjectSnapshot` is a structural slice of ProjectStore — the engine never imports store internals.

**Child ORDER routes spatial tf\* lanes** (`weaveTfAutomationLanes` + `tfAutomationChain.ts`, 2026-08): an automation lane on tfX/Y/Z, tfRot\*, or tfSize that sits ABOVE a mover/splitter sibling becomes a count-neutral chain entry post-multiplying each copy with the lane's DELTA from the panel value — so a splitter below it duplicates the already-animated object (a grid under a rotation lane spins every cell in place). A lane BELOW every chain child stays on the params-overlay path, bit-exact with the historical whole-formation behavior. Two traps if you touch it: (1) the lane's slot MIRRORS across the chain (a lane with g chain siblings above lands after chain position n−g), because chain composition frames top-down while the user reads children as a pipeline — inserting the delta at the lane's own position reproduces the old orbit behavior exactly and looks like the feature doesn't work; (2) the delta is RELATIVE to the panel value so inert lanes are no-ops and keyframe values stay absolute, which means the placement path must keep composing the panel pose untouched (never remove the param from placement). tfOpacity and instrument-param lanes are order-free and always overlay. Embedded lanes are absent from `obj.automations`, so the transform panel's slider shows the panel value, not the lane's. **Every push site in `resolveAutomationLanes` must stamp `sourceTrackId`** — a mode added without it silently falls back to the overlay path when its lane sits above a splitter.

**SPLITTER tracks offer the spatial tf\* params to their own lanes too** (`weaveSplitterTfLanes`): such a lane becomes a `tfAutomationChainEntry` woven among the splitter's mover children at the lane's child position — it acts exactly like a mover child in that slot, moving the splitter's copies about the splitter's origin in its reference frame (`visualCopies/splitterChildChain.ts`), count-neutral and never re-framing the chain below. NO mirroring here, unlike the object-track weave — the splitter child chain composes top-down in child order already. Base is the panel value (splitters store no tf\* params, so the transform default), so keyframe values are absolute deltas and inert lanes are no-ops. The UI surfaces offering the list (context menu, piano-roll rows, retarget dropdown) all go through `withSpatialTransformParams` (core/transform.ts) — opacity is excluded, it isn't a transform.

**A chain child contributes 0, 1 or N entries, and `chainEntryCount` is the one place
that says which.** 0 for a BYPASS lane (a `parentGate` definition — it is not an entry of
anything; `resolveMoverOrSplitterTrack` lifts it out and wraps the finished parent in
`bypassGated`, outermost of the frame / child-chain / copy-target wrappers). 1 for an
ordinary device. **N for a SWITCHER**, which splices its whole rack into the chain it sits
in, contiguously in child order (`visualCopies/switcher.ts`).

Five walks share that count and they must not disagree by one:
`resolveMoverAndSplitterChain`, `weaveTfAutomationLanes` (`entriesAbove += n`),
`weaveSplitterTfLanes` (`chainIndex += n`), `priorChainPrefixes`, and the group/global
passes — all of which now go through `resolveChainChildEntries` for the resolving half.
Before switchers this was a hazard; with a child that can own several slots it is a
certainty, and the failure is silent: every automation lane below the disagreement weaves
into the wrong slot. `bypassRuntime.test.ts` pins the 0 case, `switcherRuntime.test.ts`
the N case (including a tf lane weaving against a rack, asserted as transparency rather
than as an index).

**GROUP tracks** (`type: 'group'`) resolve to placement nodes (`ResolvedGraph.groups`), never objects: per frame `computeAtBeat` interleaves them among the objects at their DFS slot (`afterObjectIndex`) so a group's world matrix (tf\* params + their lanes, sampled per frame) is composed before any member reads it, and its `tfOpacity` accumulates through `inheritedOpacities` onto member objects (objects pass the value through without adding their own — nested-object behavior is unchanged). A group's mover/splitter children broadcast at resolve: each appends to the chain of every member OBJECT above it in the group's child order, per member in the member's own frame (deepest group first, so a member chain reads [own chain, inner group entries, outer group entries, global movers]). `isChainChild` counts group children, so they never route through `targets`. A broadcast Freeze warps each member; the group's own placement always samples the real beat.

**THE SCENE INSTRUMENT** (`core/sceneTrack.ts` — read its header first) reaches the resolver as an ordinary `group` track at the front of the roots, so the group machinery above carries its `tf*` and its automation lanes for free. Three things are bespoke, all in `resolveProject`:

1. **It parents every ROOT object and root group** (`parentId: track.parentId ?? sceneTrack?.id`) — nothing is nested under it in the document, so the implicit parenting is what makes its transform move the scene as one. Stamped on the EMITTED object, never on the cached `base`: the per-track cache is keyed on the track's own ref, and toggling ⌘⇧S changes neither the track nor its subtree, so baking it in would leave every cached object claiming a stale parent. It never parents itself.
2. **Its chain broadcasts to every object in the scene**, not to "members above" — it holds no members. It is FIRST in DFS, hence last in the reversed group walk, so its entries land after every real group's: the right nesting order for an outermost container.
3. **A COLORIZER on it paints the BACKDROP**, and is kept out of every object chain (`ResolvedGraph.backdropChain`). This is the one place `def.kind` steers resolution — the visualCopies guide calls it a UI-only discriminator — and the exception is deliberate: objects already have colorizers on their own track, on a group, and via a routed global entry, while the backdrop had **no** beat-driven route at all. `computeAtBeat` evaluates the chain once per frame (copy 0 only — a backdrop is one surface, so a splitter there multiplies objects and nothing here) and `getSceneBackdrop(sceneId)` is what `VisualScene` clears and paints the gradient with. `shiftHex` mirrors `instrumentColor.ts`'s order and both hue regimes exactly, so a colorizer cannot mean one thing on a cube and another on the wall behind it. A transparent backdrop is left alone; both gradient stops travel through ONE shift. "Grade the whole scene, objects included" is the scene EFFECT chain's job, not this one.

## automation.ts — one lane, five modes

An automation child track's notes mean one of five things, and which one is
implied by the config the track carries (`automationMode()` owns that precedence;
burst beats noise beats cycle beats force if a document somehow has several). All
five are pure functions of the beat, so the pause invariant holds for every mode:

| mode | config | what a note is | between notes |
|---|---|---|---|
| curve | `interpolation` | a value keyframe (pitch → value) | eased per segment, or splined through all of them; endpoints held |
| noise | `Track.noise` | a gate for seeded random wander around its value | **inert** |
| burst | `Track.burst` | an ADSR burst from the value underneath toward its own pitch-value, velocity = intensity | **inert** |
| cycle | `Track.cycle` | an ONSET dividing time: the motion curve plays once between each consecutive onset pair, stretched to fit | the cycle itself; **inert** outside the onset span |
| force | `Track.force` | a PUSH applied to a body with mass — no target at all | wherever the pushes left it; **never inert** |

**CYCLE mode** (`Track.cycle`): the shape is one cubic bezier y(x) with editable
ENDPOINT heights — seam continuity is not an option, it is whether the user's
endpoints match. The earlier onset's pitch-value is the cycle's high (y = 1)
over a configurable `floor` (default 0); `invert` flips the note to the LOW
under a constant `ceiling` (default param max). Duration is deliberately
ignored (onsets only), chords collapse to one boundary keeping the largest
value, and a lone onset is inert — there is nothing to stretch to. The
`noteSpan` toggle flips the span rule: each cycle runs onset → its own note's
END (duration matters again, a lone note cycles, the gap after a note is
inert, and the newest sounding note wins an overlap — an older longer note
resumes mid-flight when it ends). Works on `fx:` lanes like burst does
(`enabled` stays keyframes). Bounds for structural budgets come from the
bezier's height hull (min/max of the four Ys).

**SPLINE interpolation** (`interpolation: 'spline'` + `Track.splineTension`) is a
CURVE-mode easing, not a fifth lane mode — it answers "how do I get from keyframe
to keyframe", which is exactly what `interpolation` means, so it inherits amount,
row-spread and retargeting for nothing. It is the only easing that is not a
per-segment function: every other one shapes one hop in isolation and therefore
kinks at every note (`ease-in-out` arrives dead stopped at each one). Spline fits
ONE curve through all the keyframes with velocity **and** acceleration continuous
everywhere — C2 — which needs two things that are easy to get wrong:

- **A tangent belongs to a KNOT, in value per BEAT**, and both segments meeting
  there read that one number. That is where continuity comes from; a slope
  derived per segment from its own endpoints is what kinks.
- **The segment is a QUINTIC Hermite with acceleration pinned to 0 at each knot,
  not a cubic.** A cubic can honour a prescribed tangent *or* C2, never both:
  fix the tangents and acceleration jumps at every knot; demand C2 and the
  classic spline solves for the tangents, leaving `tension` nothing to act on.

The tangent is the NON-UNIFORM three-point difference, `(v[i+1] - v[i-1]) /
(b[i+1] - b[i-1])`, times tension. Dividing by the spanned TIME (not the uniform
Catmull-Rom's constant 2) is what makes it a real velocity and what makes the
shape gap-independent — the ride between two notes is identical at any spacing.
**Get that wrong and the lane is still perfectly smooth**, it just rides
differently as note spacing changes, so the test that catches it is the
spacing-independence one, not the continuity ones (established by mutation).
End knots take tangent 0, which is not a shortcut: `sampleLane` holds the
endpoint values flat outside the keyframe range and only a zero tangent joins
those flats without a corner, so the lane is C2 over ALL beats.

**It is the default a NEW lane is created with** (`addAutomationTrack` writes
`interpolation: 'spline'` explicitly). Note what was deliberately *not* done: the
`?? 'linear'` absence fallbacks in resolve.ts and TrackEditor stayed put. That
fallback is what every saved lane predating the `interpolation` field reads, so
moving it would silently re-interpolate already-shipped projects — a document
whose playback changes under it, with no upgrade step to point at. New lanes get
the new default; old documents keep their own.

Tension 0 collapses each segment to quintic smootherstep; 1 is neutral (stored
as absence) and 2 is the max. Spline is the one keyframe easing that can leave
its keyframes' own span — that overshoot IS the tangent working — so
`sampleAutomationLane` clamps it to the lane's bounds like cycle and the shaped
bursts, and `automationLaneValueBounds` widens the keyframe hull by
`0.2 * (|m0| + |m1|)` per segment (0.198 is where the two tangent basis
functions peak) so a mover's copy pool is budgeted for the swing. Both are gated
on the mode, so every other easing stays bit-identical.

**FORCE MODE** (`Track.force`) is the odd one out, and the distinction is worth
stating plainly because it explains every design choice in it: the other four
modes are all **target-seeking**. They name a destination and travel there — a
keyframe interpolates to the next value, a burst travels from the value
underneath toward the note's own, a cycle rides between two bounds. A spring is
only the mushiest member of that family; it is still a restoring force aimed at a
rest point. A force lane has **no destination at all.** One body with a mass;
notes apply pushes; the value is the consequence.

Four things follow, all of them load-bearing:

- **It is stateful, which no other mode is.** The value at beat 40 depends on
  every note before it, so there is no formula to evaluate at a beat. The purity
  rule still holds because the integration runs ONCE at resolve, from a fixed
  origin, into a fixed-step table (`FORCE_TABLE_STEP` = 1/64 beat, integrated at
  4× that), and `sampleAutomationLane` does a lookup plus a lerp. **Never
  integrate per frame** — pause, scrub and export would each pay for the whole
  phrase. This is the only lane that does real work in `resolve.ts`.
- **The physics is normalized to the lane's own range**, then mapped back to
  param units, so MASS and FORCE feel identical on a 0..1 opacity and a -360..360
  rotation, and a retarget can't silently change the feel. `home` is likewise a
  FRACTION of the range, not param units.
- **The body starts at its EQUILIBRIUM** — on the floor under gravity, at HOME
  under a pull, mid-range with nothing acting — deliberately *not* at the value
  underneath. That keeps the table independent of the param knob, so a knob drag
  can't force a re-integration; and a lane with notes owns its param outright
  anyway, exactly as a keyframe lane does.
- **It never goes inert.** Burst/noise/cycle return NaN between their gates so the
  base shows through; a pushed body stays where it landed, so the endpoints HOLD.

Two behaviours that look like bugs and are not. **Dry friction has a real stall
force**: a body parked above the floor under gravity will simply stay there
rather than sliding back (a box on a slope), and a weak thrust may not break it
loose at all. That is why `thrustGain` is geared well above `kickGain` relative
to `mu` — a sustained push that can't move anything reads as a dead control — and
why a note near the middle row still stalls under `signed` aim, which is correct,
since that row means no force. **The range limits are always cushioned**, never a
hard stop and never a bounce: a hard stop is a velocity discontinuity, the one
thing this mode exists to avoid, and a bounce would put the spring back.

Bounds for structural budgets are exact here — the table IS every value the lane
can emit, so `automationLaneValueBounds` just walks it.

Automation lanes are RETARGETABLE from the panel (`setAutomationTarget`):
same one-lane-per-param rule as creation, `automationRange` resets (its
min/max speak the old param's units), and the lane renames only when it still
wore the auto-name.

**`sampleAutomationLane(lane, beat, base)` is the only place the mode is read.**
The engine, the hover preview and `paramAtBeat` all go through it, so they cannot
disagree and a new mode lands in all of them at once. It returns **NaN for
an inert lane** — callers keep the value that was already there, which is what
makes burst/noise composable with the base param and with each other. `base` is
what a burst departs FROM; the other modes ignore it.

Burst reuses `adsr.ts`: `adsrGateGain` is the per-note piece (exported for exactly
this), and overlapping bursts blend toward their gain-weighted target with the
total travel clamped at 1 — the same sum-and-clamp stacking `evaluateAdsrGain` does.

**Burst SHAPES** (`Track.burst.shape`, absent = 'adsr' for every pre-existing save):
'bezier' rides a user cubic-bezier — rise 0→1 along the curve over `riseBeats`
(control Ys past 1 overshoot), hold, play it back over `fallBeats` — and 'spring'
is a closed-form damped-spring simulation (stiffness/damping/mass, per-beat time
base; underdamped rings, release springs back seeded with the exact held state).
Both may return gain > 1, so their travel cap is 2 (the classic ADSR keeps its
historical cap of 1, bit-identical), and `sampleAutomationLane` clamps the shaped
result back to the param range. `burstGateGain` is the one shape dispatcher;
`automationLaneValueBounds` includes the overshoot reach (clamped) for the
structural budgets. The panel's bezier window is a real control-point editor;
the spring window plots a demo note through the actual evaluator.

Burst works on `fx:` lanes too, taking the effect's stored setting as its base. The
`enabled` pseudo-param stays a keyframe lane (a 0/1 toggle has nothing to travel
through). Noise on `fx:` lanes is NOT wired — such a lane silently behaves as
keyframes, as it always has.

**ROW SPREAD** (`Track.automationRange`, absent = the frozen historical mapping):
a lane may reshape how its pitch rows spread onto values - a value SUB-range
(`min`/`max`), a row COUNT (`rows` 2..49, rows fill upward from pitch 36 and the
top row IS the max), INTEGER counting, and a spread `curve` ('linear' | 'fineLow'
| 'fineHigh' | 'sCurve'). `pitchToValueRanged` (core/trackTypes.ts) is the one
mapping both the engine (extraction in resolve.ts) and the editor
(generateValueRows' labels) read, so a note can never mean different things in
the roll and in playback. The panel's Rows·Range console emits a NORMALIZED
config - defaults collapse to absence.

Two invariants the rows keep, and the reason the INT arm is shaped the way it is:
**the bottom row is the min, the top row is the max, and the steps between them
are even.** INT used to be a `Math.round` on top of whatever spread the rows
already had, which broke both — a 1..12 count lane labelled two neighbouring rows
"7", and five rows over 0..10 stepped 3-2-3-2. So INT now DERIVES the count
(`automationIntegerGrid` / `automationRowCount`): the rows are the whole numbers
of the range, counting up from the min, and `rows` + `curve` stand down while
it's on (the panel greys them). A span too wide for the 49 pitch rows widens the
step to the narrowest whole number that still lands exactly on both ends
(-360..360 counts by 15); a span with no such divisor keeps the narrowest fitting
step and spends its LAST row on the max, one short gap being the price of the top
row still being the max. **This reinterprets existing INT lanes' pitches** — the
config shape is unchanged, so there's no upgrade step; the feature was five days
old and demonstrably wrong when it changed (2026-08-14).

**A lane may aim PAST the param's own bounds.** `automationValueBounds` returns
the range config's min/max *unclamped* by the param def — the panel's MIN/MAX
knobs travel one full param span beyond each end — and the clamps that used to
read `pdef.min/max` (the pitch mapping, the amount gain, and the lane's
`min`/`max` that sampling clamps noise/cycle/burst to) all read the lane's own
bounds now.

**AMOUNT** (`Track.automationAmount`, default 1, 0..`AUTOMATION_AMOUNT_MAX`) is a
whole-lane output gain, mode-independent: applied at EXTRACTION in resolve.ts (the
one choke point every consumer shares), it multiplies keyframe values, noise centers
+ deviation, and burst target values. A BOOST lifts the ceiling with it
(`automationOutputBounds`: amount 3 on a 0..2 lane reaches 6) — cranking the fader
has to actually go somewhere, and clamping back to the param's max made it a no-op
past `max/amount`. Attenuation (< 1) doesn't narrow the bounds; scaling toward zero
needs no headroom, and narrowing would fight a lane whose min is above zero. Noise's
deviation is a fraction of that span, so `scaledNoise` (resolve.ts) re-bases the
stored `range` onto the boosted span — the wobble scales exactly once, and amount 1
is bit-identical to before. It deliberately does NOT touch `fx:` `enabled` lanes —
that's a 0/1 switch read against a 0.5 threshold, and a gain there is just a surprise
off-switch. Neutral (1) is stored as field absence (`setTrackAutomationAmount`).

## instrumentFrame.ts — the per-frame entry point for instruments

`useInstrumentFrame(trackId, cb)` is the ONLY way instruments do per-frame work (lint-enforced). Contract:
- cb sees `ObjectState` (beat, params, energy, notes…), canvas size/DPR, camera pose — nothing wall-clock.
- **Signature skip**: if none of the inputs changed, cb is not called (pure function ⇒ same pixels). This is what makes paused editing cheap.
- **Return `false` if you can't apply the frame yet** (refs unattached, canvas not ready). A silent bail eats the change and the object renders stale until the next input change — which may never come while paused (the LaserSphere "params do nothing until remount" bug).
- Runs after `VisualBeatSync`'s computeAtBeat (mount order), so state is always this frame's.

## instancedFrame.ts — the instanced copy-pool fast path (2026-08)

`useInstancedCopyFrame(trackId, cb)` is the instanced counterpart of
`useInstrumentFrame`: ONE mount per track draws every VisualCopy occurrence by
writing per-instance buffers on an `InstancedMesh2` (@three.ez/instanced-mesh),
instead of VisualScene mounting one ObjectRenderer + instrument component per
copy. An instrument opts in with `instancedComponent` on its def; Cube is the
reference port. Facts that cost time to establish:

- **Routing lives in `components/visual/InstancedObjectRenderer.tsx`**, which
  falls back to the per-copy path whenever the track has ANY effect instance
  (own or group-broadcast, enabled or not — an `enabled` automation lane can
  switch a disabled one on), a routed crop mask, or full-frame mode. The
  fallback keys are byte-identical to the ungrouped mounts, so flipping an
  effect on/off remounts cleanly.
- **Deliberately NO signature skip**: copy transforms refresh imperatively in
  computeAtBeat and aren't identity-comparable, so a skip would eat paused
  mover-knob drags. The callback runs on every rendered frame; RenderGovernor
  still gates frames while paused.
- **Per-instance opacity is the colors texture's alpha**: `setColorAt` writes
  rgb only (3 floats at offset id*4), `setOpacityAt` owns the 4th — order-free.
  Mirror applyMaterialOpacity's rule by flipping the shared material's
  `transparent` when any copy is mid-fade; hide (never just fade) copies at
  ≤0.001 or the ghost-wall depth artifact returns.
- **Custom ShaderMaterials CAN instance**: the lib registers global
  `ShaderChunk['instanced_pars_vertex']` etc. at import, and the mesh's
  onBeforeCompile injects `USE_INSTANCING_INDIRECT` / `USE_INSTANCING_COLOR_INDIRECT`
  defines (fires for ShaderMaterial too). Include the chunks, call
  `getInstancedMatrix()` / `getColorTexture()` — `createInstancedPosterMaterial`
  in instruments/posterShading.ts is the reference.
- **Scale effects DO ride the instanced path** (the one effect that does): they
  are a per-track scalar the placement math already lifts outside the copy
  transform, so `InstancedObjectRenderer` filters the track's own instances and
  hands them down `InstancedScaleContext` for `composeCopyMatrix` to compose via
  `composePostMoverScale` — same order, same beat source (real playhead / export
  override, not the object's warped beat) as ObjectRenderer. Any OTHER own
  effect, or any effect on a group ancestor, still falls back per copy. Scale is
  the most common effect, so falling back on it would have gutted the fast path.
- **Per-copy colorShift on shared materials reaches DIFFUSE only** (instance
  color): gloss emissive and the unlit-gloss surface carry the track's own
  color, not the copy's. Documented fidelity trade; the poster path is fully
  per-copy. The shift math is `applyColorShiftToColor` (instrumentColor.ts),
  the same function the string-param path uses, so the two paths cannot drift.

## Supporting files worth knowing

- `VisualBeatSync.tsx` — mounted once in Canvas; per-frame `computeAtBeat`, plus synchronous `syncParams` on store changes and a debounced (~80ms) structural re-resolve.
- `pauseCanary.ts` — dev-only: hashes the scene while paused, names any object that moves (backstop for the purity rule).
- `beatOverride.ts` — export's hook: overrides the beat the engine computes at, bypassing the transport.
- `wordFormation.ts` — Word Formation lanes: the geometry a text instrument seats its
  words into. Pure (no three, no store, no React), so it is imported by the resolver,
  the instrument AND the settings panel — all three read the same `formationSeats`, so
  the panel's preview cannot drift from what renders. Three things worth knowing:
  - **It is deliberately NOT a splitter.** A splitter gives geometry without content
    (`VisualCopy` is content-blind, so all four cells of a 2×2 render the same word) and
    its copy count may not depend on the beat. Because these are not copies, the COUNTS
    are freely automatable — nothing has to size a mounted pool ahead of the playhead —
    which is the one capability the chain could never have given this.
  - The lanes are gathered in `resolve.ts` (`resolveWordFormations`, mute/solo like the
    ability lanes) and their settings are sampled per frame in `VisualEngine` beside
    `params`, so an automated Columns arrives already resolved at the instrument.
  - **Geometry is knob-driven, so `syncParams` refreshes it at 60fps** like the envelope
    lanes' sliders — and it REPLACES the lane array rather than mutating it, because
    `instrumentFrame`'s signature compares it by reference. Mutating in place drags a
    knob with no repaint at all while paused, which reads exactly like a dead panel.
- `automation.ts` — the three automation-lane MODES and the one function that dispatches between them.
- `energy.ts` — the note-pulse "energy" signal instruments receive.
- `noteWindow.ts` — bisected windows over a sorted note stream, for the per-frame consumers that used to scan every note of an object per frame (`activeNotes` in computeAtBeat, `evaluatePulse`, `evaluateAdsrGain`, the splitter mute rows in `visualCopies/splitterMidi.ts`). Each caller still applies its own exact predicate inside the window, so the answers are bit-identical to the full scans (`noteWindow.test.ts` pins that against verbatim copies of the old evaluators). It leans on `flattenBlocks` sorting by beat; an unsorted array falls back to the whole range, so hand-built fixtures still work. The window range it returns is ONE shared object - read it before asking for another.
- `instrumentColor.ts` — applies VisualCopy colorShift to instrument color params (`InstrumentCopyContext`). The only place that knows both the object's own color and the copy's absolute `tint`, so the tint mix happens here, before the relative HSL offsets. `tintPerceptual` chooses how that mix walks: `Color.lerp` (default) runs in LINEAR light and so overshoots perceived brightness at partial amounts, while `mixOklabLinearRgb` tracks it honestly — see the visualCopies guide for why that reads as "the flash goes white". `huePerceptual` does the same for the relative hue channel: set, the turn happens in OKLCH (`rotateHueOklabLinearRgb`, lightness and chroma held) and offsetHSL is left only the saturation/lightness offsets — an HSL hue sweep pulses in brightness twice a turn, which is what makes Hue Rotate's whole-wheel automation viable. Anything added to `colorShift` must also enter `instrumentFrame`'s signature buffer, or a paused edit won't repaint; both perceptual flags are in there for exactly that reason (flipping MIX or CIRCLE at a frozen beat has to repaint).
- `screenAnchor.ts` / `postMoverScale.ts` / `fullFrameCanvas.ts` — screen-space anchoring, scale lifted outside mover chains, full-frame canvas plumbing.
- `finalInvertMask.ts`, `animatedColor.ts`, `animatedOpacity.ts`, `fonts.ts` — final-pass invert, color/opacity tweening helpers, font loading.

Tests are colocated; run via `npm run test:visual`.
