# Fluid Impact

Fluid Impact is a position mover for dense formations. A note pushes copies away from a center, feeds them into a curling wake, then brings them back with a softer rebound. Its per-copy field runs inside the compact Particle shader, so it can sit after a large splitter population without expanding that population on the CPU.

## Use it

1. Add Particle and its splitters. Three Radials with 32 copies each make 32,768 particles; four make 1,048,576.
2. Add **Fluid Impact** from the library's **Impact** folder as a child of the Particle, below the splitters in the chain.
3. Write notes on its **Impact** row (MIDI pitch 60). Velocity controls strength. Each note onset launches an impulse; extending the written note does not hold it open.
4. Start with **Impact**, **Reach**, and **Settle**, then add **Curl** and **Scatter**. Repeated hits overlap and add together; there is no fixed voice limit that removes older tails.

The six main controls fit in two rows. **More** holds the field's center, swirl axis, eddy size and flow. All numeric controls accept ordinary automation, including Center X/Y. Particle X/Y automation also remains compatible with the compact path.

| Control | Default | Meaning |
| --- | ---: | --- |
| Impact | 2.2 | Strength of the displacement, scaled by note velocity. |
| Reach | 6 | Radius of the affected region in the formation's chain frame. Copies outside it stay unchanged. |
| Settle | 1.5 beats | Time from a note onset until that impact has completely returned home. |
| Curl | 0.8 | Coherent swirl around the selected axis; negative values reverse its direction. |
| Scatter | 0.65 | Strength of the spatially varying eddies. Neighboring copies move in related currents. |
| Rebound | 0.45 | Softer inward movement behind the initial outward push. |
| Eddy size | 1.5 | Spatial wavelength of the eddies; smaller values break the field into finer currents. |
| Flow | 0.8 | Evolution of the eddies during an impact; negative values reverse it. |
| Swirl axis | Z | X, Y, or Z axis for the coherent swirl. |
| Center X / Y / Z | 0 / 0 / 0 | Center of the impact region. |

The center lives in the same chain frame that the splitters use. Moving the Particle or a parent group carries the formation and its field together. Use the Center controls to move the field through the formation. A mover nested beneath Fluid Impact as a placement frame does not relocate this placement-independent field.

## Motion model

This is an analytic fluid-like displacement field. It does not integrate particle velocities, collisions or pressure between neighbors, and it does not keep a simulation history. Every position is a pure function of the current beat, settings, notes and incoming copy transform. Pausing freezes it; playback, seeking and export sample the same result.

Each note contributes two compact envelopes over `u = age / Settle`: an early pressure kick `12.20703125 * u * (1 - u)^4`, and a later wake `16 * u^2 * (1 - u)^2`. Both are zero before the onset and after Settle; the return has zero terminal velocity. The summed kick drives radial dispersion. The wake drives swirl, eddies and the rebound, so the return has a different shape from the launch.

The spatial field combines a softened outward direction, a cross-product swirl around the chosen axis, and the curl of a trigonometric vector potential. The underlying eddy field is divergence-free; the complete localized effect also includes radial pressure and a spatial falloff, so it is not an incompressible fluid solver. Its falloff reaches zero smoothly at Reach. The burst acts throughout the affected region at once; it does not model a front traveling outward at a physical wave speed.

The operation translates each copy in the chain frame. It preserves that copy's orientation, scale, shear, opacity and color. Following movers still see its displaced reference position; nested splitter internals retain the engine's normal composition rules.

## Why it stays compact

`fluidImpactField.ts` prepares the note timeline and reduces active impact tails to shared radial, swirl and scatter amounts at the sampled beat. The CPU submits one operation record with 14 scalar parameters, regardless of how many copies the splitters produce. It does not evaluate the field once per particle or upload a matrix for every displaced copy.

`gpuOperations.ts` implements that record in both the reference evaluator and GLSL. The shader reconstructs each copy from the compact splitter tables, evaluates the field at its incoming position, and applies the resulting translation. The operation can appear before, between or after supported splitter stages. Its bounded displacement and unchanged basis let the compiler retain conservative bounds and determinant information.

The mover declares one output, unchanged appearance and no placement dependency. These contracts preserve it through parameter automation and allow a nested splitter to sample it over local slots. It shares the same rendering pipeline as [Symmetric Motion, Symmetric Rotation and mixed mover chains](automation-mover-program.md).

## Scope and limits

The compact rendering benefit currently applies to eligible Particle chains, starting at 16,384 structural copies. Smaller populations and other instruments use the matching CPU evaluator. Fluid Impact works with the existing compact splitter layouts, supported GPU movers, ordinary parameter automation and compatible bounded CPU prefixes.

Adding an unsupported mover after an already-large population can still force the chain onto the reference path. The existing 4,096-copy CPU-prefix bound and 16-stage GPU-program limit remain. Copy clocks, masks and unsupported effects retain their existing fallback behavior. Fluid Impact does not make arbitrary JavaScript movers run on the GPU.

GPU work still grows with the submitted population. Particle size, screen resolution, overdraw, other movers and the rest of the scene affect frame rate. Strong overlapping hits can also throw copies outside the camera view; increase the view's room or reduce Impact for a tighter formation.

## Validation and performance

All 1,898 visual tests passed after integrating the latest main branch. The focused tests cover envelopes, superposed notes, CPU/GPU operation parity, automation, seeks, placement, appearance and nested frames. All 25 browser image comparisons passed against expanded reference copies, with a maximum three-level difference in an 8-bit color channel.

Chromium 152 using ANGLE Metal on Apple M1 Max measured the isolated production renderer at 1024×576. Each case used 30 warmup frames followed by 150 measured frames. Fluid Impact ran after the full splitter expansion:

| Chain | Submitted particles | GPU median / p95 | CPU update and render median / p95 |
| --- | ---: | ---: | ---: |
| Three Radials + Fluid Impact | 32,768 | 0.400 / 0.966 ms | 0.2 / 0.3 ms |
| Four Radials + Fluid Impact | 1,048,576 | 4.670 / 6.702 ms | 0.2 / 0.4 ms |
| Four Radials + Symmetric Rotation + Fluid Impact | 1,048,576 | 5.271 / 6.875 ms | 0.3 / 0.4 ms |

Every case submitted its complete population as hardware points in one draw call. All GPU timer queries completed without disjoint intervals; browser callbacks ran at approximately 120 Hz. GPU elapsed time and CPU submission time are separate measurements and are not added together as a frame-rate estimate.

The full editor used the production document engine, a real inspector and timeline, Final quality with a 1212×562 main composition target, and Particle X/Y plus Fluid Impact Center X/Y automation:

| Submitted particles | Rendered frame rate | Main canvas CPU median / p95 | Verified main draws |
| --- | ---: | ---: | ---: |
| 32,768 | 59.95 FPS | 0.6 / 2.1 ms | 300 |
| 1,048,576 | 60.05 FPS | 0.6 / 1.9 ms | 301 |

Both populations retained their full GPU draw count with no CPU seeds or mesh replacements. The fixture verified live motion directly from the drawn shader parameters: both center axes changed across their automated ranges, all three impact displacement channels varied, and the operation texture updated on every measured frame transition. The million-particle case recorded 300 texture updates over 301 draws. These are local measurements on this machine and viewport, not a universal frame-rate guarantee.

## Reproduce

```sh
node --import tsx --test --experimental-test-module-mocks \
  src/editor/core/visualCopies/fluidImpact.test.ts \
  src/editor/core/visual/fluidImpactRuntime.test.ts
node scripts/perf/fluid-impact-gpu.mjs
```

Open the printed browser URL and click **Run validation**. Optional timings exercise Fluid Impact after three or four 32-copy Radials, including a million-particle chain with Symmetric Rotation. Results save to `artifacts/fluid-impact/gpu.json`.

For the real editor, temporarily copy `scripts/perf/fluid-impact-editor.html` into `public/fluid-impact-check.html` and run a local development editor with its own `NEXT_DIST_DIR`. Open that page, choose a population and quality (Final is the default), load the chain, then measure with the tab visible. It changes only its own in-memory document. Its instrumentation checks the main composition target, exact submitted population and Fluid Impact GPU operation separately from the timeline previews. It records changing center and displacement channels directly from the submitted operation texture, rather than relying on a worker diagnostic beat that may remain stale during direct rendering. Remove the temporary public page afterward.
