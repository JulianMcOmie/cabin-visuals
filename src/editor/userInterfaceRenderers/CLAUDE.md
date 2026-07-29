# src/editor/userInterfaceRenderers — registered settings UIs

The inspector panel (in `TrackEditor.tsx`) renders a track's settings through a REGISTERED renderer instead of hardcoding layouts. A renderer is a component `({ targetId, parameters })` where each `UserInterfaceParameter` arrives with `{ definition, value, setValue }` — the canonical update path is already bound; renderers never write stores directly.

Three registries:
- **Object instruments** (`index.ts`, keyed by `UserInterfaceRendererId` from `ids.ts`): every instrument def explicitly names one via `userInterfaceRenderer`. `'parameters'` is the generic auto-generated list (`ParametersUserInterface.tsx`); the rest are bespoke (Cube, TextDisplay, Video…).
- **Movers/splitters and effects** (`bespokeRegistries.ts`, keyed by definition/plugin id): registration is OPTIONAL — a missing entry falls back to the generic ParamControl list in TrackEditor.
- Envelope tracks use `EnvelopeUserInterface.tsx` directly.

Adding a bespoke instrument UI: add the id to `ids.ts` (union type), create `<Name>UserInterface.tsx`, register in `index.ts`, point the instrument def at it. For movers/effects: just add to the right map in `bespokeRegistries.ts`.

Building blocks — use these, don't hand-roll controls: `ParameterControl.tsx` exports `ParamControl` (dispatches on param type), `ParamSlider` (drag + curve + fine-step behavior), `ParamToggle`; `colorWheel.tsx` is the shared color picker (also used by SceneSettingsPanel). Respect `showIf` gating (already handled if you go through ParamControl). See `docs/instrument-panel-design-guide.md` for the visual language.
