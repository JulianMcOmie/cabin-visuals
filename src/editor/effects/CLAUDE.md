# src/editor/effects — per-object effect plugins

Plugins applied to an object's rendered output, chained per track (`track.effects: EffectInstance[]`). Three categories: **material** (re-materials the object's meshes per frame — Texturizer), **transform** (mutates the wrapping Group per frame) and **shader** (screen-space GLSL post pass over the object). Clone effects were replaced by VisualCopy splitters (`core/visualCopies/`).

- `types.ts` — `VisualEffect` def: `params` (same `ParamDef` shape as instruments, enums/booleans encoded numerically), `applyTransform(group, settings, time)` where `time` IS the beat (music-synced, pure), or `fragmentShader` (samples `tDiffuse`, gets `time`/`resolution` + one uniform per param).
- `index.ts` — the registry (`EFFECTS`/`getEffect`/`PLUGIN_LIST`). Adding an effect = one file + one entry here (+ optional bespoke UI in `userInterfaceRenderers/bespokeRegistries.ts`).
- `automation.ts` — effect-setting automation targets, encoded `fx:<instanceId>:<key>` in a child automation track's `targetParam` (plus the `enabled` pseudo-param as a 0/1 lane); `parseFxTarget` decodes. Sampled per frame into `ObjectState.effectOverrides`, merged over stored settings by the wrappers.
- Rendering: `components/visual/TransformWrapper.tsx` / `ShaderWrapper.tsx`, inside `ObjectRenderer`.

Material plugins (`materials/texturizer.ts` + pure half in `texturizerCore.ts`):
- `applyMaterial(root, settings, beat)` swaps each convertible mesh material for a cached MeshPhysicalMaterial (MeshToonMaterial for Toon) derived from the original; `restoreMaterial(root)` hands originals back — called every frame while disabled AND on unmount, so it must be idempotent/cheap once restored. Originals are never mutated.
- **Liveness contract**: instruments animate their materials two ways. Refs captured at mount hit the ORIGINAL — a dirty-check mirrors colour/opacity-base/map onto the swap when the original changes. `mesh.material` reads hit OURS — never blind-overwrite those channels. `emissiveIntensity` uses the floor rule: the finish's value is a floor, and a value we didn't write last frame (an instrument's note flash) is combined via max, so pulses survive every finish.
- Define-flipping props (sheen/transmission/maps) need `needsUpdate` when they cross zero — three won't recompile the program otherwise; the swap fingerprints this.
- Chrome/glass read from `scene.environment`; ShaderWrapper's offscreen rig inherits it from its mounting scene per frame so env reflections survive shader chaining.

Gotchas:
- The base transform effects (offset/rotate/scale) are `deprecated: true` — hidden from the add menu in favor of the canonical `tf*` track transform (`core/transform.ts`); existing instances keep rendering. Don't build new features on them.
- Scale is the deliberate chain-ordering exception: renderers lift it OUTSIDE VisualCopy movers (`core/visual/postMoverScale.ts`) so mover layout distances stay size-independent.
- `applyTransform` must stay a pure function of `(settings, beat)` — same pause invariant as instruments.
