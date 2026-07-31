# src/editor/userInterfaceRenderers — registered settings UIs

The inspector panel (in `TrackEditor.tsx`) renders a track's settings through a REGISTERED renderer instead of hardcoding layouts. A renderer is a component `({ targetId, parameters })` where each `UserInterfaceParameter` arrives with `{ definition, value, setValue }` — the canonical update path is already bound; renderers never write stores directly.

Three registries:
- **Object instruments** (`index.ts`, keyed by `UserInterfaceRendererId` from `ids.ts`): every instrument def explicitly names one via `userInterfaceRenderer`. `'parameters'` is the generic auto-generated list (`ParametersUserInterface.tsx`); the rest are bespoke (Cube, TextDisplay, Video…).
- **Movers/splitters and effects** (`bespokeRegistries.ts`, keyed by definition/plugin id): registration is OPTIONAL — a missing entry falls back to the generic ParamControl list in TrackEditor.
- Envelope tracks use `EnvelopeUserInterface.tsx` directly; automation tracks use `AutomationUserInterface.tsx` directly (both are plain presentational components TrackEditor binds, not registry entries).

Adding a bespoke instrument UI: add the id to `ids.ts` (union type), create `<Name>UserInterface.tsx`, register in `index.ts`, point the instrument def at it. For movers/effects: just add to the right map in `bespokeRegistries.ts`.

**A panel's live 3D preview may not animate until the transport PLAYS.** Observed 2026-07-29 on both Impact Scatter's and Conveyor's previews: the canvas is created and sized, but `useFrame` never fires while paused, so the window stays BLACK — hitting play starts it, pausing freezes the last frame. Likely because r3f's render loop is global and the main canvas runs `frameloop='demand'` (RenderGovernor), so once the loop stops nothing restarts it for a panel root that mounted later. It is app-wide, not a panel bug: **smoke-test previews with the transport running** before suspecting your own preview code.

`AutomationUserInterface.tsx` is the second panel built to the guide (after Laser Sphere): a live window onto the lane — the easing curve, the real seeded wobble, or a grabbable ADSR — over a segmented MODE control and a knob row. Its window is drawn with the engine's own samplers (`easeFraction`, `sampleNoiseLane`) so the picture can't drift from playback, and its emission comes from three stacked strokes of the same path rather than a blur filter (a stretched viewBox smears blurs anisotropically).

Building blocks — use these, don't hand-roll controls: `ParameterControl.tsx` exports `ParamControl` (dispatches on param type), `ParamSlider` (drag + curve + fine-step behavior), `ParamToggle`, `ParamStepper` (small integer counts as −/+ around a detent strip — segment/facet counts, where a smooth slider makes the exact value a hunt), `ParamHueSlider` (a radians hue param on a rainbow track); `colorWheel.tsx` is the shared color picker (also used by SceneSettingsPanel); `laserKnob.tsx` is the guide's console knob (`LaserKnob`, plain numbers in/out) — every panel that follows the guide turns the SAME knob, so don't re-derive the arc math. Respect `showIf` gating (already handled if you go through ParamControl). See `docs/instrument-panel-design-guide.md` for the visual language.

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
