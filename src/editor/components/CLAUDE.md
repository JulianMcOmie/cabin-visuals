# src/editor/components — the editor UI

Three big surfaces plus the inspector. **The timeline and the piano roll have separate gesture systems on purpose** — don't try to unify them.

## timeline/ — the arrangement view

- `TimelineArea.tsx` orchestrates: ruler, playhead (`usePlayhead` writes px via RAF, no re-render per frame), scrub, loop-region drag, track rows.
- `trackTree.ts` flattens the track forest into visible rows (collapse-aware); `Track.tsx` renders a row (label strip + lane); `Block.tsx`/`AudioBlock.tsx` the blocks.
- Gestures: `useTrackGestures` (block move/resize/draw), `useTrackNestDrag` (reparenting, drop indicators via `trackDrop.ts`), `useTrackCopyDrag` (alt-drag duplicate). Block-edge resizing shares `utils/edgeResize.ts` with the piano roll.
- `TrackContextMenu.tsx` — add automation/ability/envelope/mover lanes, tags, etc. `TrackTagsPanel.tsx` (popup tag editor in the row), `TrackTransformPanel.tsx` (canonical `tf*` strip), `AudioTrackOscilloscope.tsx`, `midiActivityRegistry.ts` (per-track note-activity glow, imperative).
- Any continuous gesture that moves audio-affecting state must bracket with the transport's drag suppression (`beginBlockDrag`/`endBlockDrag` etc. — see core/playback.ts) or it recreates the "earrape" bug.

## midi/ — the piano roll

- `PianoRollPanel.tsx` hosts; `MidiEditor.tsx` is the canvas-based editor, reused for regular tracks, automation lanes (rows labelled by VALUE via the pitch encoding in `core/trackTypes.ts`), ability lanes, and pad-bank lanes (video/photo: one labelled row per pad).
- `generateRows.ts` / `resolveDeclaredRows.ts` — which rows show: an instrument's `midiRows` vocabulary, else full piano. `coords.ts` — beat/pitch ⟷ px (the one place).
- Gestures: `useNoteGestures` (draw/move/resize/velocity; commits ONCE per gesture so undo gets one step), `useMidiBlockGestures` (the block's own bounds/loop from inside the editor). State: `useMidiEditorState`.

## visual/ — the 3D viewport pipeline

- `VisualScene.tsx` — mounts one `ObjectRenderer` per `ObjectListEntry` from the engine (structural list; per-frame values are pulled imperatively). Renders scenes to render targets and composites director `CompositionLayer`s (partitions/flash/blur/bloom) into the final frame.
- `ObjectRenderer.tsx` — one OCCURRENCE of one object: placement group → post-mover scale → its VisualCopy transform; `TransformWrapper`/`ShaderWrapper` apply the effect chain inside. Never resolves copy logic itself.
- **`placementKey` in VisualScene IS the pass partition**, not a cache key: it builds one character per object (`'B'` base / `'F'` front / `'I'` final-invert) and the three `createPortal` blocks at the bottom filter on it. Both it and ObjectRenderer's full-frame branch resolve through `instruments/types.ts`'s `isFullFrameTrack` / `isOnTopTrack` — change one and you must change the other, or an object mounts in a pass its renderer isn't expecting.
- **A full-frame instrument in the front pass hides the whole scene behind it**, background included, even with a fully transparent texture — the front pass composites over the base and a viewport-filling plane covers every pixel of it. Long-standing, easy to mistake for a bug in the instrument. It is the main reason the Oscilloscope now defaults to an in-scene object instead of a pinned overlay.
- `RenderGovernor.tsx` — paused = `frameloop='demand'`; invalidates exactly one frame on: any ProjectStore change, the debounced structural re-resolve (~80ms later), beat moves while paused, play→pause edge, canvas resize. The frameloop prop must stay a Canvas PROP (Canvas re-applies props and would clobber imperative setFrameloop).
- `ExportDriver.tsx` — bridges the export engine to the canvas.

## Inspector & the rest

- `TrackEditor.tsx` — the detail/inspector panel: dispatches per track type to registered settings UIs (`userInterfaceRenderers/`), effect chains, mover routing, envelope/automation config, scene settings (`SceneSettingsPanel.tsx`). Identity rides ON the tab rail — `panelIdentity()` resolves name + kind (tooltip) + color, and the color tints the ACTIVE tab; the rail is a `@container` that drops to short tab labels under 300px. Design options were explored at `/dev/panel-header-lab`.
- `LeftSidebar.tsx` — the library. **`ALL_OBJECT_INSTRUMENTS` is the curated instrument picker** — new instruments must be added here as well as the registry. The instruments tab is a Logic-style drill-down (`FolderBrowser`): folders are plain rows you click into, a sticky back row returns one level, and cards appear only at the level that holds them. `SCENE_FOLDERS` is the scene tree (Main gets its directors at the root via `rootItems`); folders claim items from the item arrays BY ID, and anything unclaimed falls through to the Unsorted folder — so a new instrument is never invisible, it just lands unsorted until it's filed. Empty folders hide their row. Drag sources: `useLibraryDrag`, `useEffectDrag`.
- Transport/header: `TransportDisplay`, `TransportIcons`, `BpmControl` (brackets `beginBpmDrag`/`endBpmDrag`), `ExportDialog`, `SceneTabs`.
- Media: `MediaFileDropLayer` (file drops → audio/video/photo pipelines), `VideoClipBank`, `PhotoBank`, `AudioTrackDetail`.
  All of these route files through `core/mediaFileKinds.ts` — never `f.type.startsWith('audio/')` and never a MIME sniff to decide whether to `preventDefault()` a drag. Safari reveals nothing about a drag until the drop and often no `File.type` at all; both shortcuts made drops do nothing there. See that file's CLAUDE.md section before touching a drop zone.
- Setup screens: `LyricSetupScreen`, `PhotoSetupScreen` (used by `/lyric-setup`, `/photo-setup` flows).
- `rulerGrid.ts`/`Ruler.tsx` — shared adaptive ruler math; `loops.ts` — loop badge/seam helpers; `NestedMenu.tsx` — generic nested context menu.
