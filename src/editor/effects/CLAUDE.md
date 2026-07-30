# src/editor/effects — per-object effect plugins

Plugins applied to an object's rendered output, chained per track (`track.effects: EffectInstance[]`). Two categories: **transform** (mutates the wrapping Group per frame) and **shader** (screen-space GLSL post pass over the object). Clone effects were replaced by VisualCopy splitters (`core/visualCopies/`).

- `types.ts` — `VisualEffect` def: `params` (same `ParamDef` shape as instruments, enums/booleans encoded numerically), `applyTransform(group, settings, time)` where `time` IS the beat (music-synced, pure), or `fragmentShader` (samples `tDiffuse`, gets `time`/`resolution` + one uniform per param).
- `index.ts` — the registry (`EFFECTS`/`getEffect`/`PLUGIN_LIST`). Adding an effect = one file + one entry here (+ optional bespoke UI in `userInterfaceRenderers/bespokeRegistries.ts`).
- `automation.ts` — effect-setting automation targets, encoded `fx:<instanceId>:<key>` in a child automation track's `targetParam` (plus the `enabled` pseudo-param as a 0/1 lane); `parseFxTarget` decodes. Sampled per frame into `ObjectState.effectOverrides`, merged over stored settings by the wrappers.
- Rendering: `components/visual/TransformWrapper.tsx` / `ShaderWrapper.tsx`, inside `ObjectRenderer`.

## Two kinds of shader effect

Worth knowing before you write one, because they have different rules:

- **Filters** re-sample `tDiffuse` and transform what is already there (`kaleidoscope` folds it into wedges, `boil` displaces it, `pixelate`, `chromaticAberration`). They inherit the object's alpha for free.
- **Generators** synthesize new color and paint it INSIDE the object, using `tDiffuse` only as a mask + shading source (`kaleidoSkin`). This is how you get a "texture on any mesh" without touching materials or UVs — it works on every instrument because it knows nothing about them.

Writing a generator, the three things that will bite you:
1. **Return `vec4(0.0)` where `src.a` is ~0 and return early.** The output quad is FULL-FRAME (see `ShaderWrapper`), so any non-transparent color outside the silhouette tints the entire scene, not just the object.
2. **Unpremultiply before reading brightness**: `dot(src.rgb, W) / max(src.a, 0.004)`. Edge pixels carry alpha-scaled rgb, and measuring them raw rings the object in a dark fringe.
3. **The FBO chain is LINEAR** — `ShaderWrapper`'s output pass applies sRGB encoding. Colors you author in the shader are linear, so they look darker/duller than the constants suggest until that final pass runs.

## Gotchas

- The base transform effects (offset/rotate/scale) are `deprecated: true` — hidden from the add menu in favor of the canonical `tf*` track transform (`core/transform.ts`); existing instances keep rendering. Don't build new features on them.
- Scale is the deliberate chain-ordering exception: renderers lift it OUTSIDE VisualCopy movers (`core/visual/postMoverScale.ts`) so mover layout distances stay size-independent.
- `applyTransform` must stay a pure function of `(settings, beat)` — same pause invariant as instruments.
- **A shader's GLSL lives in a TS template literal — a stray backtick in a GLSL comment silently ends the string** and Turbopack reports it as "Parsing ecmascript source code failed" pointing at the comment, not as a shader problem. Escape them (`\``) or avoid them. Run `npx tsc --noEmit` after editing shader source; the build catches it instantly, the browser just shows a build overlay.
- A procedural field placed at ABSOLUTE coordinates runs out at the edges as soon as a zoom param widens the view — the mesh rim goes bare. Tile it instead. `kaleidoSkin` uses a POLAR lattice and tests only the pixel's own cell ± 1 neighbours, a fixed 9 shape tests at any zoom. Two things that matters for:
  - **Cells per ring must grow with radius.** A fixed number of shards per ring spreads over an arc that grows with r, so density decays as 1/r and the outer rings read as confetti on bare tint. Size cells so their arc length is ~one radial pitch and they stay roughly square.
  - Per-shard edge softness is `k * zoom` (a field distance covers `zoom` times less screen). Keep `k` SMALL — objects are a fraction of the frame, so shards are only tens of pixels wide, and a wide edge blends neighbouring complementary shards into pastel mush.
- **Calibrate frame-relative effects against a REAL object, not a frame-filling test shape.** The fold is computed on full-frame UV, but a default instrument occupies maybe a fifth of the frame, so a constant tuned on a shape that fills the frame puts every real object inside the innermost cell and shows one soft blob. This is invisible in an offscreen harness and obvious in `/editor`.
- Anything animated must be a continuous function of `time` — a `fract()`-based position wraps and the shape visibly teleports. Drive drift with `sin()` around a stratified base instead.
