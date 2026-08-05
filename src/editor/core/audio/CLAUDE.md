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
- An `AudioBlock`'s beat window is DERIVED at schedule time from `startBar + trim + tempo`, never stored.
- Audio tracks are project-level (outside scenes) and pinned to the top of the timeline.
