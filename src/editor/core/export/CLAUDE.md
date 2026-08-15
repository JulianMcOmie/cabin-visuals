# core/export — deterministic MP4 export

Export never records playback. It **steps the beat arithmetically** — `beat(i) = startBeat + i·bpm/(60·fps)` — through the same visual path scrubbing uses, encodes via WebCodecs, muxes to MP4, and renders audio offline through the same placement math as live playback. Frame-exact, faster than realtime, wall-clock-free.

## Files

- `exportEngine.ts` — the frame loop (`walkFrames`): the ONE place export timing lives. Sink `await`s are the backpressure. Notable: the once-a-second yield uses `MessageChannel`, NOT `setTimeout` — background tabs throttle timers to ≥1s (then ~1/min), which would stall a backgrounded export; MessageChannel tasks are exempt.
  - **Frame preparers** (`registerFramePreparer`): async work that must complete before a frame renders. The Video instrument registers one that seeks its `<video>` to the beat-derived time and resolves on `seeked` — that's what makes exported video frame-exact where live playback merely drift-corrects.
- `frameDriver.ts` — pins the canvas/engine into export mode and renders one frame per beat (via `core/visual/beatOverride.ts`, bypassing the transport). Pin/unpin brackets the WHOLE export, not each walk. Also owns the `exportPinned` flag (`isExportPinned`/`subscribeExportPinned`, set by ExportDriver's pin/unpin): VisualScene subscribes to suspend the draft preview-resolution scale, so pinned renders are always full-size.
- `videoEncode.ts` — WebCodecs encoder session + config; `support.ts` — capability gate (`isExportSupported`, Chrome/Edge) + muxable-chunk check.
- `mux.ts` — MP4 muxing (`Mp4Writer`, mp4-muxer).
- `audioRender.ts` — offline audio render into the writer, using `core/audio/placement.ts` with anchor t=0.
- `watermark.ts` — free-plan watermark compositor; `previewCapture.ts` — small deterministic captures (project thumbnails, instrument previews).
- `types.ts` — `ExportSettings`, `BeatRange`, `makeTimebase`.

## Aspect ratios and resolution tiers

The shapes you can release in live in **`core/aspectRatios.ts`**, not here — the editor's
preview pin (`ProjectStore.ViewAspect` = `'fill'` + that list) reads the same module, and
the two must agree or pinning the viewport stops previewing the export. `ExportAspect` is
an alias of `AspectRatioId`; adding a shape is one entry in `ASPECT_RATIO_IDS` + `RATIOS`,
and the viewport menu grows it automatically. Nothing persists an ExportAspect, so no
schema bump; `ViewAspect` IS persisted, but widening a union only makes old documents more
valid.

**The export dialog deliberately shows only TWO of them** (`exportAspectChoices`): the
shape the viewport is pinned to — 16:9 when it's on Fill — and 9:16, because the vertical
cut is a second release of the same piece rather than a different composition. Picking a
shape is a viewport act, where you can see what it does to the frame; the dialog only
confirms it. A viewport already pinned to 9:16 pairs with 16:9 so the picker is never one
lonely card. A pin overrides the saved localStorage aspect outright; on Fill the saved
choice stands if it's one of the two.

**A tier names the frame's SHORT edge** (`RESOLUTION_TIERS` + `frameSizeFor`): 1080p is
1080 tall in landscape, 1080 wide in portrait, so 16:9 lands on the canonical
1920×1080, 9:16 on its rotation, and a 2:1 "1080p" is 2160×1080 — the way people say it.
Both axes are forced even (H.264 chroma subsampling). Two consequences worth knowing:

- **Bitrate keys off `min(width, height)`, not the long edge.** Long-edge keying was
  equivalent while 16:9 and its rotation were the only shapes; a 2:1 1080p is 2160 wide and
  would have been charged the 4K rate. Every `defaultBitrate` caller passes the short edge.
- **`videoCodec(width, height, fps)` computes the H.264 level from the real macroblock
  count and rate** rather than bucketing the long edge, because the wider shapes fall off
  the old table: 2:1 at 4K is 4320×2160, which fits level 5.2's frame size but exceeds its
  macroblock RATE at 60fps and needs level 6.0. Signalling a level that's too low is a lie
  in the bitstream that players may refuse; the probe in `runExport` is what tells you a
  browser's encoder can't take the config, before minutes of rendering are spent.

`ExportResult.poster` is a still of the MIDDLE encoded frame (data URL), grabbed inside the frame sink — same task as the render, from the same canvas that gets encoded, so it carries the watermark and needs no `preserveDrawingBuffer`. The dialog's completion screen shows it because the running view's rAF monitor can't: complete is a different React subtree (fresh, blank canvas) and the driver is unpinned by then.

## Rules

- No wall clock, no RAF, no transport anywhere in this path. If a visual looks right live but wrong in export, the instrument is impure (see the root pause invariant) — fix the instrument, don't patch export.
- Export ignores the loop region on purpose (wrap lives only in playback's RAF tick).
- Starting an export PAUSES the transport (ExportDialog): playback and the encode share one canvas, so a running transport only steals frames from the render.
- UI entry: `components/ExportDialog.tsx` + `components/visual/ExportDriver.tsx`.
