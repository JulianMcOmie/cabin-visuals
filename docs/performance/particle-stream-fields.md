# Particle Stream fields

The original million-particle optimization covered the Particle instrument with
factored Grid/Radial/Line layouts. It did not accelerate Particle Stream. A
splitter previously mounted a complete stream renderer for every copy, repeating
path planning, local sampling, buffer uploads and draw calls.

Particle Stream now renders the Cartesian product of copy placements and local
particles in one draw call per track/pass. A local position/fade texture holds at
most 768 dots. A second texture holds one matrix and RGBA value per visible copy.
The vertex shader combines them without allocating or uploading a matrix for
every final particle. Movers, Polar Warp and colorizers retain their existing
engine evaluation and exact placement/color semantics.

The scene and its chain thumbnails share sampled local fields by the actual
geometry, timing and MIDI inputs. An eight-entry LRU bounds retained path tables;
notes are compared by their supported intersection events, so separately resolved
thumbnail states can share results. Frame buffers are borrowed and consumed
immediately. Seeks and evictions never determine choreography. Copy color mixing
also uses a bounded value cache shared across frames within an instanced track.

Direct 60 Hz presentation admits these fields when there are at most eight stream
tracks and 8,192 CPU-evaluated stream copies in the population. Up to sixteen
ordinary light occurrences may accompany them. Masks, private Stagger clocks,
non-Scale object effects, group effects and other instruments retain the existing
compatibility/worker paths. The existing compact Particle plans remain supported.
Dense timeline thumbnails refresh at 10 Hz during playback when their aggregate
particle population reaches one million; the complete fields remain visible, and
paused previews and export retain their existing behavior.

## Validation (2026-09-12, Apple M1 Max, Chrome)

- The GPU field matched the previous renderer pixel-for-pixel at five sampled
  beats, including a backward seek and repeated MIDI intersection beat.
- One-pixel GPU picking succeeded with no WebGL errors.
- About 1.05 million particles: one draw call, GPU median 3.02 ms / p95 6.06 ms.
- About 4.19 million particles: one draw call, GPU median 5.39 ms / p95 9.16 ms.
- Full editor fixture: two Particle Stream tracks, each with
  Mover → Radial with Radius automation → Mover → Polar Warp → Gradient → Radial
  → Cosine Palette, plus default lighting and timeline previews. Each track had
  1,024 copies × 768 dots, for 1,572,864 particles. At a 2043×561 render size,
  the warmed measurement recorded 59.96 rendered FPS, CPU median 2.6 ms / p95 5 ms.
- All 1,703 visual tests passed, including field sampling parity, cache invalidation,
  texture growth/shrink, fade packing and direct-presentation eligibility.

The editor numbers count renderer advances, not OS presentation events. The
fixture reproduces the observed chain structure, not the exact saved project.
Large sprites/overdraw, additional effects, private clocks, hardware and browser
power settings can change performance.

## Reproduce

Run `node scripts/perf/particle-stream-field.mjs`, open its printed local URL in
Chrome, and click **Run validation**. It bundles the production sampler/shader,
compares pixels and picking, then measures one and four million particles.
Results are written under `artifacts/particle-stream-field/` (git-ignored).

For editor integration, start a development server in an isolated checkout, copy
`scripts/perf/particle-stream-editor.html` to
`public/particle-stream-check.html`, and open that local path in Chrome. Wait for
the editor to load, click **Load representative chain**, allow lazy chunks to
settle, then click **Measure editor playback**. Confirm that the result includes
two `Shared Particle Stream` meshes and `directParticles: true`. Hot reload may
reset this in-memory fixture; load it again after code edits. Delete the temporary
public file before building or committing. The fixture never opens a saved cloud
project.
