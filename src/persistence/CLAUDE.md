# src/persistence — Supabase persistence

Projects persist as one JSONB blob per row (`projects.data` = `ProjectDocument`). Media bytes live in Supabase Storage buckets behind refs; documents carry only serializable descriptors.

## The pipeline

- `serialize.ts` — ProjectStore → document. Picks fields **generically** (every non-function field — the same boundary HistoryStore snapshots), so a new store field is persisted by default; update `types.ts` `ProjectDocument` to keep the type honest. Clip catalogs (audio/video/photo) and `loopRegion` ride along from their stores. `hydrate()` is the inverse: writes stores, rebuilds the flattened scene view, resets `currentBeat` to 0 (only loads come through hydrate — undo restores directly, so undo never yanks the playhead), and defaults absent fields explicitly (an old save must reset the field, not inherit the previously open project's value).
- `upgrade.ts` — `CURRENT_VERSION` (12 as of the director de-specialization) + `UPGRADES[N]` steps, vN→vN+1. **Append-only; a shipped step is never edited.** Each step is pure. Bump the version whenever the document shape changes non-additively; purely additive fields can skip a bump if hydrate defaults them.
- `projectStorage.ts` — CRUD against the `projects` table with optimistic concurrency via a `rev` counter: a save whose rev doesn't match fails with a conflict that must NOT be retried (retrying is exactly the overwrite the check prevents) — callers stop autosaving and ask the user (ConflictDialog). Loads run the blob through `upgradeDocument`. Also derives the lightweight `ProjectPreview` for the projects grid.
- `autosave.ts` — debounced (~1s) ProjectStore subscription mirroring the document to Supabase. Pure observation: a failed save never touches memory. `useSaveStatus` is the one React surface (header chip + conflict banner). Distinguish `'error'` (save failed) from `'load-failed'` (project never opened) — conflating them once sent a user hunting the wrong path. Also captures a real canvas frame as the project thumbnail (≤ every 30s; last capture reused when the canvas is unmounted).
- `audioStorage.ts` / `videoStorage.ts` / `photoStorage.ts` — bucket upload/download per media type, background upload progress into the media stores.
- `anonSession.ts` + `adoptionHandoff.ts` + `upgrade path in hooks/` — anonymous editing: projects made before sign-in are adopted into the account after auth (`useAnonymousAdoption`).
- `carryover.ts` / `lastProject.ts` — cross-page handoff bits (template → editor, last-opened project).
- `supabase.ts` — client construction; `hooks/useAuth.ts`, `hooks/useProjectList.ts`.

## Rules

- Documents are versioned; NEVER mutate an upgrade step that shipped. Old blobs must always walk the chain.
- Bytes never enter the document or the stores — refs only.
- Nothing in the edit path may depend on persistence (autosave observes; it is never awaited by edits).
