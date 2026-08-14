# core/audio — everything that makes sound, behind one door

`AudioEngine` (singleton via `getAudioEngine()`) consumes the beat **discretely**: players are armed at transport events (play/seek/bpm change) and Tone's clock carries them between — no per-frame work.

## The one guardrail

**This engine has NO clock of its own.** `when` (absolute audio-clock seconds) is always computed by the transport (`core/playback.ts`) and passed in — never `Tone.now()` here. One shared anchor keeps N players + transport sample-aligned.

## Files

- `AudioEngine.ts` — player pool keyed by block id; `armAll(beat, when, bpm, beatsPerBar)` gathers audible blocks (mute/solo folded in at gather time) and schedules each via placement math. Master `Tone.Gain(0.85)` for headroom + a `Tone.Meter` tap (`getOutputLevel()`) feeding the transport's audio-reactive glow — a pure listener.
- `placement.ts` — **the one place beat⟷second block-placement math lives**, shared LITERALLY by live playback and offline export. Three cases per block vs `atBeat`: past → null, future → delay ahead, mid-clip → join at in-clip offset. Change placement semantics HERE only; both paths follow.
- `waveform.ts` — decode + peak cache (`getBuffer`); powers timeline waveforms and the export's offline render.
- `audioSource.ts` — bytes behind refs (bucket + session cache); `beatDetect.ts` — onset/BPM estimation for imported audio.

## Semantics to preserve

- Audio **never time-stretches**; a BPM change re-anchors (beat window recomputed from fixed seconds). The audible seam at re-anchor is inherent — gestures batch it to release (see playback.ts drag suppression).
- **Slow monitoring (½× / ¼×) is the one thing that changes a clip's playback speed — and it is VARISPEED, not time-stretch**: the player's `playbackRate` resamples, so the pitch drops an octave per halving (a deliberate product decision, and what the tooltips promise). It is not a tempo change: `blockPlacement` still runs at the PROJECT bpm, so a block's beat window never moves. The rate is spent in exactly two places — `delayAtRate` stretches the wall-clock delay, and the player's own rate stretches the clip — which is what keeps a clip glued to its beats at any speed (`core/playbackRate.test.ts` pins that three-way agreement). `duration` passed to `Player.start` stays in SOURCE seconds: Tone divides it by playbackRate itself. `armAll`'s `rate` defaults to 1, so export (which calls `blockPlacement` directly) is untouched.
- An `AudioBlock`'s beat window is DERIVED at schedule time from `startBar + trim + tempo`, never stored.
- Audio tracks are project-level (outside scenes) and pinned to the top of the timeline.
