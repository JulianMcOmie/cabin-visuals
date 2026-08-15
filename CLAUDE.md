# Cabin Visuals

A browser DAW for music visuals: MIDI notes drive 3D instruments on a timeline; exports to MP4. Next.js 15 / React 19 / react-three-fiber / zustand / Tone.js / Supabase. README.md has the product-level overview; this file is the working map. Per-directory CLAUDE.md files carry the deep contracts — trust them before re-deriving from code.

## Commands

- `npm run dev` — dev server (turbopack), port 3000. In a worktree, use a unique port + `NEXT_DIST_DIR` (see `dev:isolated`).
  **A build must not share a running dev server's `NEXT_DIST_DIR`.** `npm run build` rewrites that
  directory and the live server then 500s on every route with `ENOENT … build-manifest.json`, which
  reads like a code error and is not one. Give the build its own dir (`NEXT_DIST_DIR=.next-build-<port>`);
  recovering means stopping the server, deleting the dist dir, and restarting.
- `npm run test:visual` — the node test suite (core, core/visual, visualCopies, directors, photo, video, **export**, effects/deform, effects/materials, **instruments**, store, utils, timeline, **midi/vim**, persistence). Tests are colocated `*.test.ts` run with `node --test` + tsx; no jest/vitest. 1219 pass, none red (verified 2026-08-15 — export/video/effects were added to the glob that day, having silently never run) — a new instrument's colocated test runs in the normal suite with no extra step, but a test in a directory the script's glob list doesn't name is silently never run: add the directory to `test:visual` when you open a new one.
- `npm run build` — production build; the `/commit` skill runs this first.
- `npm run db:generate` / `db:migrate` — Drizzle (needs `DATABASE_URL`).
- Single test file: `node --import tsx --test --experimental-test-module-mocks path/to/file.test.ts`.

`/editor` runs fully in-memory without Supabase env or `?project=` id. `EditorSignupGate` (src/editor/components) puts an un-dismissable signup card over the editor for anyone without a real account — anonymous sessions included — and ExportDialog has its own gate in front of Export. **Both stand down on a dev server** (`src/editor/devGates.ts`: `DEV_GATES_OFF`, true when `NODE_ENV === 'development'` unless `NEXT_PUBLIC_EDITOR_GATE=on`), so `npm run dev` is a signed-out smoke-test path again; production builds compile the branch away.

## The one rule

**Every visual is a pure function of the current beat** (+ document + params). Paused = frozen frame; scrubbing shows exactly what playback shows; export is frame-exact because it just steps the beat. Enforced by:
- ESLint bans in `src/editor/instruments/`: no `useFrame`, `performance.now`, `Date.now`, `Math.random`, no clock/delta. Use `useInstrumentFrame(trackId, cb)` and `seededRand(seed)`.
- `core/visual/pauseCanary.ts` (dev-only) hashes the paused scene and names any object that moves.

Never derive the beat from audio; audio is scheduled FROM the beat (see `src/editor/core/audio/CLAUDE.md`).

## Data-flow map

```
TimeStore.currentBeat  ← produced ONLY by core/playback.ts (Tone transport + RAF)
   ├─ visual engine   core/visual/    resolve tracks → graph; computeAtBeat per frame
   ├─ audio engine    core/audio/     players armed at transport events (discrete, not per-frame)
   └─ export engine   core/export/    steps beat arithmetically through the same visual path
ProjectStore = the document (per-scene tracks/blocks/notes + tempo)   store/
Persistence  = serialize ⟷ hydrate ⟷ Supabase, autosave, upgrades     src/persistence/
```

## Load-bearing invariants (violating these breaks distant code)

1. **Generic field picking**: `HistoryStore` (undo) and `persistence/serialize.ts` both snapshot ProjectStore by enumerating every non-function field. A new ProjectStore data field is automatically undoable AND persisted — but you must add it to `ProjectDocument` (persistence/types.ts) to keep the type honest, and consider a schema upgrade if the shape changed.
2. **Upgrade steps are append-only and frozen** (`persistence/upgrade.ts`): bump `CURRENT_VERSION`, append `UPGRADES[N]`, never edit a shipped step.
3. **Registries everywhere**: instruments, effects, movers/splitters (visualCopies), directors, templates, and settings UIs each register in one index file. "Adding an X" is: one new file + one registry entry (+ for instruments, a curated picker entry in `LeftSidebar.tsx` — the add menu does NOT read the registry).
4. **The engine is not React**: `core/visual/VisualEngine.ts` is a module singleton; per-frame state must never trigger re-renders. Only the structural object LIST is a React-visible external store.
5. Timeline and piano roll have **separate gesture systems on purpose** — don't unify them.

## Where things are

| Area | Path | Guide |
|---|---|---|
| Editor shell, document model | `src/editor/` | `src/editor/CLAUDE.md` |
| Transport, track transform, directors, photo/video time | `src/editor/core/` | `src/editor/core/CLAUDE.md` |
| Visual engine | `src/editor/core/visual/` | its CLAUDE.md |
| Movers/splitters (VisualCopy) | `src/editor/core/visualCopies/` | its CLAUDE.md |
| Audio engine | `src/editor/core/audio/` | its CLAUDE.md |
| Export | `src/editor/core/export/` | its CLAUDE.md |
| Zustand stores | `src/editor/store/` | its CLAUDE.md |
| Instruments | `src/editor/instruments/` | its CLAUDE.md |
| Effects (transform/shader) | `src/editor/effects/` | its CLAUDE.md |
| Settings UIs | `src/editor/userInterfaceRenderers/` | its CLAUDE.md |
| Timeline / piano roll / 3D view UI | `src/editor/components/` | its CLAUDE.md |
| Persistence / Supabase | `src/persistence/` | its CLAUDE.md |
| Templates | `src/templates/` | its CLAUDE.md |
| Routes, auth, Stripe, APIs | `app/` | `app/CLAUDE.md` |

`docs/` holds the historical architecture + implementation-plan HTML docs (the *why* behind big features); `rapid-todos.html` is the backlog. `visualObjectEngineDocs.md` and `ExportVideoDoc.md` at the root are deep dives on those two engines.

## Style

The codebase's comments explain *why* and document contracts at definition sites — match that. Prose comments over restating code. Colocated tests. No default exports for defs; registries import named defs.
