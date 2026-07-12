import * as Tone from 'tone'
import { getAudioEngine } from './audio/AudioEngine'
import { shouldLoopWrap, type LoopRegion } from './loopRegion'

type BeatChangeCallback = (beat: number) => void

interface EngineCallbacks {
  onBeatChange: BeatChangeCallback
  getBpm: () => number
  getBeatsPerBar: () => number
  getMaxBeat: () => number
  getLoopRegion: () => LoopRegion | null
  onEnd: () => void
}

// Shared schedule lookahead (seconds): the transport and every audio player are
// armed at the same audio-clock `when`, so they stay sample-aligned. 50ms (up
// from 20ms) gives the N-player arming loop comfortable margin against downbeat
// jitter.
const AUDIO_LOOKAHEAD = 0.05

/**
 * The TRANSPORT engine: the Tone transport and the RAF beat clock - the sole
 * producer of the beat and of the shared `when` anchor. Audio playback lives in
 * the audio engine (core/audio/), which this hands (beat, when) at every
 * transport event; visuals live in core/visual/, reading the beat per frame.
 */
class PlaybackEngine {
  private rafId: number | null = null
  private callbacks: EngineCallbacks | null = null
  private playing = false
  private lastTrackedBeat: number | null = null

  init(callbacks: EngineCallbacks) {
    this.callbacks = callbacks
  }

  async play(startBeat: number) {
    if (!this.callbacks) return
    await Tone.start()
    const bpm = this.callbacks.getBpm()
    const beatsPerBar = this.callbacks.getBeatsPerBar()

    const transport = Tone.getTransport()
    transport.stop()
    transport.bpm.value = bpm

    // Position is the single source of truth - set it, don't add it back later.
    transport.position = beatToPosition(startBeat, beatsPerBar)

    // Arm transport + every audio block at the same audio-clock time.
    const when = Tone.now() + AUDIO_LOOKAHEAD
    transport.start(when)
    getAudioEngine().armAll(startBeat, when, bpm, beatsPerBar)

    this.playing = true
    this.lastTrackedBeat = startBeat
    this.cancelBeatTracking()
    this.startBeatTracking()
  }

  pause() {
    Tone.getTransport().pause()
    getAudioEngine().stopAll()
    this.playing = false
    this.lastTrackedBeat = null
    this.cancelBeatTracking()
  }

  /** Live tempo change: future advancement changes, the position doesn't. Every
   *  audio block's beat window just moved (fixed seconds, new beat mapping), so
   *  re-arm while playing. Audio never time-stretches - it re-anchors. */
  setBpm(bpm: number) {
    Tone.getTransport().bpm.value = bpm
    if (this.playing && this.callbacks) {
      const beatsPerBar = this.callbacks.getBeatsPerBar()
      const beat = positionToBeat(Tone.getTransport().position, beatsPerBar)
      const when = Tone.now() + AUDIO_LOOKAHEAD
      getAudioEngine().armAll(beat, when, bpm, beatsPerBar)
    }
  }

  /** Jump the (possibly playing) transport to a new beat, re-arming audio if live. */
  seek(beat: number) {
    if (!this.callbacks) return
    const bpm = this.callbacks.getBpm()
    const beatsPerBar = this.callbacks.getBeatsPerBar()
    Tone.getTransport().position = beatToPosition(beat, beatsPerBar)
    this.lastTrackedBeat = beat
    if (this.playing) {
      const when = Tone.now() + AUDIO_LOOKAHEAD
      getAudioEngine().armAll(beat, when, bpm, beatsPerBar)
    }
  }

  /** Re-arm audio at the current position (block edits / mute toggles while playing). */
  rearmAudio() {
    if (!this.playing || !this.callbacks) return
    const bpm = this.callbacks.getBpm()
    const beatsPerBar = this.callbacks.getBeatsPerBar()
    const beat = positionToBeat(Tone.getTransport().position, beatsPerBar)
    const when = Tone.now() + AUDIO_LOOKAHEAD
    getAudioEngine().armAll(beat, when, bpm, beatsPerBar)
  }

  private startBeatTracking() {
    const tick = () => {
      if (!this.callbacks) return
      const { onBeatChange, getBeatsPerBar, getMaxBeat, getLoopRegion, onEnd } = this.callbacks
      const beat = positionToBeat(Tone.getTransport().position, getBeatsPerBar())
      const previousBeat = this.lastTrackedBeat ?? beat
      this.lastTrackedBeat = beat
      const maxBeat = getMaxBeat()

      // Loop-region wrap, checked before the end-of-timeline stop so a region
      // ending at maxBeat loops instead of stopping. This lives only in the
      // live RAF tick - export drives beats through the beat override and
      // never runs this loop, so exports walk straight through the region.
      const region = getLoopRegion()
      if (region && shouldLoopWrap(previousBeat, beat, region)) {
        this.seek(region.startBeat)
        onBeatChange(region.startBeat)
        // Same zombie guard as below: an onBeatChange subscriber may pause().
        if (!this.playing) return
        this.rafId = requestAnimationFrame(tick)
        return
      }

      if (beat >= maxBeat) {
        Tone.getTransport().stop()
        getAudioEngine().stopAll()
        this.playing = false
        this.lastTrackedBeat = null
        onBeatChange(maxBeat)
        onEnd()
        return
      }

      onBeatChange(beat)
      // An onBeatChange subscriber may pause() DURING this tick (the tutorial's
      // pass-the-block watcher does). That cancels rafId, but this callback is
      // already running - rescheduling unconditionally would resurrect the loop
      // as a zombie that pins currentBeat to the paused transport's position
      // every frame (scrubbing appears locked until the next play).
      if (!this.playing) return
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  private cancelBeatTracking() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }
}

/** beat -> Tone transport position "bars:beats:sixteenths". */
function beatToPosition(beat: number, beatsPerBar: number): string {
  const bars = Math.floor(beat / beatsPerBar)
  const beats = beat % beatsPerBar
  return `${bars}:${beats}:0`
}

/** Tone transport position -> absolute beat (with sub-beat precision). */
function positionToBeat(position: unknown, beatsPerBar: number): number {
  const [bars, beats, sixteenths] = String(position).split(':').map(Number)
  return (bars || 0) * beatsPerBar + (beats || 0) + (sixteenths || 0) / 4
}

let _engine: PlaybackEngine | null = null

export function getPlaybackEngine(): PlaybackEngine {
  if (!_engine) _engine = new PlaybackEngine()
  return _engine
}
