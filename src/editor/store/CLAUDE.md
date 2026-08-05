# src/editor/store — zustand stores

One store per concern. The DOCUMENT is ProjectStore; everything else is session/view state.

## ProjectStore.ts (~2100 lines) — the document + all edit actions

State: `scenes` (each scene owns its `tracks`/`rootTrackIds`), `sceneOrder`, `activeSceneId`, project-level `audioTracks`/`audioRootTrackIds`, tempo (`bpm`, `beatsPerBar`, `totalBars`), `viewAspect`, `appliedTemplateId` — **plus a flattened VIEW**: top-level `tracks`/`rootTrackIds` are the active scene's tracks merged with the audio tracks (see `viewForScene`). Edit actions write through the view into the owning scene. Audio tracks are pinned first in `rootTrackIds` (`audioPinnedCount`).

Conventions baked into actions:
- Immutable updates (reference-compare is what HistoryStore/autosave diff on).
- Clone helpers (`cloneBlock` etc.) mint fresh UUIDs at every level — paste/alt-drag never share ids.
- `splitBlockAtBeat` handles looped blocks carefully (seam cuts restart phase-zero; mid-loop cuts re-phase) — it's pure and unit-tested; reuse it, don't reimplement splitting.
- New-track colors continue an OKLCH hue cycle from the latest sibling (`resolveNextTrackColor`).
- `addTrack` mints an id when the track arrives without one (hand-built tracks from console/E2E
  scripts). Before this guard, an id-less track keyed the record as the string `"undefined"`,
  pushed a literal `undefined` into `rootTrackIds` (persisting as `null`), and its timeline row
  rendered `key={undefined}` — surfacing as React's missing-key warning blaming TimelineArea's
  (correctly keyed) row map. If that warning names TimelineArea, suspect malformed track ids,
  not the map.
- `songEnd.ts` — derived song-end bar + loop trimming on shrink.

**Adding a data field**: it's automatically undoable (HistoryStore) and persisted (serialize) via generic field picking — but add it to `persistence/types.ts` `ProjectDocument`, and default it on hydrate for older saves (see `viewAspect` precedent). Fields excluded from snapshots: the flattened view (`tracks`, `rootTrackIds`, `activeSceneId` is normalized on restore).

## The others

- **TimeStore** — `currentBeat` (written ONLY by the transport/scrub paths), `isPlaying`, `loopRegion` (persisted; the rest ephemeral). `setCurrentBeat` clamps to project length.
- **HistoryStore** — undo/redo as generic snapshots of ProjectStore's non-function fields. A store subscription is the only writer of `past`; 80ms burst window collapses drags to one step; any edit clears `future`. `reset()` (not `clear()`) for project loads so hydrate isn't undoable. Restore shallow-merges data back — actions untouched.
- **UIStore** — selection (track single + multi, block set), collapsed tracks, editing block (piano-roll target), zoom levels (`tracksPixelsPerBeat`, `midiPixelsPerBeat`, `midiRowHeight`), panel visibility.
- **AudioStore / VideoStore / PhotoStore** — serializable clip CATALOGS keyed by ref (`{ref, fileName, duration}`-shaped descriptors; bytes live behind core/audio|video|photo). Deliberately not undoable: loading a file isn't an edit. Persisted via serialize's ride-along. Also hold ephemeral upload progress (never persisted).
- **ClipboardStore** — copy/paste payloads.

## Invariants

- Never write `TimeStore.currentBeat` from a component — go through the transport (`getPlaybackEngine().seek/scrubSeek`) so audio stays armed correctly.
- Any ProjectStore write while playing that affects audio audibility/placement must trigger `rearmAudio()` (block-edit subscriptions do this; drags defer to release — see core/playback.ts).
- Store files must stay React-free (no components); engines read stores via `getState()`/`subscribe`, never the hook form.
