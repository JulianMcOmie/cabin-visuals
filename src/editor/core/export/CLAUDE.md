# core/export — deterministic MP4 export

Export never records playback. It **steps the beat arithmetically** — `beat(i) = startBeat + i·bpm/(60·fps)` — through the same visual path scrubbing uses, encodes via WebCodecs, muxes to MP4, and renders audio offline through the same placement math as live playback. Frame-exact, faster than realtime, wall-clock-free.

## Files

- `exportEngine.ts` — the frame loop (`walkFrames`): the ONE place export timing lives. Sink `await`s are the backpressure. Notable: the once-a-second yield uses `MessageChannel`, NOT `setTimeout` — background tabs throttle timers to ≥1s (then ~1/min), which would stall a backgrounded export; MessageChannel tasks are exempt.
  - **Frame preparers** (`registerFramePreparer`): async work that must complete before a frame renders. The Video instrument registers one that seeks its `<video>` to the beat-derived time and resolves on `seeked` — that's what makes exported video frame-exact where live playback merely drift-corrects.
- `frameDriver.ts` — pins the canvas/engine into export mode and renders one frame per beat (via `core/visual/beatOverride.ts`, bypassing the transport). Pin/unpin brackets the WHOLE export, not each walk.
- `videoEncode.ts` — WebCodecs encoder session + config; `support.ts` — capability gate (`isExportSupported`, Chrome/Edge) + muxable-chunk check.
- `mux.ts` — MP4 muxing (`Mp4Writer`, mp4-muxer).
- `audioRender.ts` — offline audio render into the writer, using `core/audio/placement.ts` with anchor t=0.
- `watermark.ts` — free-plan watermark compositor; `previewCapture.ts` — small deterministic captures (project thumbnails, instrument previews).
- `types.ts` — `ExportSettings`, `BeatRange`, `makeTimebase`.

## Rules

- No wall clock, no RAF, no transport anywhere in this path. If a visual looks right live but wrong in export, the instrument is impure (see the root pause invariant) — fix the instrument, don't patch export.
- Export ignores the loop region on purpose (wrap lives only in playback's RAF tick).
- UI entry: `components/ExportDialog.tsx` + `components/visual/ExportDriver.tsx`.
