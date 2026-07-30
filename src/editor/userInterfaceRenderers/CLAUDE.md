# src/editor/userInterfaceRenderers — registered settings UIs

The inspector panel (in `TrackEditor.tsx`) renders a track's settings through a REGISTERED renderer instead of hardcoding layouts. A renderer is a component `({ targetId, parameters })` where each `UserInterfaceParameter` arrives with `{ definition, value, setValue }` — the canonical update path is already bound; renderers never write stores directly.

Three registries:
- **Object instruments** (`index.ts`, keyed by `UserInterfaceRendererId` from `ids.ts`): every instrument def explicitly names one via `userInterfaceRenderer`. `'parameters'` is the generic auto-generated list (`ParametersUserInterface.tsx`); the rest are bespoke (Cube, TextDisplay, Video…).
- **Movers/splitters and effects** (`bespokeRegistries.ts`, keyed by definition/plugin id): registration is OPTIONAL — a missing entry falls back to the generic ParamControl list in TrackEditor.
- Envelope tracks use `EnvelopeUserInterface.tsx` directly; automation tracks use `AutomationUserInterface.tsx` directly (both are plain presentational components TrackEditor binds, not registry entries).

Adding a bespoke instrument UI: add the id to `ids.ts` (union type), create `<Name>UserInterface.tsx`, register in `index.ts`, point the instrument def at it. For movers/effects: just add to the right map in `bespokeRegistries.ts`.

`AutomationUserInterface.tsx` is the second panel built to the guide (after Laser Sphere): a live window onto the lane — the easing curve, the real seeded wobble, or a grabbable ADSR — over a segmented MODE control and a knob row. Its window is drawn with the engine's own samplers (`easeFraction`, `sampleNoiseLane`) so the picture can't drift from playback, and its emission comes from three stacked strokes of the same path rather than a blur filter (a stretched viewBox smears blurs anisotropically).

Building blocks — use these, don't hand-roll controls: `ParameterControl.tsx` exports `ParamControl` (dispatches on param type), `ParamSlider` (drag + curve + fine-step behavior), `ParamToggle`; `colorWheel.tsx` is the shared color picker (also used by SceneSettingsPanel); `laserKnob.tsx` is the guide's console knob (`LaserKnob`, plain numbers in/out) — every panel that follows the guide turns the SAME knob, so don't re-derive the arc math. Respect `showIf` gating (already handled if you go through ParamControl). See `docs/instrument-panel-design-guide.md` for the visual language.
