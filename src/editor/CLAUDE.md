# src/editor — the editor app

Everything inside the `/editor` route. `App.tsx` is the shell (client-only, dynamically imported by `app/editor/page.tsx` because the three.js bundle is heavy): header/transport, resizable panels (left library sidebar, timeline, piano roll, 3D canvas), and the once-mounted plumbing components (`VisualBeatSync`, `RenderGovernor`, `ExportDriver`, `MediaFileDropLayer`). Dev builds expose stores on `window.__cabinStores` for console/E2E debugging.

## The document model (`types.ts`)

`types.ts` is THE document schema — what gets persisted, undone, and resolved. The engine's derived types live in `core/visual/types.ts`; dependency points engine → document only.

- **Scene**: a self-contained track forest (`tracks` record + `rootTrackIds`) with a backdrop: a flat color, a two-stop gradient (`backgroundGradient`, optional field), or transparency. `sceneBackdropMode()` in types.ts resolves which one the scene wears; `ProjectStore.setSceneBackdropMode` switches atomically (one undo step) and the gradient's setup survives leaving the mode. The **Main scene** (`isMain`) is special: it holds *composition-instrument* tracks — ordinary `base` tracks whose `instrumentId` names a def in `core/directors` — that compose the other scenes into the final frame instead of rendering objects.
- **Track** is a tagged union via `type: TrackType`:
  - `base` — an object instrument (`instrumentId`, `params` numeric / `stringParams` string-valued, `effects`, canonical transform under reserved `tf*` param keys).
  - `automation` — child lane keyframing a parent numeric param. **Value is encoded in note PITCH** (`core/trackTypes.ts`: pitch 36–84 maps linearly onto the param's [min,max]); `targetParam` picks what. Four MODES pick how (see `core/visual/CLAUDE.md`): `interpolation` curves between keyframes, `noise` gates seeded-random wander, `burst` fires an ADSR from the value underneath toward each note's own value, `cycle` stretches a user motion curve between each pair of note onsets (the earlier note's value scales it). Mode is implied by which config exists — set it through `setAutomationMode`, which keeps them exclusive in one undo step. `automationAmount` is a mode-independent output gain on the whole lane (see core/visual/CLAUDE.md; neutral 1 is stored as absence). For lanes targeting the spatial `tf*` params, the lane's POSITION among mover/splitter siblings is semantic: above a splitter it animates each copy in place (the splitter duplicates the animated object), below the whole chain it moves the finished formation as one — see the weave step in core/visual/CLAUDE.md. Lanes may be dragged between parents: a target the new parent can't take is defaulted by `remapAutomationTarget`, with the displaced original kept in `previousTargetParam` so dragging back restores it (a deliberate retarget forgets it).
  - `ability` — child lane driving a parent instrument's bespoke ability (`abilityKey`, e.g. Cube's Shatter). Expressed inside the instrument's own component.
  - `envelope` — child ADSR lane (`adsr` in beats, `envDepth`, `envTarget`, `targetParam`; reserved target `'opacity'` multiplies).
  - `mover` / `splitter` — VisualCopy chain rows (`moverId`/`splitterId` + `inputValues`); top-level movers target other tracks via `targets: Routing[]` (track / tag / subtree scopes), and ANY chain row narrows which of the copies reaching it it acts on via `copyTargets` (absent = all of them — see `core/visualCopies/copyTargets.ts`; both pickers live on the inspector's Targets tab). Nested under a MOVER a mover is that parent's **frame** and moves it (`core/visualCopies/moverFrame.ts`); nested under a SPLITTER it moves the splitter's **copies in the splitter's reference frame** — a rotation child orbits the formation about the splitter's origin, as motion INTERNAL to the copies that never re-frames later chain entries, so a grid below duplicates the spinning formation instead of inheriting the spin (`core/visualCopies/splitterChildChain.ts`). Either way it never joins the object's chain and its own `targets` are ignored. The one exception to all of that is a **Bypass** lane (`moverId: 'bypass'`, a `parentGate` definition): it is not an entry of anything — its notes switch its parent device off, or with the mode flipped switch it on for the note's length. See `core/visualCopies/CLAUDE.md`.
  - `wordFormation` — child lane of a text instrument: ONE arrangement its words are seated into (geometry in `inputValues` against `WORD_FORMATION_PARAMS`, so automation children and the panel binding work exactly like a mover's), plus notes saying when that arrangement is live. Several lanes = several formations; the one whose onset is most recent owns the beat. See `core/visual/wordFormation.ts` — including why this is not a splitter. An instrument opts in with `seatsWords` on its def; only Text Display does.
  - `group` — a folder over member tracks (⌘⇧G groups the selection via `groupTracks`; ⌘⇧G on a lone selected group, or the context menu, ungroups). Carries the canonical `tf*` transform (inherited by the whole subtree — the engine composes its world matrix as every member's parent; `tfOpacity` cascades onto member objects), automation lanes on those params, an effect chain broadcast to every member object (merged in `ObjectRenderer`), and mover/splitter children that broadcast onto each member's chain. **A group chain child applies to the member siblings ABOVE it** (children read as a top-to-bottom pipeline; an entry above every member applies to nothing), composed per member in the member's own frame — the group's own tf\* is the formation-as-one channel. Inner groups' entries land before outer ones. Group fx: automation lanes are deliberately not offered (no engine sampling yet).
  - `audio` — pinned audio lanes (`audioBlocks`, positioned+trimmed clip refs). Live OUTSIDE scenes (project-level, `audioTracks`/`audioRootTrackIds` in the store).
  - (The `director` type was retired in schema v12: composers are now `base` tracks whose `instrumentId` names a composition def, discriminated by `isCompositionTrack` — see `core/CLAUDE.md`. `sceneBindings` maps their MIDI pitches → scene ids.)
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
- **Panel-toggle motion (App.tsx)**: sidebar toggles glide by putting `.panel-toggle-anim` (globals.css, M3 emphasized-decelerate 400ms on `flex-grow`) on the panel's GROUP for the toggle's duration. Two traps: react-resizable-panels v4's `onResize` tracks the DOM *through* the CSS transition, so open/closed state is set from INTENT at click and `onResize` writes are suppressed for the glide window (`suppressResizeUntilRef`) — otherwise the header icon re-blues mid-close; and the WebGL canvas must not resize DURING a glide (per-frame buffer resizes stretch the picture — the buffer lags the element), so the toggle also freezes the r3f root (`.canvas-glide-freeze`), centered, at a width ≥ its landing size (current + the toggled panel's width) — the glide is horizontal-only and the camera's FOV is vertical, so the wider render center-crops pixel-identically and the panel edge just reveals/covers a fully-rendered scene; the start/settle resizes are invisible. `.visual-canvas-smooth canvas` pins the canvas to 100% of its root with `!important` (bridges the inline-px lag at the snap), and the letterbox box is pure CSS (`cqh` contain-fit, no ResizeObserver).
- **Aspect-switch motion (App.tsx `VisualPanel`)**: Fill / 16:9 / 9:16 glide instead of
  snapping — the framed box travels between the two contain-fit rects on M3 emphasized
  400ms (`.aspect-glide-anim` in globals.css; keep it in step with `ASPECT_GLIDE_MS`), and
  since everything outside that box is the panel's deep background, animating the box IS
  animating the letterbox bars. At rest the box is sized in container-query units on BOTH
  axes (`restingAspectBox`) so it tracks sidebar glides with no measure→render round-trip;
  the glide swaps in an explicit px pair, because a transition between two `min()`/`cq`
  expressions is not a portable interpolation, and hands the box back to the CSS at the end
  (identical geometry, invisible handover). Two traps: the effect measures the panel, and
  that flush recalculates the box's style too — so the browser's before-change value is
  already the NEW resting box, and arming the transition on the same commit animates
  BACKWARDS (destination → origin) until the rAF retarget swallows the glide whole; hence
  the untransitioned `moving: false` commit that pins the old rect, then a rAF commit that
  moves. And while the px pair is in force the box cannot track a panel resize — it snaps
  onto the container at the settle, which is why the class/px live only for the glide.
  **`object-fit: cover` scales the frame UP whenever the element outruns the GL buffer, and
  that asymmetry is a bug generator**: a box that GROWS (any glide out to Fill) rendered
  visibly zoomed for the glide's duration, while a shrinking one merely cropped and looked
  perfect — so the artifact shows up in one direction only and reads as "Fill zooms the
  preview". The cure is the sidebar freeze's: pin the r3f root (`.aspect-canvas-pin`),
  centered, at the LARGER of the two boxes per axis — `≥ wherever the glide lands`, because
  pinning the DESTINATION instead opens a dark gap down each side of a shrinking glide — so
  the buffer resizes once at the start, never during, and the moving box only ever crops a
  fully-rendered scene. Anything else that animates the canvas's container owes the same
  pin; a continuous per-frame resize also re-renders the whole instrument tree ~24 times.
- **Decoration that overhangs a box must be clipped with `overflow-clip`, never
  `overflow-hidden`** — `hidden` makes the box a real SCROLL CONTAINER, and an absolutely
  positioned child hanging past its inline-end edge gives it scroll range nobody asked for.
  The workspace card (App.tsx, `data-workspace-card`) held the ambient bleed
  (`left:-15%; width:130%`) and so carried ~15% of horizontal scroll: `clientWidth` 720 vs
  `scrollWidth` 827 at a 1440px window. One stray trackpad swipe, focus, or `scrollIntoView`
  anywhere inside slid the card left and opened a ~108px blank margin down the right side,
  shoving the visualizer and the inspector off the viewport edge with no way home but
  scrolling it back — reported as "sometimes there's randomly margin on the right", and it
  looks like a flex/panel-sizing bug, which is why it survived so long. Only the RIGHT side
  showed because the bleed's `top:-30%; height:118%` ends at 88%, so there was no bottom
  overhang. `clip` clips pixel-identically and simply is not scrollable, and fixed-position
  descendants still escape it, so VisualPanel's fullscreen glide is unaffected (all three
  verified in the live DOM, 2026-08-14). The whole editor was swept for the family the
  next day: the ruler's `[data-loop-lane]` (`Ruler.tsx`) was the other live one — 2190px of
  range over transform-scrolled content nothing reads `scrollLeft` from, so a swipe over
  the ruler desynced the bar numbers from the lanes permanently — plus the pickup band and
  clipped bar-number boxes beside it, `TimelineArea`'s lane wrapper / playhead clip /
  project-end host, `BottomArea`'s roll-slide clip, and the two preview clip boxes
  (`InstrumentHoverPreview`, `SceneSettingsPanel`). The subtlest was `VisualPanel`'s
  framed box: both canvas pins park the r3f root inside it as an absolute child WIDER
  than the box and centered, so it grew ~150px of range for the 400ms of every sidebar
  toggle and aspect switch — a transient window, but a wheel inside it left the canvas
  permanently off-centre in its frame. Anything that pins an oversized child owes the
  same treatment. (The `w-screen h-screen` root stays `overflow-hidden`: measured zero
  range, and every child now clips itself.) **The rule now: a box that exists only
  to CLIP takes `overflow-clip`; `overflow-hidden` is reserved for something you actually
  intend to scroll** (the timeline's `absolute inset-0 overflow-auto` is the one real
  scroller here, and its `scrollLeft` is read all over — don't convert it).
  Diagnose by trying to scroll everything, not by comparing widths — only the former
  distinguishes reachable range: for each element set `scrollLeft`/`scrollTop` to 99999,
  read them back, restore. Two known non-findings: Tailwind's `truncate` is
  `overflow:hidden`, so every truncated line reports a few px of range (unreachable —
  nothing focusable lives inside a text span), and in the embedded Browser pane r3f's
  `<Canvas>` wrapper reports ~19px because the pane's starved ResizeObserver leaves the
  canvas at its intrinsic 300×150; that one is the environment, not the app.
- `useVerticalSplit.ts` — the timeline/piano-roll divider.
- `utils/` — pure helpers: `selection.ts` (track select), `edgeResize.ts` (shared block-edge drag), `snapStep.ts`, `oklch.ts` + `trackColors.ts` (hue-cycled track colors), `trackTags.ts`, `zoomAroundBeat.ts`, `multiStyleApply.ts` (lyric style switching), `midiEditorPalette.ts`.
- `hooks/` — transport-facing hooks: `usePlayback` (wires PlaybackEngine callbacks), `usePlayhead` (RAF playhead px), `useScrub`, `useTransportKeys` (space/enter/F), `useUndoRedoKeys`, `useProjectPersistence` (load + autosave lifecycle), `useAnonymousAdoption` (anon → signed-in project handoff).
