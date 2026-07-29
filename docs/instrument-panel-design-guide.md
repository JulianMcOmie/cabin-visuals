# Instrument Panel Design Guide

The rules for bespoke instrument settings UIs (`src/editor/userInterfaceRenderers/`).
Laser Sphere (`LaserSphereUserInterface.tsx`) is the reference implementation; new
panels and reworks of existing ones follow this guide. The point of the guide is to
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

- **No in-panel titles, icons, or status dots.** The panel header already says
  "Laser Sphere"; repeating it inside the card is noise. (The panel-top header
  itself is slated for removal later — do not add anything that depends on it.)
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

**Knob** — every continuous param is a knob; one control vocabulary per panel.
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

(Bespoke panels don't use sliders; the generic `ParameterList` fallback keeps
them.)

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

- ~~Remove the panel-top track-name header~~ — done: the inspector starts at
  its tabs; the timeline row and scene tab carry identity. If a panel wants
  identity, bake it into the surface (the scene panel's etched "SCENE"
  wordmark, the audio panel's oscilloscope label) — never a heading row.
- A real layering solution to replace the deprecated IN FRONT toggle.
- Migrate the other bespoke renderers (Cube, Hopf, …) to these rules: strip
  card chrome, headers, reset buttons, gradient backdrops; adopt the accent
  and glow rules.
