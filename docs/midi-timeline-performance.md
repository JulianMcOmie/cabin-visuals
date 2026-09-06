# MIDI timeline performance — 2026-09-05

The arrangement's note activity had three avoidable costs:

- Each block pulse wrote an inherited `--midi-activity-opacity` property on the
  block, invalidating styles on all its note descendants. The wash now receives
  opacity directly; the envelope and colors are unchanged.
- Every block animated regardless of whether it was in the lane viewport.
  One shared IntersectionObserver per scroller now gates activity subscriptions
  and compositor promotion, with 200px overscan. Offscreen notes stop updating
  and resume on entry. Selecting/deselecting a block also refreshes its wash
  registration, which previously could retain detached overlays.
- Registration wrote a zero property onto every note, and the first playback
  frame rewrote `0` as `0.0000`. Silent notes now use the existing CSS fallback;
  only notes whose activity actually changes receive style writes.

The initial playback fix kept note DOM mounted: removing previews on exit
added scrolling work. The follow-up below isolates scroll viewports and skips
offscreen contents temporarily during row zoom; it still keeps every note
mounted and does not virtualize initial note DOM.

## Matched density probe

Thirty tracks, eight blocks per track, 128 notes per block: 240 blocks and
30,720 notes. Ten rows/30 blocks intersected the viewport. A MIDI-only fixture
avoids instrument rendering costs. Headless Chromium, 1600×1000, local dev
server; CPU sampling plus browser timeline tracing. Single before/after runs
are directional measurements, not FPS guarantees.

| Workload / metric | Before | After |
| --- | ---: | ---: |
| Six-second playback: style update time | 1,541 ms | 88 ms |
| Six-second playback: MIDI custom-property writes | 44,520 | 8,910 |
| Playback: p95 frame interval | 148.8 ms | 87.2 ms |
| Block drag: style update time | 742 ms | 530 ms |
| Block drag: MIDI custom-property writes | 903 | 0 |
| Rapid scroll: p95 frame interval | 52.8 ms | 53.0 ms |
| Rapid scroll: style update time | 4.0 ms | 3.9 ms |

An additional 100-track fixture (800 blocks, 102,400 notes) completed playback
and browser checks for visible pulses, offscreen demotion, scrolling back into
view, selecting/deselecting, and opening the piano roll with its notes. Its
playback style-update time was 69 ms over six seconds; painting remained costly
at this size, so this is not a claim that all 100k-note rendering cost is gone.

The unchanged resting timeline was checked with viewport screenshots (12 pixels
differed out of 681,600). Regression
tests cover pulse values, mute/pause, absence of mass zero writes, viewport
entry/exit cleanup, observer sharing and teardown. All 1,457 tests passed.

## Reproduce

```sh
BASE=http://localhost:3091 node scripts/perf/timeline-density.mjs play
BASE=http://localhost:3091 node scripts/perf/timeline-density.mjs scroll
BASE=http://localhost:3091 node scripts/perf/timeline-density.mjs drag
BASE=http://localhost:3091 TRACKS=100 VERIFY=1 node scripts/perf/timeline-density.mjs play
```

`TRACKS`, `BLOCKS` and `NOTES` configure density. `HEADED=1` opens a browser;
`OUT_SHOT=/tmp/timeline.png` captures the resting lane viewport. The fixture is
created in the test browser's in-memory editor and never saves to a project.


## Follow-up: scrolling, panel resize, and row zoom

Panel-height changes repeatedly repainted the note surface as part of the page.
The arrangement and piano-roll scrollers now have their own composited surface
with size/layout/paint containment. Containment belongs on the externally sized
scroll viewport, not individual rows: selection blooms still cross row edges,
and transform/tag popovers remain portaled outside it.

Arrangement row zoom additionally skips the **contents** of offscreen blocks
using the existing 200px viewport observer. This is enabled only while row height
changes, including toolbar changes, and ends 180ms after the last change. All
notes stay mounted. Leaving this skipping enabled during ordinary scrolling was
rejected: p95 increased from 57ms to 96ms through repeated reveal/raster work.
The final code restores the browser's cached content when zoom settles.

The piano roll previously rebuilt all note elements on every vertical zoom step.
Note tops/heights and loop ghosts now use percentages of the full grid height;
React caches the note elements until their notes, selection, horizontal geometry,
row vocabulary, or word content changes. An inherited row-height CSS variable
was also tested and rejected: its style invalidation consumed the saved React
time. Percentage geometry avoids that invalidation, and ref-backed gesture
callbacks still use the latest zoom coordinates.

Matched headless Chromium probes (1600×1000, development build, same fixtures):

| Workload / metric | Before | Final |
| --- | ---: | ---: |
| Arrangement panel resize, 30,720 notes: p95 frame interval | 158.2ms | 114.2ms |
| Arrangement panel resize: raster task time | 8,503ms | 503ms |
| Arrangement row zoom: p95 frame interval | 148.5ms | 101.4ms |
| Arrangement row zoom: layout time | 1,434ms | 355ms |
| Arrangement scrolling: p95 frame interval | 56.8ms | 57.3ms |
| Arrangement scrolling: paint event time | 436ms | 155ms |
| Piano-roll row zoom, 4,096 notes: p95 frame interval | 131.5ms | 83.1ms |
| Piano-roll row zoom: style update time | 258ms | 43ms |

Each gesture has 60 input steps. Trace event totals can include nested paint
work and parallel raster tasks; they are not additive elapsed time. These are
single matched diagnostic runs, not FPS guarantees. In the piano-roll panel
resize run, raster work fell from 4,745ms to 366ms but p95 did **not** improve
(70.7ms to 89.8ms); WebGL canvas resizing remains a separate source of delay. A subsequent
**after-only headed/native GPU** check of that piano-roll resize measured
9.5ms p95 and 13ms raster time; it is not a matched before/after comparison.

A 100-track / 102,400-note arrangement completed row zoom plus viewport,
selection, deselection, and piano-roll opening checks. The probe waits for
zoom-only skipping to turn off and checks that offscreen DOM is restored.
For the dense piano roll, browser assertions compare every note's computed
position and size against the original pixel formula at four row heights
(including fractional zoom, within 0.02px browser layout precision), then move
and resize a note with real pointer input. Timeline screenshots were visually
checked for matching note layout and chrome; layer rasterization is not pixel
identical.

```sh
BASE=http://localhost:3091 node scripts/perf/timeline-density.mjs resize
BASE=http://localhost:3091 node scripts/perf/timeline-density.mjs zoom
BASE=http://localhost:3091 TRACKS=100 VERIFY=1 node scripts/perf/timeline-density.mjs zoom
BASE=http://localhost:3091 ROLL=1 TRACKS=1 BLOCKS=1 NOTES=4096 VERIFY=1 node scripts/perf/timeline-density.mjs zoom
```

`ROLL=1` opens the first block before profiling. `OUT_TRACE=/tmp/trace.json`
writes the raw Chrome timeline and CPU profile. Use `HEADED=1` to check native
GPU behavior; headless WebGL resizing includes software-renderer overhead.

Validation: all 1,457 tests, TypeScript, targeted ESLint, and the production build passed.


## Further pass: track chrome and viewport activity

The next remaining zoom cost was React rebuilding every track's controls on
row-height changes. One CSS grid now sizes the rows, and nested brackets use
percentages of their owning row. Only crossing the tag-label visibility
threshold triggers a track render during vertical zoom.

Viewport entry/exit no longer runs through React state. An unchanged block's
activity handle builds its note/DOM lookup on first entry, retains it while
parked, and disposes it on edits, selection changes or unmount. Hidden blocks
remain absent from the per-frame activity map; entering after pause or during
playback restores the correct state without stale flashes.

Compared with the immediately preceding local version, on the **same
100-track / 800-block / 102,400-note** fixture, controlled headless Chromium:

| Metric | Before this pass | After |
| --- | ---: | ---: |
| Row zoom: p95 frame interval | 141.0ms | 72.8ms |
| Scrolling: p95 frame interval | 139.3ms | 139.4ms |

The scrolling lifecycle change removes React work and repeated preparation but
has not improved overall scrolling frame delay; painting remains the limiting
cost. Timings are single-run diagnostics, not FPS guarantees. Native-window
profiling showed long idle/scheduling gaps and was excluded from this comparison.

New unit checks cover lazy preparation, repeated viewport entry without another
DOM scan, restoring activity at the same beat, parking across pause, duplicate
visibility callbacks, and ignoring callbacks after disposal. Browser checks
cover five row heights (including fractional height), nested bracket spans,
tag visibility at 64px, sticky labels during horizontal scrolling, and collapsing
and re-expanding nested groups:

```sh
BASE=http://localhost:3091 node scripts/perf/timeline-layout-check.mjs
BASE=http://localhost:3091 TRACKS=100 VERIFY=1 node scripts/perf/timeline-density.mjs zoom
BASE=http://localhost:3091 TRACKS=100 VERIFY=1 node scripts/perf/timeline-density.mjs scroll
```

Validation for this pass: all 1,460 tests, TypeScript, targeted ESLint, the
production build, nested-layout checks, and dense block-drag/playback checks passed.
