# src/editor — the editor app

Everything inside the `/editor` route. `App.tsx` is the shell (client-only, dynamically imported by `app/editor/page.tsx` because the three.js bundle is heavy): header/transport, resizable panels (left library sidebar, timeline, piano roll, 3D canvas), and the once-mounted plumbing components (`VisualBeatSync`, `RenderGovernor`, `ExportDriver`, `MediaFileDropLayer`). Dev builds expose stores on `window.__cabinStores` for console/E2E debugging.

## The document model (`types.ts`)

`types.ts` is THE document schema — what gets persisted, undone, and resolved. The engine's derived types live in `core/visual/types.ts`; dependency points engine → document only.

- **Scene**: a self-contained track forest (`tracks` record + `rootTrackIds`) with a backdrop: a flat color, a two-stop gradient (`backgroundGradient`, optional field), or transparency. `sceneBackdropMode()` in types.ts resolves which one the scene wears; `ProjectStore.setSceneBackdropMode` switches atomically (one undo step) and the gradient's setup survives leaving the mode. The **Main scene** (`isMain`) is special: it holds *director* tracks that compose the other scenes into the final frame instead of object instruments.
- **Track** is a tagged union via `type: TrackType`:
  - `base` — an object instrument (`instrumentId`, `params` numeric / `stringParams` string-valued, `effects`, canonical transform under reserved `tf*` param keys).
  - `automation` — child lane keyframing a parent numeric param. **Value is encoded in note PITCH** (`core/trackTypes.ts`: pitch 36–84 maps linearly onto the param's [min,max]); `targetParam` picks what. Three MODES pick how (see `core/visual/CLAUDE.md`): `interpolation` curves between keyframes, `noise` gates seeded-random wander, `burst` fires an ADSR from the value underneath toward each note's own value. Mode is implied by which config exists — set it through `setAutomationMode`, which keeps them exclusive in one undo step.
  - `ability` — child lane driving a parent instrument's bespoke ability (`abilityKey`, e.g. Cube's Shatter). Expressed inside the instrument's own component.
  - `envelope` — child ADSR lane (`adsr` in beats, `envDepth`, `envTarget`, `targetParam`; reserved target `'opacity'` multiplies).
  - `mover` / `splitter` — VisualCopy chain rows (`moverId`/`splitterId` + `inputValues`); top-level movers target other tracks via `targets: Routing[]` (track / tag / subtree scopes). Nested under ANOTHER mover/splitter a mover is that parent's **frame** and moves it instead of joining the object's chain (`core/visualCopies/moverFrame.ts`) — its own `targets` are ignored.
  - `audio` — pinned audio lanes (`audioBlocks`, positioned+trimmed clip refs). Live OUTSIDE scenes (project-level, `audioTracks`/`audioRootTrackIds` in the store).
  - `director` — Main-scene-only (`directorId`, `sceneBindings` mapping MIDI pitches → scene ids).
- **Block**: bar-positioned note container; `loop` + `loopLengthBars` tile its notes (expansion happens in `core/visual/noteFlatten.ts` at resolve time). **Note beats are relative to their block.**
  - Field names bite when you build blocks/notes by hand (store scripting, console smoke tests, fixtures): a Block's length is **`durationBars`** (not `lengthBars`) and a Note's position is **`startBeat`** (not `beat`). `ResolvedNote` — what movers and instruments actually receive — is the *other* shape: absolute `beat`, plus `blockStartBeat`/`blockEndBeat`. Get either wrong and nothing throws: `flattenBlocks` quietly emits `beat: NaN` (or a zero-length block), so the track simply renders nothing and looks like a bug in whatever you were testing.
  - Related console-scripting gotcha: `UIStore.selectedTrackIds` is a **Set**, not an array — handing it an array throws inside the timeline's `Track` row.
- Video/Photo instruments keep pad banks on the track (`videoPads`/`photoPads`); pad order IS the MIDI mapping. Bytes live behind `core/video` / `core/photo`; stores hold serializable descriptors only.
- Lyrics track: `lyricTiming` (seconds) is the source of truth; note beats are re-derived from it on BPM change so words never move off their sung time.

## Neighbor guides

Stores → `store/CLAUDE.md` · engines → `core/*/CLAUDE.md` · UI → `components/CLAUDE.md` · instruments/effects/settings-UIs → their CLAUDE.md.

## Misc files here

- `constants.ts` — shared layout px constants (track label width, playhead triangle).
- `uiSettings.ts` — localStorage-backed pane open/closed defaults.
- `useVerticalSplit.ts` — the timeline/piano-roll divider.
- `utils/` — pure helpers: `selection.ts` (track select), `edgeResize.ts` (shared block-edge drag), `snapStep.ts`, `oklch.ts` + `trackColors.ts` (hue-cycled track colors), `trackTags.ts`, `zoomAroundBeat.ts`, `multiStyleApply.ts` (lyric style switching), `midiEditorPalette.ts`.
- `hooks/` — transport-facing hooks: `usePlayback` (wires PlaybackEngine callbacks), `usePlayhead` (RAF playhead px), `useScrub`, `useTransportKeys` (space/enter/F), `useUndoRedoKeys`, `useProjectPersistence` (load + autosave lifecycle), `useAnonymousAdoption` (anon → signed-in project handoff).
