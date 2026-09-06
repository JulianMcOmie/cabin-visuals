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

Note DOM stays mounted. Both removing previews on exit and browser content
containment added scrolling work in comparison probes, so neither is part of
the final fix. This change does not virtualize the project's initial note DOM.

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
