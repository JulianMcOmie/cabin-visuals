# Million-particle splitter chains

Large Particle tracks now compile compatible splitter chains into a compact GPU layout. Two sibling Grid splitters, each with 32 rows and 32 columns, produce **1,048,576 particles**. The evaluator stores 2,048 layout matrices instead of creating a million copy objects. The renderer draws the entire population in one call.

## Try it

1. Add a Particle instrument and set Size to about `0.006`.
2. Add two Grid splitters as sibling children of the Particle, in chain order.
3. Set both Grids to Rows `32`, Columns `32`, Depth `1`.
4. Set the first Grid's Spacing to `0.15`, and the second to `0.004`.
5. Automate the second Grid's Spacing between `0.002` and `0.006`, or add count MIDI to either splitter. Scrubbing and playback sample the same absolute-beat layout.

Setting the second Grid's Depth to `4` produces **4,194,304 particles**. Small particles matter: increasing size and glow increases the number of blended pixels substantially.

## Supported scope

The compact path activates automatically at a structural count of 16,384 or more, for up to 16 packed stages. Grid, Radial, Line, Mover (Translate/Rotate/Orbit), and Radial Motion can participate. It supports their layout settings, layout automation, count MIDI, Particle appearance, object placement, and the existing compatible Scale effect. A compatible splitter's own spatial rotation automation or nested count-one shared Mover also stays compact, with its internal motion preserved separately from downstream layouts. Logical counts remain available, and inspection can reconstruct any single copy without expanding its neighbors. Count reductions preserve hidden structural slots when inspecting them. See [moving-particle measurements](radial-transforms.md) for the three-Radial case.

Nested splitter children, movers without an explicit shared-transform contract, per-copy clocks, targeted entries, masks, and other effects retain the reference evaluator. They can still be expensive at large counts. This is not a general GPU compiler for every device combination.

Small particles use a buffer-free point draw indexed by `gl_VertexID`. A conservative scale bound chooses the original instanced-quad shader when points could exceed the GPU's supported size. Point sprites retain the same radial color/glow shader, with minor rasterization differences from quads, including clipping at the viewport edge. Neither path drops particles to meet a frame budget.

Compact-only scenes (including Main when all potential source scenes are compact) present directly, avoiding worker pixel readback and the compatibility renderer's cooldown. The main canvas targets 60 FPS. Dense timeline thumbnails retain their complete populations but refresh at up to 10 FPS during playback, and up to 30 FPS while paused. Other scenes retain the existing worker policy.

Selection uses a one-pixel GPU depth pass, restores renderer state, and handles an in-flight thumbnail pixel-pack buffer. Large populations are never enumerated for pointer queries. Export uses the same absolute-beat plan; GPU layout data is serializable and static worker metadata is sent only when changed or unacknowledged.

## Measured on Apple M1 Max, Chromium / ANGLE Metal

Measurements are development-build observations, not a hardware-independent frame-rate guarantee.

| Test | Population | Result |
| --- | ---: | --- |
| Isolated production renderer, 1440 × 900 | 1,048,576 | GPU median 2.38 ms, p95 4.87 ms |
| Isolated production renderer, 1440 × 900 | 4,194,304 | GPU median 4.03 ms, p95 7.68 ms |
| Editor, animated Grid spacing, 706 × 303 canvas, display cap disabled | 1,048,576 | 60.13 rendered FPS; CPU median 1.0 ms; GPU median 1.64 ms |
| Editor with normal browser timing | 1,048,576 | Approximately 29–56 rendered FPS across runs; browser callbacks intermittently limited to 30 Hz |

The capacity test disables Chromium's frame-rate limit and GPU vsync to separate engine throughput from display pacing. Its 60 FPS result does **not** establish steady 60 FPS presentation under normal browser settings. Normal editor frame pacing remains a limitation to investigate on the intended display/browser. GPU p95 in the full editor also varied substantially (up to about 30 ms), unlike the isolated renderer. Size, resolution, effects, other GPU workloads, and thumbnail visibility affect the result.

For 512 reference particles, point-renderer mean absolute byte error against the quad renderer was 0.00393 on a 0–255 channel scale. The quad plan's error was 0.000005. CPU matrix parity, count ordering, backward seeks, worker acknowledgement, representation changes, and layout automation are covered by tests. All 1,695 tests and TypeScript checks pass, and the production build succeeds. Browser checks verified identical export pixels when returning from beat 4 to beat 0, restoration of the preview size after export, Main composition, and GPU → reference → GPU transitions.

## Reproduce

Start the development editor in this checkout, then run:

```sh
BENCH_URL=http://127.0.0.1:3000/editor node scripts/perf/million-particles.mjs
BENCH_URL=http://127.0.0.1:3000/editor node scripts/perf/million-particles.mjs --capacity
node scripts/perf/particle-plan-validation.mjs
```

The benchmark uses fresh disposable browser storage and injects an animated million-particle fixture. It does not modify an existing browser session or saved project. Results and a screenshot are written to `artifacts/million-particles` (override with `BENCH_OUTPUT` for the editor benchmark). The editor benchmark requires development inspection hooks. The GPU validation harness bundles production modules and checks point drawing, texture growth/shrink, hit/miss picking, hidden geometry, and renderer/PBO state restoration.
