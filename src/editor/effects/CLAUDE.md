# src/editor/effects — per-object effect plugins

Plugins applied to an object's rendered output, chained per track (`track.effects: EffectInstance[]`). Two categories: **transform** (mutates the wrapping Group per frame) and **shader** (screen-space GLSL post pass over the object). Clone effects were replaced by VisualCopy splitters (`core/visualCopies/`).

- `types.ts` — `VisualEffect` def: `params` (same `ParamDef` shape as instruments, enums/booleans encoded numerically), `applyTransform(group, settings, time)` where `time` IS the beat (music-synced, pure), or `fragmentShader` (samples `tDiffuse`, gets `time`/`resolution` + one uniform per param).
- `index.ts` — the registry (`EFFECTS`/`getEffect`/`PLUGIN_LIST`). Adding an effect = one file + one entry here (+ optional bespoke UI in `userInterfaceRenderers/bespokeRegistries.ts`).
- `automation.ts` — effect-setting automation targets, encoded `fx:<instanceId>:<key>` in a child automation track's `targetParam` (plus the `enabled` pseudo-param as a 0/1 lane); `parseFxTarget` decodes. Sampled per frame into `ObjectState.effectOverrides`, merged over stored settings by the wrappers.
- Rendering: `components/visual/TransformWrapper.tsx` / `ShaderWrapper.tsx`, inside `ObjectRenderer`.

## Gotchas

- The base transform effects (offset/rotate/scale) are `deprecated: true` — hidden from the add menu in favor of the canonical `tf*` track transform (`core/transform.ts`); existing instances keep rendering. Don't build new features on them.
- Scale is the deliberate chain-ordering exception: renderers lift it OUTSIDE VisualCopy movers (`core/visual/postMoverScale.ts`) so mover layout distances stay size-independent.
- `applyTransform` must stay a pure function of `(settings, beat)` — same pause invariant as instruments.
- **A shader's GLSL lives in a TS template literal — a stray backtick in a GLSL comment silently ends the string** and Turbopack reports it as "Parsing ecmascript source code failed" pointing at the comment, not as a shader problem. Escape them (`\``) or avoid them. Run `npx tsc --noEmit` after editing shader source; the build catches it instantly, the browser just shows a build overlay.
- **A screen-space shader pass is frame-relative, and objects are a small part of the frame.** Any spatial constant you pick has to be calibrated against a REAL instrument, not a test shape that fills the frame — otherwise the whole pattern lands inside its own innermost feature and reads as one soft blob. This is invisible in an offscreen harness and obvious in `/editor`. For a surface-locked pattern that travels with the mesh instead, see `instruments/KaleidoSolid.tsx` (object-space field injected into a lit material) — that is a different tool, not an effect.
- Anything animated must be a continuous function of `time` — a `fract()`-based position wraps and the shape visibly teleports. Drive drift with `sin()` around a stratified base instead.
