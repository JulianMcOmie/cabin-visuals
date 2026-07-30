# src/editor/effects — per-object effect plugins

Plugins attached per track (`track.effects: EffectInstance[]`) — the mechanism for "apply this to any instrument". Three categories:

- **transform** — mutates the wrapping Group per frame.
- **shader** — screen-space GLSL post pass over the object's rendered output.
- **material** — GENERATES the target's surface. The only way to get a pattern that is bolted to the mesh and travels with it; a screen-space pass is frame-relative, so its pattern slides across a moving object. Two shapes: a `materialField` GLSL chunk injected into built-in materials (Kaleido Skin, applied by `components/visual/MaterialWrapper.tsx`, innermost in the chain), or an `applyMaterial`/`restoreMaterial` pair that re-materials the meshes per frame (Texturizer, applied by `TransformWrapper`'s SingleMaterial). A plugin declares exactly one shape.

Clone effects were replaced by VisualCopy splitters (`core/visualCopies/`).

- `types.ts` — `VisualEffect` def: `params` (same `ParamDef` shape as instruments, enums/booleans encoded numerically), `applyTransform(group, settings, time)` where `time` IS the beat (music-synced, pure), or `fragmentShader` (samples `tDiffuse`, gets `time`/`resolution` + one uniform per param).
- `index.ts` — the registry (`EFFECTS`/`getEffect`/`PLUGIN_LIST`). Adding an effect = one file + one entry here (+ optional bespoke UI in `userInterfaceRenderers/bespokeRegistries.ts`). **A new CATEGORY also needs an entry in `components/TrackEditor.tsx`'s `EFFECT_CATEGORIES`** — the add menu groups by that list, so an effect in an unlisted category is registered but unreachable.
- `automation.ts` — effect-setting automation targets, encoded `fx:<instanceId>:<key>` in a child automation track's `targetParam` (plus the `enabled` pseudo-param as a 0/1 lane); `parseFxTarget` decodes. Sampled per frame into `ObjectState.effectOverrides`, merged over stored settings by the wrappers.
- Rendering: `components/visual/TransformWrapper.tsx` / `ShaderWrapper.tsx`, inside `ObjectRenderer`.

## Writing a `material` effect

The chunk must declare `uniform float uK<Param>` per param plus `uKBeat`, and define
`vec3 kaleidoField(vec3 objDir)` returning linear albedo for a direction in the mesh's
OWN space (see `materials/kaleidoField.ts`). What to know:

- **Object space is the point.** Inject at `#include <begin_vertex>`, the last place the
  vertex is still in the mesh's own space. That is what makes the pattern turn and travel
  with the object.
- **Albedo is a REFLECTANCE.** MaterialWrapper scales the field by 0.5 before assigning
  `diffuseColor`; a field peaking near 1.0 assigned raw saturates the lit side to a pale
  wash under this scene's lighting.
- **It only bites on three's built-in materials** — injection keys off `#include <common>`
  and `vec4 diffuseColor = ...`. Instruments drawing with their own raw ShaderMaterial
  (LaserSphere, FractalTunnel, Stars, Wormhole, DotField, ShapeFlight…) silently no-op.
  That limit is inherent to `onBeforeCompile`. For those, a screen-space `shader` effect is
  the only option.
- MaterialWrapper patches materials **in place and restores on unmount/disable** rather
  than cloning: instruments mutate their own material per frame (Cube sets `mat.color`),
  so a clone would go stale instantly.
- The LAST enabled material effect wins — two generated surfaces have no meaningful
  composition, so it replaces rather than accumulates (as a VisualCopy `tint` does).

## Gotchas


Material plugins (`materials/texturizer.ts` + pure half in `texturizerCore.ts`):
- `applyMaterial(root, settings, beat)` swaps each convertible mesh material for a cached MeshPhysicalMaterial (MeshToonMaterial for Toon) derived from the original; `restoreMaterial(root)` hands originals back — called every frame while disabled AND on unmount, so it must be idempotent/cheap once restored. Originals are never mutated.
- **Liveness contract**: instruments animate their materials two ways. Refs captured at mount hit the ORIGINAL — a dirty-check mirrors colour/opacity-base/map onto the swap when the original changes. `mesh.material` reads hit OURS — never blind-overwrite those channels. `emissiveIntensity` uses the floor rule: the finish's value is a floor, and a value we didn't write last frame (an instrument's note flash) is combined via max, so pulses survive every finish.
- Define-flipping props (sheen/transmission/maps) need `needsUpdate` when they cross zero — three won't recompile the program otherwise; the swap fingerprints this.
- Chrome/glass read from `scene.environment`; ShaderWrapper's offscreen rig inherits it from its mounting scene per frame so env reflections survive shader chaining.

Gotchas:
- The base transform effects (offset/rotate/scale) are `deprecated: true` — hidden from the add menu in favor of the canonical `tf*` track transform (`core/transform.ts`); existing instances keep rendering. Don't build new features on them.
- Scale is the deliberate chain-ordering exception: renderers lift it OUTSIDE VisualCopy movers (`core/visual/postMoverScale.ts`) so mover layout distances stay size-independent.
- `applyTransform` must stay a pure function of `(settings, beat)` — same pause invariant as instruments.
- **A shader's GLSL lives in a TS template literal — a stray backtick in a GLSL comment silently ends the string** and Turbopack reports it as "Parsing ecmascript source code failed" pointing at the comment, not as a shader problem. Escape them (`\``) or avoid them. Run `npx tsc --noEmit` after editing shader source; the build catches it instantly, the browser just shows a build overlay.
- **A screen-space shader pass is frame-relative, and objects are a small part of the frame.** Any spatial constant you pick has to be calibrated against a REAL instrument, not a test shape that fills the frame — otherwise the whole pattern lands inside its own innermost feature and reads as one soft blob. This is invisible in an offscreen harness and obvious in `/editor`. For a surface-locked pattern that travels with the mesh instead, see `instruments/KaleidoSolid.tsx` (object-space field injected into a lit material) — that is a different tool, not an effect.
- Anything animated must be a continuous function of `time` — a `fract()`-based position wraps and the shape visibly teleports. Drive drift with `sin()` around a stratified base instead.
