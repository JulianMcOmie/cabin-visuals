# Particle export throughput

The disabled-effect batching fix measured **40.3× faster rendering and hardware
encoding** for a 32,768-particle fixture at 1080p. This is a specific performance
cliff, not a universal export multiplier. The main opportunity for a 10–100×
improvement is avoiding work per particle. Export already steps through exact beats
without playback pacing, captures the WebGL canvas directly into `VideoFrame`,
and pipelines frames into WebCodecs with bounded backpressure. Reducing the
number of rendered frames or rendering at a lower resolution would change the
output; this change does neither.

## Implemented: parallel encoding for an already-batched project

A real project with two 32-copy Radials, 1,024 particles and Impact Warp was
already batched. It has no attached effects, so the disabled-effect fix below
does not accelerate it. CPU evaluation took approximately 0.073 ms/frame;
4K60 Maximum (H.264 QP21) encoding was the bottleneck.

The same saved eight-second range was measured through `runExport`, including
setup, rendering, capture, encoding, flush, poster capture and MP4 muxing. The
local comparison used the same in-app Chromium browser on the M1 Max; project
loading and copying the completed Blob to the local test server were excluded.
The project snapshot stayed local and was not edited or committed.

| Configuration | Complete export | Encoded frames |
| --- | ---: | ---: |
| Original serial exporter, final warmed comparison | 9.97 s | 480 |
| Two concurrent encoders | 5.61 s | 480 |
| Four concurrent encoders | 4.83 s | 480 |
| Final automatic policy, no concurrency override | 5.03 s | 480 |

The automatic result is approximately **2× faster at the same output
settings** (2.1× in the explicit four-encoder run against a 10.18-second warm
baseline). All 480 frames from the final automatic run are also pixel-identical
to the original. A cold first local export took 16.11 seconds and is excluded
from that ratio. Production Chrome's original export measured 9.81 seconds twice,
consistent with the warmed local baseline. Standard quality previously took
5.74 seconds, but changes rate control and is not the basis of this improvement.

All three Maximum outputs are 20,258,441 bytes long. Their MP4 container
hashes differ, but **all 480 fully decoded frames are pixel-identical**, including
every segment boundary. `ffprobe` and parsed H.264 sample data confirm uniform
60 fps timestamps/durations, an exact eight-second duration, and IDR keyframes
at 0, 2, 4 and 6 seconds. All 33 direct-seek checks match full-decode frame hashes;
strict full decoding reports no errors. A 9.5-second/570-frame comparison also
exercises encoder reuse and a shortened final GOP: 11.88 seconds serial versus
6.86 seconds parallel, with all 570 decoded frames pixel-identical.

The implementation interleaves render submission across independent two-second
segments (for example, frames 0, 120, 240, 360, then 1, 121, 241, 361). Each
encoder receives consecutive frames within its segment. Original frame indices
determine beats and timestamps, and compressed output reaches the muxer in
timeline order. Raw frames are queued in small bounded batches; compressed
reordering is capped at 64 MiB. Merely adding encoders while submitting entire
segments chronologically did not offer useful overlap without huge raw buffers.

Default parallelism applies to Maximum at 4K or above: two encoders for clips
of at least four seconds on devices reporting four CPU threads, and four for
eight-second clips on eight-thread devices. Concurrent preflight checks actual
support and compatible decoder configurations. Runtime incompatibility discards
the partial writer and retries once serially. Cancellation never retries or
returns a partial file. Async frame preparers retain sequential rendering;
eligibility is checked after the exact export tree mounts. Other quality modes,
lower resolutions and short clips retain the original execution policy.

For paired measurements, `runExport(settings, project, hooks,
{ videoConcurrency: 1 | 2 | 4 })` overrides execution without changing output
settings or the saved document. Compare fresh encoder sessions after warming the
renderer, include `flush` and `finalize`, and decode every output frame. Focused
tests live in `parallelVideoEncode.test.ts`, `videoEncodeSession.test.ts` and
`exportEngine.parallel.test.ts`; they also exercise failures, resource limits,
partial segments, exact time/range arithmetic and cancellation during audio.

Validation on main `dcc992e0` plus the parallel change: all 1,784 tests pass,
including automatic policy selection for the exact 4K60 Maximum/eight-second
case. TypeScript and focused ESLint checks pass. Performance measurements above
used the preceding main `63c8895e`; the intervening fog effect is inactive in
this project and adds no render pass to it.

This is a measured improvement for the actual encoder-bound workload. A
10–100× whole-export improvement at these settings has not been demonstrated.

## Implemented: disabled effects retain batching

A Particle track with a disabled Glow effect previously lost both its pooled
renderer and its compact GPU layout. The same happened with a disabled effect
on a parent group. A 16,384-particle track could therefore acquire 16,384
structural entries and per-copy renderers even though the effect did nothing.

`core/visual/instancedEffects.ts` now supplies one shared eligibility rule to the
visual engine, the pooled renderer and the direct-preview policy. A known,
explicitly disabled effect does not prevent batching unless an enable automation
lane can activate it. The check is structural: even an empty or muted enable
lane retains the compatibility path. Active effects, unknown effects, masks and
per-copy clocks retain their existing behavior. Own Scale effects remain
supported by the pool; active inherited Scale still uses the reference path.

Tests compare the actual engine's 16,384-particle copy transforms against the
CPU reference at forward and backward beats. They also check effect toggles,
adding enable automation, inherited effects and direct Particle Stream previews.
This optimization helps projects with the corresponding disabled effects; it
does not accelerate a track that already uses the compact GPU renderer.

## How to interpret the measurements

The earlier synthetic probes below use disposable Chrome storage on this machine's Apple M1 Max and
native ANGLE Metal. They do not load or modify an existing browser project.
These are development-build observations, not a promise for every GPU, particle
size, effect chain or export quality setting.

Encoder measurements use synthetic animated grain and speckles to isolate
H.264 throughput. Particle measurements use the editor's pinned export driver
and exact frame stepping. Codec startup is separated from warmed throughput.
GPU and encoder probes must run sequentially: they share the same hardware.
CPU frame submission time alone is not completed GPU work, and an encoder-only
speedup is not a whole-export speedup.

### Evaluating the disabled-effect fix

The real editor comparison renders 30 changing frames at 1920×1080 with 32,768
particles and 60 fps timestamps on M1 Max / native Chrome Metal:

| Measurement | Previous per-copy path | Batched path | Speedup |
| --- | ---: | ---: | ---: |
| Render + hardware H.264 encode + flush | 4.11 fps | 165.56 fps | **40.3×** |
| Render + software H.264 encode + flush | 3.58 fps | 64.91 fps | 18.1× |
| Render with GPU readback fence | 3.27 fps | 434.15 fps | 132.7× |
| Draw calls per frame, including postprocessing | 32,780 | 13 | — |

For a comparison without reverting live source, the reference fixture uses an
enabled unknown effect: the renderer ignores its visual effect but keeps the
same per-copy path as the old disabled-Glow predicate. The optimized fixture has
an explicitly disabled Glow. Both render the same moving Radial arrangement.
This measures rendering and completed encoding, excluding project loading,
initial mounts, audio, MP4 muxing and downloading. The scene is warmed before
measurement. Each encoding phase creates its own encoder; the timed window
includes any deferred initialization and the final flush. The probe uses queue
depth 8; production uses 2, whose throughput was equivalent in the independent
encoder comparison.

Captured PNGs confirm the same composition and particle population. Each path
returns byte-identical pixels when seeking beat 2 → 3 → 2. They are **not
bit-identical across paths**: the existing batched point shader and individual
quads rasterize slightly differently. Across three 1080p samples, mean absolute
channel error is 0.271–0.299 on a 0–255 scale, PSNR is 42.13–42.23 dB, and about
0.66–0.70% of channels differ by more than 8. No particle count, output size,
frame rate or encoder quality setting was reduced.

The CPU probe compares the same document against the old effect-eligibility
predicate in an isolated temporary copy of the engine. Values are medians of
five 180-frame runs after warming up. The stacked grids include a moving shared
transform, so these are changing frames, not a static-cache benchmark.

| Disabled Glow fixture | Before, CPU ms/frame | After, CPU ms/frame | Evaluator speedup |
| --- | ---: | ---: | ---: |
| Stacked grids, 16,384 particles | 2.324 | 0.0751 | 30.9× |
| Stacked grids, 32,768 particles | 4.382 | 0.0309 | 141.8× |

Both cases reduce structural mounts from the particle count to one. At 4,096
particles, the existing 16,384 threshold keeps the CPU evaluator unchanged;
pooling still removes the per-copy renderer cost. A single huge grid improves
evaluation only about 2.6–2.8×: it still has one layout matrix per particle.
These ratios measure evaluation, **not completed MP4 export**.

### Already-batched particle scenes

At 1920×1080 and 60 output frames per second, a 60-frame native Chrome probe
measured the following. It includes frame rendering, `VideoFrame` capture,
hardware H.264 encoding at 20 Mbps, and encoder flush; it excludes project
loading, the initial pin/preparation, audio, muxing and downloading.

| Particle count | Completed encoded frames/second | Throughput relative to 60 fps playback |
| --- | ---: | ---: |
| 32,768 | 214 | 3.57× |
| 1,048,576 | 206 | 3.43× |

The renderer actually draws the stated populations. Pixel hashes differ at
beats 2 and 3 and match when returning to beat 2. There are 13 renderer passes
per frame. The million-particle fixture uses four 32-copy Radials: Radial clamps
its count to 32, so three Radials set to 100 would silently test only 32,768.

This already-batched case did not exhibit a 10–100× opportunity in the encoder.
Simply requesting hardware acceleration, enlarging the encoder queue, or
discarding canvas alpha did not improve warmed throughput in the isolated
encoder tests. Hardware was already in use. Quality modes are materially
slower than Standard, but changing them changes compression quality and was
not applied as an automatic optimization.

For the synthetic grain/speckle fixture, warmed Standard measured about 292/89
fps at 1080p/4K, QP21 about 143/50, and the existing QP0 setting about 66/19.
Four independent QP21 encoders reached about 305/98 fps: roughly 2× scaling,
requiring separate chunk encoding and mux integration. Standard saturated much
earlier. Disabling `preserveDrawingBuffer` did not help and would break the
documented PostHog replay capture contract. The encoder retains quality latency;
the [WebCodecs specification](https://www.w3.org/TR/webcodecs/#latency-mode)
permits frame dropping in realtime mode.

## Further opportunities

- Keep more *active* effects and mover chains in a batched GPU representation.
  This is the most promising way to remove remaining large performance cliffs.
  Each effect needs a correctness-preserving implementation: grouping arbitrary
  per-copy shader effects can change overlaps, masks and nonlinear processing.
- A dedicated worker export renderer could improve editor responsiveness.
  Moving the same GPU work to a worker does not itself make it render faster.
- Parallel local segments now provide the measured improvement above. They
  still compete for the same GPU and media engine; much larger scaling would
  require multiple machines/GPUs, transfer and
  startup costs, exact timestamp/keyframe handling, and additional infrastructure.
- Sequential source-video decoding can avoid repeatedly decoding a GOP for
  every frame in video-heavy projects. It does not explain dense procedural
  particle exports and was deliberately left out of this change.

The output remains the same resolution, frame rate and selected codec quality.
No particles are dropped and export quality defaults are unchanged.

## Reproduce

From the repository root, with Node, installed dependencies and native Chrome:

```sh
node --import tsx scripts/perf/export-effects-cpu.ts
node --import tsx scripts/perf/export-encode-probe.mjs
```

The encoder probe starts its own temporary local server. For the editor probe,
start a separate development server first, then run these sequentially:

```sh
NEXT_DIST_DIR=.next-isolated-export npm run dev -- --hostname 127.0.0.1 --port 3068
BASE=http://127.0.0.1:3068 node scripts/perf/export-render-probe.mjs
node scripts/perf/export-render-probe.mjs --counts 32 --samples 30 --effect baseline --output artifacts/export-performance/effect-baseline.json
node scripts/perf/export-render-probe.mjs --counts 32 --samples 30 --effect disabled-glow --output artifacts/export-performance/effect-optimized.json
```

The render probe's file header documents the fixture, sample and effect options.
Results, including raw timing samples, system information and pixel comparisons,
are saved under `artifacts/export-performance/`. That directory is ignored by
Git. The three probe scripts and this report retain the reproduction path.

Historical validation of the disabled-effect change on main `61d76c52`: all 1,743 tests pass;
TypeScript, focused ESLint checks and `git diff --check` pass. The shared-motion
benchmark prerequisite is included in that main commit. Timing observations
above come from the original benchmark run before the main integration.
