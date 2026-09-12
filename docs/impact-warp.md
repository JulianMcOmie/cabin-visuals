# Impact Warp

Impact Warp now has one **Impact** control. Each MIDI note on the Hit row (pitch
60) drives a centered magnification of the complete scene, including overlays.
All pixels and color channels move together. Polar Warp is separate and unchanged.

The internally tuned response loads into its peak in about 100ms, recovers over
780ms, and passes through one small rebound. Timing comes from note beat age and
project seconds per beat; it has no accumulated animation state. Note duration
is ignored. MIDI velocity remains expressive, overlapping notes compound through
a smooth limiter, and the rebound is separately limited so dense rolls cannot
produce a large reverse impact. Impact zero skips the pass entirely.

The `impact` parameter key and default (0.7) are retained, so existing intensity
automation continues to work. Saved `style`, `release`, and `size` values are
intentionally ignored by the redesigned instrument. Old style/release/size
automation no longer changes its appearance. No document migration is required.
The library card and inspector share the production envelope and scale.

## Verification

- `npm run test:visual`: 1,717 tests passed, including 11 Impact Warp tests.
- `npx tsc --noEmit --incremental false`: passed.
- Production `npm run build` against integrated main: passed.
- ESLint on all changed TypeScript/TSX files: passed.
- `node --import tsx scripts/perf/impact-warp.mjs`: compiles the production GLSL
  and checks actual pixels at wide, square, and portrait sizes for horizontal and
  vertical symmetry, aligned color channels, exact neutral output and repeated
  frame equality. Saves a contact sheet under `artifacts/impact-warp/`.
- `BASE=http://127.0.0.1:3281 node scripts/perf/impact-warp-app.mjs`: unsaved editor
  fixture exercising several instruments, the single control, worker seeking,
  intensity edits and the production export frame driver. Passed with exact
  repeated worker/export frames, exact bypass, visible displacement and no
  browser errors. The isolated dev server needs the existing `.env.local` for
  client initialization even though the fixture itself is entirely in memory.
