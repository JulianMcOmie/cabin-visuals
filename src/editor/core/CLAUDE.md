# src/editor/core — engines and document semantics

Non-React logic. Subdirectories have their own CLAUDE.md (visual, audio, export, visualCopies). This file covers the loose files and small subsystems.

## playback.ts — THE transport

`PlaybackEngine` (module singleton via `getPlaybackEngine()`) is the **sole producer of the beat**: Tone transport + a RAF tick that converts transport position → beat → `TimeStore.setCurrentBeat`. Also the sole producer of the shared `when` audio-clock anchor — transport and all audio players are armed at the same `when = Tone.now() + 0.05` so they stay sample-aligned.

Key behaviors (each has a war-story comment in the file — read before changing):
- **BPM change re-anchors audio, never time-stretches.** Live `setBpm` re-arms all players.
- **Drag suppression** (`beginBpmDrag`/`beginBlockDrag`/`beginScrub` + matching end): re-arming per pointermove stacks overlapping clip starts inside the lookahead window into a runaway gain sum ("earrape"). Every continuous gesture must silence-or-defer and re-arm ONCE at release. If you add a new continuous gesture that writes audio-affecting state, use this pattern.
- **Zombie-RAF guard**: an `onBeatChange` subscriber may `pause()` mid-tick; the tick checks `this.playing` before rescheduling.
- Loop-region wrap lives ONLY in the live RAF tick — export walks straight through it.

## transform.ts — the canonical track transform

Reserved `tf*` param keys (`tfX/Y/Z`, `tfRotX/Y/Z` in degrees, `tfSize`, `tfOpacity`) stored in `track.params` so automation/envelope machinery targets them like any param, but **declared here, not by instruments**. Composed as the PARENT of the instrument's own `localTransform`, so they inherit down the track hierarchy; `tfSize` is a "group fader" (scales subtree + mover layouts), unlike instrument mesh scale which stays private to the mesh.

## trackTypes.ts — automation pitch encoding

Automation lanes encode value in note pitch: `pitchToValue`/`valueToPitch` over pitch span 36–84 → param [min,max]. Shared by piano-roll row labels and engine keyframe extraction.

## loopRegion.ts / midiImport.ts

Loop region math (`shouldLoopWrap`); MIDI file import via `@tonejs/midi` → `ImportedMidiTrack`s consumed by ProjectStore.

## directors/ — Main-scene composition

Directors are Main-scene track plugins that compose the other scenes into the final frame. Registry: `directors/index.ts` (`getDirector`, `listDirectors`); defs: `sceneSwitcher`, `cut`, `radialCut`, `crop`. A director resolves per-frame into `CompositionLayer[]` (types.ts): sceneId + opacity + viewport + optional partition mask (`linear` / `radial` / `slice` — see types.ts for the geometry distinctions), `flash` (lerp-toward-white, deliberately not additive), directional `blur`. `sceneBindings.ts` binds MIDI pitches → scene ids stably. VisualScene renders each layer from its scene's render target.

## photo/ and video/ — pure time models + byte stores

`videoTime.ts` / `photoTime.ts`: pure `(beat, notes) → what's on screen` (which pad, and for video the in-clip time). No DOM/three — this purity is what makes scrub/pause/export land identical frames. Pads answer fixed base pitch 48 upward; the MIDI editor shows labelled rows so pitches are never user-facing. `decodeEngine.ts` keeps each pad's in-point frames warm so triggers land next display tick. `videoUploads.ts`/`photoUploads.ts`/`videoSource.ts`/`photoSource.ts` handle bytes (Supabase bucket + session cache) behind refs; only serializable descriptors reach the stores.

Export video frame-exactness comes from a registered frame preparer (see export/CLAUDE.md).
