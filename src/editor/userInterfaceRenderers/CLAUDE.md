# src/editor/userInterfaceRenderers — registered settings UIs

The inspector panel (in `TrackEditor.tsx`) renders a track's settings through a REGISTERED renderer instead of hardcoding layouts. A renderer is a component `({ targetId, parameters })` where each `UserInterfaceParameter` arrives with `{ definition, value, setValue }` — the canonical update path is already bound; renderers never write stores directly.

Three registries:
- **Object instruments** (`index.ts`, keyed by `UserInterfaceRendererId` from `ids.ts`): every instrument def explicitly names one via `userInterfaceRenderer`. `'parameters'` is the generic auto-generated list (`ParametersUserInterface.tsx`); the rest are bespoke (Cube, TextDisplay, Video…).
- **Movers/splitters and effects** (`bespokeRegistries.ts`, keyed by definition/plugin id): registration is OPTIONAL — a missing entry falls back to the generic ParamControl list in TrackEditor.
- Envelope tracks use `EnvelopeUserInterface.tsx` directly; automation tracks use `AutomationUserInterface.tsx` directly; word-formation lanes use `WordFormationUserInterface.tsx` directly (all three are plain presentational components TrackEditor binds, not registry entries).

`WordFormationUserInterface.tsx` is Grid's layout-preview pattern applied to a lane that has no definition, which changes exactly one thing: **its accent is the TRACK's own color** (`resolveTrackDisplayColor`), not an `identityColors` constant — same principle (console and notes are one color), different source, because a formation lane is told apart by which one you play rather than by a definition it names. Its window draws the real `formationSeats` numbered in fill order, so the fill-order segments are made legible by looking at the preview rather than by reading their labels.

**`useMemo(() => bind(parameters), [parameters])` is a trap if the panel ALSO subscribes to a store.** The shared `bind` helper (copied across Grid, Tunnel, Approach, Word Formation) *drains* its pool — each `num`/`select` call deletes the key so `rest()` can return the leftovers. Memoizing the binder and calling it during render is fine only while every render brings a fresh `parameters` array. A panel with its own `useProjectStore` subscription re-renders on any store change with the SAME props, gets the memoized, already-drained binder back, and every lookup returns null — so an "all keys present, else ParameterList" check silently renders the generic list, looking exactly like a failed registration. Resolve the bindings INSIDE the memo (return the resolved object, not the binder). Cost half an hour of chasing the wrong thing; the sibling panels are only safe because they subscribe to nothing.

Adding a bespoke instrument UI: add the id to `ids.ts` (union type), create `<Name>UserInterface.tsx`, register in `index.ts`, point the instrument def at it. For movers/effects: just add to the right map in `bespokeRegistries.ts`.

**Start with the console kit (`console/`) — most panels never need more.** The kit is the guide's building blocks as components: `bindPanel` (the one param binder — typed lookups that CLAIM keys, `rest()` for the disclosure, `missing` for the fallback), the accent formulas (`shadeOf`/`spillOf`/`emitterHalo`), the `Console` chassis + `ControlRow`/`GutterRow`, bound `Knob`/`ColorPill`, `Segmented`, `PreviewWindow`, and `More`. A panel states its accent ONCE on `<Console>`; every kit control reads it from context. Two ways in:

1. **A spec** (`console/spec.tsx`): a panel that is pure composition is DATA — accent, an optional preview component, rows of knobs/segments. `consolePanel(spec)` interprets it. An instrument def can carry the spec as `panelSpec` and skip ids.ts/index.ts registration entirely (Laser Line is the reference — its whole console is ~10 lines on the def); a registry entry can also be `consolePanel(spec)` directly (Laser Sphere). The spec's escape hatches are the `preview` slot and `custom` rows (components with a `claims` list so their keys stay out of MORE) — previews and one-off controls are the instrument speaking and stay components on purpose. A panel that outgrows the spec becomes a bespoke file; that is the intended pressure valve.
2. **A bespoke file composing the kit** (Strobe, Mover, Conveyor…): for panels with view state, derived loops, or bespoke interaction. Deliberately different controls remain first-class — Impact Scatter's overdrive catch-detent knob, Pixel Blast's 8-bit cell meters, the gradient-track sliders (their tracks ARE the value space) — but the chassis, binder, plain knobs and disclosure still come from the kit.

The `showIf` trap below is encoded in the binder: look gated keys up with `{ optional: true }` (string shorthand `'key?'` in a spec).

**Mount an r3f preview through `PreviewCanvas` (console kit), never a bare `<Canvas>`.**
The inspector is one of the panes the sidebar toggles GLIDE (400ms), so a preview's width
changes on every frame of an animation, and a bare Canvas gets both failure modes the main
viewport had: three writes inline px on the canvas element per `setSize` through a
ResizeObserver → React round-trip, so the element visibly STEPS inside its smoothly-moving
window; and resizing a WebGL drawing buffer CLEARS it, so a preview that isn't looping
(see the black-until-play note below) goes black or stale for the rest of the glide.
`PreviewCanvas` fixes both — `.preview-canvas-smooth` (globals.css) hands the canvas
geometry to CSS so layout can't lag, and its `ResizeSync` advances THAT root synchronously
pre-paint on every size change. Same cure as `VisualPanel`'s in editor/App.tsx.

**A panel's live 3D preview may not animate until the transport PLAYS.** Observed 2026-07-29 on both Impact Scatter's and Conveyor's previews: the canvas is created and sized, but `useFrame` never fires while paused, so the window stays BLACK — hitting play starts it, pausing freezes the last frame. Likely because r3f's render loop is global and the main canvas runs `frameloop='demand'` (RenderGovernor), so once the loop stops nothing restarts it for a panel root that mounted later. It is app-wide, not a panel bug: **smoke-test previews with the transport running** before suspecting your own preview code.

`AutomationUserInterface.tsx` is the second panel built to the guide (after Laser Sphere): a live window onto the lane — the easing curve, the real seeded wobble, or a grabbable ADSR — over a segmented MODE control and a knob row. Its window is drawn with the engine's own samplers (`easeFraction`, `sampleNoiseLane`, `sampleLane`) so the picture can't drift from playback, and its emission comes from three stacked strokes of the same path rather than a blur filter (a stretched viewBox smears blurs anisotropically). Its AMOUNT fader is the panel's one sanctioned slider: a lane-level gain (mode-independent, so it sits below whichever mode console is up) with its lit fill growing from a 100% center detent — the horizontal-throw sibling of LaserKnob's `bipolar` rule that neutral must never read as half-on. The curve/noise windows scale with it, using the same math resolve.ts applies, so the plot stays the real signal.

The **FORCE console** is the panel's largest, and its shape was picked from an
interactive mock rather than argued: PUSH, RESISTANCE and STANDING FORCE are
segmented rows up front with the four knobs between them, while the two choices
that change what a note *means* — whether its row is a target or a signed force,
and how overlapping notes combine — sit behind a MORE disclosure. Its window is a
PLOT and deliberately never an editor, unlike burst's and cycle's: there is no
handle to grab on a curve that is the consequence of pushes rather than a shape
someone drew. The plot runs the engine's own `integrateForceLane` over a demo
phrase, and it draws the note SPANS as well as their onsets, because under a held
thrust the note's length is the gesture. Range-limit behaviour has no control at
all (always cushioned) — see core/visual/CLAUDE.md for why. The kit's `More` is
shaped for a generic ParameterList, so this one borrows its chrome via a local
`MoreRow` that takes children instead.

Its curve picker holds **one swatch that is a live value rather than a fixed
glyph**: SPLINE's shape depends on the keyframes around it, so it cannot be drawn
as a single hop like the other seven easings. Both its swatch and its window plot
a four-keyframe demo phrase through the real `sampleLane` at the current tension —
a phrase that turns TWICE on purpose, because a rising spline would look like any
other easing and hide the whole point of the mode. The window is a plot, not an
editor (unlike burst's and cycle's): there is no handle to grab on a curve whose
shape comes from the notes, so TENSION is an ordinary knob beneath the picker.

Its **Rows·Range console** says two things the param defs don't. MIN/MAX travel one full param span PAST each end, because a lane is allowed to aim past what the instrument declares (`automationValueBounds`; a boosted AMOUNT lifts the ceiling further at playback). And under **INT the ROWS knob and the spread segments are DERIVED, not chosen** — the rows are the whole numbers of the range — so both stand down rather than disappearing: ROWS keeps showing the derived count through LaserKnob's `disabled` (dimmed, no pointer/keys, `title` says why), because a control that vanishes re-flows the row and hides the very number you wanted. Every `emit` passes `range?.rows`, never the displayed count, or INT's derived value would get written back as an explicit one.

`RadialMotionMoverUserInterface.tsx` is the worked example for a panel whose params are a MATRIX rather than a list: the same four questions (radius, spin Z, spin X, spin Y) asked once per nesting depth, so rows are the question, columns are the depth, and the knobs carry no captions of their own. Three things it settled:

- **A grid panel busts the ~240px height budget and that is a real cost, not a rounding error.** 4 rows × 3 knobs plus a preview lands near 450px, and the inspector pane opens around 300px — half the console starts below the fold. It scrolls and the pane drags, but reach for a disclosure first; only go to a grid when the caller has explicitly asked for everything visible at once.
- Its preview runs the mover's real `resolve()` with **NO NOTES**, which is the claim the mover makes (passive choreography, MIDI as accent). A preview that needs notes to move would be hiding the actual behaviour.
- The preview frames by **HEIGHT, not width** — the subject is a disc in a short wide window, and fitting the width pushes the top and bottom off-frame. (Conveyor frames by width for the opposite reason: its subject is a line.) Same per-frame re-derivation from `gl.domElement.client*` as Conveyor, for the same reason.
- **A stepped (detent) knob is a LaserKnob driven in INDEX units**, not a new control: its spin knobs walk `RADIAL_MOTION_SPIN_DETENTS` by binding `value`/`min`/`max`/`step` to `0…detents.length−1`/`1` and converting index⟷rate in the wrapper's `format`/`onChange` — evenly spaced clicks on the arc regardless of how non-uniform the underlying values are, and `bipolar` still works when the zero detent is the middle index. The keyboard nudge in laserKnob.tsx is `max(3%, one step)` for exactly this case; don't shrink it back.

Building blocks — use these, don't hand-roll controls: **the console kit in `console/` first** (see above), then the plain-value primitives it wraps: `ParameterControl.tsx` exports `ParamControl` (dispatches on param type), `ParamSlider` (drag + curve + fine-step behavior), `ParamToggle`, `ParamStepper` (small integer counts as −/+ around a detent strip — segment/facet counts, where a smooth slider makes the exact value a hunt), `ParamHueSlider` (a radians hue param on a rainbow track); `colorWheel.tsx` is the shared color picker in TWO shapes — `ColorWheelPill` + `ColorWheelPopover` (a swatch that opens a floating HSV wheel: the default, and what the kit's bound `ColorPill` wraps) and **`ColorField`** (the same picker laid FLAT and always open — captioned header with live hex, hue rail, saturation/brightness field; plain values in/out, no bound kit wrapper yet). Reach for the field when the color IS the panel's subject and the popover would cover the very preview you are judging, or when two colors must be editable at once: stacking two `ColorField`s is how SceneSettingsPanel edits a gradient's stops with no selector between them. It costs ~85px per color against the pill's ~50px, so it is a deliberate trade, not the new default; `laserKnob.tsx` is the guide's console knob (`LaserKnob`, plain numbers in/out — the layer to bind when the value is NOT a `UserInterfaceParameter`: an ADSR field, a mover input; otherwise use the kit's bound `Knob`). Two options on it exist for grid panels: **`bipolar`** anchors the arc at 12 o'clock and grows it either way, which is mandatory for a signed rate (a half-lit ring for zero reads as half ON); and passing **`label=""`** drops the caption row entirely, for a panel that labels its rows and columns instead. The kit `Knob` also takes **`detents`** (uneven allowed stops driven in index units — Radial Motion's pattern, folded in). Respect `showIf` gating (already handled if you go through ParamControl). See `docs/instrument-panel-design-guide.md` for the visual language.

**Live shader previews**: `KaleidoSolidUserInterface.tsx` imports the instrument's exported GLSL (`KALEIDO_FIELD_GLSL`) and runs it in a small raw-WebGL canvas, rather than redrawing an impression of it in SVG — so the preview cannot drift from what renders. It evaluates the field over an orthographic sphere: the object-space direction at each pixel of a front-facing sphere is just `(x, y, sqrt(1-x²-y²))`. Three things this depends on:

- Match however the real path produces colour. Previewing a screen-space EFFECT means mirroring `ShaderWrapper`'s stages (byte FBO, then a linear→sRGB output pass) or it reads far darker than the viewport; previewing a lit MATERIAL means a stand-in lighting term, so treat it as a character preview, not an exact colour match.
- Call `WEBGL_lose_context.loseContext()` on unmount — panels mount and unmount on every track selection, and exhausting the browser's WebGL context budget takes out the main VIEWPORT, not the panel.
- **The canvas must be created inside the effect and appended to a host div, NOT rendered by React.** `loseContext()` permanently kills that canvas's context, and React StrictMode double-invokes effects in dev: the second mount lands on the same element, `getContext` hands back the dead context, and every compile fails with a null/empty info log — which surfaces only as the "preview unavailable" fallback. Owning the element per mount gives each run a genuinely fresh canvas.

**A drag pad that draws circles must be SQUARE in CSS, not just in its viewBox.**
`CameraOrbitUserInterface`'s two pads (top-down orbit ring, side elevation arc)
use a `0 0 100 100` viewBox; dropped into the inspector's full-width column with
`preserveAspectRatio="none"` the ring becomes a flat ellipse the rig visibly
slides around at the wrong speed, and the camera glyph shears. Constrain the pad
itself (`aspect-square w-full max-w-[…] mx-auto`) and cap its header to the same
width, or the right-aligned hint drifts away from the thing it labels. Two more
from that panel: an SVG arc between near-vertical endpoints has two valid halves,
so pick the sweep flag by asking which half the value actually travels through
(0° = level, the RIGHT half) rather than trying flags until one draws; and map a
pad radius to a range like distance's 0.5–60 on a CURVE, because a linear map
crushes every useful shot into the first few pixels of travel.

Driving `time` from rAF is fine in panel code: the pause invariant governs the rendered visual (where `time` is the beat); a panel canvas is chrome, like the animated disc in `KaleidoscopeEffectUserInterface`.

**A mover/splitter/colorizer panel's accent is NOT the panel's to choose.** It comes
from the definition's `identityColor` (`core/visualCopies/identityColors.ts`), which is
the same value its timeline blocks and piano-roll notes wear - so the console and the
notes you write in it are one colour by construction. Import the constant; never
re-declare the hex locally, which is exactly the drift the shared module exists to
prevent. (The nine panels that had hard-coded accents kept their exact colours - the
palette was built around them - they just import them now.)

**A panel whose subject is MOTION should use plain DOM transforms, not r3f.**
`ImpactPulseMoverUserInterface` animates its subject with `element.style.transform` off
one rAF loop rather than a `<Canvas>`, precisely because of the black-until-play note
above: a size punch is exactly the thing you need to watch while the transport is
parked. Reach for a canvas only when the preview genuinely needs shaders, lighting, or
real geometry.

`MoverUserInterface.tsx` extends that pattern to full 3D: its window is a FIELD of
nine seeds run through the definition's real `resolve()` on a looping demo phrase,
each rendered as a DOM square whose `transform` is the resulting `Matrix4` as a CSS
`matrix3d(...)`. What that conversion needs (in `toCssMatrix`): both are column-major,
so the elements pass straight through, but three's +Y is up and CSS's is down —
CONJUGATE by a Y-flip (`F · M · F`), which flips the axis while keeping rotations
rigid (a bare `scaleY(-1)` wrapper would mirror handedness instead) — then scale only
the translation column into pixels. `perspective` on the stage div gives the Z axis
its depth for free. A field, not a lone subject, because rotate and orbit are
indistinguishable on one centered object. Its demo phrase is per-mode, chosen to end
where it starts so the loop wrap is invisible — and the rotate/orbit CONSTANT cell
deliberately plays NO notes, because an empty lane spinning is that cell's actual
claim (same reasoning as Radial Motion's no-notes preview). The panel's two segmented
controls mirror the definition's two select params; per-mode knobs render only for
the active cell, and the shared per-axis X/Y/Z knobs re-bind between `distance*` and
`angle*` keys as the motion segment moves, with the row's unit said once in a caption
above it rather than on every knob.

**Sizing a signal window's axes is a design decision, not arithmetic.** Two mistakes
that each make a mathematically correct curve look like a broken panel, both found in
that same panel:

- *Vertical.* Scaling the axis to the param's theoretical maximum leaves ordinary
  settings in the bottom fifth — at the default HIT the curve was a 13%-tall bump on an
  empty field. Put the value through a saturating map (`v / (|v| + knee)`) instead:
  every setting is legible, extremes never clip, and the knob still moves the picture.
- *Horizontal.* An x-axis proportional to the param it plots is self-similar, so that
  param becomes invisible — every DECAY draws the identical shape. An absolute axis
  instead squeezes short values into the left fifth. Use a proportional span WITH a
  beat grid behind it: the shape fills the window and the grid says how long it lasted.

**TrackEditor filters `showIf`-gated params BEFORE the renderer sees them —
but ONLY on the instrument branch.** A bespoke instrument panel's `parameters`
array only contains params whose gate is currently satisfied - so a panel that
lists a gated param (Flash Wall's `panelWidth`, gated on `fitToScreen=0`) in
its "all keys present, else ParameterList" check silently renders the generic
fallback whenever the gate is off, which looks like the registration failed.
Treat gated params as optional bindings; only ungated keys belong in the
fallback check. The MOVER/SPLITTER branch passes gated params through
UNFILTERED (verified 2026-08-01 on the Grid panel), so a mover panel must gate
the control's display on the controlling param's value itself - and should
STILL treat the gated binding as optional, in case the branches are ever
unified.

`TunnelSplitterUserInterface.tsx` is Approach's corridor sibling: same real-resolve
preview from a camera parked at the splitter's assumed stage position, but drawn with
thin TILES rather than spheres, because its FACING control is a rotation and only a
flat face makes a rotation legible. Its SPEED row is the worked example for a
two-clock rate: a FREE/SYNC segmented control renders whichever knob the mode reads
(the other key stays in PLACED_KEYS so it can't leak into MORE as a stray slider),
and the SYNC knob is a stepped LaserKnob over `TUNNEL_SYNC_DETENTS` in index units —
Radial Motion's detent pattern, with the readout speaking beats-per-ring ("1/2b").

`CopyTargetsUserInterface.tsx` is the **Targets tab's COPIES console** (which of the
copies reaching a mover/splitter row it acts on — `core/visualCopies/copyTargets.ts`).
It is the reference for a panel where **the window IS the readout**: there is
deliberately no caption line and no n-of-m tally, because the picture says it better
than words can. Three things it settled:

- **It draws the REAL incoming formation**, from `getPriorChainPrefix(trackId, project)`
  (core/visual/resolve.ts — the same prefix `getPriorVisualCopyCount` measures, handed
  over whole). Targeted copies are lit in their slice's hue, skipped ones are hollow
  rings. That is what earns the window: emission order is raster order, so "every other
  copy" on an even-width grid is stripes, not a checkerboard — the picture shows it
  before the user would think to ask, and no wording could.
- **Build the prefix in a `useMemo` on the document, resolve it in the rAF loop.**
  Building walks the subtree; `resolveVisualCopies` on the built chain is microseconds.
  The live beat is read with `useTimeStore.getState()` inside the loop — subscribing
  would re-render the panel every frame of playback.
- **The window teaches the controls their range** (`onCount` up from the painted frame).
  It is the only thing that knows the real copy count, so a 4-copy ring never offers 12
  slices that could only ever be empty.

The tab itself is conditional (`targetChannels` in TrackEditor): a global mover or a
Crop gets the OBJECT routing, any mover/splitter row gets the copy console, and a plain
instrument keeps the two-tab rail rather than gaining a third tab with nothing in it. A
conditional tab needs the effect that bounces `tab` back to `instrument` when the
selected track loses it, or the panel renders a body with no tab lit.

**A panel whose subject is a LAYOUT can preview with a plain 2D canvas.**
`GridSplitterUserInterface` runs the splitter's real `resolve()` (no notes)
and draws the copies as painter-sorted cube faces on a `<canvas>` with its own
rAF - no r3f, because a panel `<Canvas>` stays black until the transport plays
(see above) and a layout is exactly what you dial in while paused. It re-reads
`clientWidth/Height` per frame instead of using a ResizeObserver (those starve
in a hidden pane), and drops to a point cloud past a few hundred copies.

**The shared splitter SIZE knob** (`core/visualCopies/splitterSize.ts`, worn by Radial,
Grid, Line, Symmetry, Polyhedron, Parametric Pattern and Tunnel) lands differently in each
console, and three things about wiring it are worth copying:

- **Bind it OPTIONALLY**, like a `showIf` param — `bindPanel`'s `num('size', { optional:
  true })`, or outside the required-keys check on a panel that predates the kit. A console
  that treats it as required falls back to the generic slider list wholesale the day a
  definition ships without it.
- **A preview that frames itself from the copies must include their SCALE in the reach**
  (`Math.hypot(e[0], e[1], e[2])` — the basis column length), or a large SIZE grows the
  formation out through the window's edges. Radial's preview always did; Grid's measured
  bare positions and needed the fix.
- **A schematic diagram is allowed to ignore it.** Symmetry's fold pad draws one glyph
  size on purpose — scaling the glyphs by SIZE would bury the mirror lines you drag at the
  top of the knob's range without saying anything the knob's own readout doesn't. Previews
  that render the real copies (Grid, Line, Radial, Tunnel) show it for free.

Placement follows the panel's own grammar: Grid pairs SPACING and SIZE in one group (the
two independent axes of a layout, read together), Line keeps three-knob rows and puts SIZE
with COPIES/SPACING while GROWTH drops to the modifier row, and Tunnel's geometry row
gained a fourth knob and therefore `flex-wrap` — four knobs plus its stepper column
overrun a narrow inspector pane, and a fixed-size knob row CLIPS rather than shrinking.

**A `ColorWheelPopover` anchor owes two decisions, and both are about what CLIPS
it.** Text Display's per-lane colour chip (`LaneColorSwatch`, 2026-08-21 — the eight
preset swatches are quick looks, the chip is any colour at all) is the worked example.
It opens `edge="bottom"` because the thing you judge a lane colour against is the live
name preview at the TOP of that card, and the default upward popover covers it. And it
sits FIRST in a wrapping swatch row rather than last, because the card renders in two
hosts and the tighter one — the piano roll's sidecar, `w-[236px] overflow-y-auto`, and
**a box that scrolls on one axis scrolls on both** — leaves a trailing chip with no
predictable x to open from: hugging either edge puts the ~158px popover outside one host
or the other. Pinned to the row's start with `align="left"` it always opens inward.
Dismissal (outside pointerdown / Escape) is the shared `useColorPopoverDismiss` hook in
`colorWheel.tsx` — `ColorWheelPill` uses it too, so a second anchor cannot drift.

**SVG can only say INTERSECTION by nesting clipPaths, and that is enough to preview a
set operation honestly.** `OverlapShapeUserInterface`'s counted preview paints one group
per subset of its shapes — a chain of `<g clip-path>` per member with the painting path
innermost — walked in ASCENDING depth, so the deeper region simply covers the shallower
one containing it and each ends up wearing its own depth's colour. It is the same
"deepest wins" the instrument's stencil fills get from running deepest-first, which is
the point: the panel demonstrates the rule rather than illustrating it. That panel also
shows **a preview may be two previews** — the instrument has two rules (a parity flip, a
per-depth count) and one picture cannot make both claims, so the parity mode keeps its
two-shape `evenodd` glide and the counted mode gets a rosette of `orders + 1` copies
breathing through each other with every depth on screen at once.

**Give a stage zone a FIXED width, never a percentage.** The settings panel is
user-resizable; a `w-[38%]` stage that looked right in a 300px sidebar became a wide
empty field with a 34px object marooned in the middle of it the moment the panel was
dragged out to 700px.
