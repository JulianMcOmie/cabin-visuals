# src/editor/userInterfaceRenderers — registered settings UIs

The inspector panel (in `TrackEditor.tsx`) renders a track's settings through a REGISTERED renderer instead of hardcoding layouts. A renderer is a component `({ targetId, parameters })` where each `UserInterfaceParameter` arrives with `{ definition, value, setValue }` — the canonical update path is already bound; renderers never write stores directly.

Three registries:
- **Object instruments** (`index.ts`, keyed by `UserInterfaceRendererId` from `ids.ts`): every instrument def explicitly names one via `userInterfaceRenderer`. `'parameters'` is the generic auto-generated list (`ParametersUserInterface.tsx`); the rest are bespoke (Cube, TextDisplay, Video…).
- **Movers/splitters and effects** (`bespokeRegistries.ts`, keyed by definition/plugin id): registration is OPTIONAL — a missing entry falls back to the generic ParamControl list in TrackEditor.
- Envelope tracks use `EnvelopeUserInterface.tsx` directly; automation tracks use `AutomationUserInterface.tsx` directly (both are plain presentational components TrackEditor binds, not registry entries).

Adding a bespoke instrument UI: add the id to `ids.ts` (union type), create `<Name>UserInterface.tsx`, register in `index.ts`, point the instrument def at it. For movers/effects: just add to the right map in `bespokeRegistries.ts`.

**A panel's live 3D preview may not animate until the transport PLAYS.** Observed 2026-07-29 on both Impact Scatter's and Conveyor's previews: the canvas is created and sized, but `useFrame` never fires while paused, so the window stays BLACK — hitting play starts it, pausing freezes the last frame. Likely because r3f's render loop is global and the main canvas runs `frameloop='demand'` (RenderGovernor), so once the loop stops nothing restarts it for a panel root that mounted later. It is app-wide, not a panel bug: **smoke-test previews with the transport running** before suspecting your own preview code.

`AutomationUserInterface.tsx` is the second panel built to the guide (after Laser Sphere): a live window onto the lane — the easing curve, the real seeded wobble, or a grabbable ADSR — over a segmented MODE control and a knob row. Its window is drawn with the engine's own samplers (`easeFraction`, `sampleNoiseLane`) so the picture can't drift from playback, and its emission comes from three stacked strokes of the same path rather than a blur filter (a stretched viewBox smears blurs anisotropically).

`RadialMotionMoverUserInterface.tsx` is the worked example for a panel whose params are a MATRIX rather than a list: the same four questions (radius, spin Z, spin X, spin Y) asked once per nesting depth, so rows are the question, columns are the depth, and the knobs carry no captions of their own. Three things it settled:

- **A grid panel busts the ~240px height budget and that is a real cost, not a rounding error.** 4 rows × 3 knobs plus a preview lands near 450px, and the inspector pane opens around 300px — half the console starts below the fold. It scrolls and the pane drags, but reach for a disclosure first; only go to a grid when the caller has explicitly asked for everything visible at once.
- Its preview runs the mover's real `resolve()` with **NO NOTES**, which is the claim the mover makes (passive choreography, MIDI as accent). A preview that needs notes to move would be hiding the actual behaviour.
- The preview frames by **HEIGHT, not width** — the subject is a disc in a short wide window, and fitting the width pushes the top and bottom off-frame. (Conveyor frames by width for the opposite reason: its subject is a line.) Same per-frame re-derivation from `gl.domElement.client*` as Conveyor, for the same reason.
- **A stepped (detent) knob is a LaserKnob driven in INDEX units**, not a new control: its spin knobs walk `RADIAL_MOTION_SPIN_DETENTS` by binding `value`/`min`/`max`/`step` to `0…detents.length−1`/`1` and converting index⟷rate in the wrapper's `format`/`onChange` — evenly spaced clicks on the arc regardless of how non-uniform the underlying values are, and `bipolar` still works when the zero detent is the middle index. The keyboard nudge in laserKnob.tsx is `max(3%, one step)` for exactly this case; don't shrink it back.

Building blocks — use these, don't hand-roll controls: `ParameterControl.tsx` exports `ParamControl` (dispatches on param type), `ParamSlider` (drag + curve + fine-step behavior), `ParamToggle`, `ParamStepper` (small integer counts as −/+ around a detent strip — segment/facet counts, where a smooth slider makes the exact value a hunt), `ParamHueSlider` (a radians hue param on a rainbow track); `colorWheel.tsx` is the shared color picker (also used by SceneSettingsPanel); `laserKnob.tsx` is the guide's console knob (`LaserKnob`, plain numbers in/out) — every panel that follows the guide turns the SAME knob, so don't re-derive the arc math. Two options on it exist for grid panels: **`bipolar`** anchors the arc at 12 o'clock and grows it either way, which is mandatory for a signed rate (a half-lit ring for zero reads as half ON); and passing **`label=""`** drops the caption row entirely, for a panel that labels its rows and columns instead. Respect `showIf` gating (already handled if you go through ParamControl). See `docs/instrument-panel-design-guide.md` for the visual language.

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

**Give a stage zone a FIXED width, never a percentage.** The settings panel is
user-resizable; a `w-[38%]` stage that looked right in a 300px sidebar became a wide
empty field with a 34px object marooned in the middle of it the moment the panel was
dragged out to 700px.
