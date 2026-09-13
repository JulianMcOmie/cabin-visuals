# Shared motion in dense Particle chains

Particle now retains compact rendering when sibling Mover Translate, Rotate, or Orbit stages occur above, between, or below compatible splitters. Every Mover mode uses the existing absolute-beat math, including MIDI and parameter automation. Instead of applying that shared matrix to every CPU copy, the renderer composes the small stage tables on the GPU. Uniform Orbit matrices collect into one common prefix; local stages keep their original order.

Three 32-copy Radials plus one constant Mover now use **97 matrices for 32,768 particles**, rather than 32,768 finished CPU matrices. Four Radials use 129 matrices for 1,048,576 particles. There is no population reduction or approximation of motion.

Radial Motion also publishes its shared local arrangement once per beat. Its default 8×4×2 arrangement adds 64 copies, so three 32-copy Radials plus Radial Motion represent **2,097,152 particles with 160 matrices**. It preserves radius glides, spin latches, and seeking.

The renderer's size estimate uses a conservative bound derived from the transform's Gram matrix. Pure rotation keeps the bound near one; shears and nonuniform scales remain safely bounded. This avoids unnecessary points/quad switching when rotating an unchanged particle size.

## Controlled CPU comparison

Baseline: clean git archive of `2220c0a7`. Same Node process settings, fixtures, sample beats, 30 warmup frames, 180 timed frames per case, Apple M1 Max. This measures `computeAtBeat`, excluding rendering and GPU uploads. The benchmark compares sampled matrices, color, opacity, and repeated seeks with the baseline.

| Mover placement | Rotate before → after (median ms) | CPU speedup | Orbit before → after (median ms) | CPU speedup |
| --- | --- | ---: | --- | ---: |
| Above Radials | 3.037 → 0.0295 | 103× | 2.226 → 0.0341 | 65× |
| Between Radials | 2.945 → 0.0233 | 126× | 2.158 → 0.0262 | 82× |
| Below Radials | 3.886 → 0.0211 | 184× | 9.493 → 0.0225 | 421× |

The final runs include the tighter size bound. All sibling cases retain one object-list entry, no expanded copies, and direct presentation eligibility. Sampled Rotate matrices were identical to the baseline; Orbit differed by at most 8.9e-16 due to multiplication regrouping. These CPU ratios are not FPS ratios. Nested Mover fixtures remain on the reference path.

## Full editor and GPU checks

The foreground Chrome development editor, with default lighting and timeline thumbnails visible, rendered the 32³ constant-Rotate case at **59.99 FPS**, with **0.5 ms median / 3.1 ms p95 CPU time** at a 1832×561 canvas. This was a representative local fixture, not the user's saved cloud project. Initial background-tab runs were slower and are not foreground performance measurements. Browser settings were unchanged.

The four-Radial constant-Orbit fixture verified **1,048,576 drawn particles at 59.96 FPS**, with **0.5 ms median / 1.9 ms p95 CPU time**, using 129 matrices at the same canvas size. Render modes remained stable in both foreground runs.

The standalone production renderer at 1280×720 drew one million particles in one draw call. GPU elapsed-query medians were **3.13 ms for Rotate** and **3.06 ms for Orbit** (p95 4.10 / 4.47 ms), with 150 measured frames each. Every query completed, with no disjoint intervals or WebGL errors. The foreground tab remained visible throughout.

All 30 expanded-versus-compact quad image comparisons passed across Rotate/Orbit, three sibling placements, and five beat samples. The maximum channel difference was one byte on the 0–255 scale; repeated seeks reproduced the prior pixels. Four growth/shrink/picking checks passed and restored renderer state, including an outstanding pixel-pack buffer.

The final integration on main passed **1,740 tests**, TypeScript validation, and a production build.

## Remaining limits

Nested mover frames and movers nested inside splitters still use the framed reference evaluator. Copy targets, independent copy clocks, appearance-changing modifiers, masks, and unsupported effects likewise retain the fallback. This change does not make every possible device chain compact. Pixel coverage, glow, canvas size, other GPU work, and browser visibility still affect frame rate.

## Reproduce

```sh
node --expose-gc --import tsx scripts/perf/radial-transform-benchmark.ts --output artifacts/radial-transforms/current.json --compare artifacts/radial-transforms/baseline.json
node --expose-gc --import tsx scripts/perf/radial-transform-benchmark.ts --motion orbit --output artifacts/radial-transforms/current-orbit.json --compare artifacts/radial-transforms/baseline-orbit.json
node scripts/perf/radial-transform-gpu.mjs
```

Capture baseline JSON from the unmodified revision first (omit `--compare` for that run), then run the same fixture with `--compare` after applying the change. Benchmark JSON stays local under `artifacts/radial-transforms`.

Open the GPU server's printed URL in normal Chrome, select its tab, and click Run validation. Results save to `artifacts/radial-transforms/gpu.json`.

For the whole editor, temporarily copy `scripts/perf/radial-transform-editor.html` into `public/radial-transform-check.html`, run an isolated Next development server, and open that page. Load the desired chain, keep the tab in the foreground, and click Measure editor playback. The harness reports both browser callback rate and actual canvas render rate and verifies the drawn population. It changes only its local in-memory fixture. Remove the temporary public file afterward.
