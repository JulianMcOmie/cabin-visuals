# GPU Stars

Stars now evaluates particle motion, size, tint and opacity in a WebGL vertex
shader. This uses Cabin's existing Three.js renderer; it adds no dependency or
WebGPU requirement. The note history, brake integration and background/ground
controls keep their existing CPU implementation. Other instruments are unchanged.

The count control now supports 100,000 stars (previously 3,000), while the default
layout remains 1,500 stars. Positions and parallax are generated from
the same deterministic seeds. Regular frames update a handful of uniforms instead
of running the old per-star JavaScript loop and uploading position, size, color
and alpha buffers. GPU arithmetic uses float32, so small numerical differences
from the old double-precision CPU calculations are expected.

To keep long projects accurate, accumulated displacement is split into a
deterministic 32-unit anchor and a small remainder. Crossing an anchor boundary
recomputes one position buffer from the immutable seeds; the shader applies the
remainder. The anchor depends only on the requested beat, not playback history.
Picking reconstructs positions only when raycasting, in a separate geometry
that never uploads to the renderer.

## Verification

Run from the repository root:

```sh
npm run test:visual
npx tsc --noEmit --incremental false
node --import tsx scripts/perf/stars-gpu.mjs
```

The standalone benchmark starts a temporary localhost server and uses Playwright
with installed Chrome (or bundled Chromium if Chrome is absent). It prints the
actual GPU renderer and browser. `SOFTWARE=1` explicitly uses SwiftShader for
correctness testing; software results are not hardware performance evidence.

The harness compares the production GLSL through WebGL2 transform feedback with
the frozen original CPU loop in `scripts/perf/fixtures/stars-cpu-reference.mjs`,
then compares rendered images with the same fragment shader and blending on both
sides. It covers motion combinations, tint endpoints, streaks, long displacement
and seeks across rebase boundaries.

For the editor smoke test, start a separate dev server:

```sh
NEXT_DIST_DIR=.next-isolated-stars npm run dev -- --port 3104 --hostname 127.0.0.1
BASE=http://127.0.0.1:3104 node scripts/perf/stars-gpu-app.mjs
```

This creates a test project in an isolated browser context, blocks remote project
storage, and checks actual rendering, repeatable backward seeks, particle buffer
updates, picking, opacity, dense counts, ground/background controls, shifted
copies and a short video export. It writes local evidence under
`artifacts/stars-gpu/`.

## Performance scope

On Apple M1 Max / Chrome 152.0.7977.82 (ANGLE Metal, hardware rendering), the
recorded A/B run measured these mean CPU particle-update times:

| Stars | Previous CPU path | GPU path, CPU work remaining |
| --- | ---: | ---: |
| 3,000 | 0.443 ms | 0.00223 ms |
| 100,000 | 14.66 ms | 0.079 ms |

The 100,000-star run includes one 6.26 ms coordinate rebase over 80 frames: about
186× less CPU update time on that workload. Forcing large alternating rebases
every frame costs about 10.9 ms per update at 100,000 stars, so rapid long-distance
scrubbing has a different cost from ordinary playback. The run's raw output is
saved locally as `artifacts/stars-gpu/benchmark-hardware.json`.

GPU timer and completed-batch measurements disagreed in this browser: the
reported GPU draw interval exceeded the amortized fenced batch time. Retain
both raw measurements for diagnostics, but do not use their throughput ratio
as a claimed render/FPS speedup. The CPU update measurements above exclude
the work now performed by the GPU.

The A/B baseline is the previous Stars per-particle CPU algorithm at matching
counts. CPU update time, submission time and GPU draw time describe different
work and must not be called whole-app FPS. Geometry rebuilds, coordinate rebases,
pointer picking, note-history evaluation and other instruments still cost CPU
time. Larger dots, streaks, overlapping copies, resolution and post-processing
can make drawing fill-rate bound even when particle updates are inexpensive.

This is the first instrument port, not evidence of a 100× speedup for the whole
editor. Use the reported GPU/browser and workload when comparing results.
