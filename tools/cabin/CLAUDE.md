# tools/cabin — the command line for building projects from code

`./cabin <command>` (repo root; TypeScript via the repo's tsx, any cwd). It
exists so a model can make a music video the way a person does in the editor -
scenes, instruments, MIDI - but by writing code, with stills in about a second,
a review loop with the user, and renders at full quality. `./cabin help` is the
reference (generated from the commands), `./cabin docs` the guides; this file
is the working knowledge.

## The loop

```bash
./cabin new song --audio ~/song.m4a        # projects/song/{project.json, cabin.json, audio/}
./cabin analyze song --lanes               # stems → grid/events; bar 0 = ONE; sections; shared lanes
./cabin analysis song --range 28-40        # the bar table: what the song does, per bar
./cabin run song path/to/build.ts          # an edit script writes scenes, instruments, MIDI
./cabin shot song --at 2,14.5,@chorus+2 --sheet   # stills + a sheet (tiles labelled bar · beat) - read it
./cabin strip song --around 28 --span 1    # frames across a moment (how a hit/transition moves)
./cabin audit song                         # whole song: black/blown/static/frozen stretches + per-section stats
./cabin clip song --range 26-30            # motion check with audio
./cabin render song --out song.mp4         # 1080p60, motion blur (3× default; --mb 2 halves the time)
```

Open the same project live with `/editor?file=<name>` (`cabin open song`): the
page polls the file and re-hydrates when the CLI writes it (one undo step, and a
review bar: "Claude changed … · Show · Undo"); editor edits PUT back (a 409 means
the file moved - the file wins). Projects live in `projects/` (gitignored).

**Always the current schema.** Every CLI read goes through the app's own
`upgradeDocument` (src/persistence/upgrade.ts) - `loadDoc`, history snapshots,
the daemon's skeleton - so the API only ever sees the version main is on and an
older file is stored current by the next write (`cabin upgrade <p>|--all` writes
it now). Never hand-write a `schemaVersion`; tests use `CURRENT_VERSION`.

## Working with the user: comments

The user pins comments in the editor - C at the playhead (on the selected
track), or pin mode (Shift+C / the chip in the scene tabs) and click a track
lane or an object on the canvas. Each carries bar, section, scene/track,
instrument, the nearby notes and a still of the frame.

```bash
./cabin comments song --wait &             # background: exits when a comment arrives (you get woken)
./cabin comments song                      # what needs you (open, or the user replied)
./cabin comment song c3 --strip            # one in full + a frame strip around it
./cabin reply song c3 "Settle 1.1 → 0.7" --shot    # answer (status review) + the frame as it is now
./cabin comment add song --at @bridge "Question for you…"
```

Statuses: open → working → review (you replied; the user looks) → resolved, or
back to open when they reply. Files: `projects/<p>/comments.json` + `comments/*.png`
(src/devtools/commentsCore.ts; the editor writes through app/api/dev/.../comments).

## The scripting API (lib/api.ts)

Edit scripts `export default (p: Cabin, args) => {...}`; `cabin eval` runs one
line with `p` in scope. **Absolute beats** (`p.bar(n)` = downbeat of 0-based bar
n). Blocks are bookkeeping the API does (a note lands in the block covering it;
blocks grow and merge; looped blocks expand when edited).

- `p.scene(name, {background})`, `p.main()`, `p.removeScene`, `p.sections`
  (the document's markers - the editor's song strip; `@name` positions),
  `p.analysis()`, `p.lane(name)` / `p.lanes()` / `p.lanesFromAnalysis()`.
- `scene.track(name, spec)` get-or-create (spec re-applied): `{instrument,
  params, strings, mover, splitter, inputs, param, range, …}`; `track.child()`
  for devices and automation lanes.
- `track.add(notes)`, `hits`, `clear(from, to, pitch?, {all?})`, `replace`,
  `notes()`, `keys([[beat, value]])` (row-quantized), `curve([{beat, value,
  ease}])` (exact + eased), `cue(beat, scene, dur)`, `set({...})`, `mute()`, `remove()`.
- **Provenance** (core/provenance.ts): every note the API adds carries
  `src {by: p.author, h}` and new tracks `createdBy` (run → 'script:<file>').
  `clear()` removes only notes still exactly as a script wrote them; `add()`
  skips notes the user moved or deleted (pins + tombstones from .history). So a
  build script can be re-run after the user's hand edits without undoing them.
  Before provenance, a project's notes are adopted as 'legacy' script notes once.
- `./cabin describe <id>` - any instrument's params and MIDI rows.

`examples/innuendo.ts` builds a whole song from its analysis - copy it.

## History (lib/history.ts)

Every CLI write records the document it wrote in `projects/<p>/.history/`:
`cabin history` (the writes, with what each changed), `cabin diff` (what changed
since my last write = the user's editor edits), `cabin diff --last` (what my last
write did), `cabin undo` (back to before my last write; refuses if the user
edited since, unless --force). The semantic diff is src/devtools/docDiff.ts.

## Analysis (tools/analysis/analyze.py, lib/analysis.ts)

- Python in `~/.cache/cabin/venv` (`cabin analyze --setup`); Demucs htdemucs on
  MPS (~15 s for a song), then grid by phase coherence of drum onsets, downbeat
  from kick weight + bass onsets + harmonic change. `--bpm/--downbeat/--json/--stems`.
- Alignment: lead-in ≤ 0.35 s is trimmed (bar 0 = ONE), a longer pickup starts
  the file mid-bar so ONE lands on bar 1. The analysis follows the audio block.
- `p.analysis()`: `kick/snare/hat {beat,v}`, `bass/vocal {beat,dur,v,pitch|null}`,
  `other {beat,dur,v,pc,bright}`, `harmony`, `env(name, beat)`, `envMean`,
  `chordAt`, `bars()`, `sections()`, and the musical filters `strongest(kind,
  rel, floor, div)` (strong FOR ITS BAR), `sung(minV)` (a pitch for every sung
  onset), `chordChanges()`. `toMidi(file)`.
- The bar table: drm/bas/vox/oth/mix energy 0-9; K S H b v o onsets per bar.

## Rendering + the live page (lib/daemon.ts, lib/render.ts, src/editor/dev/renderHooks.ts)

- A daemon keeps one headless Chrome (real GPU) on `/editor?file=<name>`; starts
  on demand, exits after 30 min idle. `cabin config dev-url http://localhost:<port>`.
- Frames go through the export FrameDriver - stills = what export encodes:
  `pin()` then `prepare(firstBeat)` (lazy instruments, mounts, one primed frame),
  exactly as Export does; skipping prepare draws not-yet-loaded scenes black.
  `--view <scene>` captures one scene. Clips stream RGBA over a WebSocket into
  ffmpeg with the project's audio; `--mb N` averages N subframes (motion blur).
  ~80 fps at 960×540; ~13 fps at 1080p60 --mb 2 (a 3.5 min song ≈ 16 min).
- Before each capture: wait for the editor, reload the file if its version moved,
  check the page shows THIS document (bpm, scenes, tracks, code ids registered);
  a mismatch reloads the page, a second one errors with what's off.
- `cabin ui <p> [--at] [--select Scene/Track] [--comments] [--do "press c; wait 300;
  type hi; press Meta+Enter; click [data-testid=x]"]` - a screenshot of the
  EDITOR (timeline, panels) after scripted input: how to check UI work.
- `cabin page <p> "<js>"` - evaluate in the live page and print the result
  (`__previewRuntime`, `__cabinStores`, `__cabinCommands`, `__three`).
- `cabin actions [filter]` (every ProjectStore action, generated from source),
  `cabin act <p> <action> args…` (JSON, `@Scene/Track`, `@@Scene`) - runs it in
  the live editor, saved back by file sync. `cabin commands <p>` / `cabin cmd <p>
  <id> k=v` - the editor's command registry (what ⌘K offers; src/editor/commands).

## Adding a command

One object in `tools/cabin/commands/<group>.ts` (`lib/command.ts`: name, usage,
summary, details, run(args)); `cli.ts` dispatches (longest name wins: "midi
import" before "midi") and generates help from it. Args: `a.opt/flag/num`
first, then `a.need/next` for positionals. Throw `UsageError` for misuse.

## Gotchas

- **Don't edit engine code (src/editor/core, VisualScene…) while a render
  streams** - `?file=` pages reload on engine hot updates. Code instruments
  hot-swap without a reload, but a mid-render swap changes the frames after it.
  Docs, `tools/`, `cabin analysis` are always safe.
- Background shells may put Node 18 first on PATH; Next 15 + tsx need ≥ 20
  (nvm Node 24, or `CABIN_NODE`).
- Running Next edits `tsconfig.json` (dist-dir globs); restore before committing.
- Typing via `ui --do` right after `press c`: add `wait 300` - keys typed before
  the composer focuses hit the editor's shortcuts (f = fullscreen canvas).
- `cabin notes` prints `bar.beat` with 1-based beats (the ruler's way); positions
  you type are 0-based fractional bars.
