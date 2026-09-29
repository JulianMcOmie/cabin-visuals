# Automation and mixed mover chains

Dense Particle chains now keep shared calculation and GPU expansion across more automation and mover combinations. This extends [shared splitter tables](shared-splitter-program.md).

## Execution

Symmetric Motion and Symmetric Rotation publish a serializable operation record sampled from their existing MIDI and automation channels. The CPU reference evaluator and GPU shader implement the same operation on the incoming reference frame. This supports mirrored displacement, radial displacement/orbit, and position-weighted twist/fold/roll. An operation can appear before, between, or after the splitter stages. Deferred nested motion stays separate until the chain finishes.

Waypoints and Physics now publish their shared local transform. Placement-independent movers retain their compact metadata when they have child movers forming an irrelevant placement frame. The wrapper preserves its existing composition behavior, including nested splitter re-anchoring.

Other movers use a bounded CPU prefix followed by a GPU suffix. The compiler finds the last unsupported operation, proves that every intermediate prefix population is at most 4,096, and evaluates only that prefix. Its output becomes correlated frame/internal seeds; subsequent splitters expand them on the GPU. A 32-copy Radial followed by Wave Terrain and two more 32-copy Radials therefore evaluates the world-space field for 32 seeds, while rendering all 32,768 final particles.

The bound is explicit definition metadata, including automation variants and gated identity arms. It is never inferred by sampling one beat. The prefix uses the normal evaluator, so arbitrary position, index, formation and placement calculations retain their original context. The GPU receives complete seed appearance: opacity, hue, saturation, lightness, tint, tint amount and perceptual color flags. Singular world inverses and deferred internal transforms remain intact.

Changing beats always resamples a CPU prefix. Placement is compared by matrix contents, including X/Y changes while paused. Worker transfer, inspection and picking retain the same plan. Automated count changes use a proven structural capacity, so an empty beat can recover without replacing the mesh.

## Coverage and limits

Particle X/Y transforms, splitter X/Y transforms, and supported mover parameter automation retain batching. In the reproduction inventory these X/Y cases were already compact; the new fixes address surrounding movers that previously forced expansion. Direct `tfX`/`tfY` lanes under a Mover remain subject to the existing parameter semantics; this change does not introduce new controls.

The typed GPU operation family is extensible. It does not translate arbitrary JavaScript into shader code. An unsupported operation after a prefix larger than 4,096 still needs the reference path. Stagger/copy clocks, masks, unsupported effects, and unproven suffix metadata also retain that path. Compact Particle rendering starts at 16,384 structural copies and supports at most 16 GPU stages, with the CPU prefix occupying one stage.

Mixed or nearly singular frames may need exact CPU guard flags. Particle size, overdraw, resolution and other scene work still determine rendering cost; CPU speedups are not FPS multipliers.

## Validation

An adjacent before/after run against a clean `a9c69492` archive used Apple M1 Max, 30 warmup frames and 180 samples per fixture. These are median `computeAtBeat` times for 32,768 particles, excluding rendering and uploads:

| Case | Before → after | CPU speedup |
| --- | ---: | ---: |
| Rotate with a child placement frame | 23.217 → 0.0190 ms | 1,225× |
| Orbit with a child placement frame | 35.168 → 0.0185 ms | 1,897× |
| Nested Rotate with that frame | 33.078 → 0.1767 ms | 187× |
| Sibling Symmetric Motion | 31.013 → 0.0645 ms | 481× |
| Sibling Symmetric Rotation | 66.251 → 0.0634 ms | 1,045× |
| Wave Terrain prefix + splitter suffix | 28.705 → 0.1700 ms | 169× |
| Colorizer prefix + splitter suffix | 30.453 → 0.2115 ms | 144× |
| Wave Terrain + Colorizer prefix + splitter suffix | 35.483 → 0.2162 ms | 164× |

All 19 fixtures retain one render object, direct presentation eligibility, and zero expanded CPU copies. The three general-prefix cases each evaluate 32 seeds. Sampled transforms match within `6.7e-16`; complete appearance and repeated seeks match. The unchanged Rotate control was 0.0328 → 0.0320 ms. This is not a claim that every case improves: already compact nested Symmetric Rotation measured 0.1504 → 0.2003 ms, while the other small controls varied by microseconds.

An independent differential comparison of the two Symmetric definitions against their pre-change implementations covered 5,040 combinations, with zero matrix differences. All 1,874 visual tests and the production build passed after integrating the latest main. Browser pixel comparisons passed all 33 cases, with a maximum two-level difference in an 8-bit color channel, zero seek differences and no WebGL errors. These cover position operations, nested internals, full seed colors, texture growth, changing seed counts, paused placement edits and repeated seeks.

Chromium 152 using ANGLE Metal on Apple M1 Max measured the isolated production renderer at 1024×576, with 150 measured frames after warmup:

| Chain | Submitted particles | Median / p95 GPU time |
| --- | ---: | ---: |
| Symmetric Motion | 32,768 | 0.408 / 0.940 ms |
| Symmetric Rotation | 32,768 | 0.606 / 1.353 ms |
| Symmetric Motion | 1,048,576 | 5.681 / 6.895 ms |
| Symmetric Rotation, twist/fold/roll | 1,048,576 | 11.154 / 15.740 ms |
| Rich CPU prefix + splitter suffix | 1,048,576 | 3.238 / 4.034 ms |

Every case used one draw call and hardware points, submitted its full population, and completed every timer query without a disjoint interval. Hidden seed slots are clipped by the shader. The visible browser delivered approximately 30 callbacks per second during this run; the table reports elapsed GPU query time, not whole-editor FPS.

The final full-editor runs, after browser callbacks returned to approximately 120 Hz, rendered **1,048,576 particles at 60.01 FPS with Symmetric Rotation plus X/Y/angle automation**, and **60.00 FPS with a 32-seed Wave Terrain prefix plus X/Y automation**. The canvas was 736×673, with a 736×674 main composition target at Final quality. Main canvas CPU time was 0.6 / 1.9 ms median/p95 for Symmetric Rotation and 0.8 / 3.2 ms for Wave Terrain. Every one of the 300 measured main composition draws in each run retained the full population and the expected GPU operation or seed prefix, with zero mesh replacements. The separate timeline atlas intentionally renders partial chains and was inspected separately. These are local fixtures on this machine, not a universal frame-rate guarantee or a measurement of the saved cloud project.

## Reproduce

```sh
node --expose-gc --import tsx scripts/perf/automation-program-benchmark.ts --output artifacts/automation-program/current.json --compare artifacts/automation-program/baseline.json
node scripts/perf/automation-program-gpu.mjs
```

Capture the CPU baseline from an unchanged revision first, omitting `--compare`. The benchmark uses the production document engine and checks sampled transforms, complete appearance and seeks. The browser harness compares the production compact renderer against expanded reference copies and optionally measures isolated GPU time.

For full-editor validation, temporarily copy `scripts/perf/automation-program-editor.html` into `public/codex-automation-program-editor.html`, serve a local development editor with a separate `NEXT_DIST_DIR`, and open that page. Its fixtures use X/Y automation with Symmetric Rotation or a world-space Wave Terrain prefix, at 32,768 and 1,048,576 particles. The page changes only its in-memory document. Remove the temporary public file afterward.
