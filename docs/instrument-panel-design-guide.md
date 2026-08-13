# Instrument Panel Design Guide

The rules for bespoke instrument settings UIs (`src/editor/userInterfaceRenderers/`).
Laser Sphere (`LaserSphereUserInterface.tsx`) is the reference implementation; new
panels and reworks of existing ones follow this guide. **The guide's decisions are
implemented once in the console kit (`userInterfaceRenderers/console/`)** — chassis,
accent formulas, bound knob, segmented control, preview frame, disclosure — and a
pure-composition panel can be declared as a spec (`console/spec.tsx`, Laser Line's
`panelSpec` is the 10-line reference). Build from the kit; don't re-derive the arc
math, the shade math, or the binder. The plain-number knob stays in `laserKnob.tsx`
for values that aren't params.
`AutomationUserInterface.tsx` is the second panel built to these rules, and the
worked example for a panel whose subject is a SIGNAL rather than an object. The point of the guide is to
replace "vibe-coded" styling — chrome that appears because a generator liked it,
not because anyone decided it — with a small set of decisions we actually made.

## North star

**An instrument's UI is just another panel.** It lives flush in the space the
settings panel gives it, fills that space, and fits it — no internal scrolling at
design height, no card-within-a-card. The panel already owns identity and chrome;
the instrument UI owns only its controls.

**Full-bleed:** the instrument runs edge to edge — side to side with no margins.
Until the settings container drops its own `p-3`, renderers cancel it with
`-mx-3 -mt-3` and own their internal padding. The preview touches the panel
edges; only the controls row gets horizontal padding.

Design height budget: preview + controls should stay under ~240px so the whole
instrument fits above the tags section in a typical window.

## Remove, don't decorate (the deprecations)

- **No in-panel titles, icons, or status dots.** The panel already says which
  track this is; repeating it inside the renderer is noise. Identity lives on
  the TAB RAIL (`TrackEditor.tsx`): the track/scene name takes the left of the
  tab row, the tabs shrink to the right, and the subject's own color tints the
  ACTIVE tab instead of the neutral elevated fill. That color is
  `resolveTrackIdentityColor` — the INSTRUMENT's declared color, achromatic
  included — not the timeline's `resolveTrackDisplayColor`, whose achromatic
  guard would send a white instrument to its hue-cycle color; the cycle is
  seeded from the audio sapphire, so that came out blue and read as the app
  accent rather than as the instrument. Scenes have no color of their own and
  use `var(--accent)`. It costs no vertical space, which
  is why the old standalone name header above the tabs stayed dead. The rail is
  a `@container`: under 300px the tabs fall back to short labels so the name
  keeps room. Renderers still start flush under the rail and own nothing above it.
- **No reset-all buttons.** Per-control double-click reset covers it.
- **No IN FRONT toggle.** Deprecated from the panel until a better layering
  solution exists. `track.onTop` / `defaultOnTop` still drive the engine —
  presentation was removed, not the data.
- **No x/y/z position params on instruments.** Placement belongs to parent
  tracks and movers; an instrument's params describe *what it is*, not *where
  it sits*.
- **No spacer margins around the renderer.** The renderer starts flush under
  the panel tabs and ends where its content ends.

## Surfaces: flat, with earned depth

- Flat fills, hairline borders (`white/[0.06]`–`white/15`), small radii
  (`rounded-md` and below; full-bleed edges get no radius at all).
- **No multi-stop or radial gradient backdrops, no large drop shadows**
  (`0 18px 42px …` was the anti-pattern). The UI sits *on* the panel, not in
  a floating card. (Floating overlays like the color wheel popover are the
  exception — they earn a shadow because they actually float.)
- **The section background is a hue-true dark shade, never an alpha tint:**
  low-alpha accent over the panel's mid-gray desaturates into mud (tried and
  reverted). Compute a shade instead — keep the accent's hue, cap saturation
  ~0.5, value ≈ 0.075. One earned gradient on top: the preview's light
  spilling through the seam onto the controls
  (`radial-gradient(58% 30px at 50% 0, <accent>@14%, transparent)`) — the
  room is lit by the instrument, not painted.
- Depth is reserved for meaning: the live preview is a window (bottom
  hairline + near-black `#05070c`), and glow carries the glow param (below).
  Nothing else casts.

## The accent is the instrument's color

One accent per instrument, taken live from its own `color` param — never a
hard-coded theme hue. It drives:

- knob arcs and knob glow,
- slider fills,
- the color pill itself (which is also the *input* for the accent),
- any preview lighting/backdrop tint.

Text stays neutral (`white/40` labels, `white/70` mono values) so the accent
reads as light, not as ink.

### The color pill and its wheel

The canonical color control: a round swatch filled with the value, hairline
border, wearing the same halo as the knobs, with label + hex readout beneath.
Clicking it opens a **continuous HSV wheel popover** — never the native
browser picker with its discrete swatches:

- Wheel: hue around the ring (CSS conic-gradient), saturation toward the
  white center (radial overlay); drag anywhere, marker shows the current spot
  and remembers hue even at zero saturation.
- Brightness bar beneath (black → full-value color), draggable.
- Opens *upward* over the preview (`bottom-full`) so it never extends the
  panel into scrolling; closes on outside click or Escape.

Reuse this pattern anywhere an instrument exposes a color.

## Glow is the instrument speaking, not the cursor

Lean into each instrument's character — the panel should look like what it
controls. For Laser Sphere that means white-hot centers and one emitter:

- **The COLOR pill is the emitter.** It alone wears the GLOW-driven halo
  (reach ≈ `5 + glow*1.8`px, alpha ≈ `0.18 + glow/12*0.55` for the 1.5–12
  range) — turn GLOW up and the pill blazes; the rest of the panel stays
  calm. The pill's face stays a **flat fill** of the color — a gradient face
  read as cheap, not laser (tried and reverted); the halo carries the light.
- **A knob's value arc IS its laser — no uniform halos on knobs.** A colored
  box-shadow around the whole knob reads as a drop shadow, not light (tried
  and reverted). Emission is sold by *exponential falloff*, three stacked
  copies of the same arc so light exists only along the lit portion:
  1. wide soft bloom — pure accent, `blur(6px)`, `scale(1.16)`, 90% opacity
     (generous reach here is what completes the emission read);
  2. tight hot bloom — accent 35% toward white, `blur(1.5px)`;
  3. the core — accent ~80% toward white (nearly burning out).
  A white-hot 4px dot burns at the arc's tip
  (`box-shadow: 0 0 5px 1.5px <accent>`) — the beam's terminus.
- **Interaction does not add glow.** No flare while turning — the hand
  changes the parameter, the parameter changes the light.
- `transition-shadow` ~150ms keeps halo changes smooth as params move.

## Control specs

**Knob** (`laserKnob.tsx` — shared) — every continuous param is a knob; one
control vocabulary per panel.
- 44px, in one row (color pill pushed to the far right with `ml-auto`); the
  instrument's primary param (SIZE here) reads one step larger at 52px.
  Short 1-word labels (SIZE, GLOW, CORE, LIGHT) + mono value
  (integer-stepped params show no decimals).
- Flat face `#14171f`, hairline inner border, 270° accent arc starting at
  7 o'clock, white needle, shared glow halo (above).
- Vertical drag, full range ≈ 140px of travel; pointer capture; double-click
  resets to default; arrow keys nudge ~3% of travel; `role="slider"` with
  aria value attributes; visible focus ring.
- Honors the param's response `curve` exactly like `ParamSlider`: position maps
  through the curve, and curved params round to 3 significant digits instead of
  the step grid (the low end is why the curve exists).
- **A SIGNED param whose zero is the middle of its travel takes `bipolar`**: the
  arc grows out of 12 o'clock toward the value instead of filling from 7
  o'clock. A rate that can run either way is half-lit at zero otherwise, which
  reads as half ON — a lie, and the worse one when the param's default is 0
  (Radial Motion's SPIN X/Y rows).
- `label=""` drops the caption row entirely. For a panel that labels its rows
  and columns, a caption per knob is noise that also costs a line of height on
  every one of them.

(Bespoke panels don't use sliders; the generic `ParameterList` fallback keeps
them.)

**Grid console** — when a panel's params are a MATRIX rather than a list (the
same question asked once per depth/stage/axis), rows are the question, columns
are the subject, and the labels move out to a left rail and column headers.
`RadialMotionMoverUserInterface.tsx` is the reference: RADIUS / SPIN Z / SPIN X /
SPIN Y × outer / middle / inner, with each column headed by its name and a small
−/+ count stepper.
- The rail label sits in an `h-11` flex box so it centres on the KNOB, not on
  the knob-plus-readout column.
- **A grid busts the height budget, and that is the decision to weigh.** Four
  rows of three plus a preview lands near 450px against a pane that opens around
  300px, so half the console starts below the fold. Prefer two visible rows and
  a disclosure for the rest; only build the full grid when everything really is
  meant to be visible at once.

**Segmented control** — for a param whose values are KINDS, not amounts, and
above all for a panel's biggest decision. A native `<select>` hides the options
until clicked and makes the most important choice look like the least important
one; segments show the whole choice at once. Recessed track (`bg-black/30`,
hairline border, 2px padding), one lit segment wearing the accent as light
(`accent@22%` fill, label pushed ~60% toward white), inactive segments neutral
`white/40`. No second border on the active segment — depth stays reserved for the
window. When the values have shapes (easing curves), the segment IS the shape:
draw each option as a mini plot and label the active one beneath, so the choice is
made by looking rather than by reading option names.

**Signal window** — the live-preview slot for a panel whose subject is a signal
rather than an object (an automation lane, an envelope). Same frame as the 3D
preview: full-bleed, fixed height (~120px), square-shouldered, near-black
`#05070c`, bottom hairline only. Rules:
- **Plot it with the engine's own sampler.** Import the function playback uses
  (`easeFraction`, `sampleNoiseLane`) instead of drawing an impression of it, so
  the picture cannot drift from what plays.
- **Light lives along the path**: three stacked strokes of the SAME geometry —
  wide/dim, medium, thin/white-hot — not a blur filter. A `viewBox` stretched
  with `preserveAspectRatio="none"` smears CSS blurs anisotropically; stacked
  strokes with `vectorEffect="non-scaling-stroke"` stay clean at any panel width.
- The window may also be the EDITOR when the shape is the thing being authored
  (burst mode's grabbable ADSR handles). That is the one sanctioned exception to
  one-vocabulary-per-panel: the knobs below still give the same values numeric,
  fine control.

**Live preview**
- Render the instrument's *real* look: its actual shaders/materials and the
  app's real post pipeline (for lasers: the exact `LaserPreviewBloom` settings —
  intensity 0.9, threshold 1.15, smoothing 0.08, mipmapBlur, radius 0.72,
  levels 7).
- Opaque in-scene background (`#05070c`), never bloom over a transparent
  canvas (alpha seams).
- Orbitable with damping; pan/zoom disabled; polar angle clamped so the floor
  stays a floor.
- Map params into preview-safe ranges (clamp scale, dim scene lights ~0.4×)
  so the tiny viewport always reads.
- Full-bleed width, fixed height (~148px), square corners, bottom hairline
  border only.

## Fallback

A bespoke renderer binds specific param keys. If any expected key is missing,
render `ParameterList` for everything rather than a half-empty custom layout.

## Open items

- ~~Remove the panel-top track-name header~~ — done, and then answered
  properly: the standalone header stayed dead, but identity came back ON the
  tab rail (name left, tabs right, the track's color lighting the active tab).
  A panel that wants *more* identity than that still bakes it into its own
  surface (the scene panel's etched "SCENE" wordmark, the audio panel's
  oscilloscope label) — never a heading row above the tabs.
- A real layering solution to replace the deprecated IN FRONT toggle.
- ~~Migrate the other bespoke renderers to these rules~~ — done 2026-08-02
  on the console kit: Hopf, DotField, Pixel Blast, Particle Burst,
  Icosahedron Burst, Symmetric Motion, Gradient and Symmetry lost their card
  chrome, headers and reset buttons and now compose the kit. Character
  controls earned their keep (Pixel Blast's cell meters, the gradient-track
  sliders). Cube (3D Shape) and Radial were independently REDESIGNED to the
  guide in the same window — 3D Shape is the worked example for a shape
  vocabulary grid + independent surface-toggle chips — and were then
  re-ported onto the kit too. The remaining theme-var panels (Stars, Neon
  Polar, Oscilloscope, Fractal Tunnel, TextDisplay, the effect panels…) are
  still pre-guide.
- `EnvelopeUserInterface.tsx`'s ADSR pad and `AutomationUserInterface.tsx`'s
  burst window are the same geometry in two skins (theme vars vs. the lane's
  accent). When the envelope panel is migrated, they should become one pad.
