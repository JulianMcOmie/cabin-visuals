# core/visual — the visual engine

The pipeline: **resolve** (document → graph, on edits) → **computeAtBeat** (graph → per-object state, per frame) → renderers read state imperatively.

## VisualEngine.ts — module singleton, deliberately NOT a store

Per-frame state must never trigger React re-renders; renderers pull it from `useFrame` via `getObjectState(trackId)` / `getVisualCopy(trackId, index)`. The ONLY React-visible signal is the structural object list (`subscribeObjects`/`getObjectList`), republished on resolve — one `ObjectListEntry` per VisualCopy occurrence, so `VisualScene` reconciles mounts only when structure changes, never per frame.

- One `ResolvedGraph` per scene; `setProject` reuses a scene's graph when its inputs are referentially unchanged (`graphInputs` map).
- `computeAtBeat(beat)`: samples automation/noise lanes, evaluates envelopes (`adsr.ts`) and note energy (`energy.ts`), composes world matrices down the track hierarchy (`stateVector.ts`: pos + axis-angle rot + logScale + opacity), applies the canonical `tf*` transform as parent of the instrument's `localTransform`, then refreshes VisualCopy values.
- **Copy-count contract**: the number of VisualCopies is fixed at resolve; MIDI gates opacity, never slot count. Hidden copies stay mounted at opacity 0.

## resolve.ts

Flattens each scene's track forest depth-first (cycle-guarded), expands looped blocks' notes (`noteFlatten.ts`), gathers child lanes per object: `automation` (keyframes via pitch encoding, or noise gates), `envelope` (ADSR), `ability`, effect-automation (`fx:<instanceId>:<key>` targets, parsed by `effects/automation.ts`), and the track's mover/splitter chain. `ProjectSnapshot` is a structural slice of ProjectStore — the engine never imports store internals.

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
- `automation.ts` — keyframe extraction/sampling + noise-gate model.
- `energy.ts` — the note-pulse "energy" signal instruments receive.
- `instrumentColor.ts` — applies VisualCopy colorShift to instrument color params (`InstrumentCopyContext`). The only place that knows both the object's own color and the copy's absolute `tint`, so the tint mix happens here, before the relative HSL offsets. Anything added to `colorShift` must also enter `instrumentFrame`'s signature buffer, or a paused edit won't repaint.
- `screenAnchor.ts` / `postMoverScale.ts` / `fullFrameCanvas.ts` — screen-space anchoring, scale lifted outside mover chains, full-frame canvas plumbing.
- `finalInvertMask.ts`, `animatedColor.ts`, `animatedOpacity.ts`, `fonts.ts` — final-pass invert, color/opacity tweening helpers, font loading.

Tests are colocated; run via `npm run test:visual`.
