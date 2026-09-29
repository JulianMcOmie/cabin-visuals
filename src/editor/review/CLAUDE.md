# src/editor/review — the review loop between the user and the cabin CLI

Dev-only, `?file=` sessions (the editor bound to `projects/<name>/project.json`).
Everything here renders nothing in normal sessions.

- **Comments** (`commentsStore.ts`, `useCommentSync.ts`, `CommentsLayer.tsx`):
  C pins a comment at the playhead (on the selected track); Shift+C / the chip
  in the scene tabs toggles pin mode, where a click on a track lane
  (`components/timeline/useTrackGestures.ts`) or on the canvas
  (`components/visual/CanvasHoverPicker.tsx`, which highlights the target as
  Shift-hover does) opens the composer there. A comment captures bar, section,
  scene/track/instrument, nearby notes and a still (FrameDriver). The panel
  shows threads with Claude's replies and frames; Reply reopens. Storage and
  the model: `src/devtools/commentsCore.ts` (shared with the CLI; lock-file
  writes), API: `app/api/dev/projects/[name]/comments`. Polls every 1.5 s.
- **Song strip** (`SongStrip.tsx`, `songAnalysis.ts`): under the timeline ruler -
  the document's markers (sections), the analysis's energy and chord roots
  (`analysis/analysis.json` via the dev files route), comment pins. It scrolls
  with the ruler: TimelineArea writes its transform in the same three places.
- **Review bar** (`ReviewBar.tsx`): when the file changes under the editor,
  `dev/useFileSync.ts` brackets the reload with `HistoryStore.checkpoint()` (so
  it's ONE undo step - Undo on the bar or Ctrl+Z reverts it, and the revert is
  written back to the file) and shows the semantic diff (`devtools/docDiff.ts`).
  Show lights the changed rows.
- **Row badges** (`TrackReviewBadges.tsx`): code-instrument error (`!`), open
  comments on the track, "changed by Claude", and `</>` for script-made tracks
  (Track.createdBy - see core/provenance.ts). Per-track subscriptions only.

The ⌘K palette and its registry are in `../commands/` - the same commands the
CLI runs with `cabin cmd`. Add a command there and both of you get it.
