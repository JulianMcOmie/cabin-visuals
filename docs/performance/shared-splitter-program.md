# Shared splitter tables and Particle rendering

All twelve spatial splitters now build their reference copies and GPU metadata from the same immutable slot table: Radial, Grid, Line, Fractal, Wallpaper, Scatter, Symmetry, Parametric Pattern, Polyhedron, Tunnel, Approach and Duplicate Trail. Stagger is the remaining splitter with independent copy clocks and uses the reference evaluator.

Each table contains local transforms and optional opacity multipliers and additive hue shifts. Static layouts are resolved once; their packed transform buffers and scale bounds are weakly cached instead of recomputed when a different stage animates. Animated layouts are sampled once per beat; Tunnel, Approach and Duplicate Trail additionally track placement matrix contents, including changes while paused. Other instruments also benefit from this shared calculation cache, even though the compact GPU renderer currently belongs to Particle.

For dense compatible Particle chains, the engine retains the tables instead of allocating the Cartesian product of copies. The GPU decodes each instance's slot indices and composes its matrices and appearance. For example, Fractal at depth four with five branches has 781 slots. Following it with a 32-copy Radial produces 24,992 particles from 813 layout matrices; adding a sibling Rotate needs one additional matrix. It does not require GPU recursion, reduced particle counts or approximate movement.

Nested movement keeps its existing reference-frame semantics. Mover, Symmetric Motion, Symmetric Rotation, Waypoints, Physics and spatial transform automation publish explicit count-one, placement-independent motion proofs. The engine evaluates these children against only the containing splitter's slots, then stores correlated frame/internal matrices for GPU composition. Their targeting and bypass gates can remain local to those slots. Shared count-one children may also contribute opacity and hue; singular incoming frames retain the bare parent's appearance and skip the child, matching the reference evaluator.

The renderer multiplies slot opacity and adds hue across the chain, then applies hue once to the Particle's linear RGB source color. Object opacity is clamped after slot fading. Hidden slots retain their stable indices but are clipped before rasterization. Appearance arrays share the layout texture, and switching between plain and appearance-bearing plans clears obsolete uniforms. The same shader drives picking.

## Validation

An independently captured pre-change source snapshot covered 432 combinations of splitter settings, MIDI, seek beats and placement transforms. All 123,936 compared matrix components, opacity values and complete color shifts matched exactly after the definition migration. Compiler and runtime tests additionally cover mixed-radix appearance, singular frames, nested and targeted motion, count automation, same-beat placement changes, worker transfer and representation changes.

Controlled CPU comparison against a clean archive of `f85bb9a8`, on Apple M1 Max with 30 warmup frames and 180 measured frames per case. These measure `computeAtBeat`, excluding rendering and GPU uploads:

| Chain | Particles | Median before → after | CPU speedup |
| --- | ---: | ---: | ---: |
| Fractal → Radial → Rotate | 24,992 | 9.955 → 0.0210 ms | 475× |
| Fractal → Rotate → Radial | 24,992 | 1.995 → 0.0175 ms | 114× |
| Rotating Fractal → Radial | 24,992 | 4.709 → 0.7109 ms | 6.6× |
| Radial → rotating Fractal | 24,992 | 22.255 → 0.7215 ms | 30.8× |
| Scatter → Wallpaper → Polyhedron → Rotate | 20,480 | 3.780 → 0.0087 ms | 436× |
| Fractal → rotating Scatter → Wallpaper | 30,976 | 8.277 → 0.0390 ms | 212× |

All six retain one render object, zero expanded CPU copies and direct presentation eligibility. Saved sampled transforms and appearance match the baseline within `1.4e-15`, including repeated backward seeks. A rotating Fractal still evaluates its own 781 slots; the upstream product no longer multiplies that cost.

The complete visual suite passed all **1,823 tests**, and the production build and TypeScript checks passed.

The production GPU renderer passed all **19 image comparisons pixel for pixel**, including nonzero hue, opacity above one, the visibility cutoff, changing placement at a held beat, count/seek restoration and appearance → plain → appearance updates. No shader or WebGL errors occurred. Chromium 152 used ANGLE Metal on Apple M1 Max.

The existing nested Radial GPU regression also passed all 30 image comparisons, five mixed-guard/program transitions and five picking/state-restoration checks, preserving the previously shipped fast path.

At a 1024×576 canvas, with 150 measured frames after warmup, the isolated renderer produced:

| Chain | Submitted particles | Median / p95 GPU time |
| --- | ---: | ---: |
| Fractal + sibling Rotate + Radial + Radial + Line | 1,047,552 | 2.994 / 5.696 ms |
| Rotating Fractal + Radial + Radial + Line | 1,047,552 | 2.666 / 5.653 ms |
| Rainbow Duplicate + Scatter + Wallpaper + Radial | 1,179,648 | 1.949 / 5.019 ms |

Each used one draw call and hardware points. Every elapsed-time query completed without a disjoint interval. The visible tab supplied approximately 120 callbacks per second. Submitted populations include stable hidden slots in the appearance case; the vertex shader clips them before rasterization. These timings describe the isolated renderer, not whole-editor frame rate.

The full local development editor, including its lighting and timeline previews, then rendered the rotating-Fractal fixture at **59.95 FPS for 24,992 particles** and **59.99 FPS for 1,047,552 particles**. The canvas was 1228×561; browser callbacks ran at approximately 120 Hz. Measured canvas CPU time was 3.2 ms median / 7.1 ms p95 for the smaller fixture and 1.7 ms median / 14.6 ms p95 for the million-particle fixture. Both retained the full draw count, hardware points and zero mesh replacements. These are representative local fixtures on this machine, not a universal frame-rate guarantee or a measurement of a saved cloud project.

## Limits

This expands the existing compact path; it does not make arbitrary device chains independent of their input copies. Stagger's clocks, world-dependent or formation-dependent sibling movers, unproven nested movement, nested splitter fanout, appearance operations beyond the declared channels, masks and unsupported effects retain the reference path. Compact Particle rendering still begins at a structural population of 16,384. Smaller chains reuse the sampled slot calculations through the ordinary evaluator.

Normal framed prefixes certify their singularity guard without enumerating copies. Mixed or near-singular prefixes can require exact CPU guard flags proportional to the incoming population. Fractal's small slot table remains bounded, but chaining many extremely shrunken stages can encounter this case. GPU time also depends on particle size, overdraw, canvas resolution and other scene work; lower CPU evaluation time is not an equivalent FPS multiplier.

## Reproduce

```sh
node --expose-gc --import tsx scripts/perf/splitter-program-benchmark.ts --output artifacts/splitter-program/current.json --compare artifacts/splitter-program/baseline.json
node scripts/perf/splitter-program-gpu.mjs
```

Capture the baseline from an unchanged revision first, omitting `--compare`. The CPU harness uses the production document engine and compares sampled transforms, appearance and repeated seeks. Open the GPU server's local URL in a normal browser and click its validation button. GPU pixel comparisons use the production Particle renderer and the independently expanded CPU copies; they do not measure whole-editor FPS.

For editor integration, temporarily copy `scripts/perf/splitter-program-editor.html` into `public/splitter-program-check.html`, serve a local development editor with a separate `NEXT_DIST_DIR`, and open that page. Select a fixture, load it, and measure playback while the tab remains visible. The harness changes only its in-memory project and reports browser callbacks, canvas renders, actual draw count and mesh replacements. Remove the temporary public file after testing.
