# Cabin Visuals

A DAW for music visuals: sequence 3D instruments on a timeline the way you'd sequence synths in Logic. MIDI notes drive visual instruments (a shattering cube, particle rings, fractal tunnels), modulators and automation shape their parameters over time, an audio track plays alongside, and the whole project exports to an MP4 — all in the browser.

Built with Next.js 15 / React 19, react-three-fiber, zustand, Tone.js, and Supabase (auth + project persistence).

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000, sign in, and create a project. Supabase needs two env vars in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

(`DATABASE_URL` is additionally needed for Drizzle migrations: `npm run db:generate` / `db:migrate`.)

Without a `?project=` id (or without Supabase configured) the editor still runs fully in-memory — nothing persists, everything else works.

## Using the editor

- **Add tracks** with the + button; drag instruments from the library onto them. Right-click a lane to draw a MIDI block; double-click a block to open the piano roll (right-click draws notes).
- **Right-click a track label** to add automation lanes (keyframe any numeric param) or the instrument's ability lanes (bespoke behaviors like the Cube's Shatter).
- **Modulators** (Pulse, …) are tracks whose notes drive other objects' ports — route them to a track, a tag, or a whole branch in the track editor.
- **Effects** (transform / clone / shader) drag onto a track from the library's Effects tab.
- **Audio**: load a file via the bar at the bottom — it becomes a pinned audio track whose block you can move and trim freely.
- **Export** (header button, Chrome) renders the project to an MP4 deterministically — frame-exact, faster than realtime, optional audio.
- Space = play/pause · Enter = return to start · F = fullscreen visual · Ctrl+Z/Y = undo/redo · drag across M/S buttons to mass-toggle.

## The one rule of the codebase

**Instruments are pure functions of the beat.** A paused playhead is a frozen frame; scrubbing to a beat shows exactly what playback shows there. This is what makes scrubbing trustworthy and video export exact. It's enforced, not aspirational: ESLint bans `useFrame`, `performance.now`, `Date.now`, `Math.random`, and clock/delta access inside `src/editor/instruments/`, and a dev-mode canary hashes the scene while paused and names any object that moves. Use `useInstrumentFrame(trackId, cb)` for per-frame visuals and `seededRand(seed)` for stable randomness.

## Architecture in one paragraph

One clock, four consumers. `TimeStore.currentBeat` is produced by the transport (`core/playback.ts`, Tone transport + RAF beat tracker) and consumed by: the **visual engine** (`core/visual/` — resolves the track tree into a render graph, computes every object's state per frame via `computeAtBeat`), the **audio engine** (`core/audio/` — a player pool armed at transport events with shared beat⟷second placement math), and the **export engine** (`core/export/` — steps the beat frame-by-frame through the same visual path into WebCodecs, and renders audio through the same placement math offline). Audio is scheduled *from* the beat; the beat is never derived from audio.

## Layout

```
app/                        Next.js routes (landing, auth, /projects, /editor)
src/editor/
  core/playback.ts          the transport — sole producer of the beat
  core/visual/              resolve → matrix → computeAtBeat · pause canary
  core/audio/               AudioEngine · placement math · decode/peak cache
  core/export/              frame stepper · WebCodecs encode · mp4 mux · gate
  instruments/              one file per visual instrument (def + component)
  instruments/modulators/   port-driving modulators (Pulse, …)
  effects/                  transform / clone / shader plugins
  store/                    zustand: ProjectStore (the document), TimeStore (the
                            clock), UIStore (view state), HistoryStore (undo)
  components/               timeline, piano roll, track editor, export dialog
src/persistence/            Supabase: serialize/hydrate · autosave · upgrades
docs/                       architecture + implementation-plan docs (start with
                            visual-architecture.html; rapid-todos.html = backlog)
```

Useful invariants beyond the big one: the project document is versioned and upgrade steps in `persistence/upgrade.ts` are append-only and frozen once shipped; `HistoryStore` and `serialize` both pick store fields generically, so a new ProjectStore field is undoable and persisted with zero wiring; the timeline and the piano roll have separate gesture systems on purpose.

## Docs

The `docs/` folder is the real documentation — greyscale, print-ready HTML. Each major feature has an architecture doc (the *why* and the decisions) and an implementation plan (the file-by-file *how*): persistence, audio track, video export, visual engine. `rapid-todos.html` tracks the backlog with an at-a-glance progress overview.
