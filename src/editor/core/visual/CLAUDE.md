# core/visual — the visual engine

The pipeline: **resolve** (document → graph, on edits) → **computeAtBeat** (graph → per-object state, per frame) → renderers read state imperatively.

## VisualEngine.ts — module singleton, deliberately NOT a store

Per-frame state must never trigger React re-renders; renderers pull it from `useFrame` via `getObjectState(trackId)` / `getVisualCopy(trackId, index)`. The ONLY React-visible signal is the structural object list (`subscribeObjects`/`getObjectList`), republished on resolve — one `ObjectListEntry` per VisualCopy occurrence, so `VisualScene` reconciles mounts only when structure changes, never per frame.

- One `ResolvedGraph` per scene; `setProject` reuses a scene's graph when its inputs are referentially unchanged (`graphInputs` map). Below that, `resolveProject` reuses **per-track** resolutions (WeakMap keyed on the object track's ref, validated against its subtree refs + tempo — see the cache block in resolve.ts): a one-note edit re-resolves one track, not the scene (~0.1ms vs ~3ms at 30 dense tracks, and the gap widens with project size). Cached entries are never emitted directly — each resolve emits a shallow copy with its own chain array and scratchBase, so global-mover appends and the solo pool stay per-resolve. `resolveReuse.test.ts` pins the invalidation rules; anything NEW a per-object resolver reads must land in `resolveDeps` or edits to it won't re-resolve. Dev builds trace each debounced resolve: `performance.getEntriesByName('cabin:setProject')`.
- `computeAtBeat(beat)`: samples automation lanes in whatever mode each is in (one call to `sampleAutomationLane`), evaluates envelopes (`adsr.ts`) and note energy (`energy.ts`), composes world matrices down the track hierarchy (`stateVector.ts`: pos + axis-angle rot + logScale + opacity), applies the canonical `tf*` transform as parent of the instrument's `localTransform`, then refreshes VisualCopy values.
- **Copy-count contract**: the number of VisualCopies is fixed at resolve; MIDI gates opacity, never slot count. Hidden copies stay mounted at opacity 0.
- **Per-object beat remap**: before anything else, each object's chain is asked for a time warp (`warpChainBeat`; only Freeze answers today). Everything after reads `objBeat`, not the playhead `beat` — that's what makes a frozen object a genuine still frame rather than one that keeps animating. The warp is a pure function of the real beat, so the purity rule holds; note `resolve.ts`'s automation memo forwards `warpBeat` UNmemoized on purpose (it's asked for the real beat while `apply` is asked for the warped one, so sharing the cache would thrash it every frame).

## resolve.ts

Flattens each scene's track forest depth-first (cycle-guarded), expands looped blocks' notes (`noteFlatten.ts`), gathers child lanes per object: `automation` (in one of its three modes, below), `envelope` (ADSR), `ability`, effect-automation (`fx:<instanceId>:<key>` targets, parsed by `effects/automation.ts`), and the track's mover/splitter chain. `ProjectSnapshot` is a structural slice of ProjectStore — the engine never imports store internals.

## automation.ts — one lane, three modes

An automation child track's notes mean one of three things, and which one is
implied by the config the track carries (`automationMode()` owns that precedence;
burst beats noise if a document somehow has both). All three are pure functions of
the beat, so the pause invariant holds for every mode:

| mode | config | what a note is | between notes |
|---|---|---|---|
| curve | `interpolation` | a value keyframe (pitch → value) | interpolated / endpoints held |
| noise | `Track.noise` | a gate for seeded random wander around its value | **inert** |
| burst | `Track.burst` | an ADSR burst from the value underneath toward its own pitch-value, velocity = intensity | **inert** |

**`sampleAutomationLane(lane, beat, base)` is the only place the mode is read.**
The engine, the hover preview and `paramAtBeat` all go through it, so they cannot
disagree and a fourth mode would land in all of them at once. It returns **NaN for
an inert lane** — callers keep the value that was already there, which is what
makes burst/noise composable with the base param and with each other. `base` is
what a burst departs FROM; the other modes ignore it.

Burst reuses `adsr.ts`: `adsrGateGain` is the per-note piece (exported for exactly
this), and overlapping bursts blend toward their gain-weighted target with the
total travel clamped at 1 — the same sum-and-clamp stacking `evaluateAdsrGain` does.

Burst works on `fx:` lanes too, taking the effect's stored setting as its base. The
`enabled` pseudo-param stays a keyframe lane (a 0/1 toggle has nothing to travel
through). Noise on `fx:` lanes is NOT wired — such a lane silently behaves as
keyframes, as it always has.

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
