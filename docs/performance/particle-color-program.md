# Particle color programs

The five shipped colorizers keep Particle copies in the compact GPU program,
including when they appear after the complete splitter population. Cosine
Palette, Gradient, Riso Duotone, Hue Rotate and the note Colorizer now publish
appearance operations. Visibility uses the same representation for opacity.

The CPU samples device parameters and shared note data. The GPU evaluates each
copy's spatial or index mapping at the colorizer's own position in the chain.
Colors sampled before a later splitter remain shared by that parent's descendants;
a later mover does not move an earlier color lookup. Relative hue, saturation and
lightness accumulate as color state, while a later tint replaces an earlier one.
The final tint and HSL/OKLCH conversion runs after that state has been composed.

The operations retain the existing discrete color choices: Cosine's 256-entry
palette, Gradient's 65-entry ramp, Riso's Bayer thresholds, and note Colorizer's
chord and envelope rules. Nested splitter programs retain their local index scope,
intermediate frames and singular-frame guards. A mover frame can supply its own
placement for a world-mapped colorizer. Copy targets and device gates preserve the
operation where their contracts allow it.

See [the execution contract](particle-execution-contract.md) for the capability
rules and fallback behavior. Per-copy clocks and arbitrary unported JavaScript
still require the existing fallback paths; this change does not turn arbitrary
CPU code into a shader.

## CPU frame preparation

Measured against baseline `fffa4212` with 32,768 copies, 30 warmup frames and 90
samples per fixture. The baseline uses `createVisualCopyEvaluator`, including its
retained static splitter prefix. The updated path compiles an equivalent compact
frame. These numbers measure **CPU frame preparation only**: they exclude GPU
execution, texture upload and rendering, and are not frame-rate multipliers.

| Chain after three 32-copy Radials | Baseline median | Compact median | CPU preparation reduction | Baseline p95 | Compact p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cosine Palette | 7.756 ms | 0.1203 ms | 98.45% / 64.5× | 16.103 ms | 0.3408 ms |
| Gradient | 2.870 ms | 0.0295 ms | 98.97% / 97.4× | 6.917 ms | 0.0891 ms |
| Riso Duotone | 5.014 ms | 0.0240 ms | 99.52% / 209.3× | 9.376 ms | 0.0282 ms |
| Hue Rotate | 2.445 ms | 0.0243 ms | 99.01% / 100.8× | 8.919 ms | 0.0327 ms |
| Note Colorizer | 19.357 ms | 0.0326 ms | 99.83% / 593.3× | 27.660 ms | 0.0565 ms |
| Fluid Impact → Cosine Palette | 17.433 ms | 0.1014 ms | 99.42% / 172.0× | 23.384 ms | 0.2165 ms |

The compiler audit separately verifies that all five colorizers remain compact
at 1,048,576 copies with every ordinary `apply` replaced by a throwing function.
The original compiler rejected every such colorizer after both 32,768 and
1,048,576 copies. No million-copy CPU expansion was used for the comparison.

## Correctness evidence

A saved baseline captures 76 scenes and 8,630 CPU reference copies. Comparing the
updated source against it preserves matrices, tint strings and perceptual flags;
maximum final linear-RGB deviation is 2.7e-15. Hue and tint amount differ only at
floating-point rounding scale. The current compact-plan tests additionally cover
mapping modes, palette and dither boundaries, amount-zero behavior, original note
order on ties, overlapping chords, positive and negative note stagger, moved
colorizer frames, recursive nested splitters, Visibility, and worker/picking
roundtrips.

The standalone browser harness compares the production compact Particle shader
with expanded CPU reference images for 96 bounded scenes. Its large-population
measurements submit compact plans only. The 64-node Gradient curve uses 4,032
segments; it has a separate 32K timing case, and the harness submits the million
case only if the measured GPU time predicts a 16.67 ms budget. A skipped case is
reported explicitly rather than counted as a successful million-particle timing.

## Reproduction

Run from the repository root:

```sh
node --import tsx scripts/perf/particle-color-program-baseline.ts reference
node --expose-gc --import tsx scripts/perf/particle-color-program-benchmark.ts expanded expanded-cpu
node --expose-gc --import tsx scripts/perf/particle-color-program-benchmark.ts compact compact-cpu
node scripts/perf/particle-color-program-gpu.mjs
```

Open the printed localhost URL in a normal visible browser and select **Run
validation**. Disable timing for image-only checks. The standalone measurements
are separate from whole-editor playback. `particle-color-program-editor.html`
provides a full-editor fixture with Final/Auto quality selection, live Cosine
scroll and X/Y automation, Fluid Impact, and an optional chain of all five
colorizers. It verifies changing data in the textures actually submitted for
main-scene draws, alongside population, compact-operation count and mesh reuse.

Raw measurements and source-reference snapshots are written under
`artifacts/particle-color-program/`; they are local validation artifacts.
