# src/editor/userInterfaceRenderers — registered settings UIs

The inspector panel (in `TrackEditor.tsx`) renders a track's settings through a REGISTERED renderer instead of hardcoding layouts. A renderer is a component `({ targetId, parameters })` where each `UserInterfaceParameter` arrives with `{ definition, value, setValue }` — the canonical update path is already bound; renderers never write stores directly.

Three registries:
- **Object instruments** (`index.ts`, keyed by `UserInterfaceRendererId` from `ids.ts`): every instrument def explicitly names one via `userInterfaceRenderer`. `'parameters'` is the generic auto-generated list (`ParametersUserInterface.tsx`); the rest are bespoke (Cube, TextDisplay, Video…).
- **Movers/splitters and effects** (`bespokeRegistries.ts`, keyed by definition/plugin id): registration is OPTIONAL — a missing entry falls back to the generic ParamControl list in TrackEditor.
- Envelope tracks use `EnvelopeUserInterface.tsx` directly.

Adding a bespoke instrument UI: add the id to `ids.ts` (union type), create `<Name>UserInterface.tsx`, register in `index.ts`, point the instrument def at it. For movers/effects: just add to the right map in `bespokeRegistries.ts`.

Building blocks — use these, don't hand-roll controls: `ParameterControl.tsx` exports `ParamControl` (dispatches on param type), `ParamSlider` (drag + curve + fine-step behavior), `ParamToggle`, `ParamStepper` (small integer counts as −/+ around a detent strip — segment/facet counts, where a smooth slider makes the exact value a hunt), `ParamHueSlider` (a radians hue param on a rainbow track); `colorWheel.tsx` is the shared color picker (also used by SceneSettingsPanel). Respect `showIf` gating (already handled if you go through ParamControl). See `docs/instrument-panel-design-guide.md` for the visual language.

**Live shader previews**: `KaleidoSolidUserInterface.tsx` imports the instrument's exported GLSL (`KALEIDO_FIELD_GLSL`) and runs it in a small raw-WebGL canvas, rather than redrawing an impression of it in SVG — so the preview cannot drift from what renders. It evaluates the field over an orthographic sphere: the object-space direction at each pixel of a front-facing sphere is just `(x, y, sqrt(1-x²-y²))`. Three things this depends on:

- Match however the real path produces colour. Previewing a screen-space EFFECT means mirroring `ShaderWrapper`'s stages (byte FBO, then a linear→sRGB output pass) or it reads far darker than the viewport; previewing a lit MATERIAL means a stand-in lighting term, so treat it as a character preview, not an exact colour match.
- Call `WEBGL_lose_context.loseContext()` on unmount — panels mount and unmount on every track selection, and exhausting the browser's WebGL context budget takes out the main VIEWPORT, not the panel.
- **The canvas must be created inside the effect and appended to a host div, NOT rendered by React.** `loseContext()` permanently kills that canvas's context, and React StrictMode double-invokes effects in dev: the second mount lands on the same element, `getContext` hands back the dead context, and every compile fails with a null/empty info log — which surfaces only as the "preview unavailable" fallback. Owning the element per mount gives each run a genuinely fresh canvas.

Driving `time` from rAF is fine in panel code: the pause invariant governs the rendered visual (where `time` is the beat); a panel canvas is chrome, like the animated disc in `KaleidoscopeEffectUserInterface`.
