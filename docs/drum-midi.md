# Drum MIDI extraction (first version)

The audio track settings have **Get kick MIDI**, **Get snare MIDI**, and
**Get hi-hat MIDI** beside **Transcribe**. Each adds a new editable MIDI
Roll track to the current scene. Existing tracks and lyrics are not replaced.
Extraction uses the selected audio track’s first clip, matching Transcribe.
Save the song to an authenticated account before extracting.

The server needs the existing `ELEVENLABS_API_KEY`, Supabase URL and anon key.
It validates the authenticated user and their immutable uploaded audio ref,
then requests ElevenLabs `six_stems_v1` with `mp3_44100_128` output. Only the
named drum MP3 is extracted from the ZIP and saved privately in `project-audio`
as `<original clip ref>-drums-six-v1.mp3`. The browser gets a short-lived signed
URL; audio does not travel through a large Next.js response. No new bucket or
schema migration is required. This assumes the existing owner-prefix Storage
RLS policy permits reading/writing this derived path. Live provider and Storage
integration still need verification with an authenticated configured account.

Official contract checked September 12, 2026:
https://elevenlabs.io/docs/api-reference/music/separate-stems

The drum stem is cached across reloads. A session cache shares a worker analysis
across the three buttons; failures are retryable. Concurrent requests coalesce
within a browser session and within one server instance. This is not a
distributed lock across serverless instances. Server input is limited to 100 MiB,
ZIP to 160 MiB, extracted MP3 to 20 MiB; browser analysis supports up to 15 minutes.
The route requests a 300-second platform runtime and times out provider work
at 270 seconds. The deployed plan must support that duration. Cancellation
prevents MIDI insertion; an already-started separation continues and its cached
stem can be reused. Existing project-prefix media cleanup also owns this cache.

Detection is a heuristic, **not learned drum transcription**: bandpass envelopes,
local attacks, relative-band classification and a refractory interval produce
GM pitches 36 (kick), 38 (snare) and 42 (closed hi-hat). It can confuse bass/stem
bleed with kick, claps/toms with snare, and cymbals with hi-hat. It does not
separate open/closed hats. Quiet hits and simultaneous parts can be missed;
velocities are relative estimates. Dense mixes need manual cleanup. MP3/stem
processing can introduce small timing differences; there is no beat snapping
or quality claim based on synthetic tests.

Detections remain in original-song seconds until insertion. Placement uses the
latest BPM, bar position and trim bounds, excluding hits outside the audible
region. A changed song or scene discards stale insertion. Extracted tracks carry
an optional `drumMidi` anchor, which makes later BPM changes rescale the *edited*
notes/blocks/loops in every scene. This preserves hand edits, IDs and deletions
instead of regenerating detections. Moving/trimming audio later does not drag
existing MIDI along; it is an independent editable track.

## Validation on September 12, 2026

- Synthetic signals: silence, tonal attacks, simultaneous kick/snare, onset
  timing within 20 ms and sustained-tone rejection. These validate mechanics,
  not real-song classification quality.
- Contract/store tests: ZIP selection, bounded responses, provider quota errors,
  ownership paths, cache/retry/cancel/upload behavior, additive imports,
  fractional BPM/trim placement, serialization, manual deletions and tempo
  changes across active/inactive scenes.
- Production build and TypeScript check passed. All 1,527 repository tests passed (16 new tests).
- Real-song browser diagnostic: `public/templates/promo/music.mp3` (32 s),
  analyzed region 1.25–30 s, 120 BPM, placed at bar 1. Only the provider response
  was substituted with the original full mix because the normal checkout's
  `.env.local` has no `ELEVENLABS_API_KEY`. Actual browser MP3 decoding, the
  bundled production worker, buttons and store import yielded **92 kick, 34
  snare, 81 hi-hat candidate hits**, one analysis request, correct trim bounds,
  unchanged lyrics and zero browser page errors. There are no ground-truth
  labels: these counts are not precision/recall or evidence of musical accuracy.
  No provider requests or charges were incurred.
- Detailed timings and a control screenshot are in local
  `artifacts/drum-midi/real-song-browser.json` and `controls.png`. The browser
  diagnostic script is `scripts/check-drum-midi.cjs` (run against port 3291).

Remaining live checks: configured provider ZIP naming and stem alignment,
private Storage cache under actual account RLS, deployed runtime limit, and
listening/ground-truth evaluation on separated real songs. The feature should
be treated as experimental until those checks are completed.

Integration onto current main was revalidated September 12, 2026: all 1,719
combined repository tests passed, TypeScript passed, and the browser diagnostic
repeated the same hit counts/cache/trim/lyrics checks with zero page errors.
The controls were subsequently moved to the audio track settings beside
Transcribe, with extraction scoped to that audio track.
