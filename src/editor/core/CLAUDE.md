# src/editor/core — engines and document semantics

Non-React logic. Subdirectories have their own CLAUDE.md (visual, audio, export, visualCopies). This file covers the loose files and small subsystems.

## playback.ts — THE transport

`PlaybackEngine` (module singleton via `getPlaybackEngine()`) is the **sole producer of the beat**: Tone transport + a RAF tick that converts transport position → beat → `TimeStore.setCurrentBeat`. Also the sole producer of the shared `when` audio-clock anchor — transport and all audio players are armed at the same `when = Tone.now() + 0.05` so they stay sample-aligned.

Key behaviors (each has a war-story comment in the file — read before changing):
- **BPM change re-anchors audio, never time-stretches.** Live `setBpm` re-arms all players.
- **Drag suppression** (`beginBpmDrag`/`beginBlockDrag`/`beginScrub` + matching end): re-arming per pointermove stacks overlapping clip starts inside the lookahead window into a runaway gain sum ("earrape"). Every continuous gesture must silence-or-defer and re-arm ONCE at release. If you add a new continuous gesture that writes audio-affecting state, use this pattern.
- **Zombie-RAF guard**: an `onBeatChange` subscriber may `pause()` mid-tick; the tick checks `this.playing` before rescheduling.
- Loop-region wrap lives ONLY in the live RAF tick — export walks straight through it.
- **Monitoring speed (½× / ¼×) is a transport GEAR, not a document edit** (`playbackRate.ts`: the type, the list, `effectiveBpm`; kept Tone-free so the store, the UI and tests can import it). The transport runs at `bpm × rate`, so everything beat-addressed — visuals, MIDI, automation — slows for free and keeps its musical position; the project bpm is untouched and **export never sees the rate** (it steps beats arithmetically and reads `TimeStore.playbackRate` nowhere). The rate reaches the engine through `getPlaybackRate` on the callbacks, and `setPlaybackRate` must RE-ARM, not just retune: a sounding player's stop was scheduled in wall-clock seconds computed at the old rate. Audio's half of the deal is in `core/audio/CLAUDE.md`.

## transform.ts — the canonical track transform

Reserved `tf*` param keys (`tfX/Y/Z`, `tfRotX/Y/Z` in degrees, `tfSize`, `tfOpacity`) stored in `track.params` so automation/envelope machinery targets them like any param, but **declared here, not by instruments**. Composed as the PARENT of the instrument's own `localTransform`, so they inherit down the track hierarchy; `tfSize` is a "group fader" (scales subtree + mover layouts), unlike instrument mesh scale which stays private to the mesh.

## trackTypes.ts — automation pitch encoding

Automation lanes encode value in note pitch: `pitchToValue`/`valueToPitch` over pitch span 36–84 → param [min,max]. Shared by piano-roll row labels and engine keyframe extraction.

A lane carrying an `automationRange` reshapes that through `pitchToValueRanged`, and three helpers here own the reshaping — `automationValueBounds` (the lane's own min/max, deliberately NOT clamped to the param's), `automationIntegerGrid` (the whole-number rows an INT lane counts on) and `automationRowCount` (how many rows the config asks for; derived under INT). Rows always run min→max evenly. See `core/visual/CLAUDE.md` for why INT derives its count instead of rounding a spread.

## loopRegion.ts / midiImport.ts

Loop region math (`shouldLoopWrap`); MIDI file import via `@tonejs/midi` → `ImportedMidiTrack`s consumed by ProjectStore.

## mediaFileKinds.ts — the ONE router for "what kind of file is this"

Every drop zone and file picker asks here, and the rules exist because of Safari:

- **`dragCarriesFiles(dataTransfer)` is the only legal gate for `preventDefault()`** on dragenter/dragover. Mid-drag, WebKit exposes no per-item MIME type at all (`items` empty, or `type === ''`), so sniffing kinds decides "not media", skips preventDefault — and a drag the page never accepted delivers **no drop event**, Safari just opens the file. `dataTransfer.types` containing `'Files'` is the one signal every browser gives. Kinds sniffed mid-drag (`mediaKindOfMimeType`) are for wording the overlay only; "couldn't tell" must render as "some file", never as "not ours".
- **`mediaKindOfFile(file)` routes on drop: MIME type when the browser reports one, filename extension when it doesn't.** Safari hands over an empty `File.type` for any extension macOS has no UTI→MIME mapping for (.aif, .opus, .caf … varies by OS version), so `f.type.startsWith('audio/')` silently dropped real audio on the floor. MIDI is checked first — `'audio/midi'` would otherwise read as audio.

## directors/ — composition instruments (Main-scene composition)

Composition instruments (the former "directors" — the directory name survives) compose the other scenes into the final frame. Since schema v12 they are **ordinary `base` tracks** whose `instrumentId` names a def in THIS registry rather than the object registry: `directors/index.ts` (`getCompositionInstrument`, `listCompositionInstruments`, and the two discriminators everything reads — `compositionDef(instrumentId)` / `isCompositionTrack(track)`). Defs: `scene`, `sceneSwitcher`, `cut`, `radialCut`, `crop` (registry order IS the Main library's card order). A def resolves per-frame into `CompositionLayer[]` (types.ts): sceneId + opacity + viewport + optional partition mask (`linear` / `radial` / `slice` — see types.ts for the geometry distinctions), `flash` (lerp-toward-white, deliberately not additive), directional `blur`. `sceneBindings.ts` binds MIDI pitches → scene ids stably (`orderedSceneBindings` self-heals; `seedSceneBindings` is the one seed all creation paths share). **This module is React-free ON PURPOSE — ProjectStore imports it for capability checks and must never pull in `instruments/index`.**

`mainOnly` on the def is what "Main-only" now means (a type rule before v12): true for sceneSwitcher/cut/radialCut, **false for `crop`, whose id is dual-surfaced** — on Main this registry's def composes its bound scene; in a visual scene the SAME id resolves through the object registry (`instruments/Crop.tsx`) and masks the scene it lives in (or its routed targets). Placement picks the behavior; `moveTrackToScene`'s three-way guard enforces it.

**`scene` is the plain one — and it is PRESENCE-driven, not note-gated** (`scene.ts`): with no notes on the track its bound scene fills the frame for the whole timeline, and drawing notes turns the same track into a gate, pitch ignored. That is the point of it existing beside `sceneSwitcher`, which renders nothing until it has been played, so a freshly dropped Main track looked broken. Same non-destructive convention as word-formation lanes. `targetsSingleScene` (shared with crop) makes the panel offer a scene picker and `resolve` read binding 0; the *copy* around that picker is per-def — `panelSummary` and `sceneChoiceNote` on the def, because the panel's generic sentences described a partition composer or a crop-shaped masker and a third shape had nowhere to say what its rows mean.

Composition params are automatable like any other track's: `compositionAutomatableParams(def)` (types.ts: the shared Opacity + the def's params) is the single source the context menu, the lane's piano-roll rows, and the engine all read. Composition tracks never enter the resolved graph (`setProject` skips `isMain` scenes — the load-bearing gate), so their lanes are gathered + sampled per frame inside `VisualEngine.resolveComposition` (a pure function of the beat) — a new def's params get automation with no extra wiring, and its `resolve()` sees the sampled values through the same `track.params` reads it already does.

## photo/ and video/ — pure time models + byte stores

`videoTime.ts` / `photoTime.ts`: pure `(beat, notes) → what's on screen` (which pad, and for video the in-clip time). No DOM/three — this purity is what makes scrub/pause/export land identical frames. Pads answer fixed base pitch 48 upward; the MIDI editor shows labelled rows so pitches are never user-facing. `decodeEngine.ts` keeps each pad's in-point frames warm so triggers land next display tick. `videoUploads.ts`/`photoUploads.ts`/`videoSource.ts`/`photoSource.ts` handle bytes (Supabase bucket + session cache) behind refs; only serializable descriptors reach the stores.

Export video frame-exactness comes from a registered frame preparer (see export/CLAUDE.md).
