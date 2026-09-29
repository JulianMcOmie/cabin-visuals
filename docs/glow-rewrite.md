# Glow v2

Glow now separates visible source, extracted emission and core brightness. It
replaces the old jittered disk blur with three smooth Gaussian scales, using
anisotropic prefiltered targets for broad and stretched halos. All Glow-chain
buffers are linear half-float; the final scene grade tone-maps once. Existing
non-Glow shader chains retain their old buffer/output behavior.

Strength, Radius and Spread lead the console. Advanced settings provide
Highlights/Whole Object/Outline sources, threshold/softness, source-following
color with hue/saturation tint blend, core brightness/white-hot amount, stretch
and orientation. Neon, Soft Halo, Dreamy, Hot Filament and Anamorphic write
ordinary editable settings. Radius uses a fixed 1080px authored frame height.

Source capture draws the actual scene with original materials, sorting, depth
and alpha discard. Non-source draws contribute zero radiance while retaining
opacity attenuation. This handles opaque and translucent occluders, including
foreground objects that do not write depth. Per-draw blend hooks are restored.
A lone Glow keeps the original geometry in the scene; core adjustments add
only the visible radiance difference, preserving foreground transparency.
Other shader/crop chains keep array order and output a depth-bearing core plus
the halo difference. Only lone, identically configured Glows on the same track
collect copies before filtering; other chains remain independent.

Global bloom reads the core-only composition through the same scene filters
and director partitions. The full composition then receives global bloom and
one tone map. This preserves unrelated bloom and prevents reblooming local
halos, at the cost of an additional scene-composition evaluation when halos
are active. Source capture also scales with distinct compatible groups and
scene geometry. Strength zero with a neutral core runs no extraction or blur.

Schema v21 intentionally migrates the old aesthetic: amount/size become
strength/radius, matching automation targets and ranges migrate, and IDs,
enabled flags and unrelated tracks are preserved. Old size automation now
interpolates in the new radius range rather than the old squared-size space.

## Validation (2026-09-07)

- TypeScript and production build pass. Focused ESLint has no errors; two
  pre-existing unused-variable warnings remain in frozen persistence upgrades.
- All 1,604 normal tests pass, including new control, HDR-pool and migration tests.
- 27 Chromium GPU assertions pass: extraction, dark colored emitters, soft/hard
  thresholds, opaque-core preservation, single fades, HDR 8.0, zero residual
  emission, additive blending restoration, opaque/translucent occlusion,
  core boosting behind glass, copy grouping, deterministic frames and zero steady-frame target allocations.
- Matched GPU samples at two resolutions differed by 1.43% at a halo edge;
  authored radius/axes are invariant across preview, HD and UHD sizes.
- Real editor inspection covers Laser Line, Text Display, Particle (eight
  splitter copies), Cube and Wireframe, plus presets and advanced controls.
  Pixelate→Glow and Glow→Pixelate produce different outputs as required.
- Paused, scrub-return and playback-return images are pixel-identical. Two
  actual export-driver frames at 1920×1080 and the same beat are pixel-identical;
  unpin restores visible source output. No browser console errors.
- Five instrument groups (including eight particle copies) use five extraction
  passes and 30 Gaussian passes total per frame. Strength-zero uses neither.
  Software Chromium submission samples were roughly 2–6ms with Glow; these are
  not native-GPU throughput or hardware FPS measurements.

Run `node scripts/perf/glow-validation.mjs` for GPU checks. Start an isolated
dev server on port 3197, then run `node scripts/perf/glow-editor.mjs` for editor
checks. Captures and JSON results are in `artifacts/glow/` (local, uncommitted).
The export test exercises the real pinned frame driver; it does not encode a
complete MP4 or certify every device/codec/browser.

## Future fog

`GlowPass.emissionStage` receives source, extracted linear emission and scene
depth before filtering. Applying fog there preserves its attenuation even in
Whole Object mode, which normalizes source chroma. Core and halo remain
separate. Emission textures are scratch resources; persist by copying when
needed. Translucent/non-depth-writing emitters need an additional depth
representation for accurate spatial fog. No volumetric scattering, fog volume,
or illumination of nearby surfaces is implemented.

Screen-space shader chains remain screen-space: they do not reconstruct new
3D surfaces when a downstream shader warps pixels. Source visibility is resolved
before the ordered chain; the core carries the scene/source depth proxy.

Main integration stores each live track-preview atlas tile on its render target,
so rebinding after Glow capture restores its viewport and scissor. A GPU
regression check covers this restoration.
