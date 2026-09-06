# Particle text playback performance — 2026-09-05

Profiled main at `c8d4d438` using the Wormhole template. Playback triggered only
four React commits in six seconds; React updates were not the dominant cost.
The real-GPU CPU profile instead attributed 428 ms to `seededRand`. Particle
text regenerated its index-based color jitter on every animated color change
(90,000 sine hashes, even at an 8,000-particle draw count), plus morph samples
whose inputs stay constant throughout a word transition.

The fix shares lazily initialized, double-precision color samples, retains two
reusable morph sample tables per cloud, and fills/uploads only the needed
particle prefix. Pending GPU updates merge into one range so hidden clouds
cannot accumulate a range per frame. Existing beats, colors, geometry, particle
counts and preview/export quality are unchanged.

## Measurements

Local real-GPU browser, 1600×1000 viewport, development server, six-second
Wormhole playback (single before/after runs; timing varies with system load):

| Metric | Before | After |
| --- | ---: | ---: |
| `seededRand` CPU self time | 428 ms | 48 ms |
| Median frame interval | 13.6 ms | 11.3 ms |
| 95th-percentile frame interval | 25.4 ms | 21.0 ms |
| Long tasks | 0 | 0 |

CPU-only benchmark, median of five 300-frame runs after warmup:

| Particles | Animated color | Before ms/frame | After ms/frame |
| --- | --- | ---: | ---: |
| 8,000 | No | 0.841 | 0.042 |
| 8,000 | Yes | 9.143 | 0.064 |
| 30,000 | No | 3.116 | 0.156 |
| 30,000 | Yes | 11.436 | 0.225 |

These microbenchmarks measure the particle updater, not total application frame
time. Software-rendered Chromium showed a separate `drawImage` readback cost
that did not reproduce with the real GPU, so it was not used to claim playback
performance on the user's hardware.

## Reproduce

```sh
BASE=http://localhost:3091 HEADED=1 node scripts/perf/profile-play.mjs template:wormhole 6
node --import tsx scripts/perf/particle-cloud.mjs
node --import tsx --test src/editor/instruments/particleWordCloud.test.ts
npm run test:visual
npx tsc --noEmit --incremental false
```

Regression hashes captured from the original implementation verify the active
position and color buffers exactly, including count growth, color/variation
changes, new morph salts, backward scrubs, and switching into field mode.
