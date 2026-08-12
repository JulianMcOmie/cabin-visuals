# core/visual — the visual engine

The pipeline: **resolve** (document → graph, on edits) → **computeAtBeat** (graph → per-object state, per frame) → renderers read state imperatively.

## VisualEngine.ts — module singleton, deliberately NOT a store

Per-frame state must never trigger React re-renders; renderers pull it from `useFrame` via `getObjectState(trackId)` / `getVisualCopy(trackId, index)`. The ONLY React-visible signal is the structural object list (`subscribeObjects`/`getObjectList`), republished on resolve — one `ObjectListEntry` per VisualCopy occurrence, so `VisualScene` reconciles mounts only when structure changes, never per frame.

- One `ResolvedGraph` per scene; `setProject` reuses a scene's graph when its inputs are referentially unchanged (`graphInputs` map). Below that, `resolveProject` reuses **per-track** resolutions (WeakMap keyed on the object track's ref, validated against its subtree refs + tempo — see the cache block in resolve.ts): a one-note edit re-resolves one track, not the scene (~0.1ms vs ~3ms at 30 dense tracks, and the gap widens with project size). Cached entries are never emitted directly — each resolve emits a shallow copy with its own chain array and scratchBase, so global-mover appends and the solo pool stay per-resolve. `resolveReuse.test.ts` pins the invalidation rules; anything NEW a per-object resolver reads must land in `resolveDeps` or edits to it won't re-resolve. Dev builds trace each debounced resolve: `performance.getEntriesByName('cabin:setProject')`.
- `computeAtBeat(beat)`: samples automation lanes in whatever mode each is in (one call to `sampleAutomationLane`), evaluates envelopes (`adsr.ts`) and note energy (`energy.ts`), composes world matrices down the track hierarchy (`stateVector.ts`: pos + axis-angle rot + logScale + opacity), applies the canonical `tf*` transform as parent of the instrument's `localTransform`, then refreshes VisualCopy values.
- **Copy-count contract**: the number of VisualCopies is fixed at resolve; MIDI gates opacity, never slot count. Hidden copies stay mounted at opacity 0. The fixed count is the chain's MAXIMUM reach, not a beat-0 sample: automating a count-shaped mover param (Radial Motion's `copies0/1/2`) legitimately varies the per-beat count, so the resolver attaches min/max-reach resolutions to automated entries (`structuralVariants` on `MoverOrSplitter`, sized by `automationLaneValueBounds`) and `structuralCopyCount` probes the pool against them. Frames below the max are silently padded with hidden copies; only OVERFLOWING the pool warns (a beat-varying def, or one non-monotonic in an automated param).
- **Per-object beat remap**: before anything else, each object's chain is asked for a time warp (`warpChainBeat`; only Freeze answers today). Everything after reads `objBeat`, not the playhead `beat` — that's what makes a frozen object a genuine still frame rather than one that keeps animating. The warp is a pure function of the real beat, so the purity rule holds; note `resolve.ts`'s automation memo forwards `warpBeat` UNmemoized on purpose (it's asked for the real beat while `apply` is asked for the warped one, so sharing the cache would thrash it every frame).

## resolve.ts

Flattens each scene's track forest depth-first (cycle-guarded), expands looped blocks' notes (`noteFlatten.ts`), gathers child lanes per object: `automation` (in one of its three modes, below), `envelope` (ADSR), `ability`, effect-automation (`fx:<instanceId>:<key>` targets, parsed by `effects/automation.ts`), and the track's mover/splitter chain. `ProjectSnapshot` is a structural slice of ProjectStore — the engine never imports store internals.

## automation.ts — one lane, four modes

An automation child track's notes mean one of four things, and which one is
implied by the config the track carries (`automationMode()` owns that precedence;
burst beats noise beats cycle if a document somehow has several). All four are
pure functions of the beat, so the pause invariant holds for every mode:

| mode | config | what a note is | between notes |
|---|---|---|---|
| curve | `interpolation` | a value keyframe (pitch → value) | interpolated / endpoints held |
| noise | `Track.noise` | a gate for seeded random wander around its value | **inert** |
| burst | `Track.burst` | an ADSR burst from the value underneath toward its own pitch-value, velocity = intensity | **inert** |
| cycle | `Track.cycle` | an ONSET dividing time: the motion curve plays once between each consecutive onset pair, stretched to fit | the cycle itself; **inert** outside the onset span |

**CYCLE mode** (`Track.cycle`): the shape is one cubic bezier y(x) with editable
ENDPOINT heights — seam continuity is not an option, it is whether the user's
endpoints match. The earlier onset's pitch-value is the cycle's high (y = 1)
over a configurable `floor` (default 0); `invert` flips the note to the LOW
under a constant `ceiling` (default param max). Duration is deliberately
ignored (onsets only), chords collapse to one boundary keeping the largest
value, and a lone onset is inert — there is nothing to stretch to. Works on
`fx:` lanes like burst does (`enabled` stays keyframes). Bounds for structural
budgets come from the bezier's height hull (min/max of the four Ys).

**`sampleAutomationLane(lane, beat, base)` is the only place the mode is read.**
The engine, the hover preview and `paramAtBeat` all go through it, so they cannot
disagree and a fourth mode would land in all of them at once. It returns **NaN for
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
(`min`/`max` inside the param's own bounds), a row COUNT (`rows` 2..49, rows fill
upward from pitch 36 and the top row IS the max), INTEGER snapping, and a spread
`curve` ('linear' | 'fineLow' | 'fineHigh' | 'sCurve'). `pitchToValueRanged`
(core/trackTypes.ts) is the one mapping both the engine (extraction in
resolve.ts) and the editor (generateValueRows' labels) read, so a note can never
mean different things in the roll and in playback. The panel's Rows·Range
console emits a NORMALIZED config - defaults collapse to absence.

**AMOUNT** (`Track.automationAmount`, default 1, 0..`AUTOMATION_AMOUNT_MAX`) is a
whole-lane output gain, mode-independent: applied at EXTRACTION in resolve.ts (the
one choke point every consumer shares), it multiplies keyframe values, noise centers
+ deviation (`range` is scaled alongside), and burst target values, each clamped back
to the param's range. It deliberately does NOT touch `fx:` `enabled` lanes — that's a
0/1 switch read against a 0.5 threshold, and a gain there is just a surprise
off-switch. Neutral (1) is stored as field absence (`setTrackAutomationAmount`).

## instrumentFrame.ts — the per-frame entry point for instruments

`useInstrumentFrame(trackId, cb)` is the ONLY way instruments do per-frame work (lint-enforced). Contract:
- cb sees `ObjectState` (beat, params, energy, notes…), canvas size/DPR, camera pose — nothing wall-clock.
- **Signature skip**: if none of the inputs changed, cb is not called (pure function ⇒ same pixels). This is what makes paused editing cheap.
- **Return `false` if you can't apply the frame yet** (refs unattached, canvas not ready). A silent bail eats the change and the object renders stale until the next input change — which may never come while paused (the LaserSphere "params do nothing until remount" bug).
- Runs after `VisualBeatSync`'s computeAtBeat (mount order), so state is always this frame's.

## Supporting files worth knowing

- `VisualBeatSync.tsx` — mounted once in Canvas; per-frame `computeAtBeat`, plus synchronous `syncParams` on store changes and a debounced (~80ms) structural re-resolve.
- `pauseCanary.ts` — dev-only: hashes the scene while paused, names any object that moves (backstop for the purity rule).
- `beatOverride.ts` — export's hook: overrides the beat the engine computes at, bypassing the transport.
- `automation.ts` — the three automation-lane MODES and the one function that dispatches between them.
- `energy.ts` — the note-pulse "energy" signal instruments receive.
- `instrumentColor.ts` — applies VisualCopy colorShift to instrument color params (`InstrumentCopyContext`). The only place that knows both the object's own color and the copy's absolute `tint`, so the tint mix happens here, before the relative HSL offsets. `tintPerceptual` chooses how that mix walks: `Color.lerp` (default) runs in LINEAR light and so overshoots perceived brightness at partial amounts, while `mixOklabLinearRgb` tracks it honestly — see the visualCopies guide for why that reads as "the flash goes white". Anything added to `colorShift` must also enter `instrumentFrame`'s signature buffer, or a paused edit won't repaint; `tintPerceptual` is in there for exactly that reason (flipping MIX at a frozen beat has to repaint).
- `screenAnchor.ts` / `postMoverScale.ts` / `fullFrameCanvas.ts` — screen-space anchoring, scale lifted outside mover chains, full-frame canvas plumbing.
- `finalInvertMask.ts`, `animatedColor.ts`, `animatedOpacity.ts`, `fonts.ts` — final-pass invert, color/opacity tweening helpers, font loading.

Tests are colocated; run via `npm run test:visual`.
