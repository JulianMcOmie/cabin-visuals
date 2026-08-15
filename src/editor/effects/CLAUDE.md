# src/editor/effects — per-object effect plugins (+ the scene chain)

Plugins attached per track (`track.effects: EffectInstance[]`) — the mechanism for "apply this to any instrument". Five categories — four per-object, plus `scene` (below):

- **transform** — mutates the wrapping Group per frame.
- **shader** — screen-space GLSL post pass over the object's rendered output.
- **material** — GENERATES the target's surface. The only way to get a pattern that is bolted to the mesh and travels with it; a screen-space pass is frame-relative, so its pattern slides across a moving object. Two shapes: a `materialField` GLSL chunk injected into built-in materials (Kaleido Skin, applied by `components/visual/MaterialWrapper.tsx`, innermost in the chain), or an `applyMaterial`/`restoreMaterial` pair that re-materials the meshes per frame (Texturizer, applied by `TransformWrapper`'s SingleMaterial). A plugin declares exactly one shape.

- **deform** — moves the mesh's own VERTICES (`vertexField` GLSL rewriting `transformed`).
  A `transform` effect moves the wrapping Group rigidly; a deformer bends the surface.

Clone effects were replaced by VisualCopy splitters (`core/visualCopies/`).

## `scene` effects — the per-scene chain (2026-08-15)

Full-frame passes over a SCENE's finished render (`scene/*.ts`: Grade, Lens,
Blur, Grain, Crush, Glitch, Mirror). Not per-object at all: the chain is
**`Scene.effects`**, which is also the SCENE INSTRUMENT's effect channel —
⌘⇧S materializes the virtual scene track (`core/sceneTrack.ts`) whose
`effects` field IS this chain, so the two inspector surfaces (scene track
selected / nothing selected) edit one list. VisualScene's compositor runs it
in array order after the post-process instruments (ripple → impact → colour →
strobe) and before the Crop matte, building ONE shared ShaderMaterial per
plugin. What to know before adding one:

- **The contract is fragmentShader-only**: sample `tDiffuse`, see `time` (the
  BEAT), `resolution`, `aspect`, plus one float uniform per param — the runtime
  wires uniforms BY PARAM KEY, and `scene/sceneEffects.test.ts` pins the
  params⟷uniforms agreement in both directions plus the required `amount`.
- **`amount` 0 must be a bit-exact passthrough** — the runtime skips the pass
  entirely (`settings.amount <= 0`), so an idle device costs nothing. Two
  conventions inside the shaders: sub-knob devices (Grade, Lens, Crush) keep
  every sub-param NEUTRAL at default and let AMOUNT scale the lot (the
  note-punch lane); single-verb devices (Blur, Glitch) make AMOUNT the strength.
- **Randomness is seeded from the QUANTIZED beat** (`floor(time * rate)`), so a
  paused frame holds one grain/glitch pattern forever and export is
  frame-exact. No feedback/trail devices: they need the previous frame, which
  is state, which the one rule bans.
- **Automation is the ordinary `fx:<id>:<key>` lane on the scene instrument**:
  the resolver gathers its lanes through the same `resolveEffectAutomations`
  objects use (`ResolvedGraph.sceneFxAutomations`), `computeAtBeat` samples
  them per frame (`getSceneFxOverrides(sceneId)`), and the compositor merges
  via `effectiveEffectState` — so curve/noise/burst/cycle all work. Envelope
  lanes are NOT offered on it (no instrument def), matching the engine.
  TrackContextMenu deliberately excepts the scene track from the "no group fx
  lanes" rule.
- Scene-category devices appear ONLY in the scene chain's add menu
  (`SCENE_EFFECT_MENU_GROUPS` in TrackEditor) — both the scene-track arm and
  the no-selection arm — and never in an object chain's, where they would sit
  inert. Conversely the scene track's picker hides the object categories:
  its synthetic group is absent from `scene.tracks`, so ObjectRenderer's
  group-chain merge would never see them.
- The composite-level Bloom (VisualScene's `BloomEffect` + `bloomIntensity`) is
  NOT yet a chain device — it runs on the final composite, per frame not per
  scene, so promoting it is its own task.

## Writing a `deform` effect

`deform/` holds the one shipped device (Deformer: 12 operations × 4 drives × 4 falloffs
from three selects — the `mover` consolidation argument applied to deformers). Injection
is shared with `material` — **one `onBeforeCompile` per material, in MaterialWrapper** —
because two patchers wrapping the same material compile differently depending on which
mounted first. Five things bite:

- **A deformer is useless without tessellation.** `<boxGeometry args={[1.6,1.6,1.6]} />`
  — what the Cube draws — has EIGHT vertices, and a vertex shader can only move what it
  is given, so a twist shears the corners and leaves the faces flat: the object looks
  *skewed*, not twisted, and it reads as a broken shader rather than a missing mesh. The
  wrapper therefore swaps in a subdivided clone (`subdivideCore.ts`, level from the
  plugin's `subdivideParam`) and restores the original on disable/unmount, exactly as
  Texturizer does for materials. Stacked deformers share ONE tessellation at the highest
  level asked for; always restore before re-subdividing or the count compounds.
- **Unlit materials have no `#include <beginnormal_vertex>`.** MeshBasicMaterial and
  friends never declare `objectNormal`, so the normal-side `.replace` silently finds
  nothing — and then `transformed = fxPos` references a variable that was never declared
  and the WHOLE program fails to compile. Branch on
  `vertexShader.includes('#include <beginnormal_vertex>')`; unlit meshes get a
  position-only deform.
- **Normals must be re-derived or the object reads as flat with a warped silhouette.**
  `fxDeformNormal` deforms two tangent-offset samples and crosses the differences; the
  frame `(t1, t2, nrm)` is right-handed so the cross needs no sign fixing, and a
  degenerate result keeps the original normal rather than flipping the shading inside out.
- **Deformers STACK, so every uniform and helper is suffixed per instance**
  (`effects/uniforms.ts` — `uniformName(key, suffix)` / `instanceSuffix(id)`, shared by
  the GLSL generator and the wrapper so the two cannot drift; a mismatch compiles fine and
  simply never delivers a value). `uKBeat` is the exception: declared ONCE for the vertex
  stage, since GLSL rejects a redeclaration. The material's patch key is a SIGNATURE of
  the surface instance plus every deformer, so adding/removing/reordering recompiles.
- **An effect never sees MIDI notes** — it is handed `(settings, beat)`. So the Deformer's
  four DRIVE modes are closed-form clocks (static / pulse / ramp / oscillate), and
  note-shaped control is an automation lane on `strength` (`fx:<id>:strength`), which
  already has burst/cycle/noise modes. RAMP is deliberately unbounded (`beat * rate`), the
  same call Constant Rotate makes: a wrapping `fract()` would teleport the shape, which is
  the one thing this file tells you not to do. `deformOps.ts` holds the TS mirror of the
  drive and falloff maths that the panel plots and `deformOps.test.ts` pins — change one,
  change both.

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
